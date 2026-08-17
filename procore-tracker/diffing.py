"""Normaliza los datos crudos de Procore, calcula qué cambió desde la última
corrida, y cruza RFIs/Submittals contra Drawings para detectar posibles
desincronizaciones (te avisan un cambio en un RFI/Submittal pero el plano que
mencionan no tiene revisión nueva)."""
from __future__ import annotations

import re
from typing import Any

Item = dict[str, Any]
ItemsById = dict[str, Item]


def normalize(kind: str, raw_items: list[dict]) -> ItemsById:
    """Convierte la lista cruda de Procore a { id: {id, number, title, updated_at, status} }.

    Los nombres de campo varían un poco entre herramientas de Procore; probamos
    las variantes más comunes y caemos a None si no aparece ninguna.
    """
    normalized: ItemsById = {}
    for item in raw_items:
        item_id = str(item.get("id"))

        if kind == "rfis":
            number = item.get("number") or item.get("rfi_number")
            title = item.get("subject") or item.get("title") or ""
        elif kind == "submittals":
            number = (
                item.get("number_with_revision")
                or item.get("number")
                or item.get("submittal_number")
            )
            title = item.get("title") or ""
        else:  # drawings
            number = item.get("number") or item.get("drawing_number") or item.get("name")
            title = item.get("title") or item.get("name") or ""

        normalized[item_id] = {
            "id": item_id,
            "number": str(number) if number is not None else None,
            "title": title,
            "updated_at": item.get("updated_at"),
            "status": item.get("status"),
        }
    return normalized


def diff(previous: ItemsById, current: ItemsById) -> dict[str, list]:
    """Compara dos snapshots por id y por `updated_at`."""
    prev_ids = set(previous.keys())
    curr_ids = set(current.keys())

    added = [current[i] for i in sorted(curr_ids - prev_ids)]
    removed = [previous[i] for i in sorted(prev_ids - curr_ids)]
    updated = [
        {"before": previous[i], "after": current[i]}
        for i in sorted(curr_ids & prev_ids)
        if previous[i].get("updated_at") != current[i].get("updated_at")
    ]
    return {"added": added, "removed": removed, "updated": updated}


def extract_drawing_numbers(text: str | None, pattern: str) -> set[str]:
    if not text:
        return set()
    return {m.upper().replace(" ", "") for m in re.findall(pattern, text)}


def cross_reference_alerts(
    rfi_diff: dict,
    submittal_diff: dict,
    drawings_current: ItemsById,
    drawings_previous: ItemsById,
    regex: str,
) -> list[dict]:
    """Para cada RFI/Submittal nuevo o actualizado, busca números de plano
    mencionados en su título/asunto. Si ese plano existe en Drawings pero su
    `updated_at` NO cambió desde la corrida anterior, lo marcamos como una
    posible desincronización: alguien tocó el RFI/Submittal pero no subió una
    revisión nueva del plano en la herramienta de Drawings.

    Es una heurística basada en texto (no un vínculo formal de Procore), así
    que ajusta PROCORE_DRAWING_NUMBER_REGEX en tu .env al formato real de tus
    planos para reducir falsos positivos/negativos.
    """
    alerts: list[dict] = []
    changed_items = (
        rfi_diff["added"]
        + [c["after"] for c in rfi_diff["updated"]]
        + submittal_diff["added"]
        + [c["after"] for c in submittal_diff["updated"]]
    )
    drawings_by_number = {
        d["number"]: d for d in drawings_current.values() if d.get("number")
    }

    for item in changed_items:
        mentioned = extract_drawing_numbers(item.get("title"), regex)
        for num in mentioned:
            drawing = drawings_by_number.get(num)
            if not drawing:
                continue  # el número mencionado no coincide con ningún plano conocido
            prev_drawing = drawings_previous.get(drawing["id"])
            unchanged = bool(prev_drawing) and prev_drawing.get("updated_at") == drawing.get(
                "updated_at"
            )
            if unchanged:
                alerts.append(
                    {
                        "item_number": item.get("number"),
                        "item_title": item.get("title"),
                        "drawing_number": num,
                        "drawing_id": drawing["id"],
                    }
                )
    return alerts
