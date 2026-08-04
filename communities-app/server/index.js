const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { state, save } = require("./store");
const { encodeGeohash, decodeGeohashCenter, DEFAULT_PRECISION } = require("./geohash");
const { randomAnonLabel } = require("./anon");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = process.env.PORT || 3000;

// ---- helpers ---------------------------------------------------------

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

function sanitizeText(raw) {
  return String(raw || "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, 280);
}

function ensureCommunity(lat, lng) {
  const geohash = encodeGeohash(lat, lng, DEFAULT_PRECISION);
  let community = state.communities.find((c) => c.geohash === geohash);
  if (!community) {
    const center = decodeGeohashCenter(geohash);
    community = {
      id: state.nextCommunityId++,
      geohash,
      lat: center.lat,
      lng: center.lng,
      createdAt: Date.now(),
    };
    state.communities.push(community);
    save();
  }
  return community;
}

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

// ---- SSE subscribers ---------------------------------------------------

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

  // GET /api/identity/:anonId
  if (req.method === "GET" && parts[1] === "identity" && parts[2]) {
    const identity = ensureIdentity(decodeURIComponent(parts[2]));
    return sendJson(res, 200, { anonId: parts[2], label: identity.label });
  }

  // GET /api/bubbles?lat=&lng=
  if (req.method === "GET" && parts[1] === "bubbles") {
    const lat = parseFloat(url.searchParams.get("lat"));
    const lng = parseFloat(url.searchParams.get("lng"));
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return sendJson(res, 400, { error: "lat/lng requeridos" });
    }

    const current = ensureCommunity(lat, lng);
    const radiusKm = 2.5;
    const nearby = state.communities
      .map((c) => ({ ...c, distanceKm: haversineKm(lat, lng, c.lat, c.lng) }))
      .filter((c) => c.distanceKm <= radiusKm || c.id === current.id)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 14);

    const bubbles = nearby.map((c) => {
      const stats = communityStats(c.id);
      return {
        id: c.id,
        geohash: c.geohash,
        center: { lat: c.lat, lng: c.lng },
        distanceKm: Math.round(c.distanceKm * 100) / 100,
        commentCount: stats.count,
        lastActiveAt: stats.lastActiveAt,
        isCurrent: c.id === current.id,
      };
    });

    return sendJson(res, 200, { currentCommunityId: current.id, bubbles });
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

  // POST /api/communities/:id/comments
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
    const text = sanitizeText(body.text);
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
