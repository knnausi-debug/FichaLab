require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { query } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1.5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error("Usa una imagen JPG, PNG o WEBP"));
    }
    cb(null, true);
  },
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : true,
  })
);
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname)));

function mapFicha(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    rut: row.rut,
    edad: row.edad,
    telefono: row.telefono || "",
    email: row.email || "",
    diagnostico: row.diagnostico || "",
    evaluacion: row.evaluacion || "",
    plan: row.plan || "",
    notas: row.notas || "",
    creada: row.creada,
  };
}

function mapCita(row) {
  const fecha =
    row.fecha instanceof Date
      ? row.fecha.toISOString().slice(0, 10)
      : String(row.fecha).slice(0, 10);
  let hora = String(row.hora);
  if (/^\d{2}:\d{2}/.test(hora)) hora = hora.slice(0, 5);

  return {
    id: row.id,
    pacienteId: row.paciente_id,
    fecha,
    hora,
    tipo: row.tipo,
    estado: row.estado,
    obs: row.obs || "",
  };
}

function mapUsuario(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    profesion: row.profesion || "",
    telefono: row.telefono || "",
    fotoUrl: row.foto_url || "",
    tema: ["verde", "rosado", "amarillo", "celeste"].includes(row.tema)
      ? row.tema
      : "verde",
    creado: row.creado,
  };
}

function iniciales(nombre) {
  const parts = String(nombre || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  if (parts.length === 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0][0] + parts[parts.length - 2][0]).toUpperCase();
}

/** Requiere header X-User-Id con el UUID del profesional logueado */
async function requireAuth(req, res, next) {
  const userId = req.header("X-User-Id");
  if (!userId) {
    return res.status(401).json({ error: "Debes iniciar sesión" });
  }
  try {
    const { rows } = await query("SELECT id FROM usuarios WHERE id = $1", [userId]);
    if (!rows[0]) return res.status(401).json({ error: "Sesión inválida" });
    req.userId = userId;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function fichaDelUsuario(fichaId, userId) {
  const { rows } = await query(
    "SELECT * FROM fichas WHERE id = $1 AND usuario_id = $2",
    [fichaId, userId]
  );
  return rows[0] || null;
}

async function citaDelUsuario(citaId, userId) {
  const { rows } = await query(
    `SELECT c.* FROM citas c
     JOIN fichas f ON f.id = c.paciente_id
     WHERE c.id = $1 AND f.usuario_id = $2`,
    [citaId, userId]
  );
  return rows[0] || null;
}

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, db: "neon" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// —— Auth / Usuarios ——
app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      nombre,
      email,
      password,
      profesion = "Kinesiólogo",
      telefono = "",
    } = req.body;

    if (!nombre?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: "Nombre, email y contraseña son obligatorios" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, profesion, telefono)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre.trim(), email.trim().toLowerCase(), hash, profesion.trim() || "Kinesiólogo", telefono.trim()]
    );
    const user = mapUsuario(rows[0]);
    user.iniciales = iniciales(user.nombre);
    res.status(201).json(user);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese email ya está registrado" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: "Email y contraseña son obligatorios" });
    }

    const { rows } = await query("SELECT * FROM usuarios WHERE email = $1", [
      email.trim().toLowerCase(),
    ]);
    if (!rows[0]) return res.status(401).json({ error: "Credenciales incorrectas" });

    const ok = await bcrypt.compare(String(password), rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales incorrectas" });

    const user = mapUsuario(rows[0]);
    user.iniciales = iniciales(user.nombre);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/usuarios/:id", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id, nombre, email, profesion, telefono, foto_url, tema, creado FROM usuarios WHERE id = $1",
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
    const user = mapUsuario(rows[0]);
    user.iniciales = iniciales(user.nombre);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/usuarios/:id", requireAuth, async (req, res) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: "No puedes editar otro perfil" });
    }

    const { nombre, email, profesion, telefono, password, tema } = req.body;
    if (!nombre?.trim() || !email?.trim()) {
      return res.status(400).json({ error: "Nombre y email son obligatorios" });
    }

    const temaOk = ["verde", "rosado", "amarillo", "celeste"].includes(tema)
      ? tema
      : null;

    let rows;
    if (password && String(password).length >= 6) {
      const hash = await bcrypt.hash(String(password), 10);
      ({ rows } = await query(
        `UPDATE usuarios SET
          nombre = $1, email = $2, profesion = $3, telefono = $4, password_hash = $5,
          tema = COALESCE($6, tema)
         WHERE id = $7
         RETURNING id, nombre, email, profesion, telefono, foto_url, tema, creado`,
        [
          nombre.trim(),
          email.trim().toLowerCase(),
          (profesion || "").trim() || "Kinesiólogo",
          (telefono || "").trim(),
          hash,
          temaOk,
          req.params.id,
        ]
      ));
    } else {
      ({ rows } = await query(
        `UPDATE usuarios SET
          nombre = $1, email = $2, profesion = $3, telefono = $4,
          tema = COALESCE($5, tema)
         WHERE id = $6
         RETURNING id, nombre, email, profesion, telefono, foto_url, tema, creado`,
        [
          nombre.trim(),
          email.trim().toLowerCase(),
          (profesion || "").trim() || "Kinesiólogo",
          (telefono || "").trim(),
          temaOk,
          req.params.id,
        ]
      ));
    }

    if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
    const user = mapUsuario(rows[0]);
    user.iniciales = iniciales(user.nombre);
    res.json(user);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese email ya está en uso" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/usuarios/:id/foto", requireAuth, upload.single("foto"), async (req, res) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: "No puedes editar otro perfil" });
    }
    if (!req.file) return res.status(400).json({ error: "No se recibió ninguna foto" });

    // Guardar en Neon (data URL) para que no se pierda al redeploy de Railway
    const fotoUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const { rows } = await query(
      `UPDATE usuarios SET foto_url = $1
       WHERE id = $2
       RETURNING id, nombre, email, profesion, telefono, foto_url, tema, creado`,
      [fotoUrl, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });

    const user = mapUsuario(rows[0]);
    user.iniciales = iniciales(user.nombre);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// —— Fichas (solo del profesional logueado) ——
app.get("/api/fichas", requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM fichas WHERE usuario_id = $1 ORDER BY creada DESC",
      [req.userId]
    );
    res.json(rows.map(mapFicha));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/fichas/:id", requireAuth, async (req, res) => {
  try {
    const row = await fichaDelUsuario(req.params.id, req.userId);
    if (!row) return res.status(404).json({ error: "Ficha no encontrada" });
    res.json(mapFicha(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/fichas", requireAuth, async (req, res) => {
  try {
    const {
      nombre,
      rut,
      edad,
      telefono = "",
      email = "",
      diagnostico = "",
      evaluacion = "",
      plan = "",
      notas = "",
    } = req.body;

    if (!nombre?.trim() || !rut?.trim()) {
      return res.status(400).json({ error: "Nombre y RUT son obligatorios" });
    }

    const { rows } = await query(
      `INSERT INTO fichas
        (usuario_id, nombre, rut, edad, telefono, email, diagnostico, evaluacion, plan, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.userId,
        nombre.trim(),
        rut.trim(),
        edad ?? null,
        telefono,
        email,
        diagnostico,
        evaluacion,
        plan,
        notas,
      ]
    );
    res.status(201).json(mapFicha(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/fichas/:id", requireAuth, async (req, res) => {
  try {
    const {
      nombre,
      rut,
      edad,
      telefono = "",
      email = "",
      diagnostico = "",
      evaluacion = "",
      plan = "",
    } = req.body;

    const { rows } = await query(
      `UPDATE fichas SET
        nombre = $1, rut = $2, edad = $3, telefono = $4, email = $5,
        diagnostico = $6, evaluacion = $7, plan = $8
       WHERE id = $9 AND usuario_id = $10
       RETURNING *`,
      [
        nombre?.trim(),
        rut?.trim(),
        edad ?? null,
        telefono,
        email,
        diagnostico,
        evaluacion,
        plan,
        req.params.id,
        req.userId,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "Ficha no encontrada" });
    res.json(mapFicha(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/fichas/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM fichas WHERE id = $1 AND usuario_id = $2",
      [req.params.id, req.userId]
    );
    if (!rowCount) return res.status(404).json({ error: "Ficha no encontrada" });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// —— Citas (solo de pacientes del profesional) ——
app.get("/api/citas", requireAuth, async (req, res) => {
  try {
    const { fecha } = req.query;
    let result;
    if (fecha) {
      result = await query(
        `SELECT c.* FROM citas c
         JOIN fichas f ON f.id = c.paciente_id
         WHERE f.usuario_id = $1 AND c.fecha = $2
         ORDER BY c.fecha ASC, c.hora ASC`,
        [req.userId, fecha]
      );
    } else {
      result = await query(
        `SELECT c.* FROM citas c
         JOIN fichas f ON f.id = c.paciente_id
         WHERE f.usuario_id = $1
         ORDER BY c.fecha ASC, c.hora ASC`,
        [req.userId]
      );
    }
    res.json(result.rows.map(mapCita));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/citas", requireAuth, async (req, res) => {
  try {
    const {
      pacienteId,
      fecha,
      hora,
      tipo = "Tratamiento",
      estado = "Programada",
      obs = "",
    } = req.body;

    if (!pacienteId || !fecha || !hora) {
      return res.status(400).json({ error: "Paciente, fecha y hora son obligatorios" });
    }

    const paciente = await fichaDelUsuario(pacienteId, req.userId);
    if (!paciente) {
      return res.status(403).json({ error: "El paciente no pertenece a tu consulta" });
    }

    const { rows } = await query(
      `INSERT INTO citas (paciente_id, fecha, hora, tipo, estado, obs)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [pacienteId, fecha, hora, tipo, estado, obs]
    );
    res.status(201).json(mapCita(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/citas/:id", requireAuth, async (req, res) => {
  try {
    const {
      pacienteId,
      fecha,
      hora,
      tipo = "Tratamiento",
      estado = "Programada",
      obs = "",
    } = req.body;

    const existente = await citaDelUsuario(req.params.id, req.userId);
    if (!existente) return res.status(404).json({ error: "Cita no encontrada" });

    const paciente = await fichaDelUsuario(pacienteId, req.userId);
    if (!paciente) {
      return res.status(403).json({ error: "El paciente no pertenece a tu consulta" });
    }

    const { rows } = await query(
      `UPDATE citas SET
        paciente_id = $1, fecha = $2, hora = $3, tipo = $4, estado = $5, obs = $6
       WHERE id = $7
       RETURNING *`,
      [pacienteId, fecha, hora, tipo, estado, obs, req.params.id]
    );
    res.json(mapCita(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/citas/:id", requireAuth, async (req, res) => {
  try {
    const existente = await citaDelUsuario(req.params.id, req.userId);
    if (!existente) return res.status(404).json({ error: "Cita no encontrada" });

    await query("DELETE FROM citas WHERE id = $1", [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: "Error interno" });
});

async function ensureTemaColumn() {
  await query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS tema TEXT NOT NULL DEFAULT 'verde'
  `);
}

ensureTemaColumn()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`FichaLab en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo preparar la BD:", err.message);
    process.exit(1);
  });
