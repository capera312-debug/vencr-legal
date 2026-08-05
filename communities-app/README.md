# Communities

Una app social donde la interfaz son burbujas ancladas a un lugar — nunca un mapa de calles. Lo que ves siempre es lo **micro**: el parque, el edificio (PH), la cuadra donde estás parado, no la ciudad ni el país como bloque.

- **Las comunidades no las crea nadie.** Existen por ubicación real, con jerarquía (país → provincia → distrito → corregimiento → lugar puntual). Cualquier persona comenta ahí, siempre de forma anónima, con un alias incógnito que rota cuando quiera.
- **Comercios y entidades** (cuentas verificadas por email institucional) no fundan nada — pagan por **publicidad** dirigida a cualquier nivel de esa jerarquía: un solo lugar, todo un corregimiento, o el país entero.

## Por qué cambió de "quién funda una comunidad" a "la comunidad ya existe"

La primera versión de este prototipo dejaba que solo comercios "fundaran" una comunidad. El problema: la mayoría del mapa quedaba vacío, porque una comunidad solo existía donde a algún comercio se le ocurrió registrarse. Esta versión genera la comunidad de la ubicación misma — todo lugar tiene una, exista o no un comercio cerca. Los comercios pasan de "dueños del espacio" a "los que pagan por aparecer con más fuerza en un espacio que ya es de todos", que es además un modelo de negocio más simple de vender (alcance por nivel, más caro cuanto más amplio).

## Cómo funciona

1. El navegador pide tu ubicación (`navigator.geolocation`).
2. El servidor resuelve dónde estás: un lugar puntual (parque, PH, establecimiento) con su cadena completa país/provincia/distrito/corregimiento — mostrada como un breadcrumb liviano arriba, solo de contexto, no navegable.
3. Ves burbujas:
   - **Tu comunidad actual** (círculo sólido) y otras cercanas ya catalogadas, si las hay. Tocarla abre los comentarios anónimos en vivo (Server-Sent Events) y podés sumar el tuyo.
   - **Publicidad** (círculo punteado, etiqueta "Publicidad"): de un comercio que pagó por alcanzar el nivel de jerarquía en el que estás parado — puede ser justo ese lugar, o algo tan amplio como todo el país. Tocarla muestra el anuncio y el descuento si tiene, sin comentarios.
4. Un comercio o entidad entra por "Comercios y entidades", se registra o inicia sesión, y lanza publicidad **desde su ubicación actual**, eligiendo a qué nivel de esa jerarquía llega.

## El catálogo de lugares — y su limitación real

En producción, resolver "en qué corregimiento/PH estoy" es un problema de geocodificación inversa: se consulta un servicio real (Nominatim propio o alojado, o Google Places con API key) con el lat/lng del usuario. **Ese acceso de red está bloqueado por la política de egress de este entorno de desarrollo** — se intentó y quedó documentado el rechazo en `server/places.js`. No es una limitación del concepto, es una limitación de esta sesión sandbox.

Por eso `server/places.js` trae un catálogo precargado a mano con lugares reales de Ciudad de Panamá (corregimientos San Francisco y Bella Vista — Parque Omar, Calle Uruguay, y un par de PH de ejemplo) en vez de consultar un servicio en vivo. Si tu ubicación no coincide con nada del catálogo, la app **no inventa** un nombre de ciudad o corregimiento falso: cae a una "zona cercana" sintética (una celda por proximidad, sin jerarquía) y lo dice explícitamente en el breadcrumb. Esto es honesto a propósito — mejor mostrar "no tenemos esto catalogado" que un dato geográfico incorrecto.

**Antes de producción real, hace falta:** reemplazar `resolveLocation()` en `server/places.js` por una consulta real de geocodificación inversa, y decidir cobertura (¿todo el país? ¿arranca por una ciudad?) y cómo se mantiene actualizado el catálogo de lugares puntuales (parques, PH, establecimientos) donde el proveedor de geocodificación no tenga buena cobertura — que en Latinoamérica es común, sobre todo a nivel de edificio.

## Arquitectura

```
communities-app/
├── server/
│   ├── index.js       # servidor HTTP + API REST + streaming (Node puro, sin frameworks)
│   ├── places.js        # catálogo de lugares + jerarquía + resolución de ubicación
│   ├── store.js           # persistencia en un archivo JSON (comentarios, entidades, ads)
│   ├── auth.js               # hash de password, verificación de dominio de email, tokens de sesión
│   ├── categories.js           # categorías de comercio → color de burbuja de publicidad
│   └── anon.js                   # generador de alias incógnitos (para comentarios individuales)
└── public/
    ├── index.html
    ├── app.js           # geolocalización, breadcrumb, render de burbujas, panel de comunidad/publicidad
    ├── business.js       # portal de comercios: registro, login, lanzar/borrar publicidad
    └── style.css
```

- **Backend**: Node.js puro (`http`, `fs`, `path`, `crypto`), **sin dependencias externas** — corre con solo `node server/index.js`, sin `npm install`. Elección deliberada de portabilidad.
- **Persistencia**: un archivo JSON (`data.json`) reescrito en cada cambio. El catálogo de lugares en sí (`places.js`) es código, no datos — no se persiste ni se edita en caliente.
- **Tiempo real**: Server-Sent Events para los comentarios de un lugar (`GET /api/places/:id/stream`). La publicidad no tiene tiempo real — es un anuncio estático mientras esté vigente.
- **Cuentas de entidad**: password con `scrypt` (nativo de Node, sin bcrypt), sesión por token opaco (`Authorization: Bearer …`), sin cookies ni JWT.
- **Identidad anónima individual**: `anonId` aleatorio en `localStorage`, alias legible asignado por el servidor, sin cuenta.

## Targeting de publicidad por nivel

Al lanzar un anuncio, el comercio elige un nivel según su ubicación actual — el servidor valida que ese nivel realmente forme parte de la cadena de jerarquía donde está parado en ese momento (no se puede targetear un corregimiento en el que nunca estuviste):

| Nivel | Alcance | Ejemplo |
|---|---|---|
| `micro` | un solo lugar puntual | "Parque Omar" |
| `corregimiento` | todos los lugares de ese corregimiento | "San Francisco" |
| `district` | todo el distrito | "Distrito de Panamá" |
| `province` | toda la provincia | "Panamá" |
| `country` | todo el país | "Panamá" |

Un usuario ve un anuncio si su ubicación actual resuelta cae dentro del nivel targeteado — estar en "PH Torres de Alba" te muestra un anuncio targeteado a "San Francisco" (el corregimiento), aunque el anunciante nunca haya estado específicamente en ese PH.

## Moderación y prevención de abuso

Es la parte más delicada del concepto (anonimato + ubicación), así que tiene varias capas — todas en `server/moderation.js` e `server/index.js`:

- **Reportar.** Cualquiera puede reportar un comentario o un anuncio (🚩 en la UI), sin cuenta. Un mismo `anonId` no puede reportar dos veces lo mismo (409 si lo intenta).
- **Auto-ocultamiento por umbral.** Al llegar a 3 reportes de `anonId` distintos, el comentario o anuncio se oculta al instante — desaparece de los listados y de `/api/bubbles`. **Esto es deliberadamente tosco:** no hay revisión humana en el medio, lo que significa que es *gameable* — varios perfiles incógnitos coordinados (aunque sea rotando de a uno) pueden ocultar contenido legítimo a fuerza de reportes falsos ("review-bombing"). Sirve para demostrar el mecanismo, no reemplaza una cola de moderación humana real.
- **Filtro de contenido.** Una lista corta e ilustrativa de patrones prohibidos (`BANNED_PATTERNS` en `moderation.js`) rechaza el posteo antes de guardarlo, con mensaje claro. Es un punto de partida, no una lista seria — antes de producción esto necesita un servicio de moderación real o una lista mantenida profesionalmente.
- **Bloqueo de identidad reincidente.** Una identidad anónima cuyos comentarios se ocultaron 5 veces por reportes queda bloqueada para seguir posteando. Límite honesto: como cualquier sistema anónimo por diseño, rotar a un perfil incógnito nuevo esquiva el bloqueo — es el costo inherente de que comentar no requiera cuenta.
- **Rate limiting en tres capas:** cooldown de 4s por identidad, cooldown de 3s por IP (frena a quien rota de identidad justamente para saltarse el límite por identidad), y un tope de 20 comentarios por hora por identidad. Todo en memoria — no sobrevive un restart ni escala a más de una instancia (ver "Próximos pasos").

## Decisiones de privacidad

- **Nunca se guarda la lat/lng exacta de un individuo comentando.** Solo se guarda a qué lugar catalogado (o celda sintética) pertenece cada comentario.
- **Comentar no requiere cuenta.** El único identificador es un UUID aleatorio del lado del cliente, sin vínculo a una persona real, con alias rotable en cualquier momento.
- **Las cuentas de entidad sí son identificables** (tienen email, nombre de comercio) — es la contracara necesaria de poder pagar por publicidad; no son anónimas ni deberían serlo.
- **Los comentarios y textos de anuncios se sanitizan** (se remueven tags HTML) antes de guardarse y se listan escapados en el cliente, para evitar XSS.
- **Toda burbuja de publicidad se etiqueta como "Publicidad"** de forma visible, tanto en el mapa como en el panel — divulgación de contenido pago, no opcional. Las tiendas de apps (Apple/Google) lo exigen explícitamente para contenido patrocinado.

## Verificación de comercios/entidades — y sus límites

El registro exige un email que **no** sea de un proveedor gratuito genérico (gmail, hotmail, outlook, yahoo, icloud, etc. — lista en `server/auth.js`). Esto es una heurística barata para levantar la vara, **no** verificación real de identidad comercial (no confirma CUIT/RUC, dirección física, ni que quien se registra tenga derecho a representar a esa organización). Antes de producción real hace falta algo más serio: verificación del dominio (enviar un email de confirmación), o directamente aprobación manual de cada cuenta nueva.

Cosas que **todavía no** están resueltas y conviene decidir antes de producción: una cola de moderación con revisión humana (hoy el ocultamiento es automático y gameable, ver arriba), una lista de contenido prohibido seria en vez de la ilustrativa actual, expiración automática de comentarios viejos, verificación real de comercios (más allá del dominio de email), y Términos de Servicio específicos que cubran tanto a comercios (qué pueden publicar y a qué nivel) como a individuos (qué pueden comentar y qué pasa si se los reporta).

## Cómo correrlo

```bash
cd communities-app
npm start
# equivalente: node server/index.js
```

No requiere `npm install`: no tiene dependencias externas.

Abrí `http://localhost:3000` en el navegador (el permiso de geolocalización solo funciona en `localhost` o HTTPS). El catálogo de lugares cubre San Francisco y Bella Vista en Ciudad de Panamá — para probarlo con datos reales, simulá tu ubicación del navegador ahí (ej. DevTools → Sensors → Location, lat `8.9925`, lng `-79.5090` para Parque Omar). En cualquier otro punto del mundo la app sigue funcionando, pero cae a la "zona cercana" sintética sin jerarquía.

## Próximos pasos sugeridos

- Reemplazar el catálogo hardcodeado por una consulta real de geocodificación inversa (Nominatim propio, o un proveedor pago) apenas haya acceso de red — es el paso número uno para salir de "demo" a "real".
- Cola de moderación con revisión humana en vez de auto-ocultamiento puro por umbral de reportes (el riesgo de review-bombing documentado arriba es real).
- Mapa real de fondo (Mapbox/Leaflet) en vez de burbujas flotando libremente.
- Expiración de comentarios (ej. desaparecen a las 24-48h) para que la comunidad refleje "ahora", no un historial acumulado.
- Verificación real de comercios/entidades (confirmación de dominio, documentación, o aprobación manual) en vez de solo el filtro de email genérico.
- Reemplazar el archivo JSON por una base de datos real (Postgres, SQLite) y mover el rate-limiting, los reportes y las suscripciones a algo compartido (Redis) si se escala a más de una instancia del servidor.
