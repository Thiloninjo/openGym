import AVFoundation
import Foundation

/**
 * Thilos Fork: Ton-Seite des laufenden Trainings (TrainingLivePlugin).
 *
 * - Wachhalten: Solange eine Pause läuft (und kurz danach), spielt eine stille Schleife in einer
 *   `.playback`-Session mit `.mixWithOthers`. Mit dem Hintergrundmodus `audio` (Info.plist) bleibt die
 *   App dadurch auch bei gesperrtem Bildschirm am Laufen, ohne andere Musik zu stören. Das Plugin
 *   startet sie mit jeder Pause und lässt sie nach Pausenende und Ansage noch eine Weile laufen
 *   (`stopKeepAlive(after:)`), damit nicht ein ganzes Training lang Akku draufgeht.
 * - Ansage: `speak` schaltet die Session kurz auf `.duckOthers` (andere Musik wird leiser), spricht
 *   den Text mit AVSpeechSynthesizer und gibt danach die Lautstärke zurück (Session deaktivieren mit
 *   `.notifyOthersOnDeactivation`, wieder nur `.mixWithOthers`, Schleife läuft weiter). Scheitert das
 *   Deaktivieren, wird die Ausgabe des Synthesizers hart beendet und länger weiter versucht; die
 *   Session bleibt nie mit `.duckOthers` aktiv zurück.
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
    private var lingerStop: DispatchWorkItem?
    private var lingerDelay: TimeInterval?   // Schleife nach dem Ende der laufenden Ansage noch so lange halten

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
        cancelLinger()
        keepingAlive = true
        resume()
    }

    func stopKeepAlive() {
        cancelLinger()
        keepingAlive = false
        player?.stop()
        player = nil
        if current == nil { deactivate() }
    }

    /// Schleife noch `delay` Sekunden halten, dann stoppen. Läuft gerade eine Ansage, zählt die Zeit
    /// erst ab deren Ende.
    func stopKeepAlive(after delay: TimeInterval) {
        guard keepingAlive else { return }
        cancelLinger()
        if current != nil { lingerDelay = delay; return }
        armLinger(delay)
    }

    private func armLinger(_ delay: TimeInterval) {
        let work = DispatchWorkItem { [weak self] in self?.stopKeepAlive() }
        lingerStop = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func cancelLinger() {
        lingerStop?.cancel()
        lingerStop = nil
        lingerDelay = nil
    }

    /// Kategorie (.playback, .mixWithOthers) neu setzen und die Schleife (wieder) starten, solange sie
    /// gebraucht wird und gerade nichts gesprochen wird (dann gilt die Ducking-Kategorie).
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
        unduck(attempt: 0)
    }

    // Erst das Deaktivieren gibt der anderen Musik ihre Lautstärke zurück. Hält der Synthesizer die
    // Ausgabe noch ("running I/O"), scheitert es: nach dem dritten Fehlschlag wird er hart gestoppt,
    // insgesamt gut 10 s lang weiter versucht. Klappt es nie, fliegt wenigstens .duckOthers aus der
    // Kategorie, damit die Session nicht duckend aktiv bleibt.
    private func unduck(attempt: Int) {
        guard current == nil else { return }
        player?.stop()
        if !deactivate(notify: true) {
            if attempt == 3 { synth.stopSpeaking(at: .immediate) }
            if attempt < 20 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.unduck(attempt: attempt + 1) }
                return
            }
            NSLog("%@", "[TrainingAudio] Session ließ sich nicht deaktivieren, nehme .duckOthers zurück")
            do {
                try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            } catch {
                NSLog("%@", "[TrainingAudio] Kategorie ohne Ducking: \(error.localizedDescription)")
            }
        }
        if keepingAlive {
            activate(duck: false)
            if player == nil { player = makePlayer() }
            player?.play()
        }
        armPendingLinger()
    }

    // Die Ansage ist vorbei (oder abgebrochen): eine aufgeschobene Nachlaufzeit beginnt jetzt.
    private func armPendingLinger() {
        guard let delay = lingerDelay else { return }
        lingerDelay = nil
        if keepingAlive { armLinger(delay) }
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
                self.armPendingLinger()
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
            self.armPendingLinger()
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

    // Die App-Sprache kommt als bloßer Code ("de"). Bevorzugte Varianten: de → de-DE, en → en-US;
    // sonst die Systemsprache, wenn sie dieselbe Sprache ist, dann irgendeine Stimme der Sprache,
    // zuletzt die Systemstimme.
    private static let preferredLocale = ["de": "de-DE", "en": "en-US"]

    private static func voice(for lang: String?) -> AVSpeechSynthesisVoice? {
        let raw = (lang ?? "").replacingOccurrences(of: "_", with: "-").trimmingCharacters(in: .whitespaces)
        let system = AVSpeechSynthesisVoice.currentLanguageCode()
        let code: String
        if raw.isEmpty {
            code = "de-DE"
        } else if let p = preferredLocale[raw.lowercased()] {
            code = p
        } else if raw.contains("-") {
            code = raw
        } else if system.lowercased().hasPrefix(raw.lowercased() + "-") {
            code = system
        } else {
            code = raw
        }
        if let v = AVSpeechSynthesisVoice(language: code) { return v }
        let base = (code.split(separator: "-").first.map(String.init) ?? code).lowercased()
        if let v = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language.lowercased().hasPrefix(base + "-") }) { return v }
        return AVSpeechSynthesisVoice(language: system)
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
