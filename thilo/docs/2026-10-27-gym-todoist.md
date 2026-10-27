# Gym in Todoist abhaken (27.10.2026)

Wird ein Training beendet, hakt openGym in Todoist die heutige Aufgabe „Gym“ automatisch ab.

## Ablauf

1. „Training beenden“ in der App: Das Training wandert nach `S.workouts[]` (mit `end`), die App schreibt den Zustand per `PUT /api/data`.
2. `commitState` (server.js) speichert und ruft danach `GYM.onCommit(uid, cur, next)` auf (`api/thilo-todoist.js`).
3. Ausgelöst wird nur für `TODOIST_UID`, und nur, wenn `next` ein Training enthält, das `cur` noch nicht hatte und das heute (Europe/Berlin) beendet wurde. Nachgetragene Trainings anderer Tage zählen nicht.
4. Im Hintergrund: `GET https://api.todoist.com/api/v1/tasks/filter?query=today`. Jede offene Aufgabe, deren Titel ohne vorangestelltes `[Bereich] ` genau „Gym“ lautet, wird per `POST /tasks/{id}/close` geschlossen.
5. Fehler landen nur im Log (`pm2 logs opengym-api | grep thilo-todoist`). Das Training ist da schon gespeichert.

Wenn heute keine passende offene Aufgabe da ist, passiert nichts.

## Konfiguration (`/opt/opengym/.env`)

- `TODOIST_TOKEN`: Pflicht; derselbe Token wie in `/opt/voice-inbox/.env`.
- `TODOIST_UID`: optional, Standard ist `HEALTH_UID`.
- `TODOIST_GYM_TITLE`: optional, Standard ist `Gym`.

Ohne Token ist der Hook aus. Der Startlog zeigt den Zustand: `thilo-todoist: an/aus`.

## Deploy

Am 27.10.2026 so gemacht: `server.js` und `thilo-todoist.js` per `tar | ssh` nach `/opt/opengym/api`, danach `pm2 restart opengym-api --update-env`. Backup liegt in `/opt/opengym/backup-2026-10-27/`. Ein neuer App-Build ist nicht nötig.
