# Procore Tracker

Script que trae **RFIs**, **Submittals** y **Drawings** de un proyecto de
Procore, compara contra la corrida anterior, y genera un reporte HTML con:

- Qué RFIs/Submittals/Drawings son **nuevos**, cuáles se **actualizaron** y
  cuáles ya no aparecen.
- Un aviso especial: **⚠️ Posibles planos desactualizados** — cuando un
  RFI o Submittal cambiado menciona un número de plano (ej. "A-101") que
  **no** tiene una revisión nueva registrada en la herramienta de Drawings.
  Es justo el caso de "actualizaron un RFI pero no el plano".

Los reportes quedan en `reports/` (con un `index.html` que lista el
historial), así que funcionan como un mini-dashboard que revisas cuando
quieras, sin tener que entrar a Procore a rastrear cada cambio.

## 1. Consigue acceso a la API de Procore (gratis)

1. Crea una cuenta gratis en <https://developers.procore.com/signup>. Se te
   asigna automáticamente un **Sandbox** (datos de prueba) sin costo.
2. Registra una app nueva y actívale una **Developer Managed Service Account
   (DMSA)** — es lo que permite autenticar sin un usuario interactivo
   (`grant_type=client_credentials`), ideal para un script que corre solo.
   Guía: <https://developers.procore.com/documentation/oauth-client-credentials>
3. Dale permisos a la app sobre las herramientas **RFIs**, **Submittals** y
   **Drawings** del proyecto que quieras monitorear.
4. Para usar datos reales (no solo Sandbox), tu **Administrador de Procore**
   debe autorizar la app a nivel de compañía (Company Level > Apps). No tiene
   costo adicional de Procore — es un paso de permisos, no un pago.
5. Copia el `Client ID` / `Client Secret` de la app.

## 2. Configura el script

```bash
cd procore-tracker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edita .env con tu CLIENT_ID, CLIENT_SECRET, COMPANY_ID y PROJECT_ID
```

`COMPANY_ID` y `PROJECT_ID` se ven en la URL cuando entras al proyecto en
Procore: `https://app.procore.com/<company_id>/projects/<project_id>/...`

## 3. Pruébalo

```bash
python tracker.py
```

La primera corrida no tiene nada con qué comparar, así que va a marcar todo
como "nuevo" — es normal. De la segunda corrida en adelante vas a ver
solamente lo que cambió. Abre `reports/index.html` en el navegador.

Si un endpoint te da 404, es porque tu instancia de Procore usa otra versión
de esa API — revisa <https://developers.procore.com/reference/rest> y ajusta
`PROCORE_RFIS_PATH` / `PROCORE_SUBMITTALS_PATH` / `PROCORE_DRAWINGS_PATH` en
tu `.env`.

## 4. Automatízalo (correr solo, programado)

Ya incluye un workflow en `.github/workflows/procore-tracker.yml` que corre
por cron y comitea el reporte nuevo al repo.

1. En GitHub: **Settings → Secrets and variables → Actions**, agrega:
   `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`, `PROCORE_COMPANY_ID`,
   `PROCORE_PROJECT_ID`.
2. GitHub solo dispara workflows programados (`schedule`) desde el branch por
   defecto (`main`). Hasta que este archivo llegue a `main`, pruébalo a mano
   con el botón **Run workflow** (`workflow_dispatch`) en la pestaña Actions.
3. Ajusta el cron en el `.yml` a la frecuencia que quieras (por defecto:
   días de semana a las 13:00 UTC).

Cada corrida deja el reporte nuevo en `reports/` y actualiza
`state/last_snapshot.json` (necesario para poder comparar la próxima vez) —
ambos se comitean automáticamente al repo.

## Cómo funciona el cruce "RFI/Submittal ↔ Drawing"

Es una heurística por texto: busca en el título/asunto del RFI o Submittal
algo que parezca un número de plano (regex configurable en
`PROCORE_DRAWING_NUMBER_REGEX`), y si ese plano existe en Drawings pero su
`updated_at` no cambió desde la corrida anterior, lo marca como alerta.

No es un vínculo "oficial" de Procore entre esos objetos (Procore no expone
ese enlace directamente vía API) — así que ajusta el regex al formato real
de numeración de tus planos para que la detección sea más precisa.

## Estructura

```
procore-tracker/
  tracker.py          # orquestador: fetch → diff → alertas → reporte → guarda estado
  procore_client.py   # autenticación OAuth (client_credentials) + GET paginado
  diffing.py           # normaliza datos de Procore, calcula diffs y alertas
  report.py            # genera el HTML del reporte y el índice
  config.py             # carga variables de entorno
  .env.example
  state/               # snapshot de la última corrida (se comitea)
  reports/             # reportes generados + index.html (se comitean)
```
