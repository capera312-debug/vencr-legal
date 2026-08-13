"""Wrapper delgado sobre Alpaca: estado de cuenta y envío de órdenes bracket
(entrada + stop-loss + take-profit).

Se mantiene como una interfaz angosta a propósito — si más adelante quieres
migrar a Interactive Brokers (`ib_insync`) u otro broker, la idea es que
puedas escribir una clase con la misma forma (`get_portfolio_state`,
`submit_bracket_order`) sin tocar `pipeline.py` ni `risk_gate.py`.

Nota: revisa la documentación vigente de Alpaca antes de usar esto con
dinero real — los detalles de órdenes bracket (notional vs qty, tipos de
orden soportados) cambian entre versiones del SDK.
"""
from __future__ import annotations

from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderClass, OrderSide, TimeInForce
from alpaca.trading.requests import (
    MarketOrderRequest,
    StopLossRequest,
    TakeProfitRequest,
)

from ..schemas import Action, ExecutedOrder, PortfolioState


class AlpacaBroker:
    def __init__(self, api_key: str, secret_key: str, paper: bool = True):
        self._client = TradingClient(api_key, secret_key, paper=paper)
        self.paper = paper

    def list_positions(self) -> list[dict]:
        """Posiciones abiertas, en un formato plano listo para mostrar en un dashboard."""
        return [
            {
                "symbol": p.symbol,
                "qty": float(p.qty),
                "market_value": float(p.market_value),
                "unrealized_pl": float(p.unrealized_pl),
                "unrealized_plpc": float(p.unrealized_plpc),
                "current_price": float(p.current_price),
            }
            for p in self._client.get_all_positions()
        ]

    def get_portfolio_state(self, trades_today: int) -> PortfolioState:
        account = self._client.get_account()
        positions = self._client.get_all_positions()
        equity = float(account.equity)
        exposure = sum(abs(float(p.market_value)) for p in positions)
        return PortfolioState(
            equity=equity,
            cash=float(account.cash),
            total_exposure_pct=(exposure / equity) if equity else 0.0,
            trades_today=trades_today,
        )

    def submit_bracket_order(
        self,
        symbol: str,
        side: Action,
        notional: float,
        last_close: float,
        stop_loss_pct: float,
        take_profit_pct: float | None = None,
    ) -> ExecutedOrder:
        if side not in ("buy", "sell"):
            raise ValueError("side debe ser 'buy' o 'sell' para enviar una orden")

        order_side = OrderSide.BUY if side == "buy" else OrderSide.SELL
        stop_price = round(
            last_close * (1 - stop_loss_pct) if side == "buy" else last_close * (1 + stop_loss_pct),
            2,
        )
        take_profit_req = None
        if take_profit_pct:
            tp_price = round(
                last_close * (1 + take_profit_pct) if side == "buy" else last_close * (1 - take_profit_pct),
                2,
            )
            take_profit_req = TakeProfitRequest(limit_price=tp_price)

        request = MarketOrderRequest(
            symbol=symbol,
            notional=round(notional, 2),
            side=order_side,
            time_in_force=TimeInForce.DAY,
            order_class=OrderClass.BRACKET,
            stop_loss=StopLossRequest(stop_price=stop_price),
            take_profit=take_profit_req,
        )
        order = self._client.submit_order(request)

        return ExecutedOrder(
            symbol=symbol,
            side=side,
            notional=notional,
            stop_loss_pct=stop_loss_pct,
            take_profit_pct=take_profit_pct,
            broker_order_id=str(order.id),
            paper=self.paper,
        )
