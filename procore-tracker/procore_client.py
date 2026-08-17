"""Cliente delgado para autenticarse con Procore y hacer llamadas GET paginadas
al REST API.

Soporta dos formas de autenticación:

- "authorization_code" (default): inicias sesión una vez como tú mismo
  (ver authorize.py), y el script se renueva solo después con un refresh
  token guardado en un archivo local (.token_cache.json, fuera del repo).
  Referencia: https://developers.procore.com/documentation/oauth-installed-apps

- "client_credentials": pensado para jobs sin usuario interactivo, pero
  requiere que Procore te habilite una Developer Managed Service Account
  (DMSA) para la app — no es self-service en el Developer Portal básico.
  Referencia: https://developers.procore.com/documentation/oauth-client-credentials
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import requests


class ProcoreError(RuntimeError):
    """Error de autenticación o de la API de Procore, con un mensaje accionable."""


class ProcoreClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        base_url: str,
        oauth_url: str,
        auth_mode: str = "authorization_code",
        redirect_uri: str = "urn:ietf:wg:oauth:2.0:oob",
        company_id: str | None = None,
        token_cache_path: Path | None = None,
        timeout: int = 30,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = base_url.rstrip("/")
        self.oauth_url = oauth_url.rstrip("/")
        self.auth_mode = auth_mode
        self.redirect_uri = redirect_uri
        self.company_id = company_id
        self.token_cache_path = token_cache_path
        self.timeout = timeout

        self._access_token: str | None = None
        self._access_token_expires_at: float = 0.0
        self._refresh_token: str | None = None

        if self.auth_mode == "authorization_code" and self.token_cache_path and self.token_cache_path.exists():
            cached = json.loads(self.token_cache_path.read_text(encoding="utf-8"))
            self._refresh_token = cached.get("refresh_token")

    # -- manejo de tokens -------------------------------------------------

    def _save_token_response(self, payload: dict) -> None:
        self._access_token = payload["access_token"]
        self._access_token_expires_at = time.time() + float(payload.get("expires_in", 5400))

        new_refresh_token = payload.get("refresh_token")
        if new_refresh_token:
            self._refresh_token = new_refresh_token

        if self.auth_mode == "authorization_code" and self.token_cache_path:
            self.token_cache_path.write_text(
                json.dumps({"refresh_token": self._refresh_token}, indent=2), encoding="utf-8"
            )

    def _request_token_client_credentials(self) -> None:
        resp = requests.post(
            f"{self.oauth_url}/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
            timeout=self.timeout,
        )
        if resp.status_code != 200:
            raise ProcoreError(
                f"No se pudo autenticar con Procore (HTTP {resp.status_code}): {resp.text}\n"
                "Revisa PROCORE_CLIENT_ID / PROCORE_CLIENT_SECRET y confirma que la app "
                "tenga una Developer Managed Service Account (DMSA) instalada. Ver "
                "https://developers.procore.com/documentation/oauth-client-credentials"
            )
        self._save_token_response(resp.json())

    def _request_token_refresh(self) -> None:
        if not self._refresh_token:
            raise ProcoreError(
                "No hay una sesión guardada todavía. Corre `python authorize.py` una vez "
                "para iniciar sesión en Procore antes de correr tracker.py."
            )
        resp = requests.post(
            f"{self.oauth_url}/oauth/token",
            data={
                "grant_type": "refresh_token",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self._refresh_token,
            },
            timeout=self.timeout,
        )
        if resp.status_code != 200:
            raise ProcoreError(
                f"No se pudo renovar la sesión con Procore (HTTP {resp.status_code}): {resp.text}\n"
                "Es probable que el refresh token haya expirado o se haya revocado. Corre "
                "`python authorize.py` de nuevo para volver a iniciar sesión."
            )
        self._save_token_response(resp.json())

    def _get_token(self) -> str:
        now = time.time()
        if self._access_token and now < self._access_token_expires_at - 60:
            return self._access_token

        if self.auth_mode == "client_credentials":
            self._request_token_client_credentials()
        else:
            self._request_token_refresh()

        assert self._access_token is not None
        return self._access_token

    def _headers(self) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._get_token()}"}
        if self.company_id:
            headers["Procore-Company-Id"] = str(self.company_id)
        return headers

    # -- llamadas a la API --------------------------------------------------

    def get_all(self, path: str, params: dict[str, Any] | None = None) -> list[dict]:
        """GET con paginación estándar de Procore (page/per_page)."""
        params = dict(params or {})
        params.setdefault("per_page", 100)
        page = 1
        results: list[dict] = []

        while True:
            params["page"] = page
            resp = requests.get(
                f"{self.base_url}{path}",
                headers=self._headers(),
                params=params,
                timeout=self.timeout,
            )
            if resp.status_code == 404:
                raise ProcoreError(
                    f"404 en {path}. Este endpoint/versión probablemente no aplica a tu "
                    "instancia o plan de Procore. Verifica la ruta correcta en "
                    "https://developers.procore.com/reference/rest y ajústala en tu .env "
                    "(PROCORE_RFIS_PATH / PROCORE_SUBMITTALS_PATH / PROCORE_DRAWINGS_PATH)."
                )
            if resp.status_code == 403:
                raise ProcoreError(
                    f"403 en {path}. Tu usuario (o la app/DMSA) no tiene permiso sobre esta "
                    "herramienta en este proyecto. Revisa tus permisos en Procore para el "
                    "proyecto configurado."
                )
            resp.raise_for_status()

            batch = resp.json()
            if isinstance(batch, dict):
                # algunos endpoints devuelven {"data": [...], ...} en vez de una lista
                batch = batch.get("data", [])
            if not batch:
                break

            results.extend(batch)
            if len(batch) < params["per_page"]:
                break
            page += 1

        return results
