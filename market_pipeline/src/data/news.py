"""Stub de noticias/catalizadores.

Conecta aquí el proveedor que prefieras (NewsAPI, Benzinga, Finnhub, RSS
propio...). Se deja separado de market_data.py para que puedas activarlo o
apagarlo sin tocar el resto del pipeline. Por defecto no hace ninguna
llamada externa y devuelve una lista vacía.
"""
from __future__ import annotations


def get_recent_headlines(symbol: str, limit: int = 5) -> list[str]:
    """Devuelve titulares recientes para `symbol`.

    Implementación de referencia (deshabilitada por defecto): reemplaza el
    cuerpo con una llamada real a tu proveedor de noticias, por ejemplo:

        resp = requests.get(
            "https://newsapi.org/v2/everything",
            params={"q": symbol, "apiKey": os.environ["NEWSAPI_KEY"],
                    "sortBy": "publishedAt", "pageSize": limit},
        )
        return [a["title"] for a in resp.json().get("articles", [])]
    """
    return []
