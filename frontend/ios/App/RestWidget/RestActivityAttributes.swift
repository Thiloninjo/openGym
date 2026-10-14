// Thilos Fork: Daten der Live-Aktivität für das laufende Training samt Satzpause. Gehört zu beiden
// Targets, der App (TrainingLivePlugin startet und ändert sie) und der Widget-Erweiterung (zeigt sie an).
// Klein gehalten: ein paar Texte, Zahlen und Zeitpunkte; Countdown und Trainingszeit zählt das
// Widget selbst (Text(timerInterval:)).
import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct RestActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var name: String          // Training
        public var exercise: String      // aktuelle Übung
        public var setNo: Int            // Satz x …
        public var setCount: Int         // … von y
        // Pause: läuft bis restEndsAt; angehalten steht die Restzeit in restLeft. Ohne Pause nil.
        public var restEndsAt: Date?
        public var restTotal: Int
        public var restLeft: Int?
        public var restTitle: String     // „Pause“ / „Seite wechseln“
        public var doneTitle: String     // nach Ablauf, z. B. „Pause vorbei. Nächster Satz!“
        public var ready: Bool           // Pause abgelaufen, der nächste Satz ist dran
    }
    // Beginn des Trainings; die Trainingszeit zählt von hier hoch.
    public var startedAt: Date
}
#endif
