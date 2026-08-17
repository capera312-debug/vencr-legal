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

## 1. Consigue tus credenciales (gratis)

1. Registra una app en <https://developers.procore.com> (si no lo hiciste
   ya) y actívala contra el **Sandbox** gratuito primero para probar.
2. En el Developer Portal, entra a **App Management → OAuth Credentials** y
   copia el `Client ID` y `Client Secret` (de la sección **Sandbox OAuth
   Credentials** si vas a probar contra Sandbox).

> **Nota sobre automatización sin login:** Procore también soporta un modo
> "Client Credentials" (sin usuario) pensado para scripts automáticos, pero
> requiere una **Developer Managed Service Account (DMSA)** que Procore
> habilita caso por caso — no aparece como opción en "App Settings" del
> Developer Portal básico. Si la necesitas, pídesela a tu Customer Success
> Manager de Procore. Mientras tanto, este tracker usa el flujo estándar de
> login (ver abajo), que **sí** funciona con lo que ya tienes.

## 2. Configura el script

```bash
cd procore-tracker
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# edita .env con tu CLIENT_ID, CLIENT_SECRET, COMPANY_ID y PROJECT_ID
```

`COMPANY_ID` y `PROJECT_ID` se ven en la URL cuando entras al proyecto en
Procore: `https://app.procore.com/<company_id>/projects/<project_id>/...`

Para probar primero contra el Sandbox (recomendado), en tu `.env` deja:
```
PROCORE_BASE_URL=https://sandbox.procore.com
PROCORE_OAUTH_URL=https://sandbox.procore.com
```

## 3. Inicia sesión (una sola vez)

```bash
python authorize.py
```

Esto abre tu navegador para que inicies sesión en Procore con tu propio
usuario. Al terminar, Procore te muestra un código en pantalla — pégalo de
vuelta en la terminal. El script guarda un *refresh token* en
`.token_cache.json` (queda en tu compu, nunca se sube al repo — está en
`.gitignore`). De ahí en adelante `tracker.py` se renueva solo; no vuelves a
tener que hacer login a menos que ese token se revoque o expire.

## 4. Pruébalo

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

## 5. Automatízalo en tu compu (Programador de Tareas de Windows)

1. Confirma que `python tracker.py` corre bien manualmente (pasos 3-4).
2. Abre el **Programador de tareas** de Windows (busca "Task Scheduler").
3. **Crear tarea básica** → nómbrala "Procore Tracker".
4. Desencadenador: **Diariamente**, a la hora que prefieras.
5. Acción: **Iniciar un programa** → selecciona el archivo
   `procore-tracker\run_tracker.bat` de este proyecto.
6. En "Opciones avanzadas" de la tarea, marca **"Ejecutar tanto si el
   usuario inició sesión como si no"** si quieres que corra aunque no
   tengas la sesión abierta.

Cada corrida deja el reporte nuevo en `reports/` — puedes fijar
`reports\index.html` como acceso directo en tu escritorio para revisarlo
cuando quieras. El archivo `tracker.log` (junto al `.bat`) guarda la salida
de cada corrida por si algo falla.

### Si más adelante consigues la DMSA

Ya incluí un workflow de GitHub Actions
(`.github/workflows/procore-tracker.yml`) para correr esto en la nube sin
depender de tu compu, pero está desactivado hasta que tengas el modo
`client_credentials` habilitado por Procore — con login de usuario no es
seguro guardar el refresh token en GitHub sin pasos extra. Cuando tengas la
DMSA, avísame y lo activamos.

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
  authorize.py         # login único: guarda el refresh token localmente
  tracker.py            # orquestador: fetch → diff → alertas → reporte → guarda estado
  procore_client.py     # autenticación OAuth (login o client_credentials) + GET paginado
  diffing.py              # normaliza datos de Procore, calcula diffs y alertas
  report.py               # genera el HTML del reporte y el índice
  config.py                # carga variables de entorno
  run_tracker.bat          # para el Programador de Tareas de Windows
  .env.example
  state/                # snapshot de la última corrida (se comitea)
  reports/              # reportes generados + index.html (se comitean)
```
