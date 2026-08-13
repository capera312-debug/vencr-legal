"""Log de auditoría en SQLite.

Cada tesis, decisión de riesgo y orden queda registrada con timestamp. Es lo
primero que hay que revisar al evaluar si el sistema está listo para más
capital o para modo automático.

SQLite es suficiente para un solo proceso corriendo el pipeline en
intervalos (ej. una vez al día). Si esto llega a correr con varios workers
en paralelo, migrar a Postgres.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from ..schemas import ExecutedOrder, PortfolioState, RiskDecision, TradeThesis

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "market_pipeline.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    symbol TEXT NOT NULL,
    thesis_json TEXT NOT NULL,
    portfolio_json TEXT NOT NULL,
    risk_decision_json TEXT NOT NULL,
    order_json TEXT
);
"""


class AuditLog:
    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH):
        self._db_path = str(db_path)
        with self._connect() as conn:
            conn.execute(_SCHEMA)

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self._db_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def record(
        self,
        thesis: TradeThesis,
        portfolio: PortfolioState,
        risk_decision: RiskDecision,
        order: ExecutedOrder | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO decisions (created_at, symbol, thesis_json, portfolio_json,"
                " risk_decision_json, order_json) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    datetime.now(timezone.utc).isoformat(),
                    thesis.symbol,
                    thesis.model_dump_json(),
                    portfolio.model_dump_json(),
                    risk_decision.model_dump_json(),
                    order.model_dump_json() if order else None,
                ),
            )

    def trades_today(self, symbol: str | None = None) -> int:
        """Cuenta órdenes efectivamente enviadas hoy (usado por el risk gate)."""
        today = datetime.now(timezone.utc).date().isoformat()
        query = "SELECT COUNT(*) FROM decisions WHERE order_json IS NOT NULL AND created_at LIKE ?"
        params: list = [f"{today}%"]
        if symbol:
            query += " AND symbol = ?"
            params.append(symbol)
        with self._connect() as conn:
            (count,) = conn.execute(query, params).fetchone()
        return count

    def recent(self, limit: int = 20) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT created_at, symbol, thesis_json, portfolio_json, risk_decision_json, order_json"
                " FROM decisions ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "created_at": r[0],
                "symbol": r[1],
                "thesis": json.loads(r[2]),
                "portfolio": json.loads(r[3]),
                "risk_decision": json.loads(r[4]),
                "order": json.loads(r[5]) if r[5] else None,
            }
            for r in rows
        ]
