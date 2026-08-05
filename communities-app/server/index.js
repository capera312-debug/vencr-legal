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

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

// ---- generic helpers ----------------------------------------------------

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function sanitizeText(raw, maxLen) {
  return String(raw || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, maxLen);
}

function clampNumber(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

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

function communityStats(communityId) {
  const comments = state.comments.filter((c) => c.communityId === communityId);
  return {
    count: comments.length,
    lastActiveAt: comments.length ? comments[comments.length - 1].createdAt : null,
  };
}

// naive per-identity cooldown to deter spam; fine for a single-process prototype
const lastPostAt = new Map();
const COOLDOWN_MS = 4000;

// ---- SSE subscribers (community comment streams) ---------------------------

const subscribers = new Map(); // communityId -> Set<res>

function broadcastToCommunity(communityId, payload) {
  const sockets = subscribers.get(communityId);
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

  // ---- entity accounts --------------------------------------------------

  if (req.method === "GET" && parts[1] === "categories") {
    return sendJson(res, 200, { categories: CATEGORIES });
  }

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
    const entity = {
      id: state.nextEntityId++,
      businessName,
      category,
      email,
      salt,
      hash,
      createdAt: Date.now(),
    };
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
    const communities = state.communities.filter((c) => c.ownerEntityId === entity.id);
    const ads = state.ads.filter((a) => a.ownerEntityId === entity.id);
    return sendJson(res, 200, { entity: publicEntity(entity), communities, ads });
  }

  // GET /api/identity/:anonId — anonymous individual alias
  if (req.method === "GET" && parts[1] === "identity" && parts[2]) {
    const identity = ensureIdentity(decodeURIComponent(parts[2]));
    return sendJson(res, 200, { anonId: parts[2], label: identity.label });
  }

  // ---- communities (entity-owned) ----------------------------------------

  if (req.method === "POST" && parts[1] === "communities" && parts.length === 2) {
    const entity = entityFromRequest(req);
    if (!entity) return sendJson(res, 401, { error: "necesitás una cuenta de comercio/entidad para crear una comunidad" });

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: "cuerpo inválido" });
    }

    const name = sanitizeText(body.name, 60);
    const description = sanitizeText(body.description, 200);
    const lat = parseFloat(body.lat);
    const lng = parseFloat(body.lng);
    if (!name) return sendJson(res, 400, { error: "falta el nombre de la comunidad" });
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { error: "ubicación inválida" });
    const radiusKm = clampNumber(body.radiusKm, 0.2, 5, 1.2);

    const community = {
      id: state.nextCommunityId++,
      name,
      description,
      ownerEntityId: entity.id,
      ownerName: entity.businessName,
      hue: hueForCategory(entity.category),
      lat,
      lng,
      radiusKm,
      createdAt: Date.now(),
    };
    state.communities.push(community);
    save();
    return sendJson(res, 201, { community });
  }

  if (req.method === "DELETE" && parts[1] === "communities" && parts[2] && parts.length === 3) {
    const entity = entityFromRequest(req);
    if (!entity) return sendJson(res, 401, { error: "sesión inválida" });
    const id = Number(parts[2]);
    const community = state.communities.find((c) => c.id === id);
    if (!community) return sendJson(res, 404, { error: "no encontrada" });
    if (community.ownerEntityId !== entity.id) return sendJson(res, 403, { error: "no te pertenece" });
    state.communities = state.communities.filter((c) => c.id !== id);
    state.comments = state.comments.filter((c) => c.communityId !== id);
    save();
    return sendJson(res, 200, { ok: true });
  }

  // GET /api/communities/:id/comments
  if (req.method === "GET" && parts[1] === "communities" && parts[3] === "comments") {
    const communityId = Number(parts[2]);
    const community = state.communities.find((c) => c.id === communityId);
    if (!community) return sendJson(res, 404, { error: "comunidad no encontrada" });
    const comments = state.comments
      .filter((c) => c.communityId === communityId)
      .slice(-100)
      .map(({ id, label, body, createdAt }) => ({ id, label, body, created_at: createdAt }));
    return sendJson(res, 200, { community, comments });
  }

  // POST /api/communities/:id/comments — anonymous individuals, no entity account needed
  if (req.method === "POST" && parts[1] === "communities" && parts[3] === "comments") {
    const communityId = Number(parts[2]);
    const community = state.communities.find((c) => c.id === communityId);
    if (!community) return sendJson(res, 404, { error: "comunidad no encontrada" });

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

    const now = Date.now();
    const last = lastPostAt.get(anonId) || 0;
    if (now - last < COOLDOWN_MS) {
      return sendJson(res, 429, { error: "espera unos segundos antes de comentar de nuevo" });
    }
    lastPostAt.set(anonId, now);

    const identity = ensureIdentity(anonId);
    const comment = {
      id: state.nextCommentId++,
      communityId,
      anonId,
      label: identity.label,
      body: text,
      createdAt: now,
    };
    state.comments.push(comment);
    save();

    const outComment = { id: comment.id, label: comment.label, body: comment.body, created_at: now };
    broadcastToCommunity(communityId, { type: "comment", comment: outComment });

    return sendJson(res, 201, { comment: outComment });
  }

  // GET /api/communities/:id/stream (Server-Sent Events)
  if (req.method === "GET" && parts[1] === "communities" && parts[3] === "stream") {
    const communityId = Number(parts[2]);
    const community = state.communities.find((c) => c.id === communityId);
    if (!community) return sendJson(res, 404, { error: "comunidad no encontrada" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    if (!subscribers.has(communityId)) subscribers.set(communityId, new Set());
    subscribers.get(communityId).add(res);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.get(communityId)?.delete(res);
    });
    return;
  }

  // ---- ads (entity-owned, independent of communities) -----------------------

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
    if (!title) return sendJson(res, 400, { error: "falta el título" });
    if (!text) return sendJson(res, 400, { error: "falta el texto del anuncio" });
    if (Number.isNaN(lat) || Number.isNaN(lng)) return sendJson(res, 400, { error: "ubicación inválida" });
    const radiusKm = clampNumber(body.radiusKm, 0.2, 5, 1);
    const durationHours = clampNumber(body.durationHours, 1, 24 * 30, 24 * 7);

    const now = Date.now();
    const ad = {
      id: state.nextAdId++,
      title,
      text,
      discountText,
      ownerEntityId: entity.id,
      ownerName: entity.businessName,
      hue: hueForCategory(entity.category),
      lat,
      lng,
      radiusKm,
      createdAt: now,
      expiresAt: now + durationHours * 3600 * 1000,
    };
    state.ads.push(ad);
    save();
    return sendJson(res, 201, { ad });
  }

  if (req.method === "DELETE" && parts[1] === "ads" && parts[2]) {
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

  // ---- bubbles: what a viewer at (lat,lng) currently sees --------------------

  if (req.method === "GET" && parts[1] === "bubbles") {
    const lat = parseFloat(url.searchParams.get("lat"));
    const lng = parseFloat(url.searchParams.get("lng"));
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return sendJson(res, 400, { error: "lat/lng requeridos" });
    }

    const FRINGE_KM = 2; // communities are visible a bit beyond their own radius, so they're discoverable while approaching
    const communities = state.communities
      .map((c) => ({ c, distanceKm: haversineKm(lat, lng, c.lat, c.lng) }))
      .filter(({ c, distanceKm }) => distanceKm <= c.radiusKm + FRINGE_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 20)
      .map(({ c, distanceKm }) => {
        const stats = communityStats(c.id);
        return {
          id: c.id,
          type: "community",
          name: c.name,
          description: c.description,
          ownerName: c.ownerName,
          hue: c.hue,
          center: { lat: c.lat, lng: c.lng },
          radiusKm: c.radiusKm,
          distanceKm: Math.round(distanceKm * 100) / 100,
          inside: distanceKm <= c.radiusKm,
          commentCount: stats.count,
          lastActiveAt: stats.lastActiveAt,
        };
      });

    const now = Date.now();
    const ads = state.ads
      .filter((a) => a.expiresAt > now)
      .map((a) => ({ a, distanceKm: haversineKm(lat, lng, a.lat, a.lng) }))
      .filter(({ a, distanceKm }) => distanceKm <= a.radiusKm * 2)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 20)
      .map(({ a, distanceKm }) => ({
        id: a.id,
        type: "ad",
        title: a.title,
        text: a.text,
        discountText: a.discountText,
        ownerName: a.ownerName,
        hue: a.hue,
        center: { lat: a.lat, lng: a.lng },
        radiusKm: a.radiusKm,
        distanceKm: Math.round(distanceKm * 100) / 100,
        inside: distanceKm <= a.radiusKm,
        proximity: Math.max(0, Math.min(1, 1 - distanceKm / (a.radiusKm * 2))),
      }));

    return sendJson(res, 200, { communities, ads });
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
