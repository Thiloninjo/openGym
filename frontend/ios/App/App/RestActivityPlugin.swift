import Foundation
import Capacitor
import UIKit
import UserNotifications
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 * Thilos Fork: Satzpause auf dem iPhone.
 *
 * - Ton: Ist die App im Hintergrund oder der Bildschirm gesperrt, läutet eine lokale Mitteilung
 *   das Ende der Pause ein. Ist die App offen, spielt die Seite ihren eigenen Ton (useUI), die
 *   Mitteilung wird dann nicht geplant oder beim Zurückkommen wieder entfernt, damit es nie
 *   doppelt klingt.
 * - Live-Aktivität: Countdown auf dem Sperrbildschirm und in der Dynamic Island (RestWidget).
 *
 * Aus JS (lib/thilo-ios-rest.js):
 *   RestActivity.start({ endsAt, totalSec, title, doneTitle, sound })
 *   RestActivity.hold({ leftSec, totalSec, title, doneTitle })
 *   RestActivity.stop()
 */
@objc(RestActivityPlugin)
public class RestActivityPlugin: CAPPlugin {
    private let notifId = "og-rest-over"
    private var endsAt: Date?
    private var doneTitle = "Pause vorbei"
    private var sound = true

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let ms = call.getDouble("endsAt") else { call.reject("endsAt is required"); return }
        let end = Date(timeIntervalSince1970: ms / 1000)
        let total = call.getInt("totalSec") ?? max(1, Int(end.timeIntervalSinceNow.rounded()))
        let title = call.getString("title") ?? "Pause"
        doneTitle = call.getString("doneTitle") ?? doneTitle
        sound = call.getBool("sound") ?? true
        endsAt = end
        askOnce()
        DispatchQueue.main.async {
            self.cancelNotification()
            if UIApplication.shared.applicationState != .active { self.scheduleNotification() }
        }
        showActivity(endsAt: end, totalSec: total, pausedLeft: nil, title: title)
        call.resolve()
    }

    @objc func hold(_ call: CAPPluginCall) {
        let left = max(1, call.getInt("leftSec") ?? 1)
        let total = max(left, call.getInt("totalSec") ?? left)
        let title = call.getString("title") ?? "Pause"
        doneTitle = call.getString("doneTitle") ?? doneTitle
        endsAt = nil
        DispatchQueue.main.async { self.cancelNotification() }
        showActivity(endsAt: Date().addingTimeInterval(Double(left)), totalSec: total, pausedLeft: left, title: title)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        endsAt = nil
        DispatchQueue.main.async { self.cancelNotification() }
        endActivities()
        call.resolve()
    }

    @objc private func didEnterBackground() {
        scheduleNotification()
    }

    @objc private func willEnterForeground() {
        // Noch nicht abgelaufen: die Seite übernimmt den Ton wieder selbst.
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [notifId])
    }

    private func askOnce() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            if settings.authorizationStatus == .notDetermined {
                center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
            }
        }
    }

    private func scheduleNotification() {
        guard let end = endsAt, end.timeIntervalSinceNow > 0.5 else { return }
        let content = UNMutableNotificationContent()
        content.title = doneTitle
        if sound { content.sound = .default }
        if #available(iOS 15.0, *) { content.interruptionLevel = .active }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: end.timeIntervalSinceNow, repeats: false)
        let request = UNNotificationRequest(identifier: notifId, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    private func cancelNotification() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [notifId])
        center.removeDeliveredNotifications(withIdentifiers: [notifId])
    }

    private func showActivity(endsAt: Date, totalSec: Int, pausedLeft: Int?, title: String) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let state = RestActivityAttributes.ContentState(endsAt: endsAt, totalSec: totalSec, pausedLeft: pausedLeft, title: title, doneTitle: doneTitle)
            let content = ActivityContent(state: state, staleDate: pausedLeft == nil ? endsAt : nil)
            Task {
                if let current = Activity<RestActivityAttributes>.activities.first {
                    await current.update(content)
                } else {
                    _ = try? Activity.request(attributes: RestActivityAttributes(name: "rest"), content: content, pushType: nil)
                }
            }
        }
        #endif
    }

    private func endActivities() {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for activity in Activity<RestActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
        #endif
    }
}
