const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { state, save } = require("./store");
const { randomAnonLabel } = require("./anon");
const { CATEGORIES, CATEGORY_IDS, hueForCategory } = require("./categories");
const {
  isValidEmail,
  isInstitutionalEmail,
  hashPassword,
  verifyPassword,
  newToken,
} = require("./auth");
const {
  resolveLocation,
  nearbyPlaces,
  targetOptionsFor,
  adMatchesLocation,
} = require("./places");
const {
  containsBannedContent,
  REPORT_HIDE_THRESHOLD,
  IDENTITY_BLOCK_THRESHOLD,
} = require("./moderation");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

// ---- generic helpers ----------------------------------------------------

function sanitizeText(raw, maxLen) {
  return String(raw || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, maxLen);
}

const PLACE_ID_RE = /^[a-z0-9-]{1,64}$/;

function publicEntity(entity) {
  return { id: entity.id, businessName: entity.businessName, category: entity.category, email: entity.email };
}

// ---- entity accounts ------------------------------------------------------

function findEntityByEmail(email) {
  const lower = email.toLowerCase();
  return state.entities.find((e) => e.email.toLowerCase() === lower);
}

function entityFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const session = state.sessions[token];
  if (!session) return null;
  return state.entities.find((e) => e.id === session.entityId) || null;
}

// ---- anonymous individual identities ---------------------------------------

function ensureIdentity(anonId) {
  let identity = state.identities[anonId];
  if (!identity) {
    identity = { label: randomAnonLabel(), createdAt: Date.now() };
    state.identities[anonId] = identity;
    save();
  }
  return identity;
}

function placeStats(placeId) {
  const comments = state.comments.filter((c) => c.placeId === placeId && !c.hiddenAt);
  return {
    count: comments.length,
    lastActiveAt: comments.length ? comments[comments.length - 1].createdAt : null,
  };
}

function getClientIp(req) {
  // no reverse proxy in front of this prototype, so the socket address is
  // trustworthy enough here — behind a real proxy this would need
  // X-Forwarded-For handled carefully (spoofable unless the proxy is trusted)
  return req.socket.remoteAddress || "unknown";
}

// Rate limiting has two independent layers:
//  - a per-identity cooldown + rolling hourly cap (the normal case)
//  - a per-IP cooldown as a backstop against someone rotating to a fresh
//    incognito profile purely to dodge the per-identity limit
// All in-memory: fine for a single-process prototype, won't survive a
// restart or scale past one instance — see README.
const lastPostAt = new Map(); // anonId -> timestamp
const lastPostAtByIp = new Map(); // ip -> timestamp
const postTimestampsByIdentity = new Map(); // anonId -> timestamp[]
const COOLDOWN_MS = 4000;
const IP_COOLDOWN_MS = 3000;
const HOURLY_LIMIT = 20;

function checkRateLimit(anonId, ip) {
  const now = Date.now();
  if (now - (lastPostAt.get(anonId) || 0) < COOLDOWN_MS) {
    return "espera unos segundos antes de comentar de nuevo";
  }
  if (now - (lastPostAtByIp.get(ip) || 0) < IP_COOLDOWN_MS) {
    return "espera unos segundos antes de comentar de nuevo";
  }
  const recent = (postTimestampsByIdentity.get(anonId) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= HOURLY_LIMIT) {
    return "llegaste al límite de comentarios por hora para este perfil — probá de nuevo más tarde";
  }
  lastPostAt.set(anonId, now);
  lastPostAtByIp.set(ip, now);
  recent.push(now);
  postTimestampsByIdentity.set(anonId, recent);
  return null;
}

// A distinct-reporter count on a comment/ad that crosses the threshold
// hides it immediately, no human in the loop — see README for why that's
// a blunt, gameable instrument and what real moderation needs instead.
function registerReport(targetType, targetId, anonId, reason) {
  const already = state.reports.some((r) => r.targetType === targetType && r.targetId === targetId && r.anonId === anonId);
  if (already) return { alreadyReported: true, hidden: false };

  state.reports.push({
    id: state.nextReportId++,
    targetType,
    targetId,
    anonId,
    reason: sanitizeText(reason, 120) || "sin especificar",
    createdAt: Date.now(),
  });

  const reportCount = state.reports.filter((r) => r.targetType === targetType && r.targetId === targetId).length;
  let justHidden = false;

  if (reportCount >= REPORT_HIDE_THRESHOLD) {
    if (targetType === "comment") {
      const comment = state.comments.find((c) => c.id === targetId);
      if (comment && !comment.hiddenAt) {
        comment.hiddenAt = Date.now();
        justHidden = true;
        const authorIdentity = state.identities[comment.anonId];
        if (authorIdentity) {
          authorIdentity.hiddenCount = (authorIdentity.hiddenCount || 0) + 1;
          if (authorIdentity.hiddenCount >= IDENTITY_BLOCK_THRESHOLD) authorIdentity.blocked = true;
        }
      }
    } else if (targetType === "ad") {
      const ad = state.ads.find((a) => a.id === targetId);
      if (ad && !ad.hiddenAt) {
        ad.hiddenAt = Date.now();
        justHidden = true;
      }
    }
  }

  save();
  return { alreadyReported: false, hidden: justHidden };
}

// ---- SSE subscribers (per-place comment streams) ---------------------------

const subscribers = new Map(); // placeId -> Set<res>

function broadcastToPlace(placeId, payload) {
  const sockets = subscribers.get(placeId);
  if (!sockets) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sockets) res.write(data);
}

// ---- request helpers ---------------------------------------------------

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readJsonBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---- route handlers ------------------------------------------------------

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (req.method === "GET" && parts[1] === "categories") {
    return sendJson(res, 200, { categories: CATEGORIES });
  }

  // ---- entity accounts --------------------------------------------------

  if (req.method === "POST" && parts[1] === "entities" && parts[2] === "register") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }

    const businessName = sanitizeText(body.businessName, 80);
    const category = String(body.category || "");
    const email = String(body.email || "").trim();
    const password = String(body.password || "");

    if (!businessName) return sendJson(res, 400, { error: "falta el nombre del comercio o entidad" });
    if (!CATEGORY_IDS.has(category)) return sendJson(res, 400, { error: "categoría inválida" });
    if (!isValidEmail(email)) return sendJson(res, 400, { error: "email inválido" });
    if (!isInstitutionalEmail(email)) {
      return sendJson(res, 400, {
        error: "usá el email de tu organización, no uno de un proveedor genérico (gmail, hotmail, etc.)",
      });
    }
    if (password.length < 8) return sendJson(res, 400, { error: "la contraseña debe tener al menos 8 caracteres" });
    if (findEntityByEmail(email)) return sendJson(res, 409, { error: "ya existe una cuenta con ese email" });

    const { salt, hash } = hashPassword(password);
    const entity = { id: state.nextEntityId++, businessName, category, email, salt, hash, createdAt: Date.now() };
    state.entities.push(entity);

    const token = newToken();
    state.sessions[token] = { entityId: entity.id, createdAt: Date.now() };
    save();

    return sendJson(res, 201, { token, entity: publicEntity(entity) });
  }

  if (req.method === "POST" && parts[1] === "entities" && parts[2] === "login") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const entity = email && findEntityByEmail(email);
    if (!entity || !verifyPassword(password, entity.salt, entity.hash)) {
      return sendJson(res, 401, { error: "email o contraseña incorrectos" });
    }
    const token = newToken();
    state.sessions[token] = { entityId: entity.id, createdAt: Date.now() };
    save();
    return sendJson(res, 200, { token, entity: publicEntity(entity) });
  }

  if (req.method === "POST" && parts[1] === "entities" && parts[2] === "logout") {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      delete state.sessions[token];
      save();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && parts[1] === "entities" && parts[2] === "me") {
    const entity = entityFromRequest(req);
    if (!entity) return sendJson(res, 401, { error: "sesión inválida" });
    const ads = state.ads.filter((a) => a.ownerEntityId === entity.id);
    return sendJson(res, 200, { entity: publicEntity(entity), ads });
  }

  // GET /api/identity/:anonId — anonymous individual alias
  if (req.method === "GET" && parts[1] === "identity" && parts[2]) {
    const identity = ensureIdentity(decodeURIComponent(parts[2]));
    return sendJson(res, 200, { anonId: parts[2], label: identity.label });
  }

  // GET /api/location?lat=&lng= — resolved place hierarchy + valid ad
  // targeting options for that spot (used by the business portal)
  if (req.method === "GET" && parts[1] === "location") {
    const lat = parseFloat(url.searchParams.get("lat"));
    const lng = parseFloat(url.searchParams.get("lng"));
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { error: "lat/lng requeridos" });
    const location = resolveLocation(lat, lng);
    return sendJson(res, 200, { location, targetOptions: targetOptionsFor(location) });
  }

  // ---- places: comments (anonymous, open to anyone) --------------------------

  if (req.method === "GET" && parts[1] === "places" && parts[3] === "comments" && parts.length === 4) {
    const placeId = decodeURIComponent(parts[2] || "");
    if (!PLACE_ID_RE.test(placeId)) return sendJson(res, 400, { error: "lugar inválido" });
    const comments = state.comments
      .filter((c) => c.placeId === placeId && !c.hiddenAt)
      .slice(-100)
      .map(({ id, label, body, createdAt }) => ({ id, label, body, created_at: createdAt }));
    return sendJson(res, 200, { placeId, comments });
  }

  if (req.method === "POST" && parts[1] === "places" && parts[3] === "comments" && parts.length === 4) {
    const placeId = decodeURIComponent(parts[2] || "");
    if (!PLACE_ID_RE.test(placeId)) return sendJson(res, 400, { error: "lugar inválido" });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }

    const anonId = String(body.anonId || "");
    const text = sanitizeText(body.text, 280);
    if (!anonId || anonId.length > 64) return sendJson(res, 400, { error: "anonId inválido" });
    if (!text) return sendJson(res, 400, { error: "el comentario está vacío" });

    const identity = ensureIdentity(anonId);
    if (identity.blocked) {
      return sendJson(res, 403, {
        error: "este perfil incógnito fue bloqueado por reportes repetidos — podés empezar de nuevo con uno nuevo",
      });
    }

    if (containsBannedContent(text)) {
      return sendJson(res, 400, { error: "tu comentario contiene contenido no permitido" });
    }

    const rateError = checkRateLimit(anonId, getClientIp(req));
    if (rateError) return sendJson(res, 429, { error: rateError });

    const now = Date.now();
    const comment = {
      id: state.nextCommentId++,
      placeId,
      anonId,
      label: identity.label,
      body: text,
      createdAt: now,
      hiddenAt: null,
    };
    state.comments.push(comment);
    save();

    const outComment = { id: comment.id, label: comment.label, body: comment.body, created_at: now };
    broadcastToPlace(placeId, { type: "comment", comment: outComment });

    return sendJson(res, 201, { comment: outComment });
  }

  // POST /api/places/:placeId/comments/:commentId/report — anonymous report
  if (req.method === "POST" && parts[1] === "places" && parts[3] === "comments" && parts[5] === "report") {
    const placeId = decodeURIComponent(parts[2] || "");
    const commentId = Number(parts[4]);
    if (!PLACE_ID_RE.test(placeId) || Number.isNaN(commentId)) return sendJson(res, 400, { error: "solicitud inválida" });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }
    const anonId = String(body.anonId || "");
    if (!anonId || anonId.length > 64) return sendJson(res, 400, { error: "anonId inválido" });

    const comment = state.comments.find((c) => c.id === commentId && c.placeId === placeId);
    if (!comment) return sendJson(res, 404, { error: "comentario no encontrado" });

    const result = registerReport("comment", commentId, anonId, body.reason);
    if (result.alreadyReported) return sendJson(res, 409, { error: "ya reportaste este comentario" });
    return sendJson(res, 200, { ok: true, hidden: result.hidden });
  }

  if (req.method === "GET" && parts[1] === "places" && parts[3] === "stream") {
    const placeId = decodeURIComponent(parts[2] || "");
    if (!PLACE_ID_RE.test(placeId)) return sendJson(res, 400, { error: "lugar inválido" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    if (!subscribers.has(placeId)) subscribers.set(placeId, new Set());
    subscribers.get(placeId).add(res);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.get(placeId)?.delete(res);
    });
    return;
  }

  // ---- ads: entity-owned, targeted at a level of the place hierarchy --------

  if (req.method === "POST" && parts[1] === "ads" && parts.length === 2) {
    const entity = entityFromRequest(req);
    if (!entity) return sendJson(res, 401, { error: "necesitás una cuenta de comercio/entidad para publicar" });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }

    const title = sanitizeText(body.title, 60);
    const text = sanitizeText(body.text, 200);
    const discountText = body.discountText ? sanitizeText(body.discountText, 60) : null;
    const lat = parseFloat(body.lat);
    const lng = parseFloat(body.lng);
    const targetLevel = String(body.targetLevel || "");
    if (!title) return sendJson(res, 400, { error: "falta el título" });
    if (!text) return sendJson(res, 400, { error: "falta el texto del anuncio" });
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { error: "ubicación inválida" });
    if (containsBannedContent(title) || containsBannedContent(text) || containsBannedContent(discountText || "")) {
      return sendJson(res, 400, { error: "el anuncio contiene contenido no permitido" });
    }

    // you can only target a level of the hierarchy your current location is
    // actually part of — no picking an arbitrary corregimiento you're not in
    const location = resolveLocation(lat, lng);
    const options = targetOptionsFor(location);
    const target = options.find((o) => o.level === targetLevel && o.id === String(body.targetId));
    if (!target) {
      return sendJson(res, 400, { error: "el alcance elegido no corresponde a tu ubicación actual" });
    }

    const durationHours = Math.max(1, Math.min(24 * 30, Number(body.durationHours) || 24 * 7));
    const now = Date.now();
    const ad = {
      id: state.nextAdId++,
      title,
      text,
      discountText,
      targetLevel: target.level,
      targetId: target.id,
      targetName: target.name,
      ownerEntityId: entity.id,
      ownerName: entity.businessName,
      hue: hueForCategory(entity.category),
      createdAt: now,
      expiresAt: now + durationHours * 3600 * 1000,
      hiddenAt: null,
    };
    state.ads.push(ad);
    save();
    return sendJson(res, 201, { ad });
  }

  if (req.method === "DELETE" && parts[1] === "ads" && parts[2] && parts.length === 3) {
    const entity = entityFromRequest(req);
    if (!entity) return sendJson(res, 401, { error: "sesión inválida" });
    const id = Number(parts[2]);
    const ad = state.ads.find((a) => a.id === id);
    if (!ad) return sendJson(res, 404, { error: "no encontrado" });
    if (ad.ownerEntityId !== entity.id) return sendJson(res, 403, { error: "no te pertenece" });
    state.ads = state.ads.filter((a) => a.id !== id);
    save();
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/ads/:id/report — anonymous report
  if (req.method === "POST" && parts[1] === "ads" && parts[2] && parts[3] === "report") {
    const id = Number(parts[2]);
    if (Number.isNaN(id)) return sendJson(res, 400, { error: "solicitud inválida" });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }
    const anonId = String(body.anonId || "");
    if (!anonId || anonId.length > 64) return sendJson(res, 400, { error: "anonId inválido" });

    const ad = state.ads.find((a) => a.id === id);
    if (!ad) return sendJson(res, 404, { error: "anuncio no encontrado" });

    const result = registerReport("ad", id, anonId, body.reason);
    if (result.alreadyReported) return sendJson(res, 409, { error: "ya reportaste este anuncio" });
    return sendJson(res, 200, { ok: true, hidden: result.hidden });
  }

  // ---- bubbles: what a viewer at (lat,lng) currently sees --------------------

  if (req.method === "GET" && parts[1] === "bubbles") {
    const lat = parseFloat(url.searchParams.get("lat"));
    const lng = parseFloat(url.searchParams.get("lng"));
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return sendJson(res, 400, { error: "lat/lng requeridos" });
    }

    const location = resolveLocation(lat, lng);

    const microStats = placeStats(location.micro.id);
    const communities = [
      {
        id: location.micro.id,
        name: location.micro.name,
        kind: location.micro.kind,
        isCurrent: true,
        distanceKm: 0,
        commentCount: microStats.count,
        lastActiveAt: microStats.lastActiveAt,
      },
    ];

    if (location.known) {
      nearbyPlaces(lat, lng, location.micro.id).forEach((p) => {
        const stats = placeStats(p.id);
        communities.push({
          id: p.id,
          name: p.name,
          kind: p.kind,
          isCurrent: false,
          distanceKm: Math.round(p.distanceKm * 100) / 100,
          commentCount: stats.count,
          lastActiveAt: stats.lastActiveAt,
        });
      });
    }

    const now = Date.now();
    const ads = state.ads
      .filter((a) => a.expiresAt > now && !a.hiddenAt)
      .filter((a) => adMatchesLocation(a, location))
      .map((a) => ({
        id: a.id,
        title: a.title,
        text: a.text,
        discountText: a.discountText,
        ownerName: a.ownerName,
        hue: a.hue,
        targetLevel: a.targetLevel,
        targetName: a.targetName,
      }));

    return sendJson(res, 200, { location, communities, ads });
  }

  return sendJson(res, 404, { error: "no encontrado" });
}

// ---- server -------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: "error interno" });
    });
  } else {
    serveStatic(req, res, url.pathname);
  }
});

server.listen(PORT, () => {
  console.log(`Communities app escuchando en http://localhost:${PORT}`);
});
