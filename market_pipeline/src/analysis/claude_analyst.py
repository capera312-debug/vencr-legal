"""Capa de análisis: Claude recibe contexto de mercado y devuelve una tesis
estructurada, nunca una orden ejecutable.

Usamos `tool_choice` forzado a una única herramienta (`submit_trade_thesis`)
para que la respuesta sea siempre JSON validable por `TradeThesis`, en vez
de tener que parsear texto libre.
"""
from __future__ import annotations

import json

import anthropic

from ..schemas import TradeThesis

SYSTEM_PROMPT = """\
Eres un analista de mercados financieros. Tu trabajo es evaluar la evidencia \
disponible sobre un activo y producir una tesis de inversión estructurada, \
NO una orden ejecutable — otro componente del sistema (un motor de reglas \
determinista) validará tu propuesta contra límites de riesgo antes de que \
cualquier orden real pueda enviarse.

Reglas de tu análisis:
- Basa tu tesis únicamente en los datos que se te dan. No inventes cifras.
- Si la evidencia es débil, mixta o insuficiente, recomienda 'hold' con \
confianza baja. No fuerces una operación cuando no la ves clara.
- 'confidence' refleja qué tan fuerte es la evidencia, no qué tan grande \
debería ser la apuesta.
- Siempre que recomiendes 'buy' o 'sell', incluye stop_loss_pct: es \
obligatorio para que el risk gate pueda considerar la operación.
- Sé explícito en 'key_risks' sobre lo que podría invalidar tu tesis.
"""

SUBMIT_THESIS_TOOL = {
    "name": "submit_trade_thesis",
    "description": "Registra la tesis de inversión estructurada para un símbolo.",
    "input_schema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "action": {"type": "string", "enum": ["buy", "sell", "hold"]},
            "confidence": {
                "type": "number", "minimum": 0, "maximum": 1,
                "description": "Qué tan fuerte es la evidencia detrás de la tesis.",
            },
            "size_pct": {
                "type": "number", "minimum": 0, "maximum": 1,
                "description": "Fracción del capital sugerida, antes del risk gate.",
            },
            "stop_loss_pct": {"type": "number", "minimum": 0},
            "take_profit_pct": {"type": "number", "minimum": 0},
            "horizon": {
                "type": "string",
                "enum": ["intraday", "swing_days", "position_weeks"],
            },
            "rationale": {"type": "string"},
            "key_risks": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["symbol", "action", "confidence", "rationale"],
    },
}


class ClaudeAnalyst:
    def __init__(self, api_key: str, model: str = "claude-sonnet-5"):
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def analyze(self, symbol: str, market_context: dict, headlines: list[str] | None = None) -> TradeThesis:
        prompt = (
            f"Símbolo: {symbol}\n\n"
            f"Datos de mercado:\n{json.dumps(market_context, indent=2, ensure_ascii=False)}\n\n"
            f"Titulares recientes:\n{json.dumps(headlines or [], indent=2, ensure_ascii=False)}\n\n"
            "Llama a submit_trade_thesis con tu análisis."
        )

        response = self._client.messages.create(
            model=self._model,
            max_tokens=1500,
            system=SYSTEM_PROMPT,
            tools=[SUBMIT_THESIS_TOOL],
            tool_choice={"type": "tool", "name": "submit_trade_thesis"},
            messages=[{"role": "user", "content": prompt}],
        )

        for block in response.content:
            if block.type == "tool_use" and block.name == "submit_trade_thesis":
                return TradeThesis(**block.input)

        raise RuntimeError(f"Claude no devolvió una tesis estructurada para {symbol}")
