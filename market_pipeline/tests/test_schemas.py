import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.schemas import TradeThesis


def test_valid_thesis():
    thesis = TradeThesis(
        symbol="MSFT",
        action="buy",
        confidence=0.7,
        stop_loss_pct=0.02,
        rationale="Momentum alcista con soporte en SMA20.",
    )
    assert thesis.symbol == "MSFT"
    assert thesis.key_risks == []


def test_confidence_out_of_range_rejected():
    with pytest.raises(ValidationError):
        TradeThesis(symbol="MSFT", action="buy", confidence=1.5, rationale="x")


def test_invalid_action_rejected():
    with pytest.raises(ValidationError):
        TradeThesis(symbol="MSFT", action="short_forever", confidence=0.5, rationale="x")


def test_rationale_is_required():
    with pytest.raises(ValidationError):
        TradeThesis(symbol="MSFT", action="hold", confidence=0.5)
