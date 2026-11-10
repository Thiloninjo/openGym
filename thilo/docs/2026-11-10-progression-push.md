# Progression sichtbar machen und anschieben (Thilos Fork)

**Stand:** 10.11.2026, mit Thilo abgestimmt („Zielkarte + Satzvergleich“).

## Anlass

Thilo will „immer Progression sehen“ und von der App aktiv angeschoben werden: „Letztes Mal 12 Wiederholungen,
nimm diesmal eine Stufe mehr“ oder „Letztes Mal 8, schaff diesmal mindestens 9“. Seine Sätze enden in den
Daten fast immer genau bei 12 (oben im Bereich), oft mit gleichem Gewicht wie zuvor.

Die Engine rechnet das Ziel schon (doppelte Progression, `thilo/docs/2026-11-06-progression.md`): gleiches
Gewicht → eine Wiederholung mehr; alle Sätze oben → ein Gewichtsschritt (`weightIncrement`: `cfg.inc` oder der
Standard aus dem Katalog). Sichtbar ist es nur als kleine Zeile unter dem Mini-Verlauf (`progline` in
`views/Workout.jsx`, „Doppelte Progression · …“), in der Kompaktansicht gar nicht. Ein Vergleich je Satz fehlt.

## Was gebaut wird

Nur bei eingeschaltetem Schalter (`thiloRules()`, `lib/thilo-rules.js`); ohne Schalter bleibt alles wie upstream.

### 1. Zielkarte

Oben an jeder Übung im Training, direkt unter der Kopfzeile mit dem Namen, auch in der Kompaktansicht.
Ersetzt im Fork die `progline`. Ein Tipp öffnet wie bisher die Übungseinstellungen (`onProgressionSettings`).

Inhalt aus `entry.plan` (Ergebnis von `nextPrescription`, beim Start der Session gestempelt) und dem letzten Mal
(`lastEntryFor`, nur Arbeitssätze):

| Fall | Überschrift | Zeile darunter |
|---|---|---|
| `kind: 'up'`, Gewicht höher als letztes Mal | ↑ Heute: 1 Stufe höher | ≈ {Gewicht} {Einheit} · {min}–{max} Wdh. |
| `kind: 'up'` sonst (Satz mehr, weniger Hilfe an der Maschine) | ↑ Heute: Text der Engine (`why`) | |
| `kind: 'hold'` mit Wiederholungsziel | Heute: {Ziel} Wdh. pro Satz | mit {Gewicht} {Einheit} |
| dazu, wenn letztes Mal ein Satz unter dem damaligen Ziel lag | | Letztes Mal fehlte {n} Wdh. in Satz {i}, heute holen |
| `kind: 'hold'` nach verfehlten Wdh. ohne Ziel (lineare Regel) | Heute: die fehlenden Wdh. holen | mit {Gewicht} {Einheit} |
| `kind: 'deload'` | ↓ Heute leichter: {Gewicht} {Einheit} | Text der Engine (`why`) |
| Halteübung, `kind: 'up'`/`'hold'` | Heute: {s} s halten | |
| `kind: 'first'`, `'off'`, Cardio | keine Karte | |

Unterste Zeile immer, wenn es ein letztes Mal gibt: „Letztes Mal: {Gewicht} {Einheit} · 12 · 12 · 11“ (bei
gemischten Gewichten je Satz `setLabel`). Bei einer Stufe nach oben steht „≈“, weil die hinterlegte Stufe nicht
zu jedem Gerät passt; das tatsächlich eingetragene Gewicht ist die Grundlage der nächsten Progression.

Stil: Powerfit-Look, Akzent Neon-Lime für ↑, Gelb für ↓, sonst neutral; Überschrift in Barlow Condensed.

### 2. Satzvergleich

Je Arbeitssatz rechts klein, was in diesem Satz letztes Mal geschafft wurde („52×12“). Satz i heute wird mit
Arbeitssatz i des letzten Mals verglichen (Aufwärmsätze zählen weder heute noch damals). Gibt es keinen Satz i,
bleibt die Stelle leer. Nach dem Abhaken wird daraus ein Chip:

- mehr Gewicht → „+{Δ} {Einheit}“ (Neon-Lime), auch wenn die Wiederholungen dabei fallen
- gleiches Gewicht, mehr Wdh. → „+{Δ}“ (Neon-Lime)
- gleich → „=“ (grau)
- weniger Gewicht → „−{Δ} {Einheit}“, gleiches Gewicht und weniger Wdh. → „−{Δ}“ (grau, nicht rot)

Halteübungen vergleichen Sekunden („+5 s“). Cardio und Sätze ohne Wdh. bekommen keinen Vergleich.
Ein besserer Satz löst beim Abhaken `haptic('success')` statt des normalen Impulses aus.

Auf schmalen Bildschirmen darf der Vergleich unter die Zeile rutschen; die Satzzeile selbst bleibt bedienbar.
Prüfung im iPhone-Format (390 px).

### 3. Kachel am Trainingsende

Im Abschluss (`FinishSummary`, `sheets.jsx`) neben „Schritte“: „Progression: {n} von {m} Übungen gesteigert“,
darunter die gesteigerten Übungen. Grundlage ist `finishCompare` (gleiche Daten wie „Letztes Mal und nächstes
Mal“): gesteigert = `trend > 0` (schwerster Satz höher, sonst mehr Wdh. gesamt); m = Übungen mit letztem Mal.
Ohne Übung mit letztem Mal keine Kachel.

## Aufbau

- `lib/thilo-target.js` (rein, getestet): `targetCard(plan, last, cfg, unit)` → Modell der Karte oder `null`;
  `setDelta(lastSet, set, mode)` → `{ sign, text }` oder `null`; `progressCount(rows)` → `{ up, of, ids }`.
- `components/ThiloTargetCard.jsx`: zeigt das Modell, Tipp ruft `onOpen`.
- `views/Workout.jsx`: Karte statt `progline` (nur mit Schalter), Vergleich in der Satzzeile, Erfolgs-Impuls.
- `sheets.jsx`: Kachel in `FinishSummary`.
- Texte über `t()` mit deutschen Übersetzungen in `locales/de.js`, wie im übrigen Fork.

## Tests

- `lib/thilo-target.test.js`: alle Fälle der Tabelle, fehlende Wdh. in Satz i, gemischte Gewichte, Halteübung,
  Cardio/first/off → null; `setDelta` für +kg trotz weniger Wdh., +Wdh., =, −kg, −Wdh., Sekunden, kein Satz i;
  `progressCount`.
- `components/ThiloTargetCard.test.jsx`: rendert Überschrift und letzte Zeile, Tipp ruft `onOpen`.
- Bestehende Tests müssen grün bleiben (ohne Schalter unverändertes Verhalten).

## Auslieferung

Commit auf `training-live`. Die iPhone-App braucht einen neuen Build (Codemagic, Build 9); der Push dafür erst
nach Rückfrage bei Thilo.

## Nicht enthalten

- Ansage des Ziels per Stimme zum Pausenende (später möglich, baut auf Build 6 auf).
- Gewichtsstufen je Gerät pflegen.
- Warnung, wenn leichter als vorgegeben eingetragen wird.
