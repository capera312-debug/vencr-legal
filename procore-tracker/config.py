"""Carga la configuración del tracker desde variables de entorno (.env)."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    client_id: str
    client_secret: str
    company_id: str
    project_id: str
    base_url: str
    oauth_url: str
    redirect_uri: str
    auth_mode: str
    rfis_path: str
    submittals_path: str
    drawings_path: str
    drawing_number_regex: str


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(
            f"Falta la variable de entorno {name}. Copia .env.example a .env y "
            "completa los valores (ver README.md)."
        )
    return value


def load_settings() -> Settings:
    return Settings(
        client_id=_required("PROCORE_CLIENT_ID"),
        client_secret=_required("PROCORE_CLIENT_SECRET"),
        company_id=_required("PROCORE_COMPANY_ID"),
        project_id=_required("PROCORE_PROJECT_ID"),
        base_url=os.environ.get("PROCORE_BASE_URL", "https://api.procore.com").rstrip("/"),
        oauth_url=os.environ.get("PROCORE_OAUTH_URL", "https://login.procore.com").rstrip("/"),
        # "authorization_code" (default): login único como tú mismo + refresh token
        # guardado localmente. "client_credentials": requiere una Developer Managed
        # Service Account (DMSA) habilitada por Procore — ver README.
        auth_mode=os.environ.get("PROCORE_AUTH_MODE", "authorization_code"),
        # urn:ietf:wg:oauth:2.0:oob = flujo "installed app" sin servidor: Procore te
        # muestra el código en pantalla en vez de redirigir a una URL.
        redirect_uri=os.environ.get("PROCORE_REDIRECT_URI", "urn:ietf:wg:oauth:2.0:oob"),
        rfis_path=os.environ.get(
            "PROCORE_RFIS_PATH", "/rest/v1.0/projects/{project_id}/rfis"
        ),
        submittals_path=os.environ.get(
            "PROCORE_SUBMITTALS_PATH", "/rest/v1.1/projects/{project_id}/submittals"
        ),
        drawings_path=os.environ.get(
            "PROCORE_DRAWINGS_PATH", "/rest/v1.0/projects/{project_id}/drawings"
        ),
        drawing_number_regex=os.environ.get(
            "PROCORE_DRAWING_NUMBER_REGEX", r"\b[A-Z]{1,3}-?\d{2,4}(?:\.\d{1,2})?\b"
        ),
    )
