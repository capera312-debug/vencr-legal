#!/usr/bin/env python3
"""CLI para correr un backtest simple de ClaudeAnalyst sobre un símbolo.

Uso:
    python scripts/run_backtest.py --symbol AAPL --start 2026-01-01 --end 2026-06-01

Por defecto evalúa una tesis nueva cada 7 días dentro del rango (--step-days)
y mide el resultado a 5 días vista (--horizon-days). Cada fecha evaluada
dispara una llamada real a la API de Claude -- el script te muestra cuántas
llamadas va a hacer y pide confirmación antes de arrancar.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.analysis.claude_analyst import ClaudeAnalyst
from src.backtest.engine import Backtester
from src.backtest.report import print_report, to_dataframe
from src.config import load_settings
from src.data.market_data import MarketDataClient


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest simple de ClaudeAnalyst sobre un símbolo.")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--start", required=True, type=_parse_date, help="YYYY-MM-DD")
    parser.add_argument("--end", required=True, type=_parse_date, help="YYYY-MM-DD")
    parser.add_argument("--step-days", type=int, default=7, help="Cada cuántos días evaluar una tesis nueva.")
    parser.add_argument("--horizon-days", type=int, default=5, help="A cuántos días vista se mide el resultado.")
    parser.add_argument(
        "--warmup-days", type=int, default=60,
        help="Historia extra a descargar antes de --start, necesaria para calcular SMA50/RSI/etc.",
    )
    parser.add_argument("--csv", default=None, help="Ruta opcional para guardar el detalle en CSV.")
    parser.add_argument("--yes", action="store_true", help="No pedir confirmación antes de llamar a la API.")
    args = parser.parse_args()

    if args.end < args.start:
        sys.exit("--end no puede ser anterior a --start")

    settings = load_settings()
    if not settings.anthropic_api_key:
        sys.exit("Falta ANTHROPIC_API_KEY en .env")
    if not (settings.alpaca_api_key and settings.alpaca_secret_key):
        sys.exit("Faltan ALPACA_API_KEY / ALPACA_SECRET_KEY en .env (se usan solo para datos históricos)")

    eval_dates = []
    current = args.start
    while current <= args.end:
        eval_dates.append(current)
        current += timedelta(days=args.step_days)

    print(f"Esto va a llamar a la API de Claude hasta {len(eval_dates)} veces (una por fecha evaluada).")
    if not args.yes:
        if input("¿Continuar? [y/N]: ").strip().lower() != "y":
            sys.exit("Cancelado.")

    market_data = MarketDataClient(settings.alpaca_api_key, settings.alpaca_secret_key)
    fetch_start = datetime.combine(args.start - timedelta(days=args.warmup_days), datetime.min.time(), tzinfo=timezone.utc)
    fetch_end = min(
        datetime.combine(args.end + timedelta(days=args.horizon_days * 2), datetime.min.time(), tzinfo=timezone.utc),
        datetime.now(timezone.utc),
    )
    bars = market_data.get_daily_bars(args.symbol, start=fetch_start, end=fetch_end)
    if bars.empty:
        sys.exit(f"No se encontraron velas para {args.symbol} en ese rango.")

    analyst = ClaudeAnalyst(settings.anthropic_api_key, model=settings.claude_model)
    backtester = Backtester(analyst, bars, args.symbol)
    results = backtester.run(eval_dates, horizon_days=args.horizon_days)

    print_report(results)

    if args.csv:
        to_dataframe(results).to_csv(args.csv, index=False)
        print(f"\nDetalle guardado en {args.csv}")


if __name__ == "__main__":
    main()
