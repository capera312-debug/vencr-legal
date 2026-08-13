"""Agrega los resultados de un backtest en métricas resumidas y las imprime."""
from __future__ import annotations

import pandas as pd

from .engine import BacktestResult


def to_dataframe(results: list[BacktestResult]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "symbol": r.symbol,
                "as_of": r.as_of,
                "action": r.thesis.action,
                "confidence": r.thesis.confidence,
                "rationale": r.thesis.rationale,
                "horizon_days": r.horizon_days,
                "entry_price": r.entry_price,
                "exit_price": r.exit_price,
                "return_pct": r.return_pct,
                "correct": r.correct,
                "stopped_out": r.stopped_out,
                "hit_take_profit": r.hit_take_profit,
            }
            for r in results
        ]
    )


def summarize(results: list[BacktestResult]) -> dict:
    df = to_dataframe(results)
    if df.empty:
        return {"total_thesis": 0, "hold_pct": None, "acted_on": 0, "evaluated": 0, "hit_rate": None, "avg_return_pct": None, "avg_return_by_confidence_bucket": None}

    acted = df[df["action"] != "hold"]
    evaluated = acted.dropna(subset=["return_pct"])

    summary = {
        "total_thesis": len(df),
        "hold_pct": (df["action"] == "hold").mean(),
        "acted_on": len(acted),
        "evaluated": len(evaluated),
        "hit_rate": evaluated["correct"].astype(bool).mean() if len(evaluated) else None,
        "avg_return_pct": evaluated["return_pct"].mean() if len(evaluated) else None,
        "avg_return_by_confidence_bucket": None,
    }

    if len(evaluated) >= 2:
        buckets = pd.cut(evaluated["confidence"], bins=[0, 0.5, 0.65, 0.8, 1.0], include_lowest=True)
        grouped = evaluated.groupby(buckets, observed=True)["return_pct"].mean().round(2)
        if not grouped.empty:
            summary["avg_return_by_confidence_bucket"] = {str(k): v for k, v in grouped.to_dict().items()}

    return summary


def print_report(results: list[BacktestResult]) -> None:
    summary = summarize(results)

    print("\n=== Resultado del backtest ===")
    print(f"Tesis generadas:        {summary['total_thesis']}")
    if summary["total_thesis"] == 0:
        print("No se generó ninguna tesis (¿faltó historia suficiente en las fechas evaluadas?).")
        return

    print(f"  hold:                  {summary['hold_pct']:.0%}")
    print(f"  buy/sell evaluadas:    {summary['evaluated']} / {summary['acted_on']}")

    if summary["hit_rate"] is not None:
        print(f"Tasa de acierto:         {summary['hit_rate']:.0%}")
        print(f"Retorno promedio:        {summary['avg_return_pct']:+.2f}%")
    else:
        print("No hay suficientes tesis buy/sell evaluadas para calcular métricas.")

    if summary["avg_return_by_confidence_bucket"]:
        print("\nRetorno promedio por bucket de confianza:")
        for bucket, ret in summary["avg_return_by_confidence_bucket"].items():
            print(f"  {bucket}: {ret:+.2f}%")

    print(
        "\nRecordá: esto no modela slippage, comisiones ni fills reales. Es una "
        "primera señal, no un veredicto final sobre si el pipeline funciona."
    )
