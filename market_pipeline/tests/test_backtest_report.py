import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backtest.engine import BacktestResult
from src.backtest.report import summarize
from src.schemas import TradeThesis


def make_result(action, confidence, return_pct=None, correct=None):
    thesis = TradeThesis(symbol="TEST", action=action, confidence=confidence, rationale="x")
    return BacktestResult(
        symbol="TEST",
        as_of=date(2026, 1, 1),
        thesis=thesis,
        horizon_days=5,
        entry_price=100.0,
        exit_price=101.0 if return_pct is not None else None,
        return_pct=return_pct,
        correct=correct,
    )


def test_summarize_computes_hit_rate_and_avg_return():
    results = [
        make_result("buy", 0.9, return_pct=5.0, correct=True),
        make_result("buy", 0.9, return_pct=-2.0, correct=False),
        make_result("hold", 0.3),
    ]

    summary = summarize(results)

    assert summary["total_thesis"] == 3
    assert summary["acted_on"] == 2
    assert summary["evaluated"] == 2
    assert summary["hit_rate"] == 0.5
    assert summary["avg_return_pct"] == 1.5


def test_summarize_handles_no_results():
    summary = summarize([])
    assert summary["total_thesis"] == 0
    assert summary["hit_rate"] is None


def test_summarize_handles_only_holds():
    results = [make_result("hold", 0.4), make_result("hold", 0.3)]
    summary = summarize(results)
    assert summary["total_thesis"] == 2
    assert summary["evaluated"] == 0
    assert summary["hit_rate"] is None
