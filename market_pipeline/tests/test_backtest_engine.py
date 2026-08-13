import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backtest.engine import Backtester
from src.schemas import TradeThesis


class FakeAnalyst:
    """Doble de prueba: devuelve siempre la misma tesis, sin llamar a ninguna API."""

    def __init__(self, thesis: TradeThesis):
        self._thesis = thesis
        self.calls = 0

    def analyze(self, symbol, context, headlines=None):
        self.calls += 1
        return self._thesis


def make_bars(prices: list[float], start: str = "2026-01-01") -> pd.DataFrame:
    idx = pd.date_range(start=start, periods=len(prices), freq="D")
    return pd.DataFrame(
        {
            "open": prices,
            "high": [p * 1.01 for p in prices],
            "low": [p * 0.99 for p in prices],
            "close": prices,
            "volume": [1_000_000] * len(prices),
        },
        index=idx,
    )


def test_hold_thesis_produces_no_return():
    thesis = TradeThesis(symbol="TEST", action="hold", confidence=0.4, rationale="sin catalizador claro")
    bars = make_bars([100 + i for i in range(40)])
    backtester = Backtester(FakeAnalyst(thesis), bars, "TEST")

    results = backtester.run([date(2026, 1, 30)], horizon_days=5)

    assert len(results) == 1
    assert results[0].return_pct is None
    assert results[0].correct is None


def test_buy_thesis_measures_positive_return_when_price_rises():
    thesis = TradeThesis(symbol="TEST", action="buy", confidence=0.8, stop_loss_pct=0.10, rationale="momentum")
    bars = make_bars([100 + i for i in range(40)])  # tendencia alcista constante
    backtester = Backtester(FakeAnalyst(thesis), bars, "TEST")

    results = backtester.run([date(2026, 1, 30)], horizon_days=5)

    assert len(results) == 1
    result = results[0]
    assert result.correct is True
    assert result.return_pct > 0
    assert result.stopped_out is False


def test_buy_thesis_detects_stop_loss_touch():
    thesis = TradeThesis(symbol="TEST", action="buy", confidence=0.8, stop_loss_pct=0.02, rationale="momentum")
    prices = [100] * 30 + [100, 95, 94, 93, 92, 91]  # cae fuerte justo después de la fecha evaluada
    bars = make_bars(prices)
    backtester = Backtester(FakeAnalyst(thesis), bars, "TEST")

    results = backtester.run([date(2026, 1, 30)], horizon_days=5)

    result = results[0]
    assert result.stopped_out is True
    assert result.return_pct == -2.0


def test_sell_thesis_measures_positive_return_when_price_falls():
    thesis = TradeThesis(symbol="TEST", action="sell", confidence=0.7, stop_loss_pct=0.10, rationale="sobrecompra")
    bars = make_bars([200 - i for i in range(40)])  # tendencia bajista constante
    backtester = Backtester(FakeAnalyst(thesis), bars, "TEST")

    results = backtester.run([date(2026, 1, 30)], horizon_days=5)

    result = results[0]
    assert result.correct is True
    assert result.return_pct > 0


def test_skips_dates_without_enough_history():
    thesis = TradeThesis(symbol="TEST", action="buy", confidence=0.8, stop_loss_pct=0.05, rationale="x")
    bars = make_bars([100 + i for i in range(10)])  # solo 10 velas, no alcanza
    analyst = FakeAnalyst(thesis)
    backtester = Backtester(analyst, bars, "TEST")

    results = backtester.run([date(2026, 1, 5)], horizon_days=5)

    assert results == []
    assert analyst.calls == 0


def test_constructor_rejects_empty_bars():
    import pytest

    thesis = TradeThesis(symbol="TEST", action="hold", confidence=0.5, rationale="x")
    with pytest.raises(ValueError):
        Backtester(FakeAnalyst(thesis), pd.DataFrame(), "TEST")
