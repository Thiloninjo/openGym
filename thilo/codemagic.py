#!/usr/bin/env python3
"""Codemagic per API für openGym (Thilos Fork). Token und App-ID liegen in .secrets/codemagic_api.txt
(erste Zeile Token, zweite Zeile App-ID), die Datei ist nicht im Repo. Gibt nie Geheimnisse aus.

  python thilo/codemagic.py apps                        # Apps des Kontos (Name, ID, Repo)
  python thilo/codemagic.py add-app <repo-ssh-url> <private-key-datei>
  python thilo/codemagic.py var <gruppe> <name> <wert-datei>   # sichere Variable aus Datei setzen
  python thilo/codemagic.py start <workflow> [branch]
  python thilo/codemagic.py wait <buildId>              # wartet, zeigt Ergebnis
  python thilo/codemagic.py log <buildId>               # Log der fehlgeschlagenen Schritte (letzte 150 Zeilen)
  python thilo/codemagic.py last [n]
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT / ".secrets" / "codemagic_api.txt"
BASE = "https://api.codemagic.io"


def creds():
    lines = SECRETS.read_text(encoding="utf-8-sig").splitlines()
    return lines[0].strip(), (lines[1].strip() if len(lines) > 1 else "")


def call(method, path, body=None, raw=False):
    token, _ = creds()
    req = urllib.request.Request(BASE + path, method=method,
                                 headers={"x-auth-token": token, "Content-Type": "application/json"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            content = r.read()
            return content if raw else (json.loads(content) if content else {})
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:400])
        sys.exit(1)


def apps():
    for a in call("GET", "/apps").get("applications", []):
        print(a.get("_id"), "|", a.get("appName"), "|", a.get("repository", {}).get("htmlUrl"))


def add_app(repo_url, key_file):
    key = base64.b64encode(Path(key_file).read_bytes()).decode()
    r = call("POST", "/apps/new", {"repositoryUrl": repo_url, "sshKey": {"data": key, "passphrase": None}})
    app_id = r.get("_id")
    print("App angelegt:", app_id, r.get("appName"))
    token, _ = creds()
    SECRETS.write_text(token + "\n" + app_id + "\n", encoding="utf-8")


def var(group, name, value_file):
    _, app = creds()
    value = Path(value_file).read_text(encoding="utf-8")
    call("POST", f"/apps/{app}/variables", {"key": name, "value": value, "group": group, "secure": True})
    print(f"Variable {name} in Gruppe {group} gesetzt")


def start(workflow, branch="main"):
    _, app = creds()
    r = call("POST", "/builds", {"appId": app, "workflowId": workflow, "branch": branch})
    print("Build gestartet:", r.get("buildId"))


def build(build_id):
    return call("GET", f"/builds/{build_id}")["build"]


def describe(b):
    bad = [f"{s.get('name')}={s.get('status')}" for s in b.get("buildActions", [])
           if s.get("status") not in (None, "success", "skipped")]
    arts = [a.get("name") for a in b.get("artefacts", []) if a.get("name", "").endswith(".ipa")]
    return (f"{b.get('status')} | {b.get('workflowId') or b.get('fileWorkflowId')} | Build #{b.get('index')}"
            + (f" | offene Schritte: {bad}" if bad else "") + (f" | ipa: {arts}" if arts else ""))


def wait(build_id, timeout=3600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        b = build(build_id)
        if b.get("status") in ("finished", "failed", "canceled", "skipped", "timeout", "warning"):
            print(describe(b))
            return
        time.sleep(30)
    print("Timeout beim Warten")


def log(build_id):
    # Die Logs hängen an den Unteraktionen der Schritte, nicht am Schritt selbst.
    for s in build(build_id).get("buildActions", []):
        if s.get("status") != "failed":
            continue
        for sub in s.get("subactions") or [s]:
            if sub.get("logUrl"):
                text = call("GET", sub["logUrl"].replace(BASE, ""), raw=True).decode("utf-8", "replace")
                print(f"--- {s.get('name')} ---")
                print("\n".join(text.splitlines()[-150:]))


def last(n=5):
    _, app = creds()
    for b in call("GET", f"/builds?appId={app}").get("builds", [])[: int(n)]:
        print(b.get("_id"), describe(b))


if __name__ == "__main__":
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else "last"), sys.argv[2:]
    {"apps": apps, "add-app": add_app, "var": var, "start": start, "wait": wait, "log": log, "last": last}[cmd](*args)
