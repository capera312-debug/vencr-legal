# Communities

Una app social donde la interfaz son burbujas ancladas a un lugar. Hay dos roles bien separados:

- **Comercios y entidades** (cuentas verificadas por email institucional) son los únicos que pueden **fundar una comunidad** en una ubicación, o **lanzar publicidad** cerca suyo con o sin descuento.
- **Cualquier persona**, sin cuenta ni registro, puede leer y comentar dentro de las comunidades ya creadas — siempre de forma anónima, con un alias incógnito que rota cuando quiera.

Ninguna persona individual puede originar una comunidad de la nada; eso evita que cualquiera "funde" un espacio y lo abandone, y le da a cada comunidad un dueño identificable de cara al resto (aunque los comentarios adentro sigan siendo anónimos).

## Cómo funciona

1. El navegador pide tu ubicación (`navigator.geolocation`).
2. Ves dos tipos de burbuja cerca tuyo:
   - **Comunidades** (círculo sólido): creadas por un comercio/entidad, con radio de alcance propio. Tocarla abre los comentarios anónimos en vivo (Server-Sent Events) y podés sumar el tuyo.
   - **Publicidad** (círculo punteado, etiqueta "Publicidad"): lanzada por un comercio cerca tuyo, con texto y opcionalmente un descuento. Se ven más grandes y opacas cuanto más cerca estás — el efecto de "se te acercan" a medida que te movés. Tocarla solo muestra el anuncio, no tiene comentarios.
3. Un comercio o entidad entra por "Comercios y entidades" arriba, se registra o inicia sesión, y desde ahí funda una comunidad o lanza publicidad **en su ubicación actual**, con su propio radio y (para publicidad) duración.

## Arquitectura

```
communities-app/
├── server/
│   ├── index.js       # servidor HTTP + API REST + streaming (Node puro, sin frameworks)
│   ├── store.js        # persistencia en un archivo JSON
│   ├── auth.js           # hash de password, verificación de dominio de email, tokens de sesión
│   ├── categories.js      # categorías de comercio → color de burbuja
│   └── anon.js             # generador de alias incógnitos (para comentarios individuales)
└── public/
    ├── index.html
    ├── app.js           # geolocalización, render de burbujas, panel de comunidad/publicidad
    ├── business.js       # portal de comercios: registro, login, crear/borrar comunidad o ad
    └── style.css
```

- **Backend**: Node.js puro (`http`, `fs`, `path`, `crypto`), **sin dependencias externas** — corre con solo `node server/index.js`, sin `npm install`. Elección deliberada de portabilidad.
- **Persistencia**: un archivo JSON (`data.json`) reescrito en cada cambio. Alcanza para un prototipo de una sola instancia.
- **Tiempo real**: Server-Sent Events para los comentarios de una comunidad (`GET /api/communities/:id/stream`). La publicidad no tiene tiempo real — es un anuncio estático mientras esté vigente.
- **Cuentas de entidad**: password con `scrypt` (nativo de Node, sin bcrypt), sesión por token opaco (`Authorization: Bearer …`), sin cookies ni JWT.
- **Identidad anónima individual**: sigue igual que antes — `anonId` aleatorio en `localStorage`, alias legible asignado por el servidor, sin cuenta.

## Los dos tipos de burbuja

| | Comunidad | Publicidad |
|---|---|---|
| Quién la crea | comercio/entidad | comercio/entidad |
| Quién comenta adentro | cualquier persona, anónima | nadie — es un anuncio, no un chat |
| Visible hasta | se borra a mano | expira sola (duración configurable) |
| Descuento | no aplica | opcional, texto libre |

## Verificación de comercios/entidades — y sus límites

El registro exige un email que **no** sea de un proveedor gratuito genérico (gmail, hotmail, outlook, yahoo, icloud, etc. — lista en `server/auth.js`). Esto es una heurística barata para levantar la vara, **no** verificación real de identidad comercial (no confirma CUIT/RUC, dirección física, ni que quien se registra tenga derecho a representar a esa organización). Antes de producción real hace falta algo más serio: verificación del dominio (enviar un email de confirmación), o directamente aprobación manual de cada cuenta nueva.

## Decisiones de privacidad

- **Nunca se guarda la lat/lng exacta de un individuo comentando.** Solo se guarda a qué comunidad (creada por una entidad, con su propio radio) pertenece cada comentario.
- **Comentar no requiere cuenta.** El único identificador es un UUID aleatorio del lado del cliente, sin vínculo a una persona real, con alias rotable en cualquier momento.
- **Las cuentas de entidad sí son identificables** (tienen email, nombre de comercio) — es la contracara necesaria de poder fundar un espacio público y publicar anuncios; no son anónimas ni deberían serlo.
- **Los comentarios y textos de anuncios se sanitizan** (se remueven tags HTML) antes de guardarse y se listan escapados en el cliente, para evitar XSS.
- **Rate limiting básico** (4s entre comentarios por `anonId`) para frenar spam sin necesitar cuentas.
- **Toda burbuja de publicidad se etiqueta como "Publicidad"** de forma visible, tanto en el mapa como en el panel — divulgación de contenido pago, no opcional. Las tiendas de apps (Apple/Google) lo exigen explícitamente para contenido patrocinado.

Cosas que **todavía no** están resueltas y conviene decidir antes de producción: moderación de contenido dentro de las comunidades (denunciar/ocultar comentarios), expiración automática de comentarios viejos, verificación real de comercios (más allá del dominio de email), límites de abuso más robustos (el rate-limit hoy es en memoria, no sobrevive un restart ni escala a más de una instancia), y Términos de Servicio específicos que cubran tanto a comercios (qué pueden publicar) como a individuos (qué pueden comentar).

## Cómo correrlo

```bash
cd communities-app
npm start
# equivalente: node server/index.js
```

No requiere `npm install`: no tiene dependencias externas.

Abrí `http://localhost:3000` en el navegador (el permiso de geolocalización solo funciona en `localhost` o HTTPS). Para simular varios comercios o personas a la vez, abrí pestañas en modo incógnito distintas — cada una tiene su propio `anonId` y su propia sesión de entidad.

## Próximos pasos sugeridos

- Mapa real de fondo (Mapbox/Leaflet) en vez de burbujas flotando libremente.
- Expiración de comentarios (ej. desaparecen a las 24-48h) para que la comunidad refleje "ahora", no un historial acumulado.
- Moderación de comentarios y de anuncios (reportar, ocultar, filtro de palabras) antes de abrir a usuarios reales.
- Verificación real de comercios/entidades (confirmación de dominio, documentación, o aprobación manual) en vez de solo el filtro de email genérico.
- Reemplazar el archivo JSON por una base de datos real (Postgres, SQLite) y mover el rate-limiting y las suscripciones a algo compartido (Redis) si se escala a más de una instancia del servidor.
