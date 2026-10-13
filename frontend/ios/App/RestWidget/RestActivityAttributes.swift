// Thilos Fork: Daten der Live-Aktivität für die Satzpause. Gehört zu beiden Targets, der App
// (RestActivityPlugin startet und ändert sie) und der Widget-Erweiterung (zeigt sie an).
import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct RestActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Ende der Pause; bei einer angehaltenen Pause steht die Restzeit in pausedLeft.
        public var endsAt: Date
        public var totalSec: Int
        public var pausedLeft: Int?
        public var title: String
        public var doneTitle: String
    }
    public var name: String
}
#endif
