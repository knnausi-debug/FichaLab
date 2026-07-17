(() => {
  const isLocalhost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]";

  // En local siempre API del mismo origen; en Netlify usa Railway
  const API_BASE = isLocalhost
    ? ""
    : String(window.FICHALAB_API_BASE || "").replace(/\/$/, "");
  const API = API_BASE ? `${API_BASE}/api` : "/api";
  const SESSION_KEY = "fichalab_user_id";
  const THEME_KEY = "fichalab_theme";
  const THEMES = ["verde", "rosado", "amarillo", "celeste"];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : "verde";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-color")
        .trim();
      if (color) meta.setAttribute("content", color);
    }
    $$('input[name="tema-color"]').forEach((input) => {
      input.checked = input.value === t;
    });
  }

  function temaActual() {
    const checked = $('input[name="tema-color"]:checked');
    const v = checked?.value || localStorage.getItem(THEME_KEY) || "verde";
    return THEMES.includes(v) ? v : "verde";
  }

  async function guardarTemaEnPerfil(tema) {
    if (!usuario) return;
    const t = THEMES.includes(tema) ? tema : "verde";
    try {
      const updated = await api(`/usuarios/${usuario.id}`, {
        method: "PUT",
        body: JSON.stringify({
          nombre: usuario.nombre,
          email: usuario.email,
          profesion: usuario.profesion || "",
          telefono: usuario.telefono || "",
          tema: t,
        }),
      });
      usuario = { ...usuario, ...updated, tema: t };
      localStorage.setItem(SESSION_KEY, usuario.id);
    } catch {
      /* el color ya se ve en este dispositivo; se reintentará al guardar perfil */
    }
  }

  function initTheme() {
    applyTheme(localStorage.getItem(THEME_KEY) || "verde");
  }

  function syncThemeFromUsuario(user) {
    if (user?.tema) applyTheme(user.tema);
  }

  let usuario = null;
  let fichas = [];
  let citas = [];
  let detalleFichaId = null;

  function assetUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
    return `${API_BASE}${path}`;
  }

  function setFoto(imgEl, inicialesEl, fotoUrl, iniciales) {
    const showIniciales = () => {
      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.removeAttribute("src");
      imgEl.classList.add("hidden");
      inicialesEl.classList.remove("hidden");
      inicialesEl.textContent = iniciales || "?";
    };

    const showFoto = () => {
      imgEl.classList.remove("hidden");
      inicialesEl.classList.add("hidden");
    };

    if (!fotoUrl || fotoUrl.startsWith("/uploads/")) {
      showIniciales();
      return;
    }

    imgEl.onload = showFoto;
    imgEl.onerror = showIniciales;

    const src = assetUrl(fotoUrl);
    // Evitar que quede en .hidden si el data-URL carga síncrono (común en móvil)
    if (imgEl.src === src && imgEl.complete && imgEl.naturalWidth > 0) {
      showFoto();
      return;
    }

    imgEl.src = src;

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      showFoto();
    }
  }
  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    const userId = usuario?.id || localStorage.getItem(SESSION_KEY);
    if (userId) headers["X-User-Id"] = userId;

    let res;
    try {
      res = await fetch(`${API}${path}`, {
        ...options,
        headers,
      });
    } catch {
      throw new Error(
        API_BASE
          ? "No se pudo conectar con la API. Revisa config.js (FICHALAB_API_BASE)."
          : "No se pudo conectar con la API. En Netlify debes configurar la URL del backend en config.js."
      );
    }
    if (res.status === 204) return null;
    if (res.status === 404) {
      throw new Error(
        "API no encontrada (404). Netlify no ejecuta el servidor Node: despliega el backend y pon su URL en config.js."
      );
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      cerrarSesion();
      throw new Error(data.error || "Sesión expirada");
    }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function apiUpload(path, formData) {
    const headers = {};
    const userId = usuario?.id || localStorage.getItem(SESSION_KEY);
    if (userId) headers["X-User-Id"] = userId;

    let res;
    try {
      res = await fetch(`${API}${path}`, {
        method: "POST",
        headers,
        body: formData,
      });
    } catch {
      throw new Error("No se pudo subir el archivo. Revisa la URL de la API en config.js.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      cerrarSesion();
      throw new Error(data.error || "Sesión expirada");
    }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function nombreCorto(nombre) {
    const parts = String(nombre || "").trim().split(/\s+/);
    return parts[0] || "Usuario";
  }

  function apellidoCorto(nombre) {
    const parts = String(nombre || "").trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || "";
    // Prefer penultimate if last looks like second surname length-wise: take last two surnames' first? Keep simple: second token
    return parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
  }

  function renderEntorno() {
    const badge = $("#env-badge");
    if (!badge) return;
    if (isLocalhost) {
      badge.classList.remove("hidden");
      badge.textContent = "Versión en prueba · localhost";
      const foot = $(".sidebar-foot");
      if (foot) foot.textContent = "Entorno local · cambios aún no en producción";
    } else {
      badge.classList.add("hidden");
    }
  }

  function saludoHora() {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  }

  function renderSesion() {
    if (!usuario) return;

    const corto = nombreCorto(usuario.nombre);
    const ape = apellidoCorto(usuario.nombre);
    const label = ape ? `${corto} ${ape}` : corto;

    $("#session-name").textContent = label;
    $("#session-name").title = usuario.nombre;
    $("#session-role").textContent = usuario.profesion || "Profesional";
    $("#session-iniciales").textContent = usuario.iniciales || "?";

    setFoto($("#session-foto"), $("#session-iniciales"), usuario.fotoUrl, usuario.iniciales);
    setFoto($("#perfil-foto"), $("#perfil-iniciales"), usuario.fotoUrl, usuario.iniciales);

    $("#greeting").textContent = `${saludoHora()}, ${corto}`;
    $("#inicio-lede").textContent = `Resumen de tu agenda y pacientes · ${usuario.profesion || "Consulta"}`;
    $("#topbar-session").textContent = `${usuario.profesion || "Usuario"} · ${usuario.nombre}`;
    document.title = `FichaLab — ${ape || corto}`;

    // Form perfil
    $("#perfil-nombre").value = usuario.nombre || "";
    $("#perfil-profesion").value = usuario.profesion || "";
    $("#perfil-email").value = usuario.email || "";
    $("#perfil-telefono").value = usuario.telefono || "";
    $("#perfil-password").value = "";
    syncThemeFromUsuario(usuario);
  }

  function showAuth() {
    $("#auth-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
  }

  function showApp() {
    $("#auth-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    renderEntorno();
  }

  function guardarSesion(user) {
    usuario = user;
    localStorage.setItem(SESSION_KEY, user.id);
    syncThemeFromUsuario(user);
  }

  function cerrarSesion() {
    usuario = null;
    localStorage.removeItem(SESSION_KEY);
    showAuth();
  }

  async function loadData() {
    const [f, c] = await Promise.all([api("/fichas"), api("/citas")]);
    fichas = f;
    citas = c;
  }

  // —— Auth UI ——
  $$(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.dataset.auth;
      $("#form-login").classList.toggle("hidden", mode !== "login");
      $("#form-register").classList.toggle("hidden", mode !== "register");
      $("#login-error").hidden = true;
      $("#register-error").hidden = true;
    });
  });

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#login-error");
    errEl.hidden = true;
    try {
      const user = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: $("#login-email").value,
          password: $("#login-password").value,
        }),
      });
      guardarSesion(user);
      showApp();
      await refresh();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $("#form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#register-error");
    errEl.hidden = true;
    try {
      const user = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nombre: $("#reg-nombre").value,
          profesion: $("#reg-profesion").value,
          telefono: $("#reg-telefono").value,
          email: $("#reg-email").value,
          password: $("#reg-password").value,
        }),
      });

      const fotoFile = $("#reg-foto").files[0];
      if (fotoFile) {
        const fd = new FormData();
        fd.append("foto", fotoFile);
        // Guardar sesión antes del upload para enviar X-User-Id
        guardarSesion(user);
        const updated = await apiUpload(`/usuarios/${user.id}/foto`, fd);
        guardarSesion(updated);
      } else {
        guardarSesion(user);
      }

      showApp();
      await refresh();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $("#btn-cerrar-sesion").addEventListener("click", () => {
    if (confirm("¿Cerrar sesión?")) cerrarSesion();
  });

  $("#btn-cerrar-sesion-perfil").addEventListener("click", () => {
    if (confirm("¿Cerrar sesión?")) cerrarSesion();
  });

  // En móvil, tocar el avatar lleva a Perfil
  $("#session-card").addEventListener("click", (e) => {
    if (e.target.closest("#btn-cerrar-sesion")) return;
    if (window.matchMedia("(max-width: 860px)").matches) {
      const perfilBtn = $('.nav-btn[data-view="perfil"]');
      if (perfilBtn) perfilBtn.click();
    }
  });

  // —— Perfil ——
  $("#form-perfil").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#perfil-error");
    const okEl = $("#perfil-ok");
    errEl.hidden = true;
    okEl.hidden = true;

    const payload = {
      nombre: $("#perfil-nombre").value.trim(),
      profesion: $("#perfil-profesion").value.trim(),
      email: $("#perfil-email").value.trim(),
      telefono: $("#perfil-telefono").value.trim(),
      tema: temaActual(),
    };
    const pass = $("#perfil-password").value;
    if (pass) payload.password = pass;

    try {
      const updated = await api(`/usuarios/${usuario.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      guardarSesion(updated);
      renderSesion();
      okEl.hidden = false;
      setTimeout(() => {
        okEl.hidden = true;
      }, 2500);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $("#perfil-foto-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file || !usuario) return;
    const errEl = $("#perfil-error");
    const okEl = $("#perfil-ok");
    errEl.hidden = true;
    okEl.hidden = true;

    try {
      const fd = new FormData();
      fd.append("foto", file);
      const data = await apiUpload(`/usuarios/${usuario.id}/foto`, fd);
      guardarSesion(data);
      renderSesion();
      okEl.textContent = "Foto actualizada";
      okEl.hidden = false;
      setTimeout(() => {
        okEl.hidden = true;
        okEl.textContent = "Perfil actualizado";
      }, 2500);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      e.target.value = "";
    }
  });

  // —— Navigation ——
  function showView(viewName, { activateNav = true } = {}) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    const view = $(`#view-${viewName}`);
    if (view) view.classList.add("active");

    if (activateNav) {
      $$(".nav-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.view === viewName);
      });
    } else {
      $$(".nav-btn").forEach((b) => b.classList.remove("active"));
      const fichasNav = $('.nav-btn[data-view="fichas"]');
      if (fichasNav) fichasNav.classList.add("active");
    }
  }

  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view, { activateNav: true });
      paint();
    });
  });

  // —— Modals ——
  function openModal(id) {
    $(`#${id}`).showModal();
  }

  function closeModal(id) {
    $(`#${id}`).close();
  }

  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  // —— Fichas ——
  function getFicha(id) {
    return fichas.find((f) => f.id === id);
  }

  function renderFichas(filtro = "") {
    const q = filtro.trim().toLowerCase();
    const list = fichas.filter(
      (f) =>
        !q ||
        f.nombre.toLowerCase().includes(q) ||
        f.rut.toLowerCase().includes(q) ||
        (f.diagnostico || "").toLowerCase().includes(q)
    );

    const container = $("#lista-fichas");
    if (list.length === 0) {
      container.innerHTML = `<p class="empty-msg">No hay fichas${q ? " con ese criterio" : ""}. Crea la primera.</p>`;
      return;
    }

    container.innerHTML = list
      .map(
        (f) => `
      <button type="button" class="ficha-card" data-id="${f.id}">
        <h3>${escapeHtml(f.nombre)}</h3>
        <p class="ficha-meta">${escapeHtml(f.rut)}${f.edad ? ` · ${f.edad} años` : ""}</p>
        <p class="ficha-diag">${escapeHtml(f.diagnostico || "Sin diagnóstico de ingreso")}</p>
        <span class="ficha-tag">Ver ficha</span>
      </button>`
      )
      .join("");

    $$(".ficha-card", container).forEach((card) => {
      card.addEventListener("click", () => mostrarDetalle(card.dataset.id));
    });
  }

  function formatFechaHoraIngreso(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-CL", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderHistorialPaciente(ficha) {
    const profesional = usuario
      ? `${escapeHtml(usuario.nombre)} · ${escapeHtml(usuario.profesion || "Profesional")}`
      : "—";

    const historialCitas = sortCitas(
      citas.filter((c) => c.pacienteId === ficha.id)
    ).reverse();

    const citasHtml =
      historialCitas.length === 0
        ? `<li class="historial-empty">Aún no hay atenciones. Usa <strong>Nueva cita</strong> para registrar la primera sesión.</li>`
        : historialCitas
            .map(
              (c) => `
        <li class="historial-item">
          <div class="historial-dot" aria-hidden="true"></div>
          <div class="historial-body">
            <div class="historial-top">
              <strong>${escapeHtml(formatFecha(c.fecha))} · ${escapeHtml(c.hora)}</strong>
              <span class="badge ${escapeHtml(c.estado)}">${escapeHtml(c.estado)}</span>
            </div>
            <p class="historial-meta">${escapeHtml(c.tipo)}${c.obs ? ` · ${escapeHtml(c.obs)}` : " · Sin notas de la sesión"}</p>
          </div>
        </li>`
            )
            .join("");

    return `
      <section class="historial-panel panel" aria-label="Historial con el profesional">
        <div class="historial-head">
          <h3>Historial clínico</h3>
          <p class="historial-head-hint">Cada cita suma una entrada con las notas de esa sesión.</p>
        </div>
        <dl class="detalle-grid historial-resumen">
          <div class="detalle-block">
            <dt>Fecha de ingreso</dt>
            <dd>${escapeHtml(formatFechaHoraIngreso(ficha.creada))}</dd>
          </div>
          <div class="detalle-block">
            <dt>Profesional a cargo</dt>
            <dd>${profesional}</dd>
          </div>
          <div class="detalle-block">
            <dt>Atenciones registradas</dt>
            <dd>${historialCitas.length}</dd>
          </div>
        </dl>
        <h4 class="historial-sub">Línea de tiempo</h4>
        <ol class="historial-timeline">${citasHtml}</ol>
      </section>`;
  }

  function renderResumenPaciente(ficha) {
    return `
      <section class="panel paciente-resumen">
        <h3>Datos clínicos</h3>
        <dl class="detalle-grid">
          <div class="detalle-block"><dt>RUT / ID</dt><dd>${escapeHtml(ficha.rut)}</dd></div>
          <div class="detalle-block"><dt>Edad</dt><dd>${ficha.edad ?? "—"}</dd></div>
          <div class="detalle-block"><dt>Teléfono</dt><dd>${escapeHtml(ficha.telefono || "—")}</dd></div>
          <div class="detalle-block"><dt>Email</dt><dd>${escapeHtml(ficha.email || "—")}</dd></div>
          <div class="detalle-block"><dt>Diagnóstico de ingreso</dt><dd>${escapeHtml(ficha.diagnostico || "—")}</dd></div>
          <div class="detalle-block"><dt>Evaluación inicial</dt><dd>${escapeHtml(ficha.evaluacion || "—")}</dd></div>
          <div class="detalle-block"><dt>Plan de tratamiento</dt><dd>${escapeHtml(ficha.plan || "—")}</dd></div>
        </dl>
      </section>`;
  }

  function abrirVistaPaciente(id) {
    const f = getFicha(id);
    if (!f) return;
    detalleFichaId = id;
    $("#paciente-titulo").textContent = f.nombre;
    $("#paciente-sub").textContent = `${f.rut}${f.diagnostico ? ` · ${f.diagnostico}` : ""}`;
    $("#paciente-contenido").innerHTML = `
      <div class="paciente-col">
        ${renderResumenPaciente(f)}
      </div>
      <div class="paciente-col paciente-col-historial">
        ${renderHistorialPaciente(f)}
      </div>`;
    showView("paciente", { activateNav: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function mostrarDetalle(id) {
    abrirVistaPaciente(id);
  }

  function nombreArchivoPaciente(ficha) {
    const base =
      String(ficha.nombre || "paciente")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "paciente";
    const stamp = new Date().toISOString().slice(0, 10);
    return `ficha-${base}-${stamp}.pdf`;
  }

  function pdfCampo(doc, label, value, x, y, maxW) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(80, 90, 88);
    doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 36, 34);
    const lines = doc.splitTextToSize(String(value || "—"), maxW);
    doc.text(lines, x, y + 5);
    return y + 5 + lines.length * 5 + 4;
  }

  function pdfAsegurarEspacio(doc, y, need) {
    const pageH = doc.internal.pageSize.getHeight();
    if (y + need > pageH - 16) {
      doc.addPage();
      return 18;
    }
    return y;
  }

  function descargarPdfPaciente(id) {
    const ficha = getFicha(id || detalleFichaId);
    if (!ficha) return;

    if (typeof window.jspdf === "undefined" || !window.jspdf.jsPDF) {
      alert("No se pudo cargar la librería de PDF. Revisa tu conexión.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 18;
    const maxW = doc.internal.pageSize.getWidth() - margin * 2;
    let y = 18;

    const profesional = usuario
      ? `${usuario.nombre}${usuario.profesion ? ` · ${usuario.profesion}` : ""}`
      : "—";
    const historialCitas = sortCitas(
      citas.filter((c) => c.pacienteId === ficha.id)
    ).reverse();
    const emitido = new Date().toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(31, 122, 101);
    doc.text("FichaLab", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 110, 108);
    doc.text("Ficha clínica e historial de atenciones", margin, y);
    y += 5;
    doc.text(`Emitido: ${emitido}`, margin, y);
    y += 8;

    doc.setDrawColor(210, 220, 216);
    doc.line(margin, y, margin + maxW, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(30, 36, 34);
    doc.text(ficha.nombre || "Paciente", margin, y);
    y += 8;

    y = pdfCampo(doc, "RUT / ID", ficha.rut, margin, y, maxW);
    y = pdfCampo(doc, "Edad", ficha.edad ?? "—", margin, y, maxW);
    y = pdfCampo(doc, "Teléfono", ficha.telefono || "—", margin, y, maxW);
    y = pdfCampo(doc, "Email", ficha.email || "—", margin, y, maxW);
    y = pdfCampo(doc, "Profesional a cargo", profesional, margin, y, maxW);
    y = pdfCampo(
      doc,
      "Fecha de ingreso",
      formatFechaHoraIngreso(ficha.creada),
      margin,
      y,
      maxW
    );

    y = pdfAsegurarEspacio(doc, y, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(31, 122, 101);
    doc.text("Datos clínicos de ingreso", margin, y);
    y += 8;

    y = pdfCampo(doc, "Diagnóstico de ingreso", ficha.diagnostico || "—", margin, y, maxW);
    y = pdfCampo(doc, "Evaluación inicial", ficha.evaluacion || "—", margin, y, maxW);
    y = pdfCampo(doc, "Plan de tratamiento", ficha.plan || "—", margin, y, maxW);

    y = pdfAsegurarEspacio(doc, y, 24);
    doc.setDrawColor(210, 220, 216);
    doc.line(margin, y, margin + maxW, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(31, 122, 101);
    doc.text(`Historial clínico (${historialCitas.length})`, margin, y);
    y += 8;

    if (!historialCitas.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(90, 98, 96);
      doc.text("Aún no hay atenciones registradas.", margin, y);
    } else {
      historialCitas.forEach((c, i) => {
        const notas = c.obs || "Sin notas de la sesión";
        const titulo = `${formatFecha(c.fecha)} · ${c.hora} — ${c.tipo} (${c.estado})`;
        const noteLines = doc.splitTextToSize(notas, maxW - 2);
        const blockH = 10 + noteLines.length * 5;

        y = pdfAsegurarEspacio(doc, y, blockH + 6);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(30, 36, 34);
        doc.text(`${i + 1}. ${titulo}`, margin, y);
        y += 5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(70, 78, 76);
        doc.text(noteLines, margin, y);
        y += noteLines.length * 5 + 6;
      });
    }

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(140, 148, 146);
      doc.text(
        `FichaLab · ${ficha.nombre || "Paciente"} · pág. ${p}/${pages}`,
        margin,
        doc.internal.pageSize.getHeight() - 8
      );
    }

    doc.save(nombreArchivoPaciente(ficha));
  }

  function resetFormFicha() {
    $("#ficha-id").value = "";
    $("#form-ficha").reset();
    $("#modal-ficha-titulo").textContent = "Nueva ficha";
  }

  function fillFormFicha(f) {
    $("#ficha-id").value = f.id;
    $("#ficha-nombre").value = f.nombre;
    $("#ficha-rut").value = f.rut;
    $("#ficha-edad").value = f.edad ?? "";
    $("#ficha-telefono").value = f.telefono || "";
    $("#ficha-email").value = f.email || "";
    $("#ficha-diagnostico").value = f.diagnostico || "";
    $("#ficha-evaluacion").value = f.evaluacion || "";
    $("#ficha-plan").value = f.plan || "";
    $("#modal-ficha-titulo").textContent = "Editar ficha";
  }

  function csvCell(value) {
    const s = value == null ? "" : String(value);
    return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  }

  function parseCsvLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ";") {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  function normalizeHeader(h) {
    return String(h || "")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
  }

  function normalizeRut(rut) {
    return String(rut || "")
      .trim()
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s/g, "");
  }

  function fichasParaExcel() {
    return fichas.map((f) => ({
      Nombre: f.nombre || "",
      RUT: f.rut || "",
      Edad: f.edad ?? "",
      Teléfono: f.telefono || "",
      Email: f.email || "",
      "Diagnóstico de ingreso": f.diagnostico || "",
      Evaluación: f.evaluacion || "",
      Plan: f.plan || "",
      Creada: f.creada ? new Date(f.creada).toLocaleString("es-CL") : "",
    }));
  }

  function exportarFichasExcel() {
    if (!fichas.length) {
      alert("No hay fichas para exportar.");
      return;
    }
    if (typeof XLSX === "undefined") {
      alert("No se pudo cargar la librería de Excel. Revisa tu conexión.");
      return;
    }

    const rows = fichasParaExcel();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Anchos de columna para que se vea como tabla ordenada
    ws["!cols"] = [
      { wch: 28 },
      { wch: 14 },
      { wch: 8 },
      { wch: 16 },
      { wch: 26 },
      { wch: 32 },
      { wch: 36 },
      { wch: 32 },
      { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fichas");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `fichas-${stamp}.xlsx`);
  }

  function filaDesdeObjeto(obj) {
    const map = {};
    Object.keys(obj || {}).forEach((k) => {
      map[normalizeHeader(k)] = obj[k];
    });
    const get = (...keys) => {
      for (const k of keys) {
        if (map[k] != null && String(map[k]).trim() !== "") return String(map[k]).trim();
      }
      return "";
    };
    return {
      nombre: get("nombre"),
      rut: get("rut"),
      edad: get("edad"),
      telefono: get("teléfono", "telefono"),
      email: get("email"),
      diagnostico: get("diagnóstico de ingreso", "diagnóstico", "diagnostico"),
      evaluacion: get("evaluación", "evaluacion"),
      plan: get("plan"),
    };
  }

  async function leerFilasExcel(file) {
    const name = (file.name || "").toLowerCase();

    // CSV / export antiguo (.xls como texto con ;)
    if (name.endsWith(".csv")) {
      const text = await file.text();
      const rawLines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (rawLines.length < 2) return [];
      const headers = parseCsvLine(rawLines[0]);
      return rawLines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cols[i] || "";
        });
        return filaDesdeObjeto(obj);
      });
    }

    if (typeof XLSX === "undefined") {
      throw new Error("No se pudo cargar la librería de Excel.");
    }

    // .xlsx real (y .xls antiguos binarios si aplica)
    const data = await file.arrayBuffer();
    // Si es texto CSV renombrado a .xls, SheetJS puede fallar: intentar CSV
    const asText = new TextDecoder("utf-8").decode(data.slice(0, 200));
    if (asText.includes("Nombre") && asText.includes(";")) {
      const text = new TextDecoder("utf-8").decode(data);
      const rawLines = text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (rawLines.length < 2) return [];
      const headers = parseCsvLine(rawLines[0]);
      return rawLines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cols[i] || "";
        });
        return filaDesdeObjeto(obj);
      });
    }

    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return json.map(filaDesdeObjeto);
  }

  async function importarFichasDesdeArchivo(file) {
    const filas = await leerFilasExcel(file);
    if (!filas.length) {
      alert("El archivo no tiene fichas para importar.");
      return;
    }

    const existentes = new Set(fichas.map((f) => normalizeRut(f.rut)));
    let creadas = 0;
    let omitidas = 0;
    let errores = 0;

    for (const fila of filas) {
      const nombre = (fila.nombre || "").trim();
      const rut = (fila.rut || "").trim();
      if (!nombre || !rut) {
        omitidas++;
        continue;
      }

      const rutKey = normalizeRut(rut);
      if (existentes.has(rutKey)) {
        omitidas++;
        continue;
      }

      const edad =
        fila.edad && !Number.isNaN(Number(fila.edad)) ? Number(fila.edad) : null;

      try {
        await api("/fichas", {
          method: "POST",
          body: JSON.stringify({
            nombre,
            rut,
            edad,
            telefono: fila.telefono || "",
            email: fila.email || "",
            diagnostico: fila.diagnostico || "",
            evaluacion: fila.evaluacion || "",
            plan: fila.plan || "",
          }),
        });
        existentes.add(rutKey);
        creadas++;
      } catch {
        errores++;
      }
    }

    await refresh();
    alert(
      `Importación lista.\n\nNuevas: ${creadas}\nOmitidas (ya existían o vacías): ${omitidas}\nErrores: ${errores}`
    );
  }

  $("#btn-nueva-ficha").addEventListener("click", () => {
    resetFormFicha();
    openModal("modal-ficha");
  });

  $("#btn-exportar-fichas").addEventListener("click", () => {
    exportarFichasExcel();
  });

  $("#btn-importar-fichas").addEventListener("click", () => {
    $("#input-importar-fichas").click();
  });

  $("#input-importar-fichas").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await importarFichasDesdeArchivo(file);
    } catch (err) {
      alert(err.message || "No se pudo importar el archivo.");
    }
  });

  $("#btn-editar-ficha").addEventListener("click", () => {
    const f = getFicha(detalleFichaId);
    if (!f) return;
    closeModal("modal-detalle");
    fillFormFicha(f);
    openModal("modal-ficha");
  });

  $("#btn-paciente-editar").addEventListener("click", () => {
    const f = getFicha(detalleFichaId);
    if (!f) return;
    fillFormFicha(f);
    openModal("modal-ficha");
  });

  $("#btn-paciente-pdf").addEventListener("click", () => {
    descargarPdfPaciente(detalleFichaId);
  });

  $("#btn-paciente-cita").addEventListener("click", () => {
    if (!detalleFichaId) return;
    abrirNuevaCita(detalleFichaId);
  });

  $("#btn-detalle-pdf").addEventListener("click", () => {
    descargarPdfPaciente(detalleFichaId);
  });

  $("#btn-volver-fichas").addEventListener("click", () => {
    showView("fichas", { activateNav: true });
    paint();
  });

  $("#btn-paciente-eliminar").addEventListener("click", async () => {
    if (!detalleFichaId) return;
    if (!confirm("¿Eliminar esta ficha y sus citas asociadas?")) return;
    try {
      await api(`/fichas/${detalleFichaId}`, { method: "DELETE" });
      detalleFichaId = null;
      showView("fichas", { activateNav: true });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  $("#btn-eliminar-ficha").addEventListener("click", async () => {
    if (!detalleFichaId) return;
    if (!confirm("¿Eliminar esta ficha y sus citas asociadas?")) return;
    try {
      await api(`/fichas/${detalleFichaId}`, { method: "DELETE" });
      closeModal("modal-detalle");
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  $("#form-ficha").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#ficha-id").value;
    const data = {
      nombre: $("#ficha-nombre").value.trim(),
      rut: $("#ficha-rut").value.trim(),
      edad: $("#ficha-edad").value ? Number($("#ficha-edad").value) : null,
      telefono: $("#ficha-telefono").value.trim(),
      email: $("#ficha-email").value.trim(),
      diagnostico: $("#ficha-diagnostico").value.trim(),
      evaluacion: $("#ficha-evaluacion").value.trim(),
      plan: $("#ficha-plan").value.trim(),
    };

    try {
      if (id) await api(`/fichas/${id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api("/fichas", { method: "POST", body: JSON.stringify(data) });
      closeModal("modal-ficha");
      await refresh();
      if (id && $("#view-paciente")?.classList.contains("active")) {
        abrirVistaPaciente(id);
      }
    } catch (err) {
      alert(err.message);
    }
  });

  $("#buscar-ficha").addEventListener("input", (e) => {
    renderFichas(e.target.value);
  });

  // —— Agenda ——
  function pacienteNombre(id) {
    return getFicha(id)?.nombre || "Paciente eliminado";
  }

  function fillSelectPacientes(selected = "") {
    const sel = $("#cita-paciente");
    sel.innerHTML =
      `<option value="">Seleccionar paciente…</option>` +
      fichas
        .map(
          (f) =>
            `<option value="${f.id}" ${f.id === selected ? "selected" : ""}>${escapeHtml(f.nombre)}</option>`
        )
        .join("");
  }

  function sortCitas(list) {
    return [...list].sort((a, b) => `${a.fecha}T${a.hora}`.localeCompare(`${b.fecha}T${b.hora}`));
  }

  function formatFecha(iso) {
    const [y, m, d] = iso.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString("es-CL", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function renderCitas(fechaFiltro = null) {
    let list = sortCitas(citas);
    if (fechaFiltro) list = list.filter((c) => c.fecha === fechaFiltro);

    const ul = $("#lista-citas");
    if (list.length === 0) {
      ul.innerHTML = `<li class="empty">No hay citas${fechaFiltro ? " para esta fecha" : ""}. Agenda la primera.</li>`;
      return;
    }

    ul.innerHTML = list
      .map(
        (c) => `
      <li class="cita-item">
        <div class="cita-hora">
          ${escapeHtml(c.hora)}
          <span class="cita-fecha-mini">${formatFecha(c.fecha)}</span>
        </div>
        <div class="cita-info">
          <strong>${escapeHtml(pacienteNombre(c.pacienteId))}</strong>
          <span>${escapeHtml(c.tipo)}${c.obs ? ` · ${escapeHtml(c.obs)}` : ""}</span>
        </div>
        <div class="cita-actions">
          <span class="badge ${escapeHtml(c.estado)}">${escapeHtml(c.estado)}</span>
          <button type="button" class="btn sm ghost" data-edit-cita="${c.id}">Editar</button>
          <button type="button" class="btn sm danger" data-del-cita="${c.id}">Eliminar</button>
        </div>
      </li>`
      )
      .join("");

    $$("[data-edit-cita]", ul).forEach((btn) => {
      btn.addEventListener("click", () => editarCita(btn.dataset.editCita));
    });
    $$("[data-del-cita]", ul).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta cita?")) return;
        try {
          await api(`/citas/${btn.dataset.delCita}`, { method: "DELETE" });
          await refresh();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function resetFormCita() {
    $("#cita-id").value = "";
    $("#form-cita").reset();
    $("#modal-cita-titulo").textContent = "Nueva cita";
    $("#cita-fecha").value = new Date().toISOString().slice(0, 10);
    $("#cita-hora").value = "09:00";
    fillSelectPacientes();
  }

  function abrirNuevaCita(pacienteId = "") {
    if (fichas.length === 0) {
      alert("Primero crea una ficha de paciente.");
      return;
    }
    resetFormCita();
    if (pacienteId) fillSelectPacientes(pacienteId);
    openModal("modal-cita");
  }

  function editarCita(id) {
    const c = citas.find((x) => x.id === id);
    if (!c) return;
    $("#cita-id").value = c.id;
    fillSelectPacientes(c.pacienteId);
    $("#cita-fecha").value = c.fecha;
    $("#cita-hora").value = c.hora;
    $("#cita-tipo").value = c.tipo;
    $("#cita-estado").value = c.estado;
    $("#cita-obs").value = c.obs || "";
    $("#modal-cita-titulo").textContent = "Editar cita";
    openModal("modal-cita");
  }

  $("#btn-nueva-cita").addEventListener("click", () => abrirNuevaCita());

  $("#btn-inicio-ficha")?.addEventListener("click", () => {
    showView("fichas", { activateNav: true });
    resetFormFicha();
    openModal("modal-ficha");
  });

  $("#btn-inicio-cita")?.addEventListener("click", () => abrirNuevaCita());

  $("#form-cita").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#cita-id").value;
    const data = {
      pacienteId: $("#cita-paciente").value,
      fecha: $("#cita-fecha").value,
      hora: $("#cita-hora").value,
      tipo: $("#cita-tipo").value,
      estado: $("#cita-estado").value,
      obs: $("#cita-obs").value.trim(),
    };

    try {
      if (id) await api(`/citas/${id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api("/citas", { method: "POST", body: JSON.stringify(data) });
      closeModal("modal-cita");
      await refresh();
      if (
        $("#view-paciente")?.classList.contains("active") &&
        detalleFichaId &&
        data.pacienteId === detalleFichaId
      ) {
        abrirVistaPaciente(detalleFichaId);
      }
    } catch (err) {
      alert(err.message);
    }
  });

  $("#filtro-fecha").addEventListener("change", (e) => {
    renderCitas(e.target.value || null);
  });

  $("#btn-ver-todas").addEventListener("click", () => {
    $("#filtro-fecha").value = "";
    renderCitas(null);
  });

  // —— Inicio ——
  function startOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function endOfWeek(d) {
    const s = startOfWeek(d);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  }

  function renderInicio() {
    const hoy = new Date();
    const hoyStr = hoy.toISOString().slice(0, 10);
    const weekStart = startOfWeek(hoy);
    const weekEnd = endOfWeek(hoy);

    const citasHoy = citas.filter((c) => c.fecha === hoyStr && c.estado !== "Cancelada");
    const citasSemana = citas.filter((c) => {
      const d = new Date(`${c.fecha}T12:00:00`);
      return d >= weekStart && d <= weekEnd && c.estado !== "Cancelada";
    });

    $("#stat-pacientes").textContent = fichas.length;
    $("#stat-hoy").textContent = citasHoy.length;
    $("#stat-semana").textContent = citasSemana.length;

    const proximas = sortCitas(
      citas.filter((c) => {
        const dt = `${c.fecha}T${c.hora}`;
        return dt >= hoyStr + "T00:00" && c.estado !== "Cancelada" && c.estado !== "Atendida";
      })
    ).slice(0, 5);

    const ul = $("#proximas-citas");
    if (proximas.length === 0) {
      ul.innerHTML = `<li class="empty">Sin citas próximas. Ve a Agenda para programar.</li>`;
      return;
    }

    ul.innerHTML = proximas
      .map(
        (c) => `
      <li class="cita-item">
        <div class="cita-hora">
          ${escapeHtml(c.hora)}
          <span class="cita-fecha-mini">${formatFecha(c.fecha)}</span>
        </div>
        <div class="cita-info">
          <strong>${escapeHtml(pacienteNombre(c.pacienteId))}</strong>
          <span>${escapeHtml(c.tipo)}</span>
        </div>
        <div class="cita-actions">
          <span class="badge ${escapeHtml(c.estado)}">${escapeHtml(c.estado)}</span>
        </div>
      </li>`
      )
      .join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function paint() {
    renderSesion();
    renderInicio();
    renderFichas($("#buscar-ficha").value);
    renderCitas($("#filtro-fecha").value || null);
  }

  async function refresh() {
    await loadData();
    paint();
  }

  ["modal-ficha", "modal-cita"].forEach((id) => {
    $(`#${id}`).addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  async function boot() {
    initTheme();
    renderEntorno();
    const savedId = localStorage.getItem(SESSION_KEY);
    if (savedId) {
      try {
        usuario = await api(`/usuarios/${savedId}`);
        showApp();
        await refresh();
        return;
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    showAuth();
  }

  $$('input[name="tema-color"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      applyTheme(input.value);
      guardarTemaEnPerfil(input.value);
    });
  });

  boot();
})();
