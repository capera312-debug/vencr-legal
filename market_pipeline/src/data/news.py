"""Titulares/catalizadores recientes vía la News API de Alpaca.

Usa las mismas credenciales que ya tenemos para Market Data -- la News API
está incluida en el mismo plan, no hace falta una cuenta ni un key aparte.

Antes esto era un stub que siempre devolvía `[]`: el análisis de Claude
corría solo con indicadores técnicos rezagados (SMA/RSI/momentum), que en
símbolos grandes suelen dar lecturas mixtas y por diseño del prompt eso
mantiene la confianza baja ("si la evidencia es débil, recomendá hold").
Con titulares reales, Claude tiene catalizadores concretos para justificar
una tesis con más o menos confianza -- sin tocar el umbral del risk gate
ni aflojar esa instrucción de cautela.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from alpaca.data.historical.news import NewsClient
from alpaca.data.requests import NewsRequest


def get_recent_headlines(
    symbol: str,
    api_key: str,
    secret_key: str,
    limit: int = 5,
    lookback_days: int = 3,
) -> list[str]:
    """Titulares reales de los últimos `lookback_days` días para `symbol`.

    Si algo falla (credenciales, red, rate limit) devuelve `[]` en vez de
    propagar la excepción -- sin noticias, el pipeline sigue funcionando
    igual que antes (análisis solo con datos técnicos), no se rompe.
    """
    if not api_key or not secret_key:
        return []
    try:
        client = NewsClient(api_key, secret_key)
        request = NewsRequest(
            symbols=symbol,
            start=datetime.now(timezone.utc) - timedelta(days=lookback_days),
            limit=limit,
            exclude_contentless=True,
        )
        news_set = client.get_news(request)
        return [article.headline for article in news_set.data.get("news", [])]
    except Exception:
        return []
