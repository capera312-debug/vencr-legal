"""Backtesting simple: corre a Claude sobre ventanas históricas de precios y
compara la tesis generada contra lo que realmente pasó después.

El objetivo no es simular una ejecución perfecta -- es tener una primera
señal de si el análisis del modelo tiene poder predictivo antes de
confiarle el pipeline en vivo (ver README, sección "Próximos pasos").

Limitaciones a tener en cuenta al leer los resultados:
- Cada fecha evaluada dispara una llamada real a la API de Claude.
- Claude solo ve velas hasta la fecha simulada (`as_of`), nunca datos
  posteriores -- así se evita lookahead bias.
- No modela slippage, comisiones, ni la posibilidad de que la orden no se
  hubiera llenado exactamente al precio de cierre.
- El stop-loss / take-profit se evalúa contra los máximos y mínimos
  intradía de las velas del horizonte, asumiendo que se ejecutan al precio
  exacto propuesto -- una simplificación optimista.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pandas as pd

from ..data.market_data import summarize_bars
from ..schemas import TradeThesis

MIN_BARS_FOR_CONTEXT = 20


@dataclass
class BacktestResult:
    symbol: str
    as_of: date
    thesis: TradeThesis
    horizon_days: int
    entry_price: float
    exit_price: float | None = None
    return_pct: float | None = None
    correct: bool | None = None
    stopped_out: bool = False
    hit_take_profit: bool = False


class Backtester:
    def __init__(self, analyst, bars: pd.DataFrame, symbol: str):
        """`analyst` debe exponer `.analyze(symbol, context) -> TradeThesis`
        (típicamente un `ClaudeAnalyst`, o un doble de prueba en los tests).
        `bars` son velas diarias crudas (como las devuelve
        `MarketDataClient.get_daily_bars`), cubriendo tanto la historia
        previa a la primera fecha a evaluar como el horizonte posterior a
        la última.
        """
        if bars.empty:
            raise ValueError(f"No hay velas cargadas para {symbol}")
        self._analyst = analyst
        self._bars = bars.sort_index()
        self._symbol = symbol

    def run(self, eval_dates: list[date], horizon_days: int = 5) -> list[BacktestResult]:
        results = []
        for as_of in eval_dates:
            window = self._bars[self._bars.index.date <= as_of]
            if len(window) < MIN_BARS_FOR_CONTEXT:
                continue  # no hay suficiente historia todavía para esta fecha

            context = summarize_bars(self._symbol, window)
            if context.get("error"):
                continue

            thesis = self._analyst.analyze(self._symbol, context)
            results.append(self._evaluate(as_of, thesis, horizon_days, window))
        return results

    def _evaluate(self, as_of: date, thesis: TradeThesis, horizon_days: int, window: pd.DataFrame) -> BacktestResult:
        entry_price = float(window["close"].iloc[-1])
        result = BacktestResult(
            symbol=self._symbol,
            as_of=as_of,
            thesis=thesis,
            horizon_days=horizon_days,
            entry_price=entry_price,
        )

        future = self._bars[self._bars.index.date > as_of].head(horizon_days)
        if thesis.action == "hold" or future.empty:
            return result

        direction = 1 if thesis.action == "buy" else -1
        exit_price = float(future["close"].iloc[-1])
        result.exit_price = exit_price
        raw_return = (exit_price / entry_price - 1) * direction

        if thesis.stop_loss_pct:
            stop_price = entry_price * (1 - direction * thesis.stop_loss_pct)
            touched_stop = (future["low"] <= stop_price) if thesis.action == "buy" else (future["high"] >= stop_price)
            if touched_stop.any():
                result.stopped_out = True
                raw_return = -thesis.stop_loss_pct

        if not result.stopped_out and thesis.take_profit_pct:
            tp_price = entry_price * (1 + direction * thesis.take_profit_pct)
            touched_tp = (future["high"] >= tp_price) if thesis.action == "buy" else (future["low"] <= tp_price)
            if touched_tp.any():
                result.hit_take_profit = True
                raw_return = thesis.take_profit_pct

        result.return_pct = round(raw_return * 100, 2)
        result.correct = raw_return > 0
        return result
