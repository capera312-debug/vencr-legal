"""Dashboard interactivo, de solo lectura, sobre el histórico del pipeline.

No envía órdenes ni modifica nada — solo lee `market_pipeline.db` y,
opcionalmente, el estado de cuenta en Alpaca (si hay credenciales en .env).

Uso (desde market_pipeline/, con el venv activado):

    streamlit run src/dashboard/app.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# streamlit ejecuta este archivo como script suelto, no como parte del
# paquete, así que no podemos usar imports relativos (`from ..config import
# ...`). En vez de eso, agregamos market_pipeline/ al path e importamos
# `src.*` como paquete absoluto — el mismo truco que usan los tests.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pandas as pd
import streamlit as st

from src.broker.alpaca_client import AlpacaBroker
from src.config import load_settings
from src.storage.db import AuditLog

st.set_page_config(page_title="Market Pipeline — Dashboard", page_icon="📊", layout="wide")


def _flatten(records: list[dict]) -> pd.DataFrame:
    rows = []
    for r in records:
        thesis = r["thesis"]
        risk = r["risk_decision"]
        order = r["order"]
        rows.append(
            {
                "created_at": pd.to_datetime(r["created_at"]),
                "symbol": r["symbol"],
                "action": thesis["action"],
                "confidence": thesis["confidence"],
                "size_pct": thesis.get("size_pct"),
                "stop_loss_pct": thesis.get("stop_loss_pct"),
                "rationale": thesis["rationale"],
                "key_risks": thesis.get("key_risks") or [],
                "approved": bool(risk["approved"]),
                "risk_reason": risk["reason"],
                "equity": r["portfolio"]["equity"],
                "order_id": (order or {}).get("broker_order_id"),
            }
        )
    return pd.DataFrame(rows)


def main() -> None:
    settings = load_settings()
    audit = AuditLog()

    st.title("📊 Market Pipeline — Dashboard")
    st.caption(
        "Vista de solo lectura del histórico de tesis, decisiones de riesgo y órdenes "
        "generadas por el pipeline. No ejecuta nada."
    )

    st.sidebar.header("Filtros")
    limit = st.sidebar.slider("Decisiones a cargar", 10, 1000, 200, step=10)
    if st.sidebar.button("🔄 Refrescar"):
        st.rerun()

    records = audit.recent(limit=limit)
    if not records:
        st.info(
            "Todavía no hay decisiones registradas. Corre "
            "`python -m src.pipeline --watchlist AAPL MSFT ...` primero."
        )
        st.stop()

    df = _flatten(records)

    symbols = sorted(df["symbol"].unique())
    selected_symbols = st.sidebar.multiselect("Símbolos", symbols, default=symbols)
    selected_actions = st.sidebar.multiselect(
        "Acción", ["buy", "sell", "hold"], default=["buy", "sell", "hold"]
    )
    only_approved = st.sidebar.checkbox("Solo aprobadas por el risk gate", value=False)

    filtered = df[df["symbol"].isin(selected_symbols) & df["action"].isin(selected_actions)]
    if only_approved:
        filtered = filtered[filtered["approved"]]

    # --- KPIs ---
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Decisiones", len(filtered))
    col2.metric("Aprobadas por risk gate", int(filtered["approved"].sum()))
    approval_rate = filtered["approved"].mean() if len(filtered) else 0
    col3.metric("Tasa de aprobación", f"{approval_rate:.0%}")
    avg_confidence = filtered["confidence"].mean() if len(filtered) else 0
    col4.metric("Confianza promedio", f"{avg_confidence:.0%}")

    # --- Cuenta en vivo (si hay credenciales de Alpaca) ---
    if settings.alpaca_api_key and settings.alpaca_secret_key:
        st.subheader("Cuenta" + (" (paper)" if settings.alpaca_paper else " — ⚠️ DINERO REAL"))
        try:
            broker = AlpacaBroker(settings.alpaca_api_key, settings.alpaca_secret_key, paper=settings.alpaca_paper)
            portfolio = broker.get_portfolio_state(trades_today=audit.trades_today())
            c1, c2, c3 = st.columns(3)
            c1.metric("Equity", f"${portfolio.equity:,.2f}")
            c2.metric("Cash", f"${portfolio.cash:,.2f}")
            c3.metric("Exposición total", f"{portfolio.total_exposure_pct:.1%}")

            positions = broker.list_positions()
            if positions:
                st.markdown("**Posiciones abiertas**")
                st.dataframe(pd.DataFrame(positions), use_container_width=True, hide_index=True)
            else:
                st.caption("Sin posiciones abiertas.")
        except Exception as exc:  # conexión a Alpaca puede fallar por muchas razones
            st.warning(f"No se pudo consultar la cuenta de Alpaca: {exc}")
    else:
        st.info("Configura ALPACA_API_KEY / ALPACA_SECRET_KEY en .env para ver la cuenta en vivo aquí.")

    # --- Curva de equity a partir de los snapshots logueados ---
    st.subheader("Evolución de equity (snapshots del pipeline)")
    equity_df = df.loc[df["equity"] > 0, ["created_at", "equity"]].drop_duplicates().sort_values("created_at")
    if len(equity_df) > 1:
        st.line_chart(equity_df.set_index("created_at"))
    else:
        st.caption("Todavía no hay suficientes snapshots con equity > 0 para graficar una curva.")

    # --- Confianza promedio por símbolo ---
    if len(filtered):
        st.subheader("Confianza promedio de las tesis por símbolo")
        st.bar_chart(filtered.groupby("symbol")["confidence"].mean())

    # --- Tabla de historial ---
    st.subheader("Historial de decisiones")
    st.dataframe(
        filtered[
            ["created_at", "symbol", "action", "confidence", "approved", "risk_reason", "order_id"]
        ].sort_values("created_at", ascending=False),
        use_container_width=True,
        hide_index=True,
    )

    # --- Detalle expandible ---
    st.subheader("Detalle por decisión")
    for _, row in filtered.sort_values("created_at", ascending=False).head(25).iterrows():
        status = "✅ aprobada" if row["approved"] else "❌ rechazada"
        with st.expander(f"{row['created_at']} — {row['symbol']} — {row['action'].upper()} ({status})"):
            st.write(f"**Confianza:** {row['confidence']:.0%}")
            st.write(f"**Razonamiento de Claude:** {row['rationale']}")
            if row["key_risks"]:
                st.write("**Riesgos clave:**")
                for risk in row["key_risks"]:
                    st.write(f"- {risk}")
            st.write(f"**Decisión del risk gate:** {row['risk_reason']}")
            if row["order_id"]:
                st.write(f"**Orden enviada:** `{row['order_id']}`")


if __name__ == "__main__":
    main()
