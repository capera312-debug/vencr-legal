"""Cliente delgado para autenticarse con Procore y hacer llamadas GET paginadas
al REST API.

Usa el flujo OAuth 2.0 "Client Credentials" (pensado para jobs de sincronización
y generadores de reportes, sin usuario interactivo), que en Procore requiere una
Developer Managed Service Account (DMSA) instalada en tu app.
Referencia: https://developers.procore.com/documentation/oauth-client-credentials
"""
from __future__ import annotations

import time
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
        company_id: str | None = None,
        timeout: int = 30,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = base_url.rstrip("/")
        self.oauth_url = oauth_url.rstrip("/")
        self.company_id = company_id
        self.timeout = timeout
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def _get_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expires_at - 60:
            return self._token

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
                "tenga una Developer Managed Service Account (DMSA) instalada con permisos "
                "sobre RFIs, Submittals y Drawings en este proyecto. Ver "
                "https://developers.procore.com/documentation/oauth-client-credentials"
            )
        payload = resp.json()
        self._token = payload["access_token"]
        # Los tokens de service account no usan refresh_token; se piden de nuevo
        # cuando expiran (por defecto duran ~1.5h). Restamos un margen de 60s.
        self._token_expires_at = now + float(payload.get("expires_in", 5400))
        return self._token

    def _headers(self) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self._get_token()}"}
        if self.company_id:
            headers["Procore-Company-Id"] = str(self.company_id)
        return headers

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
                    f"403 en {path}. La app/DMSA no tiene permiso sobre esta herramienta "
                    "en este proyecto. Revisa los permisos de la app en el Admin de Procore "
                    "(Company Level > Apps)."
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
