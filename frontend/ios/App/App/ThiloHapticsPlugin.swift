import Capacitor
import UIKit

/**
 * Thilos Fork: Haptik über die Taptic Engine (lib/thilo-haptics.js).
 *
 * Die Web-Ansicht kennt auf dem iPhone kein navigator.vibrate; jeder Tap und jede wichtige Aktion
 * (Satz abhaken, Training beenden, Löschen) kommt deshalb hier an.
 *
 *   ThiloHaptics.play({ kind: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' })
 *
 * Angemeldet in ThiloBridgeViewController (Capacitor 7: registerPluginInstance), in den Build
 * aufgenommen von thilo/ios/add-rest-widget.rb. Die iOS-Einstellung „System-Haptik“ gilt.
 */
@objc(ThiloHapticsPlugin)
public class ThiloHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ThiloHapticsPlugin"
    public let jsName = "ThiloHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise)
    ]

    // Vorbereitet gehalten, damit der Impuls ohne Anlaufzeit kommt. Nur auf dem Main-Thread benutzen.
    private lazy var light = UIImpactFeedbackGenerator(style: .light)
    private lazy var medium = UIImpactFeedbackGenerator(style: .medium)
    private lazy var heavy = UIImpactFeedbackGenerator(style: .heavy)
    private lazy var selection = UISelectionFeedbackGenerator()
    private lazy var notification = UINotificationFeedbackGenerator()

    override public func load() {
        DispatchQueue.main.async {
            self.light.prepare()
            self.selection.prepare()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "light"
        DispatchQueue.main.async {
            switch kind {
            case "medium":
                self.medium.impactOccurred()
                self.medium.prepare()
            case "heavy":
                self.heavy.impactOccurred()
                self.heavy.prepare()
            case "selection":
                self.selection.selectionChanged()
                self.selection.prepare()
            case "success":
                self.notification.notificationOccurred(.success)
                self.notification.prepare()
            case "warning":
                self.notification.notificationOccurred(.warning)
                self.notification.prepare()
            default:
                self.light.impactOccurred()
                self.light.prepare()
            }
        }
        call.resolve()
    }
}
