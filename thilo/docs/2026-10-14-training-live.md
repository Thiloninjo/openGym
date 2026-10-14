# Training live auf dem Sperrbildschirm, Ansage mit leiserer Musik (Thilos Fork)

**Stand:** 14.10.2026, mit Thilo abgestimmt. Vorbild: Adidas Running (Lauf als Live-Aktivität, Ansage per Stimme, Musik wird kurz leiser).

## Befund (warum Build 3 nichts tat)

- `RestActivityPlugin` und `PrintPlugin` sind nur per `CAP_PLUGIN`-Makro (`.m`) angemeldet. Capacitor 7 lädt
  lokale Plugins im App-Target aber nur, wenn sie über `bridge?.registerPluginInstance(...)` in einer eigenen
  `CAPBridgeViewController`-Unterklasse (`capacitorDidLoad`) registriert werden und `CAPBridgedPlugin` erfüllen
  (Doku: capacitorjs.com/docs/v7/ios/custom-code). `Main.storyboard` nutzt den Standard-Controller.
- Folge: jeder Aufruf scheitert, `lib/thilo-ios-rest.js` verschluckt den Fehler (`.catch(() => {})`).
  Bestätigt durch Thilo: PDF-Druck (PrintPlugin) geht in der App ebenfalls nicht. Mitteilungen sind an.

## Ziel

1. Plugins richtig registrieren (Rest/Training und Print).
2. **Ganzes Training als Live-Aktivität** (Sperrbildschirm und Dynamic Island), solange ein Training läuft:
   Name des Trainings, aktuelle Übung, Satz x von y, laufende Trainingszeit (zählt selbst hoch). In der Pause
   stattdessen der Countdown mit Fortschrittsbalken; nach Ablauf „Nächster Satz“. Ende des Trainings beendet sie.
3. **Ansage per Stimme** zum Pausenende, auch bei gesperrtem Bildschirm und ohne Mitteilungen; andere Musik wird
   währenddessen leiser (Ducking) und danach wieder lauter. Text kommt aus JS (heute „Pause vorbei. Nächster Satz.“
   bzw. Seitenwechsel), Thilo passt ihn später an.

## Lösung

- **Registrierung**: `frontend/ios/App/App/ThiloBridgeViewController.swift` (Unterklasse von `CAPBridgeViewController`,
  `capacitorDidLoad` registriert beide Plugins); `Main.storyboard` zeigt darauf (customClass, customModule App).
  Plugins erfüllen `CAPBridgedPlugin` (`identifier`, `jsName`, `pluginMethods`); `.m`-Dateien entfallen oder bleiben
  wirkungslos, je nachdem was mit Capacitor 7 sauber baut. Das Xcode-Projekt bekommt neue Dateien wie bisher über
  `thilo/ios/add-rest-widget.rb` (kein Mac).
- **Wachhalten**: Hintergrundmodus `audio` (`UIBackgroundModes` in `App/Info.plist`). Während eines Trainings hält
  eine stille Audio-Schleife (`AVAudioSession` `.playback` mit `.mixWithOthers`) die App am Leben, damit die
  Ansage auch bei gesperrtem Bildschirm kommt. Start mit Trainingsbeginn, Stop mit Trainingsende.
  Unterbrechungen (Anruf, andere App übernimmt Audio) danach sauber wieder aufnehmen.
- **Ansage**: nativer Zeitgeber auf `endsAt` (nicht im WebView, der im Hintergrund gedrosselt wird). Bei Ablauf:
  Session-Optionen auf `.duckOthers` (+ `.mixWithOthers`), `AVSpeechSynthesizer` (Stimme in App-Sprache, Deutsch),
  nach Ende zurück auf nur `.mixWithOthers`, damit die Musik wieder laut wird. Gleichzeitig Live-Aktivität auf
  „Nächster Satz“ aktualisieren. Schalter `S.sound` (Pausen-Ton aus) unterdrückt die Ansage.
  Im iPhone-App-Build ersetzt die Ansage den Web-Ton der Seite am Pausenende, damit nichts doppelt klingt.
  Die lokale Mitteilung als Ton-Ersatz entfällt.
- **JS-Anbindung** (`lib/thilo-ios-rest.js`, umbenennen/erweitern zu einem Trainings-Baustein): Aufrufe bei
  Trainingsstart, Wechsel von Übung/Satz, Pausenstart/-halt/-ende und Trainingsende. Fehler nicht mehr still
  verschlucken: einmal in der Konsole melden.

## Prüfung

- Kein Mac: Compiler über Codemagic (`ios-adhoc` baut und legt die IPA auf die Installationsseite).
- Frontend: `cd frontend && npx vitest run src && npm run build`; Tests für die JS-Anbindung (richtige Aufrufe
  bei Start, Satz, Pause, Ende; Web/Android: kein Aufruf).
- Ende-zu-Ende mit Thilo: Training starten, Musik in anderer App, iPhone sperren, Pause ablaufen lassen →
  Ansage, Musik leiser/lauter, Live-Aktivität zeigt Training und Countdown; PDF-Druck geht.
