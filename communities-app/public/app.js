(() => {
  const statusEl = document.getElementById("status");
  const fieldEl = document.getElementById("bubbleField");
  const panelEl = document.getElementById("panel");
  const panelSubtitle = document.getElementById("panelSubtitle");
  const closePanelBtn = document.getElementById("closePanel");
  const commentListEl = document.getElementById("commentList");
  const commentForm = document.getElementById("commentForm");
  const commentInput = document.getElementById("commentInput");
  const rotateBtn = document.getElementById("rotateIdentity");
  const myLabelEl = document.getElementById("myLabel");

  const state = {
    anonId: null,
    label: null,
    lastPos: null,
    activeCommunityId: null,
    eventSource: null,
  };

  // ---- anonymous identity -------------------------------------------

  function loadOrCreateAnonId() {
    let id = localStorage.getItem("communities_anon_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("communities_anon_id", id);
    }
    return id;
  }

  async function refreshIdentity() {
    state.anonId = loadOrCreateAnonId();
    const res = await fetch(`/api/identity/${state.anonId}`);
    const data = await res.json();
    state.label = data.label;
    myLabelEl.textContent = `Posteás como ${state.label}`;
  }

  rotateBtn.addEventListener("click", async () => {
    localStorage.removeItem("communities_anon_id");
    await refreshIdentity();
    statusEl.textContent = `Nuevo perfil: ${state.label}`;
  });

  // ---- geolocation -----------------------------------------------------

  function startWatching() {
    if (!navigator.geolocation) {
      statusEl.textContent = "Tu navegador no soporta geolocalización";
      renderEmptyState("Activá la ubicación para ver las comunidades cerca tuyo.");
      return;
    }
    navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000,
    });
  }

  let lastFetchAt = 0;
  function onPosition(pos) {
    const { latitude, longitude } = pos.coords;
    const moved =
      !state.lastPos ||
      distanceMeters(state.lastPos.lat, state.lastPos.lng, latitude, longitude) > 40;
    state.lastPos = { lat: latitude, lng: longitude };

    const now = Date.now();
    if (moved || now - lastFetchAt > 15000) {
      lastFetchAt = now;
      loadBubbles(latitude, longitude);
    }
  }

  function onPositionError(err) {
    statusEl.textContent = "No pudimos acceder a tu ubicación";
    renderEmptyState(
      "Sin acceso a tu ubicación no podemos mostrarte tu comunidad. Habilitá el permiso e intentá de nuevo."
    );
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ---- bubbles ----------------------------------------------------------

  function hashSeed(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  async function loadBubbles(lat, lng) {
    try {
      const res = await fetch(`/api/bubbles?lat=${lat}&lng=${lng}`);
      if (!res.ok) throw new Error("bubbles fetch failed");
      const data = await res.json();
      state.currentCommunityId = data.currentCommunityId;
      renderBubbles(data.bubbles);
      statusEl.textContent = `${data.bubbles.length} comunidad${data.bubbles.length === 1 ? "" : "es"} cerca tuyo`;
    } catch (e) {
      statusEl.textContent = "No pudimos cargar las comunidades cercanas";
    }
  }

  function renderEmptyState(msg) {
    fieldEl.innerHTML = `<div class="empty-state">${msg}</div>`;
  }

  function renderBubbles(bubbles) {
    fieldEl.innerHTML = "";
    if (!bubbles.length) {
      renderEmptyState("Todavía no hay comunidades activas cerca tuyo. ¡Sé el primero en comentar!");
      return;
    }

    bubbles.forEach((b) => {
      const seed = hashSeed(b.geohash);
      const x = 10 + (seed % 80);
      const y = 15 + ((seed >> 8) % 65);
      const size = Math.min(160, Math.max(70, 70 + b.commentCount * 6));

      const el = document.createElement("button");
      el.className = "bubble" + (b.isCurrent ? " current" : "");
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.animationDelay = `${(seed % 30) / 10}s`;
      el.innerHTML = `
        <span class="count">${b.commentCount}</span>
        <span class="dist">${b.isCurrent ? "acá" : b.distanceKm + " km"}</span>
      `;
      el.addEventListener("click", () => openCommunity(b));
      fieldEl.appendChild(el);
    });
  }

  // ---- community panel + comments ---------------------------------------

  function openCommunity(bubble) {
    state.activeCommunityId = bubble.id;
    panelEl.classList.remove("hidden");
    panelSubtitle.textContent = bubble.isCurrent
      ? "Tu ubicación actual"
      : `A ${bubble.distanceKm} km de vos`;
    loadComments(bubble.id);
    connectStream(bubble.id);
  }

  closePanelBtn.addEventListener("click", () => {
    panelEl.classList.add("hidden");
    state.activeCommunityId = null;
    if (state.eventSource) state.eventSource.close();
  });

  async function loadComments(communityId) {
    commentListEl.innerHTML = `<div class="empty-state">Cargando…</div>`;
    const res = await fetch(`/api/communities/${communityId}/comments`);
    const data = await res.json();
    commentListEl.innerHTML = "";
    if (!data.comments.length) {
      commentListEl.innerHTML = `<div class="empty-state">Todavía no hay comentarios acá. Contá qué está pasando.</div>`;
      return;
    }
    data.comments.forEach(appendComment);
    commentListEl.scrollTop = commentListEl.scrollHeight;
  }

  function appendComment(c) {
    const div = document.createElement("div");
    div.className = "comment";
    const time = new Date(c.created_at).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    div.innerHTML = `
      <div class="meta"><span class="label">${escapeHtml(c.label)}</span><span>${time}</span></div>
      <div class="body">${escapeHtml(c.body)}</div>
    `;
    commentListEl.appendChild(div);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- realtime via Server-Sent Events -----------------------------------

  function connectStream(communityId) {
    if (state.eventSource) state.eventSource.close();
    const es = new EventSource(`/api/communities/${communityId}/stream`);
    es.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "comment" && state.activeCommunityId === communityId) {
        appendComment(payload.comment);
        commentListEl.scrollTop = commentListEl.scrollHeight;
      }
    };
    state.eventSource = es;
  }

  // ---- posting comments ---------------------------------------------------

  commentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = commentInput.value.trim();
    if (!text || !state.activeCommunityId) return;

    const submitBtn = commentForm.querySelector("button");
    submitBtn.disabled = true;
    try {
      const res = await fetch(`/api/communities/${state.activeCommunityId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anonId: state.anonId, text }),
      });
      if (res.ok) {
        commentInput.value = "";
      } else {
        const err = await res.json();
        statusEl.textContent = err.error || "No se pudo enviar el comentario";
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---- boot -----------------------------------------------------------------

  (async function init() {
    await refreshIdentity();
    startWatching();
  })();
})();
