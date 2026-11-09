# Progression und Verlauf (Thilos Fork)

**Stand:** 06.11.2026, mit Thilo abgestimmt.

## Befund

- Ohne eigene Regel galt „Lineare Progression“. Als Gewicht einer Session zählte das **schwerste** abgehakte
  Gewicht (`loadOf`). 12×30, 12×30, 3×50 ergab 50, die 3 Wiederholungen waren ein Fehlversuch, also
  „gleiches Gewicht nochmal“: alle Sätze der nächsten Session standen auf 50.
- Der Verlauf einer Übung war nur über das ⋯-Menü erreichbar.

## Regeln (Schalter `lib/thilo-rules.js`, eingeschaltet in `main.jsx`)

Ohne Schalter rechnet alles wie upstream; die Tests des Originals laufen deshalb unverändert.

1. **Doppelte Progression** für Wiederholungen ohne eigene Regel oder mit „linear“. Greyskull, Triple
   und „aus“ bleiben, wenn eine Übung sie ausdrücklich hat.
2. **Bereich:** Plan ist das obere Ende, ohne eigenes Minimum 4 darunter (12 → 8–12). Gleiches Gewicht,
   jedes Mal eine Wiederholung mehr; alle Sätze oben → ein Gewichtsschritt, zurück auf 8.
3. **Arbeitsgewicht:** das schwerste Gewicht, mit dem ein Satz die Ziel-Wiederholungen geschafft hat
   (sonst das Gewicht der meisten Sätze). Schwerere Versuche darüber zählen nicht, und ohne sie fehlt
   der Satz. 12×30, 12×30, 3×50 → nächstes Mal 3×12 mit 30.
4. **Schlechter Tag senkt nichts:** Die Ziel-Wiederholungen fallen nicht unter die der letzten Session.
   Wurde leichter trainiert als vorgegeben, bleibt das vorgegebene Gewicht, und die leichteren
   Wiederholungen bringen weder mehr Wiederholungen noch einen Gewichtsschritt. Die Entlastung nach
   drei Fehlversuchen in Folge bleibt wie upstream.

Code: `lib/progression.js` (`policyFor`, `readSession`, `workingWeight`, `nextPrescription`),
`lib/rep-range.js`. Tests: `lib/thilo-rules.test.js`.

## Mini-Verlauf

`components/ThiloMiniHistory.jsx` unter „Letztes Mal“ an jeder Übung (nicht in der Kompaktansicht):
kleine Kurve des schwersten Satzes (bis 10 Sessions), die letzten 4 Sessions mit Datum und allen Sätzen,
aus allen Routinen. „Übungsverlauf ›“ öffnet die ganze Ansicht.

## Offen

- Thilos echte Routinen nicht geprüft (Serverzugriff abgelehnt): ob Übungen ausdrücklich eine andere
  Regel oder ein eigenes Minimum haben.
- Der Coach (MCP `policyFor`) kennt den Schalter nicht und nennt die Regel weiter „linear“.
