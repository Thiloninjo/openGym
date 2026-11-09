// Thilos Fork: eigene Progressionsregeln (thilo/docs/2026-11-06-progression.md).
//
// Ein Schalter statt fester Änderung: das Original und seine Tests rechnen weiter wie upstream,
// Thilos App schaltet die Regeln beim Start ein (main.jsx). Was sie ändern:
//   · Wiederholungen ohne eigene Regel (oder „linear“) laufen als doppelte Progression.
//   · Der Bereich ohne eigenes Minimum reicht vom Plan abwärts über RANGE_SPAN (12 → 8–12).
//   · Das Gewicht einer Session ist das schwerste, mit dem die Ziel-Wiederholungen geschafft
//     wurden; ein schwererer Versuch darüber zählt nicht (12×30, 12×30, 3×50 → 30).
//   · Ein schlechter Tag senkt nichts: weder das vorgegebene Gewicht noch die Ziel-Wiederholungen.
let on = false

export const thiloRules = () => on
export function setThiloRules(value) { on = !!value }

export const RANGE_SPAN = 4
