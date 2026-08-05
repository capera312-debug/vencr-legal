(() => {
  const TOKEN_KEY = "communities_entity_token";

  const overlay = document.getElementById("businessOverlay");
  const openBtn = document.getElementById("openBusiness");
  const closeBtn = document.getElementById("closeBusiness");

  const authTabs = document.getElementById("authTabs");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginError = document.getElementById("loginError");
  const registerError = document.getElementById("registerError");
  const regCategory = document.getElementById("regCategory");

  const dashboard = document.getElementById("dashboard");
  const dashName = document.getElementById("dashName");
  const dashCategory = document.getElementById("dashCategory");
  const logoutBtn = document.getElementById("logoutBtn");

  const showCreateCommunityBtn = document.getElementById("showCreateCommunity");
  const showCreateAdBtn = document.getElementById("showCreateAd");
  const createCommunityForm = document.getElementById("createCommunityForm");
  const createAdForm = document.getElementById("createAdForm");
  const cancelCreateCommunity = document.getElementById("cancelCreateCommunity");
  const cancelCreateAd = document.getElementById("cancelCreateAd");
  const communityError = document.getElementById("communityError");
  const adError = document.getElementById("adError");

  const communityRadius = document.getElementById("communityRadius");
  const communityRadiusLabel = document.getElementById("communityRadiusLabel");
  const adRadius = document.getElementById("adRadius");
  const adRadiusLabel = document.getElementById("adRadiusLabel");
  const adDuration = document.getElementById("adDuration");
  const adDurationLabel = document.getElementById("adDurationLabel");

  const myCommunitiesEl = document.getElementById("myCommunities");
  const myAdsEl = document.getElementById("myAds");

  let categories = [];
  let session = loadSession();

  function loadSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { token } : null;
  }

  function saveSession(token) {
    localStorage.setItem(TOKEN_KEY, token);
    session = { token };
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    session = null;
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
    if (session) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "algo salió mal");
    return data;
  }

  function currentPosition() {
    const last = window.CommunitiesApp && window.CommunitiesApp.getLastPos();
    if (last) return Promise.resolve(last);
    if (!navigator.geolocation) return Promise.reject(new Error("sin geolocalización"));
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  // ---- categories ---------------------------------------------------------

  async function loadCategories() {
    const data = await api("/api/categories");
    categories = data.categories;
    regCategory.innerHTML = categories.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  }

  // ---- modal open/close + view switching -----------------------------------

  function showAuthView() {
    dashboard.classList.add("hidden");
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    authTabs.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "login"));
  }

  function showDashboardView(entity) {
    authTabs.classList.add("hidden");
    loginForm.classList.add("hidden");
    registerForm.classList.add("hidden");
    dashboard.classList.remove("hidden");
    dashName.textContent = entity.businessName;
    const cat = categories.find((c) => c.id === entity.category);
    dashCategory.textContent = cat ? cat.label : entity.category;
  }

  async function openModal() {
    overlay.classList.remove("hidden");
    if (!categories.length) await loadCategories().catch(() => {});
    if (session) {
      try {
        const data = await api("/api/entities/me");
        showDashboardView(data.entity);
        renderOwned(data.communities, data.ads);
      } catch {
        clearSession();
        authTabs.classList.remove("hidden");
        showAuthView();
      }
    } else {
      authTabs.classList.remove("hidden");
      showAuthView();
    }
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.add("hidden");
  });

  authTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".auth-tab");
    if (!tab) return;
    authTabs.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
    loginForm.classList.toggle("hidden", tab.dataset.tab !== "login");
    registerForm.classList.toggle("hidden", tab.dataset.tab !== "register");
    loginError.textContent = "";
    registerError.textContent = "";
  });

  // ---- login / register / logout -----------------------------------------

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    try {
      const data = await api("/api/entities/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.getElementById("loginEmail").value.trim(),
          password: document.getElementById("loginPassword").value,
        }),
      });
      saveSession(data.token);
      showDashboardView(data.entity);
      const me = await api("/api/entities/me");
      renderOwned(me.communities, me.ads);
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    registerError.textContent = "";
    try {
      const data = await api("/api/entities/register", {
        method: "POST",
        body: JSON.stringify({
          businessName: document.getElementById("regName").value.trim(),
          category: regCategory.value,
          email: document.getElementById("regEmail").value.trim(),
          password: document.getElementById("regPassword").value,
        }),
      });
      saveSession(data.token);
      showDashboardView(data.entity);
      renderOwned([], []);
    } catch (err) {
      registerError.textContent = err.message;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/entities/logout", { method: "POST" });
    } catch {}
    clearSession();
    authTabs.classList.remove("hidden");
    showAuthView();
  });

  // ---- create community / ad -----------------------------------------------

  function fmtRadius(km) {
    return `${Number(km).toFixed(1)} km`;
  }
  function fmtDuration(hours) {
    const h = Number(hours);
    if (h < 24) return `${h} hora${h === 1 ? "" : "s"}`;
    const d = Math.round(h / 24);
    return `${d} día${d === 1 ? "" : "s"}`;
  }

  communityRadius.addEventListener("input", () => {
    communityRadiusLabel.textContent = fmtRadius(communityRadius.value);
  });
  adRadius.addEventListener("input", () => {
    adRadiusLabel.textContent = fmtRadius(adRadius.value);
  });
  adDuration.addEventListener("input", () => {
    adDurationLabel.textContent = fmtDuration(adDuration.value);
  });

  showCreateCommunityBtn.addEventListener("click", () => {
    createAdForm.classList.add("hidden");
    createCommunityForm.classList.toggle("hidden");
  });
  showCreateAdBtn.addEventListener("click", () => {
    createCommunityForm.classList.add("hidden");
    createAdForm.classList.toggle("hidden");
  });
  cancelCreateCommunity.addEventListener("click", () => createCommunityForm.classList.add("hidden"));
  cancelCreateAd.addEventListener("click", () => createAdForm.classList.add("hidden"));

  createCommunityForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    communityError.textContent = "";
    try {
      const pos = await currentPosition();
      await api("/api/communities", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("communityName").value.trim(),
          description: document.getElementById("communityDescription").value.trim(),
          lat: pos.lat,
          lng: pos.lng,
          radiusKm: Number(communityRadius.value),
        }),
      });
      createCommunityForm.reset();
      createCommunityForm.classList.add("hidden");
      const me = await api("/api/entities/me");
      renderOwned(me.communities, me.ads);
      if (window.CommunitiesApp) window.CommunitiesApp.refreshBubbles();
    } catch (err) {
      communityError.textContent = err.message === "sin geolocalización" ? "Necesitamos tu ubicación para crear la comunidad acá." : err.message;
    }
  });

  createAdForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    adError.textContent = "";
    try {
      const pos = await currentPosition();
      await api("/api/ads", {
        method: "POST",
        body: JSON.stringify({
          title: document.getElementById("adTitle").value.trim(),
          text: document.getElementById("adTextInput").value.trim(),
          discountText: document.getElementById("adDiscountInput").value.trim() || null,
          lat: pos.lat,
          lng: pos.lng,
          radiusKm: Number(adRadius.value),
          durationHours: Number(adDuration.value),
        }),
      });
      createAdForm.reset();
      createAdForm.classList.add("hidden");
      const me = await api("/api/entities/me");
      renderOwned(me.communities, me.ads);
      if (window.CommunitiesApp) window.CommunitiesApp.refreshBubbles();
    } catch (err) {
      adError.textContent = err.message === "sin geolocalización" ? "Necesitamos tu ubicación para publicar acá." : err.message;
    }
  });

  // ---- owned lists ----------------------------------------------------------

  function renderOwned(communities, ads) {
    myCommunitiesEl.innerHTML = communities.length
      ? communities.map((c) => ownedRow(c.id, c.name, `radio ${fmtRadius(c.radiusKm)}`, "community")).join("")
      : `<div class="owned-empty">Todavía no creaste ninguna comunidad.</div>`;

    myAdsEl.innerHTML = ads.length
      ? ads.map((a) => ownedRow(a.id, a.title, `hasta ${new Date(a.expiresAt).toLocaleDateString("es-AR")}`, "ad")).join("")
      : `<div class="owned-empty">Todavía no lanzaste publicidad.</div>`;

    myCommunitiesEl.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteOwned("community", btn.dataset.delete));
    });
    myAdsEl.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteOwned("ad", btn.dataset.delete));
    });
  }

  function ownedRow(id, name, meta, kind) {
    return `
      <div class="owned-item">
        <div>
          <div class="owned-name">${escapeHtml(name)}</div>
          <div class="owned-meta">${escapeHtml(meta)}</div>
        </div>
        <button type="button" data-delete="${id}" data-kind="${kind}">Borrar</button>
      </div>
    `;
  }

  async function deleteOwned(kind, id) {
    const path = kind === "community" ? `/api/communities/${id}` : `/api/ads/${id}`;
    try {
      await api(path, { method: "DELETE" });
      const me = await api("/api/entities/me");
      renderOwned(me.communities, me.ads);
      if (window.CommunitiesApp) window.CommunitiesApp.refreshBubbles();
    } catch (err) {
      alert(err.message);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
