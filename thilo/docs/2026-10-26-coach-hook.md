# Coach-Hook (Thilos Fork)

**Stand:** 26.10.2026. Plan: `H:\Projects\coach\docs\superpowers\plans\2026-10-26-coach-runde-2.md`, Teil A.

## Zweck

Der Coach-Server ändert in openGym Routinen und Tagesplan und gibt im laufenden Training einen
Übungstausch vor. Nur lokal erreichbar (API auf `127.0.0.1:3008`, nginx sperrt `/api/thilo/`).
Code: `api/thilo-coach.js` (reine Logik), Verdrahtung in `api/server.js` (`coachHook`).

## Routen

- `POST /api/thilo/coach?key=<COACH_HOOK_KEY>`, Body `{ops: [...]}`, höchstens 25 ops, alles oder nichts.
  Antwort `200 {ok, rev, applied: [...]}` oder `400 {error}` (nennt die fehlerhafte op).
- `GET /api/thilo/coach/exercises?key=<COACH_HOOK_KEY>&q=<Text>` sucht im Katalog und in `customEx`
  (deutsche und englische Namen, Gerät, Zielmuskel; jedes Wort muss vorkommen).
  Antwort: Liste mit höchstens 20 Einträgen `{id, name, en, equipment, muscles, bodyPart, custom?}`.
- Falscher Schlüssel → 403. Ohne Konfiguration → 404.

## Ops

| `op` | Felder | Wirkung |
|---|---|---|
| `replace-exercise` | `routineId`, `exId`, `newExId`, `cfg?` | Tauscht die Übung in der Routine; Einstellungen bleiben, `cfg` überschreibt. |
| `update-exercise` | `routineId`, `exId`, `cfg` | Ändert die Einstellungen der Übung. |
| `set-day` | `date` (YYYY-MM-DD), `routineId` / `"rest"` / `null` | Setzt `dayPlan[date]`; `null` löscht den Eintrag. |
| `live-swap` | `exId`, `newExId`, `cfg?`, `note?` | Schreibt `coachLive: {id, ts, ops}`; die App tauscht im laufenden Training. |

- `cfg`: `sets` (1–20), `reps` (1–100), `repsMin` (1–100, ≤ reps), `weight` (0–1000), `note` (≤ 200 Zeichen);
  `null` entfernt `repsMin`, `weight`, `note`.
- Übungs-IDs müssen im Katalog (`api/coach/core/library-data.js`) oder in `customEx` stehen.
- Alle `live-swap` eines Requests bilden einen Auftrag mit neuer ID; er ersetzt einen früheren `coachLive`.
- Geschrieben wird mit `commitState(uid, cur, next, {overRead: true, stamped: false})`: der Server stempelt
  die Änderungen selbst, damit ein Gerät mit älterem Stand sie nicht zurückdreht.

## Sync-Regel für `coachLive`

- Nur der Hook schreibt `coachLive` (`commitState(..., {coachLive: true})`). Jeder andere Schreiber
  (PUT /api/data, Backup-Import, ältere App, Health-Hook) behält den gespeicherten (`keepCoachLive`):
  ein Gerät mit altem Stand bringt keinen erledigten Auftrag zurück und überschreibt keinen neueren.
- Der Server stempelt `edited.coachLive`; im Merge der App gewinnt damit der Stand des Servers.

## Live-Tausch in der App (Frontend)

- `frontend/src/lib/coach-live.js` (rein): `applyCoachLive(active, coachLive, doneId, {build, nameOf})`
  → `{active, notices, doneId, inserted}`.
  - Kein Training, eine Bearbeitung eines gespeicherten Trainings oder ein Training, das erst nach
    dem Auftrag begann: der Auftrag verfällt (wird als erledigt gemerkt).
  - Je op der erste noch nicht ganz erledigte Eintrag mit `exId`, getauscht mit `swapActiveExercise`
    (`loggedConfirmed: true`, `groupDisposition: 'keep'`); erledigte Sätze bleiben, der Ersatz kommt daneben.
  - Ersatz wie beim manuellen Tausch: `lib/swap-replacement.js` (`buildSwapReplacement`, auch von
    `sheets.jsx` benutzt). Einstellungen: Standard der neuen Übung, Sätze/Wdh. des Platzes, `cfg` darüber.
  - Die ID wird am Training vermerkt (`active.coachLiveId`), damit ein Auftrag auch ohne gemerkte ID
    nicht zweimal wirkt.
- Store (`store/useStore.js`): in `persist` (jeder Pull, Merge, Tab-Abgleich) und beim Start (`finishBoot`).
  Die erledigte ID liegt nur auf dem Gerät (`localStorage` `gym_coach_live_done`).
  Hinweis als Toast (6 s): „Coach: Seitheben mit Kurzhanteln → Seitheben an der Hebelmaschine“.
  Eine laufende Pause rückt mit, wenn ein Ersatz davor eingefügt wird; ein Halte-Timer hört dann auf.
- Die App holt den Stand bei Fokus, Sichtbarkeit und App-Resume (`checkRev`, `onAppActive`) und alle 30 s.

## Umgebung (`/opt/opengym/.env`)

- `COACH_HOOK_KEY`: mindestens 32 Zeichen. Fehlt er, ist der Hook aus.
- `COACH_UID`: openGym-Nutzer; ohne Angabe gilt `HEALTH_UID`.

## Deutsche Namen

`api/thilo-exercise-names-de.js` wird aus `frontend/src/exercise-names/de.js` erzeugt
(`node thilo/build-exercise-names.mjs`, Prüfung mit `--check`), weil die API ohne `frontend/` läuft.
