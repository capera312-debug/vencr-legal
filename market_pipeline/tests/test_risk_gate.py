import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import RiskLimits
from src.risk.risk_gate import RiskGate
from src.schemas import PortfolioState, TradeThesis

DEFAULT_LIMITS = RiskLimits(
    max_position_pct=0.05,
    max_total_exposure_pct=0.30,
    min_confidence_to_act=0.65,
    max_daily_trades=5,
)


def make_thesis(**overrides) -> TradeThesis:
    base = dict(
        symbol="AAPL",
        action="buy",
        confidence=0.8,
        size_pct=0.05,
        stop_loss_pct=0.03,
        rationale="test",
    )
    base.update(overrides)
    return TradeThesis(**base)


def make_portfolio(**overrides) -> PortfolioState:
    base = dict(equity=100_000, cash=50_000, total_exposure_pct=0.1, trades_today=0)
    base.update(overrides)
    return PortfolioState(**base)


def test_hold_is_never_approved():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(action="hold", stop_loss_pct=None), make_portfolio())
    assert not decision.approved


def test_rejects_low_confidence():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(confidence=0.4), make_portfolio())
    assert not decision.approved
    assert "confianza" in decision.reason


def test_rejects_missing_stop_loss():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(stop_loss_pct=None), make_portfolio())
    assert not decision.approved
    assert "stop_loss" in decision.reason


def test_rejects_daily_trade_limit():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(), make_portfolio(trades_today=5))
    assert not decision.approved
    assert "diario" in decision.reason


def test_rejects_exceeding_total_exposure():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(size_pct=0.05), make_portfolio(total_exposure_pct=0.28))
    assert not decision.approved
    assert "exposición" in decision.reason


def test_approves_and_caps_size_to_limit():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(size_pct=0.20), make_portfolio())
    assert decision.approved
    assert decision.adjusted_size_pct == DEFAULT_LIMITS.max_position_pct


def test_approves_within_limits():
    gate = RiskGate(DEFAULT_LIMITS)
    decision = gate.evaluate(make_thesis(size_pct=0.03), make_portfolio())
    assert decision.approved
    assert decision.adjusted_size_pct == 0.03
