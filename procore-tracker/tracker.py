#!/usr/bin/env python3
"""Punto de entrada del Procore Tracker.

Trae RFIs, Submittals y Drawings del proyecto configurado, compara contra la
última corrida (guardada en state/last_snapshot.json), cruza referencias a
números de plano para detectar posibles desincronizaciones, y genera un
reporte HTML en reports/.

Uso:
    cd procore-tracker
    python tracker.py

Requiere las variables de entorno de .env.example (o exportadas en el entorno,
como hace el workflow de GitHub Actions). Ver README.md.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from config import load_settings
from diffing import cross_reference_alerts, diff, normalize
from procore_client import ProcoreClient, ProcoreError
from report import write_index, write_report

BASE_DIR = Path(__file__).resolve().parent
STATE_PATH = BASE_DIR / "state" / "last_snapshot.json"
REPORTS_DIR = BASE_DIR / "reports"
TOKEN_CACHE_PATH = BASE_DIR / ".token_cache.json"

PATH_SETTINGS_ATTR = {
    "rfis": "rfis_path",
    "submittals": "submittals_path",
    "drawings": "drawings_path",
}


def fetch_items(client: ProcoreClient, settings, kind: str) -> list[dict]:
    path_template = getattr(settings, PATH_SETTINGS_ATTR[kind])
    path = path_template.format(project_id=settings.project_id)
    return client.get_all(path)


def load_previous_snapshot() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {}


def save_snapshot(snapshot: dict) -> None:
    STATE_PATH.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    load_dotenv(BASE_DIR / ".env")
    settings = load_settings()

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    client = ProcoreClient(
        client_id=settings.client_id,
        client_secret=settings.client_secret,
        base_url=settings.base_url,
        oauth_url=settings.oauth_url,
        auth_mode=settings.auth_mode,
        redirect_uri=settings.redirect_uri,
        company_id=settings.company_id,
        token_cache_path=TOKEN_CACHE_PATH,
    )

    previous_snapshot = load_previous_snapshot()
    current_snapshot: dict = {"generated_at": datetime.now(timezone.utc).isoformat()}
    diffs: dict[str, dict] = {}

    try:
        for kind in ("rfis", "submittals", "drawings"):
            print(f"Trayendo {kind} de Procore...")
            raw_items = fetch_items(client, settings, kind)
            current_snapshot[kind] = normalize(kind, raw_items)
            prev_items = previous_snapshot.get(kind, {})
            diffs[kind] = diff(prev_items, current_snapshot[kind])
            d = diffs[kind]
            print(
                f"  {kind}: +{len(d['added'])} nuevos, {len(d['updated'])} actualizados, "
                f"-{len(d['removed'])} ya no aparecen"
            )
    except ProcoreError as exc:
        raise SystemExit(f"\n❌ {exc}") from exc

    alerts = cross_reference_alerts(
        diffs["rfis"],
        diffs["submittals"],
        current_snapshot["drawings"],
        previous_snapshot.get("drawings", {}),
        settings.drawing_number_regex,
    )

    report_path = write_report(REPORTS_DIR, diffs, alerts, settings)
    write_index(REPORTS_DIR)
    save_snapshot(current_snapshot)

    print(f"\nReporte generado: {report_path}")
    if alerts:
        print(f"⚠️  {len(alerts)} posible(s) desincronización entre RFI/Submittal y Drawings.")


if __name__ == "__main__":
    main()
