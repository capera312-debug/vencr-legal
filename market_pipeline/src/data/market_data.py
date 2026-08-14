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
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit


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


def summarize_intraday_bars(symbol: str, bars: pd.DataFrame) -> dict:
    """Resumen de corto plazo (velas de 15 minutos) para afinar el TIMING de
    entrada o salida dentro de una tesis -- no habilita ni implica day
    trading. Las posiciones siguen abriéndose/cerrándose vía el horizonte
    swing normal del pipeline; esto solo mejora en qué momento de la sesión
    conviene actuar.
    """
    if bars.empty:
        return {"symbol": symbol, "error": "sin datos intradía disponibles"}

    closes = bars["close"]
    session_open = float(bars["open"].iloc[0])
    last_price = float(closes.iloc[-1])
    session_high = float(bars["high"].max())
    session_low = float(bars["low"].min())
    pct_change_session = round((last_price / session_open - 1) * 100, 2) if session_open else None

    typical_price = (bars["high"] + bars["low"] + bars["close"]) / 3
    volume_sum = float(bars["volume"].sum())
    vwap = float((typical_price * bars["volume"]).sum() / volume_sum) if volume_sum else None

    lookback = min(8, len(closes))  # ~2h en velas de 15 min
    momentum_2h_pct = (
        round(float(closes.iloc[-1] / closes.iloc[-lookback] - 1) * 100, 2)
        if lookback > 1 else None
    )

    return {
        "symbol": symbol,
        "timeframe": "15min",
        "last_price": round(last_price, 2),
        "session_open": round(session_open, 2),
        "session_high": round(session_high, 2),
        "session_low": round(session_low, 2),
        "pct_change_session": pct_change_session,
        "vwap": round(vwap, 2) if vwap is not None else None,
        "momentum_last_2h_pct": momentum_2h_pct,
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

    def get_intraday_bars(
        self, symbol: str, lookback_hours: int = 6, timeframe_minutes: int = 15
    ) -> pd.DataFrame:
        """Velas intradía crudas (por defecto de 15 minutos) de las últimas
        `lookback_hours` horas. Uso previsto: afinar el timing de entrada de
        una tesis swing, no operar day trading -- ver `summarize_intraday_bars`.
        """
        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=TimeFrame(timeframe_minutes, TimeFrameUnit.Minute),
            start=datetime.now(timezone.utc) - timedelta(hours=lookback_hours),
        )
        bars = self._client.get_stock_bars(request).df
        if bars.empty:
            return bars
        if isinstance(bars.index, pd.MultiIndex):
            bars = bars.xs(symbol, level=0)
        return bars.sort_index()

    def get_intraday_context(self, symbol: str, lookback_hours: int = 6) -> dict:
        """Resumen de corto plazo (15 min) para pasarle a Claude junto con el
        contexto diario -- ver `summarize_intraday_bars` para el propósito."""
        bars = self.get_intraday_bars(symbol, lookback_hours=lookback_hours)
        return summarize_intraday_bars(symbol, bars)
