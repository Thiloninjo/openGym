# Körpergewicht aus Apple Health in openGym (Thilos Fork)

**Stand:** 14.10.2026, mit Thilo abgestimmt.

## Ziel

Jede Wiegung (Withings → Apple Health → Habit-Tracker-App → habits-api) erscheint ohne Handarbeit
als Körpergewicht in openGym. Gewicht von Hand eintragen oder löschen gibt es in Thilos Build nicht mehr.

## Entscheidungen (Thilo, 14.10.2026)

- Pro Tag zählt die **letzte** Wiegung des Tages (openGym kennt ein Gewicht pro Tag, Schlüssel `d`).
- Löschen nur in Apple Health. In openGym kein Löschen, kein „Log“, keine Abfrage vor dem Training.
- Ein Wert pro Training ist nicht nötig: ohne `active.bw` nutzt openGym die letzte Wiegung
  (`frontend/src/lib/recovery.js`, `Stats.jsx profileBodyweightKg`).
- Muster wie beim Zielbild (`H:\Projects\Zielbild\server\src\healthSync.ts`): openGym holt selbst ab.

## Quelle: habits-api (gleicher Server, 127.0.0.1:3004)

- `GET /api/body?since=<rev>` mit `Authorization: Bearer <HABITS_TOKEN>` →
  `{rev, items:[{uuid, type, value, at, sourceName, deleted, rev}]}`; nur `type: "weight"` (kg) ist relevant.
  `rev` zählt fortlaufend; `rev < since` heißt: habits-api neu aufgebaut → Merker auf 0, alles neu holen.
- Webhook: habits-api POSTet jedes Ereignis als JSON an alle `WEBHOOK_URLS`; relevant ist `{"type":"body.changed"}`.

## Server (`api/`)

Neue Datei `api/thilo-health.js`, eingebunden in `api/server.js` mit Kommentar „Thilos Fork“.

- **Konfiguration** aus `/opt/opengym/.env`: `HABITS_API_URL`, `HABITS_TOKEN`, `HEALTH_HOOK_KEY` (≥ 32 Zeichen),
  `HEALTH_UID` (openGym-Nutzer-ID von Thilo). Fehlt etwas: eine Logzeile, Funktion aus, Server läuft normal.
- **Spiegel** `$DATA_DIR/thilo-health.json`: `{rev, weights: {uuid: {at, kg, deleted}}}`, atomar geschrieben
  (vorhandenes `atomicWrite`). Er hält alle Gewichtsproben, damit sich „letzte des Tages“ auch nach Löschungen
  neu berechnen lässt.
- **Abgleich `sync()`**: Merker `rev` aus dem Spiegel, `GET /api/body?since=rev`, Gewichtseinträge in den
  Spiegel übernehmen (ungültige Werte überspringen und loggen), betroffene Tage sammeln (Tag = lokales Datum
  Europe/Berlin von `at`). Für jeden betroffenen Tag die letzte nicht gelöschte Probe bestimmen:
  - vorhanden → Eintrag `{d, w, t, src: "apple-health", hk: uuid}` setzen (ersetzt den Tageseintrag),
    `w` in `S.unit` (kg, bei `lb` umrechnen wie `frontend/src/lib/import-csv.js`), auf 0,1 gerundet;
    `t` ist bei einem neuen Tag `Date.parse(at)`, beim Ersetzen eines gespeicherten Eintrags
    `max(Date.parse(at), gespeichertes t + 1)`, damit der App-Merge (pro Tag gewinnt das spätere `t`) die alte Kopie eines Geräts nicht zurückholt;
  - keine mehr → Tageseintrag entfernen, aber nur wenn er `src: "apple-health"` trägt (alte Handeinträge bleiben),
    und die Löschung selbst vermerken: `deleted.bodyweight[d] = max(Date.now(), gespeichertes t + 1)`
    (geschrieben wird mit `stamped: true`, das vermerkt Löschungen nicht von selbst).
  Liste nach `d` sortieren. Geschrieben wird über denselben Weg wie `PUT /api/data`
  (`readStateStrict`, `stampPut`, `_rev`/`_wid`/`_wids`, `atomicWrite`, `stateCache.delete`) – dafür eine Hilfsfunktion
  aus dem PUT-Handler herausziehen, damit beide denselben Code nutzen. Zwischen Lesen und Schreiben kein `await`.
  Hat sich am Zustand nichts geändert, nicht schreiben. Danach Merker speichern.
  Läufe nicht parallel; ein Aufruf während eines Laufs hängt genau einen weiteren an.
- **Auslöser**: beim Start, alle 15 Minuten, und `POST /api/thilo/health-hook?key=<HEALTH_HOOK_KEY>`
  (Schlüssel per `timingSafeEqual`; vor der Session-Prüfung; falscher Schlüssel → 403; ohne Konfiguration → 404;
  nur `body.changed` startet einen Lauf; Antwort 202). nginx sperrt `/api/thilo/` nach außen (`deny all`).
- Fehler beim Abruf: Logzeile, nichts geändert, nächster Lauf holt nach.

## Frontend (`frontend/src`), mit Kommentar „Thilos Fork“

- „Log“-Knopf auf der Startseite (`views/Home.jsx`), in `views/Stats.jsx` und `views/StructuralBalance.jsx` entfernen;
  Leertext der Gewichtskarte sinngemäß „Kommt automatisch aus Apple Health“ (in der Sprache der übrigen Texte, i18n-Mechanismus nutzen).
- Abfrage vor dem Training (`startFlow`, `repeatWorkout` in `sheets.jsx`, gesteuert über `S.weighIn`) immer aus;
  Schalter in `views/Settings.jsx` ausblenden.
- Löschen im Wiegeverlauf (`WeighInRow` in `sheets.jsx`) entfernen; Verlauf bleibt sichtbar.
- Ziel-Gewicht (`goalSheet`) bleibt.

## Tests

- `api/test/thilo-health.test.js` (node:test, Muster der vorhandenen Tests): Fake-Fetcher;
  neue Wiegung → Tageseintrag; zwei Wiegungen am Tag → letzte zählt; Löschen der letzten → vorletzte;
  Löschen aller → Eintrag weg; Handeintrag ohne `src` bleibt; `lb`-Umrechnung; `rev < since` → Merker 0;
  ungültiger Wert übersprungen; `_rev` steigt nur bei Änderung; Hook 202/403/404.
- `cd api && npm test`, `cd frontend && npm test && npm run build`.

## Betrieb

- `.env` auf dem Hetzner ergänzen (Werte nie ausgeben), habits-api `WEBHOOK_URLS` um
  `http://127.0.0.1:3008/api/thilo/health-hook?key=<HEALTH_HOOK_KEY>` erweitern, nginx-Sperre aktivieren.
- Deploy wie bisher für openGym (Server + Web), iOS-App per Codemagic `ios-adhoc`.
