# Market Pipeline — Asistente de mercados financieros con Claude

Pipeline de referencia que usa **Claude** como capa de análisis dentro de un
flujo de inversión, con un **motor de reglas determinista (risk gate)** entre
el modelo y cualquier orden real, y **Alpaca (paper trading)** como broker de
ejecución.

## ⚠️ Antes de usar esto, lee esto

- **Esto no es asesoría financiera.** Es una herramienta de análisis y
  automatización. Las decisiones y sus consecuencias son responsabilidad de
  quien la opera.
- **Claude nunca ejecuta órdenes directamente.** Genera una *tesis*
  estructurada (símbolo, dirección, confianza, stop-loss...). Esa tesis pasa
  por `risk_gate.py`, un módulo de código normal (no LLM) que aplica límites
  duros de tamaño de posición, exposición total y confianza mínima. Solo lo
  que sobrevive esas reglas puede convertirse en orden.
- **Por defecto todo corre en modo paper trading** (`ALPACA_PAPER=true`) y
  con `AUTO_EXECUTE=false`, es decir: el pipeline te muestra qué haría y pide
  confirmación manual antes de mandar cualquier orden, incluso en paper.
  Pasar a dinero real (`ALPACA_PAPER=false`) es una decisión explícita que
  requiere además `CONFIRM_LIVE_TRADING=true` — ver `src/config.py`.
- Si vas a operar con capital de terceros o a distribuir esto como producto,
  revisa con un abogado si necesitas licencia de asesor de inversiones en tu
  jurisdicción. Este repo es una base técnica, no cubre ese aspecto legal.
- Antes de arriesgar dinero real: corre el pipeline en paper trading durante
  varias semanas y audita el histórico de decisiones en
  `market_pipeline.db`.

## Arquitectura

```
Watchlist ─▶ market_data.py ─▶ Claude (claude_analyst.py) ─▶ TradeThesis (JSON)
                                                                    │
                                                                    ▼
                                                          risk_gate.py
                                                     (reglas duras, sin LLM)
                                                                    │
                                              ┌─────────────────────┴───────┐
                                              ▼                              ▼
                                        rechazada                       aprobada
                                     (se loguea y listo)         (se pide confirmación
                                                                   humana o, si
                                                                   AUTO_EXECUTE=true,
                                                                   se envía a Alpaca)
                                                                    │
                                                                    ▼
                                                         storage/db.py (auditoría)
```

Cada pieza vive en su propio módulo para que puedas cambiarla sin tocar el
resto:

| Módulo | Responsabilidad |
|---|---|
| `src/data/market_data.py` | Precios/velas e indicadores técnicos (vía Alpaca Market Data). |
| `src/data/news.py` | Noticias/catalizadores recientes (stub, conecta el proveedor que prefieras). |
| `src/analysis/claude_analyst.py` | Llama a Claude con `tool_choice` forzado a `submit_trade_thesis` para obtener siempre JSON estructurado y validado con Pydantic. |
| `src/risk/risk_gate.py` | Único lugar donde se decide si una tesis se puede convertir en orden. Sin llamadas a LLM. |
| `src/broker/alpaca_client.py` | Estado de la cuenta/posiciones y envío de órdenes (bracket: entrada + stop-loss + take-profit). |
| `src/storage/db.py` | SQLite con el histórico de tesis, decisiones de riesgo y órdenes, para auditoría. |
| `src/notify/console_notify.py` | Presenta la propuesta y pide aprobación humana por consola (reemplázalo por Telegram/Slack si quieres). |
| `src/pipeline.py` | Orquesta todo lo anterior para una watchlist. |
| `src/dashboard/app.py` | Dashboard interactivo (Streamlit), de solo lectura, sobre el histórico en `market_pipeline.db`. |

## Setup

```bash
cd market_pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edita .env con tus keys
```

Necesitas:
- `ANTHROPIC_API_KEY` — https://console.anthropic.com/
- `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` de una cuenta **paper trading** —
  https://alpaca.markets/ (el paper trading es gratis y no requiere fondear
  una cuenta real)

## Uso

```bash
python -m src.pipeline --watchlist AAPL MSFT NVDA
```

Esto, para cada símbolo:
1. Trae precios recientes y calcula indicadores (SMA20/50, RSI14).
2. Le pide a Claude una tesis estructurada.
3. La pasa por el risk gate.
4. Si es aprobada, te la muestra y pide confirmación antes de mandarla a
   Alpaca (paper).
5. Guarda todo en `market_pipeline.db` para que puedas revisar el histórico.

Modo no interactivo (solo analiza y loguea, nunca manda órdenes):

```bash
python -m src.pipeline --watchlist AAPL MSFT --dry-run
```

## Dashboard interactivo

```bash
streamlit run src/dashboard/app.py
```

Es de **solo lectura**: no envía órdenes ni modifica nada, solo lee
`market_pipeline.db` y, si hay credenciales de Alpaca en `.env`, el estado
actual de la cuenta paper. Incluye:

- KPIs: cantidad de decisiones, tasa de aprobación del risk gate, confianza
  promedio de las tesis.
- Cuenta en vivo (equity, cash, exposición total) y posiciones abiertas, si
  Alpaca está configurado.
- Curva de equity a partir de los snapshots que el pipeline registra en
  cada corrida.
- Confianza promedio de las tesis por símbolo.
- Tabla filtrable (por símbolo, acción, solo aprobadas) del historial
  completo, con el razonamiento de Claude, los riesgos que identificó y la
  razón exacta del risk gate para cada decisión — la misma auditoría que
  necesitas antes de confiar más capital al pipeline.

## Próximos pasos razonables

- Backtesting: correr `claude_analyst.py` contra datos históricos y comparar
  la tesis contra el resultado real antes de confiar en el pipeline en vivo.
- Añadir más fuentes (noticias, sentimiento, fundamentales) a
  `market_context` en `pipeline.py`.
- Sustituir Alpaca por Interactive Brokers (`ib_insync`) si necesitas
  opciones, futuros o mercados fuera de EE.UU. — la interfaz de
  `broker/alpaca_client.py` está pensada para que sea intercambiable.
- Mover `storage/db.py` de SQLite a Postgres si esto corre en producción
  con más de un proceso escribiendo a la vez.
- Notificaciones por Telegram/Slack en vez de consola para aprobar órdenes
  desde el celular.
