# Communities

Una app social donde la interfaz son burbujas: cada burbuja representa la comunidad de personas que están (o estuvieron) en un mismo lugar. Dentro de cada burbuja hay comentarios anónimos de quienes están ahí — así, cualquiera que llegue a una zona puede ver rápido qué está pasando, sin perfiles, sin seguidores, sin historial público.

## Cómo funciona

1. El navegador pide tu ubicación (`navigator.geolocation`).
2. El servidor agrupa esa ubicación en una celda geográfica usando **geohash** (precisión 6, ≈ 600m × 1200m) — esa celda *es* la comunidad.
3. Se muestran burbujas: la tuya (resaltada) y las de celdas cercanas (~2.5 km), con tamaño proporcional a la cantidad de comentarios.
4. Al tocar una burbuja se abren los comentarios de esa comunidad, en vivo (Server-Sent Events).
5. Podés comentar. Tu comentario aparece con un alias incógnito generado al azar (ej. "Zorro Curioso #42"), no con tu nombre ni tu cuenta.

## Arquitectura

```
communities-app/
├── server/
│   ├── index.js       # servidor HTTP + API REST + streaming (Node puro, sin frameworks)
│   ├── store.js        # persistencia en un archivo JSON
│   ├── geohash.js       # encode/decode de geohash, sin dependencias externas
│   └── anon.js           # generador de alias incógnitos
└── public/
    ├── index.html
    ├── app.js           # geolocalización, render de burbujas, chat en vivo
    └── style.css
```

- **Backend**: Node.js puro (`http`, `fs`, `path`), **sin dependencias externas** — corre con solo `node server/index.js`, sin `npm install`. Es una elección deliberada de portabilidad, no solo una limitación de este entorno de desarrollo.
- **Persistencia**: un archivo JSON (`data.json`) que se reescribe en cada cambio. Alcanza para un prototipo de una sola instancia; para producción real conviene una base de datos de verdad (Postgres, SQLite con `better-sqlite3`, etc.) y así lo dice la sección de próximos pasos.
- **Tiempo real**: Server-Sent Events (`EventSource`, nativo del navegador) — cada cliente se suscribe a la comunidad que tiene abierta (`GET /api/communities/:id/stream`) y recibe los comentarios nuevos al instante, sin necesitar la librería `ws`.
- **Identidad anónima**: el cliente genera un `anonId` aleatorio (`crypto.randomUUID()`) guardado en `localStorage`. El servidor le asigna un alias legible la primera vez que comenta y lo reutiliza mientras dure ese `anonId`. El botón "Nuevo perfil incógnito" borra el `anonId` local y empieza de cero.

## Decisiones de privacidad

Esto es lo más delicado de una app de "burbujas por ubicación", así que quedan documentadas las decisiones tomadas:

- **Nunca se guarda tu lat/lng exacta.** Solo se persiste el geohash (celda de ~600m) y el centro geométrico de esa celda — no el punto donde estabas parado.
- **No hay cuentas, ni email, ni teléfono.** El único identificador es un UUID aleatorio del lado del cliente, sin vínculo a una persona real.
- **El alias es cosmético y rotable.** Cambiar de "perfil incógnito" es instantáneo y no dejar rastro server-side vinculando el alias viejo con el nuevo.
- **Los comentarios se sanitizan** (se remueven tags HTML) antes de guardarse y se listan escapados en el cliente, para evitar XSS.
- **Rate limiting básico** (4s de espera entre comentarios por `anonId`) para frenar spam sin necesitar cuentas.

Cosas que **todavía no** están resueltas y conviene decidir antes de producción: moderación de contenido (denunciar/ocultar comentarios), expiración automática de comentarios viejos, límites de abuso más robustos (hoy el rate-limit es en memoria y no sobrevive un restart ni escala a múltiples instancias), y moderación legal/ToS específica para contenido generado por ubicación.

## Cómo correrlo

```bash
cd communities-app
npm start
# equivalente: node server/index.js
```

No requiere `npm install`: no tiene dependencias externas.

Abrí `http://localhost:3000` en el navegador (el permiso de geolocalización solo funciona en `localhost` o HTTPS). Para probarlo con varias "personas" a la vez, abrí pestañas en modo incógnito distintas — cada una tendrá su propio `anonId`.

## Próximos pasos sugeridos

- Mapa real de fondo (Mapbox/Leaflet) en vez de burbujas flotando libremente.
- Expiración de comentarios (ej. desaparecen a las 24-48h) para que la burbuja refleje "ahora", no un historial acumulado.
- Moderación (reportar, ocultar, filtro de palabras) antes de abrir a usuarios reales.
- Reemplazar el archivo JSON por una base de datos real (Postgres, SQLite) y mover el rate-limiting y las suscripciones a algo compartido (Redis) si se escala a más de una instancia del servidor.
