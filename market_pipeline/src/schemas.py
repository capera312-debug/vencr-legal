"""Modelos de datos compartidos entre módulos.

Usar Pydantic aquí es lo que nos permite forzar a Claude a devolver algo
validable en vez de texto libre que hay que parsear con la esperanza de que
tenga el formato correcto.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Action = Literal["buy", "sell", "hold"]
Horizon = Literal["intraday", "swing_days", "position_weeks"]


class TradeThesis(BaseModel):
    """Salida estructurada de Claude para un símbolo dado."""

    symbol: str
    action: Action
    confidence: float = Field(ge=0.0, le=1.0)
    size_pct: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description="Fracción del capital sugerida por Claude, ANTES del risk gate.",
    )
    stop_loss_pct: Optional[float] = Field(default=None, ge=0.0)
    take_profit_pct: Optional[float] = Field(default=None, ge=0.0)
    horizon: Optional[Horizon] = None
    rationale: str
    key_risks: list[str] = Field(default_factory=list)


class PortfolioState(BaseModel):
    """Estado de la cuenta necesario para que el risk gate pueda decidir."""

    equity: float
    cash: float
    total_exposure_pct: float
    trades_today: int


class RiskDecision(BaseModel):
    approved: bool
    reason: str
    adjusted_size_pct: Optional[float] = None


class ExecutedOrder(BaseModel):
    symbol: str
    side: Action
    notional: float
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    broker_order_id: Optional[str] = None
    paper: bool = True
