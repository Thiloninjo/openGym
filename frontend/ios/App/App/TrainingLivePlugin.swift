import Foundation
import Capacitor
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 * Thilos Fork: das laufende Training auf dem iPhone.
 *
 * - Live-Aktivität (RestWidget): Name des Trainings, aktuelle Übung, Satz x von y und die laufende
 *   Trainingszeit; in der Pause Countdown mit Fortschrittsbalken, nach Ablauf der Hinweis aus JS
 *   („Pause vorbei. Nächster Satz!“). Endet mit dem Training.
 * - Wachhalten und Ansage (TrainingAudio): stille Schleife während des Trainings, zum Pausenende
 *   eine Ansage per Stimme, andere Musik wird solange leiser. Der Zeitgeber dafür läuft hier nativ,
 *   nicht im WebView (der wird im Hintergrund gedrosselt).
 *
 * Angemeldet in ThiloBridgeViewController (Capacitor 7: registerPluginInstance).
 * Aus JS (lib/thilo-ios-training.js):
 *   TrainingLive.start/update({ name, startedAt, exercise, setNo, setCount })
 *   TrainingLive.end()
 *   TrainingLive.rest({ endsAt, totalSec, title, doneTitle, speech, sound, lang })
 *   TrainingLive.hold({ leftSec, totalSec, title, doneTitle })
 *   TrainingLive.restStop()
 */
@objc(TrainingLivePlugin)
public class TrainingLivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TrainingLivePlugin"
    public let jsName = "TrainingLive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hold", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restStop", returnType: CAPPluginReturnPromise)
    ]

    /// Was die Live-Aktivität zeigt, unabhängig von der iOS-Version gehalten.
    private struct Live {
        var name = ""
        var startedAt = Date()
        var exercise = ""
        var setNo = 0
        var setCount = 0
        var restEndsAt: Date?
        var restTotal = 0
        var restLeft: Int?
        var restTitle = "Pause"
        var doneTitle = "Pause vorbei"
        var ready = false
    }

    // Entsteht mit dem Plugin in ThiloBridgeViewController.capacitorDidLoad, also auf dem Main-Thread.
    private let audio = TrainingAudio()
    private var live = Live()
    private var training = false
    private var restTimer: DispatchSourceTimer?
    private var chain: Task<Void, Never>?

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    // MARK: Training

    @objc func start(_ call: CAPPluginCall) {
        let fields = TrainingLivePlugin.fields(call)
        let startedAt = call.getDouble("startedAt").map { Date(timeIntervalSince1970: $0 / 1000) }
        DispatchQueue.main.async {
            self.training = true
            if let s = startedAt { self.live.startedAt = s }
            self.apply(fields)
            self.audio.startKeepAlive()
            self.push()
            call.resolve()
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        let fields = TrainingLivePlugin.fields(call)
        DispatchQueue.main.async {
            self.apply(fields)
            // Der nächste Satz ist dran oder erledigt: „Nächster Satz“ hat seinen Zweck erfüllt.
            if self.live.restEndsAt == nil && self.live.restLeft == nil { self.live.ready = false }
            self.push()
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.training = false
            self.cancelRestTimer()
            self.live = Live()
            self.audio.stopKeepAlive()
            self.push()
            call.resolve()
        }
    }

    // MARK: Pause

    @objc func rest(_ call: CAPPluginCall) {
        guard let ms = call.getDouble("endsAt") else { call.reject("endsAt is required"); return }
        let end = Date(timeIntervalSince1970: ms / 1000)
        let total = max(1, call.getInt("totalSec") ?? Int(end.timeIntervalSinceNow.rounded()))
        let title = call.getString("title")
        let doneTitle = call.getString("doneTitle")
        let speech = call.getString("speech") ?? doneTitle ?? ""
        let sound = call.getBool("sound") ?? true
        let lang = call.getString("lang")
        DispatchQueue.main.async {
            self.live.restEndsAt = end
            self.live.restTotal = total
            self.live.restLeft = nil
            self.live.ready = false
            if let t = title { self.live.restTitle = t }
            if let d = doneTitle { self.live.doneTitle = d }
            self.audio.startKeepAlive()
            self.scheduleRestEnd(at: end, speech: sound ? speech : nil, lang: lang)
            self.push()
            call.resolve()
        }
    }

    @objc func hold(_ call: CAPPluginCall) {
        let left = max(1, call.getInt("leftSec") ?? 1)
        let total = max(left, call.getInt("totalSec") ?? left)
        let title = call.getString("title")
        let doneTitle = call.getString("doneTitle")
        DispatchQueue.main.async {
            self.cancelRestTimer()
            self.live.restEndsAt = Date().addingTimeInterval(Double(left))
            self.live.restTotal = total
            self.live.restLeft = left
            self.live.ready = false
            if let t = title { self.live.restTitle = t }
            if let d = doneTitle { self.live.doneTitle = d }
            self.push()
            call.resolve()
        }
    }

    @objc func restStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cancelRestTimer()
            self.live.restEndsAt = nil
            self.live.restLeft = nil
            self.live.ready = false
            self.push()
            call.resolve()
        }
    }

    // MARK: Zeitgeber

    private func scheduleRestEnd(at end: Date, speech: String?, lang: String?) {
        cancelRestTimer()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        timer.schedule(wallDeadline: .now() + max(0, end.timeIntervalSinceNow))
        timer.setEventHandler { [weak self] in self?.restEnded(speech: speech, lang: lang) }
        restTimer = timer
        timer.resume()
    }

    private func cancelRestTimer() {
        restTimer?.cancel()
        restTimer = nil
    }

    private func restEnded(speech: String?, lang: String?) {
        cancelRestTimer()
        live.restEndsAt = nil
        live.restLeft = nil
        live.ready = true
        if let s = speech, !s.isEmpty { audio.speak(s, lang: lang) }
        push()
    }

    @objc private func willEnterForeground() {
        DispatchQueue.main.async { if self.training { self.audio.resume() } }
    }

    // MARK: Felder

    private struct Fields {
        var name: String?
        var exercise: String?
        var setNo: Int?
        var setCount: Int?
    }

    private static func fields(_ call: CAPPluginCall) -> Fields {
        Fields(name: call.getString("name"), exercise: call.getString("exercise"),
               setNo: call.getInt("setNo"), setCount: call.getInt("setCount"))
    }

    private func apply(_ f: Fields) {
        if let v = f.name { live.name = v }
        if let v = f.exercise { live.exercise = v }
        if let v = f.setNo { live.setNo = v }
        if let v = f.setCount { live.setCount = v }
    }

    // MARK: Live-Aktivität

    /// Bringt die Live-Aktivität auf den Stand von `live`. Die Aufrufe laufen nacheinander (chain),
    /// damit eine schnelle Folge (Pause aus, Pause an) nicht in falscher Reihenfolge ankommt.
    private func push() {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let want = training || live.restEndsAt != nil || live.restLeft != nil || live.ready
            let state = contentState()
            let stale: Date? = live.restLeft == nil ? live.restEndsAt : nil
            let startedAt = live.startedAt
            let previous = chain
            chain = Task {
                await previous?.value
                await TrainingLivePlugin.sync(want: want, state: state, stale: stale, startedAt: startedAt)
            }
        }
        #endif
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private func contentState() -> RestActivityAttributes.ContentState {
        RestActivityAttributes.ContentState(
            name: live.name, exercise: live.exercise, setNo: live.setNo, setCount: live.setCount,
            restEndsAt: live.restEndsAt, restTotal: live.restTotal, restLeft: live.restLeft,
            restTitle: live.restTitle, doneTitle: live.doneTitle, ready: live.ready)
    }

    @available(iOS 16.2, *)
    private static func sync(want: Bool, state: RestActivityAttributes.ContentState, stale: Date?, startedAt: Date) async {
        let content = ActivityContent(state: state, staleDate: stale)
        var current: Activity<RestActivityAttributes>?
        for activity in Activity<RestActivityAttributes>.activities {
            let open = activity.activityState != .ended && activity.activityState != .dismissed
            let same = abs(activity.attributes.startedAt.timeIntervalSince(startedAt)) < 1
            if want && current == nil && open && same {
                current = activity
            } else {
                // Eine andere (älteres Training, App mitten drin beendet) oder keine mehr gewünscht.
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        guard want else { return }
        if let activity = current {
            await activity.update(content)
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            _ = try Activity.request(attributes: RestActivityAttributes(startedAt: startedAt), content: content, pushType: nil)
        } catch {
            NSLog("%@", "[TrainingLive] Live-Aktivität starten: \(error.localizedDescription)")
        }
    }
    #endif
}
