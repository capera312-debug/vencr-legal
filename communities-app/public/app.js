(() => {
  const statusEl = document.getElementById("status");
  const breadcrumbEl = document.getElementById("breadcrumb");
  const fieldEl = document.getElementById("bubbleField");
  const panelEl = document.getElementById("panel");
  const panelTitleEl = document.getElementById("panelTitle");
  const panelSubtitle = document.getElementById("panelSubtitle");
  const closePanelBtn = document.getElementById("closePanel");
  const communityView = document.getElementById("communityView");
  const adView = document.getElementById("adView");
  const commentListEl = document.getElementById("commentList");
  const commentForm = document.getElementById("commentForm");
  const commentInput = document.getElementById("commentInput");
  const adTextEl = document.getElementById("adText");
  const adDiscountEl = document.getElementById("adDiscount");
  const adOwnerEl = document.getElementById("adOwner");
  const rotateBtn = document.getElementById("rotateIdentity");
  const myLabelEl = document.getElementById("myLabel");

  // Places have no owner and no chosen color — this is just a light visual
  // cue for what kind of place you're looking at, reusing the same palette
  // categories.js uses for businesses (parks are public space, PH is
  // residential, etc).
  const KIND_HUE = {
    parque: "#5fa85f",
    ph: "#4f7fc9",
    establecimiento: "#c97a3d",
    zona: "#8c7a63",
  };

  const state = {
    anonId: null,
    label: null,
    lastPos: null,
    activePlaceId: null,
    eventSource: null,
    renderedCommentIds: new Set(),
  };

  window.CommunitiesApp = {
    getLastPos: () => state.lastPos,
    refreshBubbles: () => {
      if (state.lastPos) loadBubbles(state.lastPos.lat, state.lastPos.lng);
    },
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

  function onPositionError() {
    statusEl.textContent = "No pudimos acceder a tu ubicación";
    renderEmptyState(
      "Sin acceso a tu ubicación no podemos mostrarte lo que hay cerca. Habilitá el permiso e intentá de nuevo."
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

  // ---- breadcrumb ---------------------------------------------------------

  function renderBreadcrumb(location) {
    if (!location.known) {
      breadcrumbEl.textContent = "Zona sin catalogar en esta demo — sin geocodificación real acá";
      breadcrumbEl.classList.add("unknown");
      return;
    }
    breadcrumbEl.classList.remove("unknown");
    const parts = [location.country.name, location.province.name, location.district.name, location.corregimiento.name]
      .filter((v, i, arr) => arr.indexOf(v) === i); // Panamá/Panamá/Panamá de sobra: no repetir
    breadcrumbEl.textContent = parts.join(" › ");
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
      renderBreadcrumb(data.location);
      renderBubbles(data.communities, data.ads);
      statusEl.textContent = data.ads.length
        ? `${data.ads.length} publicidad${data.ads.length === 1 ? "" : "es"} llegando hasta acá`
        : "";
    } catch (e) {
      statusEl.textContent = "No pudimos cargar lo que hay cerca";
    }
  }

  function renderEmptyState(msg) {
    fieldEl.innerHTML = `<div class="empty-state">${msg}</div>`;
  }

  // Places never get placed under the topbar — its buttons and breadcrumb
  // sit above the field and would otherwise steal clicks from a bubble.
  const TOP_SAFE_PX = 150;

  function placeNonOverlapping(items, placed, w, h) {
    const GAP = 10;
    items.forEach((item) => {
      const r = item.size / 2;
      let x = item.baseX;
      let y = item.baseY;
      let ok = false;
      for (let attempt = 0; attempt < 24 && !ok; attempt++) {
        if (attempt > 0) {
          const angle = attempt * 2.4;
          const spiral = attempt * 9;
          x = item.baseX + Math.cos(angle) * spiral;
          y = item.baseY + Math.sin(angle) * spiral;
        }
        x = Math.max(r + 6, Math.min(w - r - 6, x));
        y = Math.max(TOP_SAFE_PX + r, Math.min(h - r - 16, y));
        ok = placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP);
      }
      placed.push({ x, y, r });
      item.x = x;
      item.y = y;
    });
  }

  function renderBubbles(communities, ads) {
    fieldEl.innerHTML = "";
    if (!communities.length && !ads.length) {
      renderEmptyState("No hay nada activo cerca tuyo todavía.");
      return;
    }

    const w = fieldEl.clientWidth || 360;
    const h = fieldEl.clientHeight || 560;

    const communityItems = communities.map((c) => {
      const seed = hashSeed(`c${c.id}`);
      return {
        c,
        seed,
        baseX: w * (0.15 + ((seed % 80) / 100)),
        baseY: h * (0.15 + (((seed >> 8) % 60) / 100)),
        size: c.isCurrent ? Math.min(190, 140 + c.commentCount * 5) : Math.min(118, 66 + c.commentCount * 5),
      };
    });
    const adItems = ads.map((a) => {
      const seed = hashSeed(`a${a.id}`);
      return {
        a,
        seed,
        baseX: w * (0.15 + (((seed >> 3) % 80) / 100)),
        baseY: h * (0.15 + (((seed >> 11) % 60) / 100)),
        size: 90,
      };
    });

    const placed = [];
    placeNonOverlapping(communityItems, placed, w, h);
    placeNonOverlapping(adItems, placed, w, h);

    communityItems.forEach(({ c, seed, size, x, y }) => {
      const hue = KIND_HUE[c.kind] || KIND_HUE.zona;
      const el = document.createElement("button");
      el.className = "bubble" + (c.isCurrent ? " current" : "");
      el.style.setProperty("--hue", hue);
      el.style.left = `${x - size / 2}px`;
      el.style.top = `${y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.animationDelay = `${(seed % 30) / 10}s`;
      el.setAttribute("aria-label", `${c.name}, ${c.commentCount} comentarios`);
      el.innerHTML = `
        <span class="count">${c.commentCount}</span>
        <span class="dist">${c.isCurrent ? "acá" : c.name}</span>
      `;
      el.addEventListener("click", () => openCommunity(c));
      fieldEl.appendChild(el);
    });

    adItems.forEach(({ a, seed, size, x, y }) => {
      const el = document.createElement("button");
      el.className = "bubble ad";
      el.style.setProperty("--hue", a.hue);
      el.style.left = `${x - size / 2}px`;
      el.style.top = `${y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.animationDelay = `${(seed % 30) / 10}s`;
      el.setAttribute("aria-label", `Publicidad: ${a.title}`);
      el.innerHTML = `
        <span class="ad-tag">Publicidad</span>
        <span class="count" style="font-size:13px">${a.title}</span>
        ${a.discountText ? `<span class="discount-badge">${escapeHtml(a.discountText)}</span>` : ""}
      `;
      el.addEventListener("click", () => openAd(a));
      fieldEl.appendChild(el);
    });
  }

  // ---- community panel + comments ---------------------------------------

  function openCommunity(place) {
    state.activePlaceId = place.id;
    state.renderedCommentIds = new Set();
    communityView.classList.remove("hidden");
    adView.classList.add("hidden");
    panelEl.classList.remove("hidden");
    panelTitleEl.textContent = place.name;
    panelSubtitle.textContent = place.isCurrent ? "tu ubicación actual" : `a ${place.distanceKm} km de vos`;
    commentListEl.innerHTML = `<div class="empty-state">Cargando…</div>`;
    loadComments(place.id);
    connectStream(place.id);
  }

  function openAd(ad) {
    state.activePlaceId = null;
    if (state.eventSource) state.eventSource.close();
    communityView.classList.add("hidden");
    adView.classList.remove("hidden");
    panelEl.classList.remove("hidden");
    panelTitleEl.textContent = ad.title;
    panelSubtitle.textContent = `${ad.ownerName} · publicidad en ${ad.targetName}`;
    adTextEl.textContent = ad.text;
    adOwnerEl.textContent = `Publicidad de ${ad.ownerName}`;
    if (ad.discountText) {
      adDiscountEl.textContent = ad.discountText;
      adDiscountEl.classList.remove("hidden");
    } else {
      adDiscountEl.classList.add("hidden");
    }
  }

  closePanelBtn.addEventListener("click", () => {
    panelEl.classList.add("hidden");
    state.activePlaceId = null;
    if (state.eventSource) state.eventSource.close();
  });

  async function loadComments(placeId) {
    const res = await fetch(`/api/places/${placeId}/comments`);
    const data = await res.json();
    if (state.activePlaceId !== placeId) return;
    data.comments.forEach(appendComment);
    if (!state.renderedCommentIds.size) {
      commentListEl.innerHTML = `<div class="empty-state">Todavía no hay comentarios acá. Contá qué está pasando.</div>`;
    }
    commentListEl.scrollTop = commentListEl.scrollHeight;
  }

  function appendComment(c) {
    if (state.renderedCommentIds.has(c.id)) return;
    state.renderedCommentIds.add(c.id);
    commentListEl.querySelector(".empty-state")?.remove();

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

  function connectStream(placeId) {
    if (state.eventSource) state.eventSource.close();
    const es = new EventSource(`/api/places/${placeId}/stream`);
    es.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "comment" && state.activePlaceId === placeId) {
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
    if (!text || !state.activePlaceId) return;

    const submitBtn = commentForm.querySelector("button");
    submitBtn.disabled = true;
    try {
      const res = await fetch(`/api/places/${state.activePlaceId}/comments`, {
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
