import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.dashboard.app import _flatten


def make_record(**overrides):
    base = {
        "created_at": "2026-08-13T12:00:00+00:00",
        "symbol": "AAPL",
        "thesis": {
            "symbol": "AAPL",
            "action": "buy",
            "confidence": 0.8,
            "size_pct": 0.05,
            "stop_loss_pct": 0.03,
            "rationale": "Momentum alcista.",
            "key_risks": ["Reversión macro"],
        },
        "portfolio": {"equity": 100_000, "cash": 50_000, "total_exposure_pct": 0.1, "trades_today": 1},
        "risk_decision": {"approved": True, "reason": "Aprobada.", "adjusted_size_pct": 0.05},
        "order": {"broker_order_id": "abc-123"},
    }
    base.update(overrides)
    return base


def test_flatten_maps_nested_fields_to_flat_columns():
    df = _flatten([make_record()])
    row = df.iloc[0]
    assert row["symbol"] == "AAPL"
    assert row["action"] == "buy"
    assert row["confidence"] == 0.8
    assert row["approved"] is True
    assert row["equity"] == 100_000
    assert row["order_id"] == "abc-123"
    assert row["key_risks"] == ["Reversión macro"]


def test_flatten_handles_missing_order_and_risks():
    record = make_record(order=None)
    record["thesis"]["key_risks"] = []
    df = _flatten([record])
    row = df.iloc[0]
    assert row["order_id"] is None
    assert row["key_risks"] == []
