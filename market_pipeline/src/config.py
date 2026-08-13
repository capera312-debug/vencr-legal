"""Configuración central del pipeline, cargada desde variables de entorno.

Mantener toda la configuración de riesgo y ejecución en un solo lugar hace
más fácil auditar qué límites está usando el sistema en un momento dado.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _bool_env(name: str, default: bool) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


def _float_env(name: str, default: float) -> float:
    val = os.getenv(name)
    return float(val) if val is not None else default


def _int_env(name: str, default: int) -> int:
    val = os.getenv(name)
    return int(val) if val is not None else default


@dataclass(frozen=True)
class RiskLimits:
    max_position_pct: float
    max_total_exposure_pct: float
    min_confidence_to_act: float
    max_daily_trades: int
    require_stop_loss: bool = True


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    claude_model: str

    alpaca_api_key: str
    alpaca_secret_key: str
    alpaca_paper: bool

    auto_execute: bool
    confirm_live_trading: bool

    risk: RiskLimits

    def is_live_trading_allowed(self) -> bool:
        """Doble salvaguarda: hace falta AMBAS banderas para tocar dinero real."""
        return (not self.alpaca_paper) and self.confirm_live_trading


def load_settings() -> Settings:
    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        claude_model=os.getenv("CLAUDE_MODEL", "claude-sonnet-5"),
        alpaca_api_key=os.getenv("ALPACA_API_KEY", ""),
        alpaca_secret_key=os.getenv("ALPACA_SECRET_KEY", ""),
        alpaca_paper=_bool_env("ALPACA_PAPER", True),
        auto_execute=_bool_env("AUTO_EXECUTE", False),
        confirm_live_trading=_bool_env("CONFIRM_LIVE_TRADING", False),
        risk=RiskLimits(
            max_position_pct=_float_env("RISK_MAX_POSITION_PCT", 0.05),
            max_total_exposure_pct=_float_env("RISK_MAX_TOTAL_EXPOSURE_PCT", 0.30),
            min_confidence_to_act=_float_env("RISK_MIN_CONFIDENCE", 0.65),
            max_daily_trades=_int_env("RISK_MAX_DAILY_TRADES", 5),
        ),
    )
