"""Obtención de precios e indicadores técnicos vía Alpaca Market Data.

Devuelve un dict plano y ya resumido — evitamos pasarle a Claude un
DataFrame gigante; le damos justo lo que necesita para razonar.
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


class MarketDataClient:
    def __init__(self, api_key: str, secret_key: str):
        self._client = StockHistoricalDataClient(api_key, secret_key)

    def get_context(self, symbol: str, lookback_days: int = 90) -> dict:
        """Trae velas diarias recientes y devuelve un resumen con indicadores."""
        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=TimeFrame.Day,
            start=datetime.now(timezone.utc) - timedelta(days=lookback_days),
        )
        bars = self._client.get_stock_bars(request).df

        if bars.empty:
            return {"symbol": symbol, "error": "sin datos disponibles"}

        # get_stock_bars devuelve un índice multi-nivel (symbol, timestamp)
        # cuando se pasa más de un símbolo; nos quedamos solo con este.
        if isinstance(bars.index, pd.MultiIndex):
            bars = bars.xs(symbol, level=0)

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
