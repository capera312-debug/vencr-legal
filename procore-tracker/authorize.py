#!/usr/bin/env python3
"""Login único: autoriza el tracker a nombre de tu usuario de Procore.

Corre esto UNA vez (o cuando el refresh token deje de funcionar). Abre el
navegador, inicias sesión en Procore con tu usuario, y Procore te muestra un
código en pantalla (flujo "installed app", sin servidor) que pegas de vuelta
acá. El script guarda un refresh token en .token_cache.json (junto a este
archivo, fuera del repo — ver .gitignore) y desde ahí tracker.py se renueva
solo, sin volver a pedirte login, hasta que ese refresh token se revoque o
expire.

Uso:
    cd procore-tracker
    python authorize.py
"""
from __future__ import annotations

import json
import webbrowser
from pathlib import Path
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv

from config import load_settings

BASE_DIR = Path(__file__).resolve().parent
TOKEN_CACHE_PATH = BASE_DIR / ".token_cache.json"


def main() -> None:
    load_dotenv(BASE_DIR / ".env")
    settings = load_settings()

    if settings.auth_mode != "authorization_code":
        raise SystemExit(
            f"PROCORE_AUTH_MODE está en '{settings.auth_mode}', no en 'authorization_code'. "
            "Este script de login solo aplica al modo authorization_code (login con usuario). "
            "Si tienes una DMSA habilitada por Procore, no necesitas correr authorize.py."
        )

    params = {
        "response_type": "code",
        "client_id": settings.client_id,
        "redirect_uri": settings.redirect_uri,
    }
    auth_url = f"{settings.oauth_url}/oauth/authorize?{urlencode(params)}"

    print("Abriendo el navegador para iniciar sesión en Procore...")
    print(f"Si no se abre solo, entra manualmente a:\n{auth_url}\n")
    webbrowser.open(auth_url)

    code = input("Pega aquí el código que te mostró Procore después de iniciar sesión: ").strip()
    if not code:
        raise SystemExit("No se ingresó ningún código.")

    resp = requests.post(
        f"{settings.oauth_url}/oauth/token",
        data={
            "grant_type": "authorization_code",
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "code": code,
            "redirect_uri": settings.redirect_uri,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise SystemExit(f"No se pudo obtener el token (HTTP {resp.status_code}): {resp.text}")

    payload = resp.json()
    refresh_token = payload.get("refresh_token")
    if not refresh_token:
        raise SystemExit(
            "Procore respondió sin refresh_token. Revisa que tu app tenga habilitado el "
            "grant type 'Authorization Code' en el Developer Portal."
        )

    TOKEN_CACHE_PATH.write_text(
        json.dumps({"refresh_token": refresh_token}, indent=2), encoding="utf-8"
    )
    print(f"\n✅ Listo. Sesión guardada en {TOKEN_CACHE_PATH}.")
    print("Ya puedes correr `python tracker.py` normalmente — se va a renovar solo.")


if __name__ == "__main__":
    main()
