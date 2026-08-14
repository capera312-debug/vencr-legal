import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.data.market_data import summarize_intraday_bars


def _bars(prices: list[float], volumes: list[int] | None = None) -> pd.DataFrame:
    volumes = volumes or [1_000] * len(prices)
    index = pd.date_range("2026-08-14 13:30", periods=len(prices), freq="15min", tz="UTC")
    return pd.DataFrame(
        {
            "open": prices,
            "high": [p * 1.002 for p in prices],
            "low": [p * 0.998 for p in prices],
            "close": prices,
            "volume": volumes,
        },
        index=index,
    )


def test_empty_bars_report_error():
    result = summarize_intraday_bars("AAPL", pd.DataFrame())
    assert result == {"symbol": "AAPL", "error": "sin datos intradía disponibles"}


def test_summarize_computes_session_stats():
    prices = [100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5, 104, 104.5]
    result = summarize_intraday_bars("NVDA", _bars(prices))

    assert result["symbol"] == "NVDA"
    assert result["timeframe"] == "15min"
    assert result["last_price"] == pytest.approx(104.5)
    assert result["session_open"] == pytest.approx(100)
    assert result["session_high"] > result["session_open"]
    assert result["session_low"] < result["last_price"]
    assert result["pct_change_session"] == pytest.approx(4.5, abs=0.01)
    assert result["vwap"] is not None
    # 8 velas de lookback (~2h): compara la última contra la vela 8 atrás
    assert result["momentum_last_2h_pct"] == pytest.approx(
        (prices[-1] / prices[-8] - 1) * 100, abs=0.01
    )
    assert result["bars_used"] == len(prices)


def test_flat_session_has_no_pct_change():
    prices = [50.0] * 5
    result = summarize_intraday_bars("MSFT", _bars(prices))
    assert result["pct_change_session"] == 0.0
    assert result["momentum_last_2h_pct"] == 0.0
