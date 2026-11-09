# Powerfit-Look, Bewegung und Haptik (Thilos Fork)

Stand 09.11.2026. Vorlage: Thilos Mockup „Powerfit Club“ (dunkel, Neon-Lime, kondensierte
Headlines in Großbuchstaben, Pill-Buttons, schwebende Tab-Leiste).

## Entscheidungen (Thilo, 09.11.2026)

- Umfang: Reskin aller Screens und eine neue Startseite im Aufbau des Mockups. Kein eigener
  Kalender-Screen, kein Foto-Startbildschirm.
- Akzent: Neon-Lime ist Standard, die Akzentauswahl bleibt.
- Haptik bei jedem Tap, stärker bei wichtigen Aktionen.

## Look (`src/thilo-theme.css`, nach `thilo-motion.css` geladen)

- Flächen: Hintergrund `#0a0a0a`, Karten `#161616`, gedrückt/verschachtelt `#202020`,
  Bedienelemente `#2a2a2a`. Karten-Radius 20 px.
- Akzent: Der Preset `lime` ist jetzt Neon-Lime `#d4f53c` (dunkel) bzw. `#5f7a00` (hell, für
  Kontrast auf Weiß). Das bisherige iOS-Grün bleibt als neuer Preset `green` wählbar
  (`lib/format.js` ACCENTS/ACCENT_NAMES/ACCENT_INK, Farbwerte in `thilo-theme.css`).
- Schrift: Barlow Condensed 600/700 (OFL, lokal in `src/thilo-fonts/`) für Seitentitel, große
  Zahlen, Kennzahlen und Tab-Beschriftungen in Großbuchstaben. Fließtext bleibt SF Pro.
- Buttons als Pills. Die Tab-Leiste schwebt als abgerundete Leiste über dem Inhalt.
- Hell-Modus bleibt funktionsfähig, er bekommt nur Formen und Schrift.

## Startseite (`src/views/ThiloHome.jsx`, Route `/home` in `App.jsx`)

Das Original `views/Home.jsx` bleibt unverändert und behält seine Tests.

1. Kopf: Avatar mit Initialen, „Hallo <Name> 👋“, rechts der Knopf zu den Einstellungen
   (mit Verbindungs-Punkt wie bisher).
2. Headline, zweite Zeile in Lime:
   - Training läuft: „TRAINING / LÄUFT“
   - Heute erledigt: „HEUTE / ERLEDIGT“
   - Trainingstag: „BEREIT FÜR / <ROUTINE>“
   - Ruhetag: „RUHETAG / ERHOL DICH“
3. Karte „Diese Woche“: Ring mit erledigt/geplant (`weekTally`), daneben Trainings, Streak
   (`streakWeeks`) und Trainingszeit der laufenden Woche. Darunter die Wochenleiste mit
   Vor/Zurück. Im Rotationsmodus statt der Leiste die Coach-Reihe (`QueueRow`).
4. Schnellaktionen: Kalender (`calendarSheet`), Check-in (nur wenn eingeschaltet, sonst Plan)
   und Gewicht (`weighInsSheet`).
5. Karte „Heutiges Training“: Bild der ersten Übung, Name, Übungszahl, runder Play-Knopf.
   Zustände wie bisher auf Home: läuft → Fortsetzen, erledigt → Haken, Ruhetag → nächste
   Einheit bzw. Tag planen. Darunter „Anderes Training wählen“.
6. Gewichtskarte wie bisher (Ziel, Kurve, alle Wiegungen), ohne Log-Knopf.

## Bewegung (`src/thilo-motion.css`, erweitert)

- Eine Kurve für alles: `--ease: cubic-bezier(.22,1,.36,1)`, Federn mit `--spring`.
- Übergänge für Farbe, Hintergrund, Schatten und Transform an allen Bedienelementen.
- Seitenwechsel, Karten und Zeilen blenden gestaffelt ein (wie bisher, weicher).
- Ring und Kennzahlen laufen beim Öffnen hoch.
- Abgehakter Satz poppt, Schalter federn, Fokus auf Eingabefeldern bekommt einen weichen Ring.
- `prefers-reduced-motion` schaltet weiterhin alles ab (Regel in `index.css`).

## Haptik

- Nativ: `ios/App/App/ThiloHapticsPlugin.swift` (Taptic Engine über
  `UIImpactFeedbackGenerator`, `UINotificationFeedbackGenerator`, `UISelectionFeedbackGenerator`),
  angemeldet in `ThiloBridgeViewController`, in den Build über `thilo/ios/add-rest-widget.rb`.
- JS: `lib/thilo-haptics.js`, `haptic(kind)` mit `light | medium | heavy | selection | success |
  warning`. iOS-App → Plugin, sonst `navigator.vibrate` (Android, Browser), sonst nichts.
- Global (ein Listener auf `click`, Capture): jeder Tap auf Button, Link, Zeile, Chip, Tab, Tag
  gibt `light`; Schalter, Segmente, Chips, Wochentage `selection`; `danger`-Elemente `warning`.
  Der Impuls kommt nach dem Loslassen, Scrollen vibriert nicht.
- Gezielte Aufrufe übertrumpfen den globalen Tap im selben Klick (kein Doppel-Impuls):
  - `lib/sound.js` `vibrate(ms)` fällt ohne `navigator.vibrate` auf die Haptik zurück
    (Satz abhaken 30 ms → `medium`, Wischen 8/15 ms → `light`/`medium`, Wheel 4 ms → `selection`).
  - Training beenden (`sheets.jsx` `doFinishWorkout`) → `success`.

## Tests

- `lib/thilo-haptics.test.js`: Zuordnung der Elemente, Vorrang gezielter Impulse, Fallback.
- `views/ThiloHome.test.jsx`: Headline je Zustand, Ring-Werte, Schnellaktionen, Start.
- Die bestehende Suite bleibt grün.

## Auslieferung

Die Web-Dateien stecken in der App: sichtbar wird alles erst mit einem neuen Codemagic-Build.
