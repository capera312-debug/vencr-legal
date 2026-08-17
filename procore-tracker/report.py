"""Genera el reporte HTML (estilo dashboard) con los cambios detectados, y un
índice con el historial de reportes."""
from __future__ import annotations

import html
from datetime import datetime, timezone
from pathlib import Path

STYLE = """
<style>
  :root {
    --bg: #0F0805; --surface: #1A0E08; --accent: #FF6A1A;
    --text: #F5EFE0; --text-dim: rgba(245,239,224,.65); --border: rgba(255,255,255,.08);
    --ok: #3DDC84; --warn: #FFD23D; --danger: #FF5C5C;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .container { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .meta { color: var(--text-dim); font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin: 32px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 14px 16px; margin-bottom: 10px; }
  .card .num { color: var(--accent); font-weight: 600; }
  .tag { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; margin-left: 8px; }
  .tag.new { background: rgba(61,220,132,.15); color: var(--ok); }
  .tag.upd { background: rgba(255,210,61,.15); color: var(--warn); }
  .tag.del { background: rgba(255,92,92,.15); color: var(--danger); }
  .alert { background: rgba(255,92,92,.08); border: 1px solid rgba(255,92,92,.3);
    border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; }
  .empty { color: var(--text-dim); font-size: 14px; padding: 8px 0; }
  a { color: var(--accent); }
  ul { padding-left: 20px; }
</style>
"""


def _card(number: str, title: str | None, tag_label: str, tag_class: str) -> str:
    return (
        f'<div class="card"><span class="num">{html.escape(str(number))}</span>'
        f'<span class="tag {tag_class}">{tag_label}</span><br>{html.escape(title or "")}</div>'
    )


def _section(title: str, kind_diff: dict) -> str:
    parts = [f"<h2>{html.escape(title)}</h2>"]
    if not kind_diff["added"] and not kind_diff["updated"] and not kind_diff["removed"]:
        parts.append('<div class="empty">Sin cambios desde la última corrida.</div>')
        return "".join(parts)

    for item in kind_diff["added"]:
        parts.append(_card(item.get("number") or item["id"], item.get("title"), "NUEVO", "new"))
    for change in kind_diff["updated"]:
        item = change["after"]
        parts.append(_card(item.get("number") or item["id"], item.get("title"), "ACTUALIZADO", "upd"))
    for item in kind_diff["removed"]:
        parts.append(_card(item.get("number") or item["id"], item.get("title"), "YA NO APARECE", "del"))
    return "".join(parts)


def _alerts_section(alerts: list[dict]) -> str:
    parts = ["<h2>⚠️ Posibles planos desactualizados</h2>"]
    if not alerts:
        parts.append(
            '<div class="empty">No se detectaron RFIs/Submittals que mencionen planos '
            "sin una revisión nueva registrada en Drawings.</div>"
        )
        return "".join(parts)
    for a in alerts:
        parts.append(
            '<div class="alert">'
            f'<b>{html.escape(str(a["item_number"] or "s/n"))}</b> — '
            f'{html.escape(a["item_title"] or "")}<br>'
            f'menciona el plano <b>{html.escape(a["drawing_number"])}</b>, pero ese plano no '
            "tiene una revisión nueva registrada en la herramienta de Drawings desde el "
            "último control."
            "</div>"
        )
    return "".join(parts)


def write_report(reports_dir: Path, diffs: dict, alerts: list[dict], settings) -> Path:
    now = datetime.now(timezone.utc)
    path = reports_dir / f"report-{now.strftime('%Y-%m-%d_%H%M')}.html"

    body = "".join(
        [
            "<!doctype html><html lang='es'><head><meta charset='utf-8'>",
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>",
            f"<title>Procore Tracker — {now.strftime('%Y-%m-%d')}</title>",
            STYLE,
            "</head><body><div class='container'>",
            "<h1>Control de cambios — Procore</h1>",
            f"<div class='meta'>Proyecto {html.escape(str(settings.project_id))} · generado "
            f"{now.strftime('%Y-%m-%d %H:%M UTC')} · "
            "<a href='index.html'>← ver todos los reportes</a></div>",
            _alerts_section(alerts),
            _section("RFIs", diffs["rfis"]),
            _section("Submittals", diffs["submittals"]),
            _section("Drawings", diffs["drawings"]),
            "</div></body></html>",
        ]
    )
    path.write_text(body, encoding="utf-8")
    return path


def write_index(reports_dir: Path) -> Path:
    reports = sorted(reports_dir.glob("report-*.html"), reverse=True)
    items = "".join(f'<li><a href="{r.name}">{r.name}</a></li>' for r in reports)
    if not items:
        items = '<li class="empty">Todavía no hay reportes.</li>'
    index_path = reports_dir / "index.html"
    index_path.write_text(
        "".join(
            [
                "<!doctype html><html lang='es'><head><meta charset='utf-8'>",
                "<meta name='viewport' content='width=device-width, initial-scale=1.0'>",
                "<title>Procore Tracker — Reportes</title>",
                STYLE,
                "</head><body><div class='container'>",
                "<h1>Reportes generados</h1>",
                f"<ul>{items}</ul>",
                "</div></body></html>",
            ]
        ),
        encoding="utf-8",
    )
    return index_path
