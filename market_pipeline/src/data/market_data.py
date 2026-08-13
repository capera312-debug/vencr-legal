"""Obtención de precios e indicadores técnicos vía Alpaca Market Data.

`summarize_bars` es una función pura (sin llamadas de red) que convierte
velas en el mismo dict resumido que consume `ClaudeAnalyst`. La usan tanto
`MarketDataClient.get_context` (datos en vivo) como `Backtester`
(datos históricos recortados a una fecha) para garantizar que ambos caminos
calculan los indicadores exactamente igual.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame


def _rsi(closes: pd.Series, period: int = 14) -> float:
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1]) if not rsi.empty and pd.notna(rsi.iloc[-1]) else 50.0


def summarize_bars(symbol: str, bars: pd.DataFrame) -> dict:
    """Convierte velas diarias (columnas open/high/low/close/volume) en el
    resumen de indicadores que se le pasa a Claude. No hace ninguna llamada
    de red -- toda la información viene ya en `bars`.
    """
    if bars.empty:
        return {"symbol": symbol, "error": "sin datos disponibles"}

    closes = bars["close"]
    last_close = float(closes.iloc[-1])
    sma20 = float(closes.rolling(20).mean().iloc[-1]) if len(closes) >= 20 else None
    sma50 = float(closes.rolling(50).mean().iloc[-1]) if len(closes) >= 50 else None
    pct_change_5d = (
        float((closes.iloc[-1] / closes.iloc[-6] - 1) * 100) if len(closes) > 5 else None
    )
    volatility_20d = float(closes.pct_change().rolling(20).std().iloc[-1] * 100) if len(closes) >= 20 else None

    return {
        "symbol": symbol,
        "last_close": round(last_close, 2),
        "sma20": round(sma20, 2) if sma20 is not None else None,
        "sma50": round(sma50, 2) if sma50 is not None else None,
        "rsi14": round(_rsi(closes), 2),
        "pct_change_5d": round(pct_change_5d, 2) if pct_change_5d is not None else None,
        "volatility_20d_pct": round(volatility_20d, 2) if volatility_20d is not None else None,
        "volume_last": int(bars["volume"].iloc[-1]),
        "bars_used": len(bars),
    }


class MarketDataClient:
    def __init__(self, api_key: str, secret_key: str):
        self._client = StockHistoricalDataClient(api_key, secret_key)

    def get_daily_bars(self, symbol: str, start: datetime, end: datetime | None = None) -> pd.DataFrame:
        """Velas diarias crudas entre `start` y `end` (por defecto, hasta ahora).

        Devuelve el DataFrame tal cual lo entrega Alpaca (índice de fecha,
        columnas open/high/low/close/volume/...), sin resumir -- pensado
        para descargar una sola vez y reutilizar, por ejemplo en el
        backtester, que necesita las velas crudas para poder recortarlas a
        distintas fechas.
        """
        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=TimeFrame.Day,
            start=start,
            end=end,
        )
        bars = self._client.get_stock_bars(request).df
        if bars.empty:
            return bars
        if isinstance(bars.index, pd.MultiIndex):
            bars = bars.xs(symbol, level=0)
        return bars.sort_index()

    def get_context(self, symbol: str, lookback_days: int = 90) -> dict:
        """Trae velas diarias recientes y devuelve un resumen con indicadores."""
        bars = self.get_daily_bars(symbol, start=datetime.now(timezone.utc) - timedelta(days=lookback_days))
        return summarize_bars(symbol, bars)
