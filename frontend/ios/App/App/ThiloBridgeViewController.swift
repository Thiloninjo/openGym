import UIKit
import Capacitor

/**
 * Thilos Fork: meldet die lokalen Plugins der App bei Capacitor an.
 *
 * Capacitor 7 lädt von selbst nur Plugins aus npm-Paketen (capacitor.config.json packageClassList).
 * Plugins im App-Target selbst müssen hier über registerPluginInstance angemeldet werden und
 * CAPBridgedPlugin erfüllen (capacitorjs.com/docs/v7/ios/custom-code). Main.storyboard zeigt auf
 * diese Klasse statt auf CAPBridgeViewController.
 */
class ThiloBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TrainingLivePlugin())
        bridge?.registerPluginInstance(PrintPlugin())
    }
}
