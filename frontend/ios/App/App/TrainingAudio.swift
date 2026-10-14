import AVFoundation
import Foundation

/**
 * Thilos Fork: Ton-Seite des laufenden Trainings (TrainingLivePlugin).
 *
 * - Wachhalten: Während eines Trainings spielt eine stille Schleife in einer `.playback`-Session mit
 *   `.mixWithOthers`. Mit dem Hintergrundmodus `audio` (Info.plist) bleibt die App dadurch auch bei
 *   gesperrtem Bildschirm am Laufen, ohne andere Musik zu stören.
 * - Ansage: `speak` schaltet die Session kurz auf `.duckOthers` (andere Musik wird leiser), spricht
 *   den Text mit AVSpeechSynthesizer und gibt danach die Lautstärke zurück (Session kurz deaktivieren
 *   mit `.notifyOthersOnDeactivation`, wieder nur `.mixWithOthers`, Schleife läuft weiter).
 * - Unterbrechungen (Anruf, Siri, eine andere App übernimmt): danach wird die Schleife wieder gestartet.
 *
 * Alle Methoden laufen auf dem Main-Thread.
 */
final class TrainingAudio: NSObject, AVSpeechSynthesizerDelegate {
    private let session = AVAudioSession.sharedInstance()
    private let synth = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var keepingAlive = false
    private var current: AVSpeechUtterance?
    private var restoreLater: DispatchWorkItem?

    override init() {
        super.init()
        synth.delegate = self
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        nc.addObserver(self, selector: #selector(mediaServicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: session)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func startKeepAlive() {
        keepingAlive = true
        resume()
    }

    func stopKeepAlive() {
        keepingAlive = false
        player?.stop()
        player = nil
        if current == nil { deactivate() }
    }

    /// Schleife (wieder) starten, falls ein Training läuft und gerade nichts gesprochen wird.
    func resume() {
        guard keepingAlive, current == nil else { return }
        activate(duck: false)
        if player == nil { player = makePlayer() }
        if player?.isPlaying != true { player?.play() }
    }

    func speak(_ text: String, lang: String?) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        // Ducking greift erst, wenn die Session (neu) aktiviert wird: Schleife anhalten, Session aus,
        // mit .duckOthers wieder an.
        player?.stop()
        deactivate(notify: false)
        activate(duck: true)
        if keepingAlive { player?.play() }
        let utterance = AVSpeechUtterance(string: words)
        utterance.voice = TrainingAudio.voice(for: lang)
        current = utterance
        synth.speak(utterance)
        // Falls der Synthesizer nie Bescheid gibt: spätestens nach 15 s ist die Musik wieder laut.
        restoreLater?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.doneSpeaking() }
        restoreLater = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
    }

    private func doneSpeaking() {
        guard current != nil else { return }
        current = nil
        restoreLater?.cancel()
        restoreLater = nil
        unduck(tries: 4)
    }

    // Erst das Deaktivieren gibt der anderen Musik ihre Lautstärke zurück. Hält der Synthesizer die
    // Ausgabe noch einen Moment, scheitert es ("running I/O"): dann kurz danach noch einmal.
    private func unduck(tries: Int) {
        guard current == nil else { return }
        player?.stop()
        if !deactivate(notify: true) && tries > 1 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.unduck(tries: tries - 1) }
            return
        }
        if keepingAlive {
            activate(duck: false)
            if player == nil { player = makePlayer() }
            player?.play()
        }
    }

    // MARK: AVSpeechSynthesizerDelegate

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { if utterance === self.current { self.doneSpeaking() } }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { if utterance === self.current { self.doneSpeaking() } }
    }

    // MARK: Session

    private func activate(duck: Bool) {
        var options: AVAudioSession.CategoryOptions = [.mixWithOthers]
        if duck { options.insert(.duckOthers) }
        do {
            try session.setCategory(.playback, mode: .default, options: options)
            try session.setActive(true)
        } catch {
            NSLog("%@", "[TrainingAudio] Session aktivieren (duck: \(duck)): \(error.localizedDescription)")
        }
    }

    @discardableResult
    private func deactivate(notify: Bool = true) -> Bool {
        do {
            try session.setActive(false, options: notify ? [.notifyOthersOnDeactivation] : [])
            return true
        } catch {
            NSLog("%@", "[TrainingAudio] Session deaktivieren: \(error.localizedDescription)")
            return false
        }
    }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            switch type {
            case .began:
                // Die Ansage ist mit unterbrochen worden; die Schleife hat iOS schon angehalten.
                if self.current != nil { self.synth.stopSpeaking(at: .immediate); self.current = nil }
            case .ended:
                // Auch ohne .shouldResume: wir mischen nur mit, die stille Schleife stört niemanden.
                self.resume()
            @unknown default:
                break
            }
        }
    }

    @objc private func mediaServicesReset(_ note: Notification) {
        DispatchQueue.main.async {
            self.player = nil
            self.current = nil
            self.resume()
        }
    }

    // MARK: Helfer

    private func makePlayer() -> AVAudioPlayer? {
        do {
            let p = try AVAudioPlayer(data: TrainingAudio.silence)
            p.numberOfLoops = -1
            p.prepareToPlay()
            return p
        } catch {
            NSLog("%@", "[TrainingAudio] Stille Schleife: \(error.localizedDescription)")
            return nil
        }
    }

    private static func voice(for lang: String?) -> AVSpeechSynthesisVoice? {
        let code = (lang ?? "").isEmpty ? "de-DE" : lang!
        if let v = AVSpeechSynthesisVoice(language: code) { return v }
        let base = code.split(separator: "-").first.map(String.init) ?? code
        if let v = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language.hasPrefix(base) }) { return v }
        return AVSpeechSynthesisVoice(language: "de-DE")
    }

    /// Eine Sekunde Stille als WAV (8 kHz, 16 Bit, mono), im Speicher erzeugt.
    private static let silence: Data = {
        let rate: UInt32 = 8000
        let bytes: UInt32 = rate * 2
        var d = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
        d.append(contentsOf: Array("RIFF".utf8)); u32(36 + bytes)
        d.append(contentsOf: Array("WAVE".utf8))
        d.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append(contentsOf: Array("data".utf8)); u32(bytes)
        d.append(Data(count: Int(bytes)))
        return d
    }()
}
