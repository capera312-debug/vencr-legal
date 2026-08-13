"""Motor de reglas determinista: el único lugar donde se decide si una
tesis de Claude puede convertirse en una orden real.

Deliberadamente NO hay ninguna llamada a un LLM en este archivo. Las reglas
son simples, legibles y auditables — si algo sale mal, el problema tiene que
poder explicarse en una frase, no en un prompt.
"""
from __future__ import annotations

from ..config import RiskLimits
from ..schemas import PortfolioState, RiskDecision, TradeThesis


class RiskGate:
    def __init__(self, limits: RiskLimits):
        self._limits = limits

    def evaluate(self, thesis: TradeThesis, portfolio: PortfolioState) -> RiskDecision:
        if thesis.action == "hold":
            return RiskDecision(approved=False, reason="La tesis es 'hold': no hay orden que evaluar.")

        reasons: list[str] = []

        if thesis.confidence < self._limits.min_confidence_to_act:
            reasons.append(
                f"confianza {thesis.confidence:.2f} por debajo del mínimo "
                f"{self._limits.min_confidence_to_act:.2f}"
            )

        if self._limits.require_stop_loss and not thesis.stop_loss_pct:
            reasons.append("falta stop_loss_pct, es obligatorio para operar")

        if portfolio.trades_today >= self._limits.max_daily_trades:
            reasons.append(
                f"límite diario de operaciones alcanzado "
                f"({portfolio.trades_today}/{self._limits.max_daily_trades})"
            )

        proposed_size = min(thesis.size_pct or self._limits.max_position_pct, self._limits.max_position_pct)

        if portfolio.total_exposure_pct + proposed_size > self._limits.max_total_exposure_pct:
            reasons.append(
                f"excede la exposición total máxima permitida "
                f"({portfolio.total_exposure_pct:.0%} + {proposed_size:.0%} > "
                f"{self._limits.max_total_exposure_pct:.0%})"
            )

        if reasons:
            return RiskDecision(approved=False, reason="; ".join(reasons))

        return RiskDecision(
            approved=True,
            adjusted_size_pct=proposed_size,
            reason="Aprobada dentro de los límites de riesgo configurados.",
        )
