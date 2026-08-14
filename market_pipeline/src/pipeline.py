"""Orquesta el pipeline completo para una watchlist:

    datos de mercado -> Claude (tesis) -> risk gate -> (confirmación humana) -> Alpaca -> log

Uso:
    python -m src.pipeline --watchlist AAPL MSFT NVDA
    python -m src.pipeline --watchlist AAPL --dry-run   # nunca manda órdenes
"""
from __future__ import annotations

import argparse
import sys

from .analysis.claude_analyst import ClaudeAnalyst
from .broker.alpaca_client import AlpacaBroker
from .config import Settings, load_settings
from .data.market_data import MarketDataClient
from .data.news import get_recent_headlines
from .notify import console_notify
from .risk.risk_gate import RiskGate
from .schemas import PortfolioState
from .storage.db import AuditLog


def run(watchlist: list[str], settings: Settings, dry_run: bool = False) -> None:
    if not settings.anthropic_api_key:
        sys.exit("Falta ANTHROPIC_API_KEY. Copia .env.example a .env y complétalo.")
    if not dry_run and not (settings.alpaca_api_key and settings.alpaca_secret_key):
        sys.exit("Faltan ALPACA_API_KEY / ALPACA_SECRET_KEY. Usa --dry-run si solo quieres analizar.")

    if not settings.alpaca_paper and not settings.confirm_live_trading:
        sys.exit(
            "ALPACA_PAPER=false pero CONFIRM_LIVE_TRADING no está en true. "
            "Esto es intencional: hacen falta ambas banderas para operar con dinero real."
        )

    market_data = MarketDataClient(settings.alpaca_api_key, settings.alpaca_secret_key) if settings.alpaca_api_key else None
    analyst = ClaudeAnalyst(settings.anthropic_api_key, model=settings.claude_model)
    risk_gate = RiskGate(settings.risk)
    audit = AuditLog()
    broker = None if dry_run else AlpacaBroker(settings.alpaca_api_key, settings.alpaca_secret_key, paper=settings.alpaca_paper)

    for symbol in watchlist:
        print(f"\n--- Analizando {symbol} ---")
        try:
            _process_symbol(symbol, settings, dry_run, market_data, analyst, risk_gate, audit, broker)
        except Exception as exc:  # noqa: BLE001 -- un símbolo roto no debe tumbar el resto de la watchlist
            print(f"[{symbol}] Error inesperado, se omite: {exc!r}")


def _process_symbol(
    symbol: str,
    settings: Settings,
    dry_run: bool,
    market_data: MarketDataClient | None,
    analyst: ClaudeAnalyst,
    risk_gate: RiskGate,
    audit: AuditLog,
    broker: AlpacaBroker | None,
) -> None:
    context = market_data.get_context(symbol) if market_data else {"symbol": symbol}
    if context.get("error"):
        print(f"[{symbol}] {context['error']}, se omite.")
        return

    # Contexto intradía: solo afina el timing de entrada/salida dentro de
    # una tesis swing -- no habilita day trading (ver claude_analyst.py).
    # Si falla (mercado cerrado, sin datos, etc.) seguimos solo con el
    # contexto diario en vez de abortar el análisis del símbolo.
    intraday_context = None
    if market_data:
        intraday_context = market_data.get_intraday_context(symbol)
        if intraday_context.get("error"):
            intraday_context = None

    headlines = get_recent_headlines(symbol)
    thesis = analyst.analyze(symbol, context, headlines, intraday_context)

    if thesis.action == "hold":
        console_notify.report_hold(thesis)
        return

    trades_today = audit.trades_today()
    portfolio = (
        broker.get_portfolio_state(trades_today)
        if broker
        else PortfolioState(equity=0.0, cash=0.0, total_exposure_pct=0.0, trades_today=trades_today)
    )
    risk_decision = risk_gate.evaluate(thesis, portfolio)

    if not risk_decision.approved:
        console_notify.report_rejected(thesis, risk_decision)
        audit.record(thesis, portfolio, risk_decision)
        return

    order = None
    if dry_run:
        print(f"[{symbol}] (dry-run) risk gate aprobó la orden, pero no se envía nada.")
    else:
        should_send = settings.auto_execute or console_notify.present_and_confirm(thesis, risk_decision)
        if should_send:
            notional = portfolio.equity * risk_decision.adjusted_size_pct
            order = broker.submit_bracket_order(
                symbol=symbol,
                side=thesis.action,
                notional=notional,
                last_close=context.get("last_close", 0),
                stop_loss_pct=thesis.stop_loss_pct,
                take_profit_pct=thesis.take_profit_pct,
            )
            print(f"[{symbol}] Orden enviada: {order.broker_order_id} (paper={order.paper})")
        else:
            print(f"[{symbol}] Orden descartada por confirmación manual.")

    audit.record(thesis, portfolio, risk_decision, order)


def main() -> None:
    parser = argparse.ArgumentParser(description="Pipeline de análisis de mercados con Claude.")
    parser.add_argument("--watchlist", nargs="+", required=True, help="Símbolos a analizar, ej. AAPL MSFT NVDA")
    parser.add_argument("--dry-run", action="store_true", help="Analiza y loguea, nunca manda órdenes.")
    args = parser.parse_args()

    settings = load_settings()
    run(args.watchlist, settings, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
