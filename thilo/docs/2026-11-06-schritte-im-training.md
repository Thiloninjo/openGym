# Schritte im Training (Thilos Fork)

**Stand:** 06.11.2026, mit Thilo abgestimmt: nur iPhone (Handy in der Tasche), nur Gesamtzahl, auch in der Live-Aktivität.

## Verhalten

- Ab Trainingsbeginn zählt der Schrittzähler des iPhones (CoreMotion, `CMPedometer`) mit, immer ab der
  Startzeit des Trainings. Nach einem Neustart der App mitten im Training stimmt die Zahl sofort wieder.
- **Live:** Kopfzeile des Trainings `12:34 · 5/20 Sätze · 812 Schritte`; Live-Aktivität oben neben dem
  Namen, Dynamic Island (aufgeklappt) unten neben dem Satz. Die Live-Aktivität bekommt neue Werte höchstens
  alle 15 s und nur, solange die App läuft (Vordergrund oder Pause mit stiller Audio-Schleife).
- **Ende:** Kachel „Schritte“ auf dem Abschluss-Bildschirm; das Training speichert `steps`, die
  Detailansicht im Verlauf zeigt sie in der Kopfzeile.
- Nachgetragene oder bearbeitete Trainings, Web und Android: keine Schritte.
- Erste Nutzung: iOS fragt nach „Bewegung & Fitness“ (`NSMotionUsageDescription`).

## Code

- Nativ: `frontend/ios/App/App/TrainingLivePlugin.swift` (Ereignis `steps` `{ steps, from }`),
  `RestWidget/RestActivityAttributes.swift` (`steps: Int?`), `RestWidget/RestWidget.swift`, `App/Info.plist`.
- JS: `lib/thilo-ios-training.js` (`watchSteps`, `stepsFor`), `store/useUI.js` (`steps`),
  `views/Workout.jsx` (Kopfzeile), `sheets.jsx` (Abschluss, Detail, `w.steps` in `doFinishWorkout`).
- Texte `Steps` / `{0} steps` in allen Sprachpaketen.

## Prüfung

- `npx vitest run src` grün, `npm run build` grün. Swift nur über Codemagic kompilierbar.
- Ende-zu-Ende: Training starten, Erlaubnis geben, herumlaufen → Zahl steigt in Kopfzeile und Live-Aktivität;
  Training beenden → Kachel „Schritte“, Zahl im Verlauf.
