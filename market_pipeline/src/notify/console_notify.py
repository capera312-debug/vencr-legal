"""Notificación/aprobación por consola.

Reemplaza este módulo por un bot de Telegram/Slack si quieres aprobar
órdenes desde el celular en vez de tener el pipeline corriendo en primer
plano. La interfaz a mantener es `present_and_confirm(thesis, risk_decision)
-> bool`.
"""
from __future__ import annotations

from ..schemas import RiskDecision, TradeThesis


def present_and_confirm(thesis: TradeThesis, risk_decision: RiskDecision) -> bool:
    print("\n" + "=" * 60)
    print(f"Propuesta para {thesis.symbol}: {thesis.action.upper()}")
    print(f"  Confianza:     {thesis.confidence:.0%}")
    print(f"  Tamaño sugerido (ajustado por risk gate): {risk_decision.adjusted_size_pct:.1%}")
    print(f"  Stop-loss:     {thesis.stop_loss_pct}")
    print(f"  Take-profit:   {thesis.take_profit_pct}")
    print(f"  Horizonte:     {thesis.horizon}")
    print(f"  Razonamiento:  {thesis.rationale}")
    if thesis.key_risks:
        print("  Riesgos clave:")
        for risk in thesis.key_risks:
            print(f"    - {risk}")
    print(f"  Risk gate:     APROBADA ({risk_decision.reason})")
    print("=" * 60)

    answer = input("¿Enviar esta orden a Alpaca? [y/N]: ").strip().lower()
    return answer == "y"


def report_rejected(thesis: TradeThesis, risk_decision: RiskDecision) -> None:
    print(f"[{thesis.symbol}] Rechazada por el risk gate: {risk_decision.reason}")


def report_hold(thesis: TradeThesis) -> None:
    print(f"[{thesis.symbol}] Claude sugiere HOLD (confianza {thesis.confidence:.0%}): {thesis.rationale}")
