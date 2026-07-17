(() => {
  const API_BASE = String(window.FICHALAB_API_BASE || "").replace(/\/$/, "");
  const API = API_BASE ? `${API_BASE}/api` : "/api";
  const SESSION_KEY = "fichalab_user_id";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let usuario = null;
  let fichas = [];
  let citas = [];
  let detalleFichaId = null;

  function assetUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_BASE}${path}`;
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

  function saludoHora() {
    const h = new Date().getHours();
    if (h < 12) return "Buenos días";
    if (h < 19) return "Buenas tardes";
    return "Buenas noches";
  }

  function setFoto(imgEl, inicialesEl, fotoUrl, iniciales) {
    if (fotoUrl) {
      imgEl.src = `${assetUrl(fotoUrl)}?t=${Date.now()}`;
      imgEl.classList.remove("hidden");
      inicialesEl.classList.add("hidden");
    } else {
      imgEl.removeAttribute("src");
      imgEl.classList.add("hidden");
      inicialesEl.classList.remove("hidden");
      inicialesEl.textContent = iniciales || "?";
    }
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
  }

  function showAuth() {
    $("#auth-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
  }

  function showApp() {
    $("#auth-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
  }

  function guardarSesion(user) {
    usuario = user;
    localStorage.setItem(SESSION_KEY, user.id);
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
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".view").forEach((v) => v.classList.remove("active"));
      $(`#view-${btn.dataset.view}`).classList.add("active");
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

  function renderFichas(filtro = "", estadoFiltro = "") {
    const q = filtro.trim().toLowerCase();
    const estadoSel = estadoFiltro || $("#filtro-estado-ficha")?.value || "";
    const list = fichas.filter((f) => {
      const matchQ =
        !q ||
        f.nombre.toLowerCase().includes(q) ||
        f.rut.toLowerCase().includes(q) ||
        (f.diagnostico || "").toLowerCase().includes(q);
      const matchE = !estadoSel || (f.estado || "Pendiente") === estadoSel;
      return matchQ && matchE;
    });

    const container = $("#lista-fichas");
    if (list.length === 0) {
      container.innerHTML = `<p class="empty-msg">No hay fichas${q || estadoSel ? " con ese criterio" : ""}. Crea la primera.</p>`;
      return;
    }

    container.innerHTML = list
      .map((f) => {
        const estado = f.estado || "Pendiente";
        return `
      <button type="button" class="ficha-card estado-${escapeHtml(estado)}" data-id="${f.id}">
        <div class="ficha-card-top">
          <h3>${escapeHtml(f.nombre)}</h3>
          <span class="badge ${escapeHtml(estado)}">${escapeHtml(estado)}</span>
        </div>
        <p class="ficha-meta">${escapeHtml(f.rut)}${f.edad ? ` · ${f.edad} años` : ""}</p>
        <p class="ficha-diag">${escapeHtml(f.diagnostico || "Sin diagnóstico registrado")}</p>
        <span class="ficha-tag">Ver ficha</span>
      </button>`;
      })
      .join("");

    $$(".ficha-card", container).forEach((card) => {
      card.addEventListener("click", () => mostrarDetalle(card.dataset.id));
    });
  }

  function mostrarDetalle(id) {
    const f = getFicha(id);
    if (!f) return;
    detalleFichaId = id;
    const estado = f.estado || "Pendiente";
    $("#detalle-nombre").textContent = f.nombre;
    $("#detalle-contenido").innerHTML = `
      <dl class="detalle-grid">
        <div class="detalle-block"><dt>Estado</dt><dd><span class="badge ${escapeHtml(estado)}">${escapeHtml(estado)}</span></dd></div>
        <div class="detalle-block"><dt>RUT / ID</dt><dd>${escapeHtml(f.rut)}</dd></div>
        <div class="detalle-block"><dt>Edad</dt><dd>${f.edad ?? "—"}</dd></div>
        <div class="detalle-block"><dt>Teléfono</dt><dd>${escapeHtml(f.telefono || "—")}</dd></div>
        <div class="detalle-block"><dt>Email</dt><dd>${escapeHtml(f.email || "—")}</dd></div>
        <div class="detalle-block"><dt>Diagnóstico</dt><dd>${escapeHtml(f.diagnostico || "—")}</dd></div>
        <div class="detalle-block"><dt>Evaluación inicial</dt><dd>${escapeHtml(f.evaluacion || "—")}</dd></div>
        <div class="detalle-block"><dt>Plan de tratamiento</dt><dd>${escapeHtml(f.plan || "—")}</dd></div>
        <div class="detalle-block"><dt>Notas de evolución</dt><dd>${escapeHtml(f.notas || "—")}</dd></div>
      </dl>`;

    const btnConfirmar = $("#btn-confirmar-ficha");
    const btnCancelar = $("#btn-cancelar-ficha");
    btnConfirmar.hidden = estado === "Confirmada";
    btnCancelar.hidden = estado === "Cancelada";
    btnConfirmar.textContent = estado === "Cancelada" ? "Reactivar / Confirmar" : "Confirmar";

    openModal("modal-detalle");
  }

  async function cambiarEstadoFicha(estado) {
    if (!detalleFichaId) return;
    const msg =
      estado === "Confirmada"
        ? "¿Confirmar esta ficha?"
        : "¿Cancelar esta ficha?";
    if (!confirm(msg)) return;
    try {
      await api(`/fichas/${detalleFichaId}/estado`, {
        method: "PATCH",
        body: JSON.stringify({ estado }),
      });
      closeModal("modal-detalle");
      await refresh();
    } catch (err) {
      alert(err.message);
    }
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
    $("#ficha-notas").value = f.notas || "";
    $("#modal-ficha-titulo").textContent = "Editar ficha";
  }

  $("#btn-nueva-ficha").addEventListener("click", () => {
    resetFormFicha();
    openModal("modal-ficha");
  });

  $("#btn-editar-ficha").addEventListener("click", () => {
    const f = getFicha(detalleFichaId);
    if (!f) return;
    closeModal("modal-detalle");
    fillFormFicha(f);
    openModal("modal-ficha");
  });

  $("#btn-confirmar-ficha").addEventListener("click", () => cambiarEstadoFicha("Confirmada"));
  $("#btn-cancelar-ficha").addEventListener("click", () => cambiarEstadoFicha("Cancelada"));

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
      notas: $("#ficha-notas").value.trim(),
    };

    try {
      if (id) await api(`/fichas/${id}`, { method: "PUT", body: JSON.stringify(data) });
      else await api("/fichas", { method: "POST", body: JSON.stringify(data) });
      closeModal("modal-ficha");
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  $("#buscar-ficha").addEventListener("input", (e) => {
    renderFichas(e.target.value);
  });

  $("#filtro-estado-ficha").addEventListener("change", () => {
    renderFichas($("#buscar-ficha").value);
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

  $("#btn-nueva-cita").addEventListener("click", () => {
    if (fichas.length === 0) {
      alert("Primero crea una ficha de paciente.");
      return;
    }
    resetFormCita();
    openModal("modal-cita");
  });

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

  boot();
})();
