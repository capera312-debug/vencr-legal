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

  const showCreateAdBtn = document.getElementById("showCreateAd");
  const createAdForm = document.getElementById("createAdForm");
  const cancelCreateAd = document.getElementById("cancelCreateAd");
  const adError = document.getElementById("adError");
  const targetOptionsEl = document.getElementById("targetOptions");

  const adDuration = document.getElementById("adDuration");
  const adDurationLabel = document.getElementById("adDurationLabel");

  const myAdsEl = document.getElementById("myAds");

  let categories = [];
  let session = loadSession();
  let lastTargetOptions = [];

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

  const LEVEL_LABEL = {
    micro: "Solo este lugar",
    corregimiento: "Todo el corregimiento",
    district: "Todo el distrito",
    province: "Toda la provincia",
    country: "Todo el país",
  };

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
        renderOwned(data.ads);
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
      renderOwned(me.ads);
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
      renderOwned([]);
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

  // ---- create ad ------------------------------------------------------------

  function fmtDuration(hours) {
    const h = Number(hours);
    if (h < 24) return `${h} hora${h === 1 ? "" : "s"}`;
    const d = Math.round(h / 24);
    return `${d} día${d === 1 ? "" : "s"}`;
  }
  adDuration.addEventListener("input", () => {
    adDurationLabel.textContent = fmtDuration(adDuration.value);
  });

  async function renderTargetOptions() {
    targetOptionsEl.innerHTML = `<div class="owned-empty">Buscando tu ubicación…</div>`;
    try {
      const pos = await currentPosition();
      const data = await api(`/api/location?lat=${pos.lat}&lng=${pos.lng}`);
      lastTargetOptions = data.targetOptions;
      const notice = data.location.known
        ? ""
        : `<div class="owned-empty">Tu ubicación actual no está catalogada en esta demo — solo podés anunciar en esta zona puntual.</div>`;
      targetOptionsEl.innerHTML = notice + lastTargetOptions
        .map(
          (o, i) => `
        <label class="target-option">
          <input type="radio" name="targetOption" value="${i}" ${i === 0 ? "checked" : ""} />
          <span>${escapeHtml(o.name)}</span>
          <span class="level-tag">${LEVEL_LABEL[o.level] || o.level}</span>
        </label>
      `
        )
        .join("");
    } catch (err) {
      targetOptionsEl.innerHTML = `<div class="owned-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  showCreateAdBtn.addEventListener("click", () => {
    const opening = createAdForm.classList.contains("hidden");
    createAdForm.classList.toggle("hidden");
    if (opening) renderTargetOptions();
  });
  cancelCreateAd.addEventListener("click", () => createAdForm.classList.add("hidden"));

  createAdForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    adError.textContent = "";
    const picked = createAdForm.querySelector('input[name="targetOption"]:checked');
    if (!picked || !lastTargetOptions[Number(picked.value)]) {
      adError.textContent = "elegí un alcance para el anuncio";
      return;
    }
    const target = lastTargetOptions[Number(picked.value)];
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
          targetLevel: target.level,
          targetId: target.id,
          durationHours: Number(adDuration.value),
        }),
      });
      createAdForm.reset();
      createAdForm.classList.add("hidden");
      const me = await api("/api/entities/me");
      renderOwned(me.ads);
      if (window.CommunitiesApp) window.CommunitiesApp.refreshBubbles();
    } catch (err) {
      adError.textContent = err.message === "sin geolocalización" ? "Necesitamos tu ubicación para publicar acá." : err.message;
    }
  });

  // ---- owned list ----------------------------------------------------------

  function renderOwned(ads) {
    myAdsEl.innerHTML = ads.length
      ? ads.map((a) => ownedRow(a.id, a.title, `${LEVEL_LABEL[a.targetLevel] || a.targetLevel} · ${a.targetName} · hasta ${new Date(a.expiresAt).toLocaleDateString("es-AR")}`)).join("")
      : `<div class="owned-empty">Todavía no lanzaste publicidad.</div>`;

    myAdsEl.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteAd(btn.dataset.delete));
    });
  }

  function ownedRow(id, name, meta) {
    return `
      <div class="owned-item">
        <div>
          <div class="owned-name">${escapeHtml(name)}</div>
          <div class="owned-meta">${escapeHtml(meta)}</div>
        </div>
        <button type="button" data-delete="${id}">Borrar</button>
      </div>
    `;
  }

  async function deleteAd(id) {
    try {
      await api(`/api/ads/${id}`, { method: "DELETE" });
      const me = await api("/api/entities/me");
      renderOwned(me.ads);
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
