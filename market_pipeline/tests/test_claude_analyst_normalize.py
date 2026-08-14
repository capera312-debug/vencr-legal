import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.analysis.claude_analyst import _normalize_thesis_input
from src.schemas import TradeThesis


def test_key_risks_as_bare_string_becomes_single_item_list():
    raw = {
        "symbol": "AAPL",
        "action": "hold",
        "confidence": 0.4,
        "rationale": "x",
        "key_risks": "Si el RSI sobreventa se revierte, podría ser una simple pausa en la caída.",
    }
    normalized = _normalize_thesis_input(raw)
    assert normalized["key_risks"] == [
        "Si el RSI sobreventa se revierte, podría ser una simple pausa en la caída."
    ]
    # y ahora sí valida contra el schema real, que antes rompía en este caso
    thesis = TradeThesis(**normalized)
    assert thesis.key_risks == normalized["key_risks"]


def test_empty_string_key_risks_becomes_empty_list():
    raw = {"symbol": "MSFT", "action": "hold", "confidence": 0.3, "rationale": "x", "key_risks": "   "}
    assert _normalize_thesis_input(raw)["key_risks"] == []


def test_list_key_risks_passes_through_unchanged():
    raw = {
        "symbol": "NVDA",
        "action": "buy",
        "confidence": 0.7,
        "rationale": "x",
        "key_risks": ["riesgo A", "riesgo B"],
    }
    assert _normalize_thesis_input(raw)["key_risks"] == ["riesgo A", "riesgo B"]


def test_missing_key_risks_is_left_untouched():
    raw = {"symbol": "AAPL", "action": "hold", "confidence": 0.3, "rationale": "x"}
    normalized = _normalize_thesis_input(raw)
    assert "key_risks" not in normalized
    # el default de TradeThesis sigue funcionando
    assert TradeThesis(**normalized).key_risks == []
