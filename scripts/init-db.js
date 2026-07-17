require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("../db");

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  profesion TEXT NOT NULL DEFAULT 'Kinesiólogo',
  telefono TEXT DEFAULT '',
  foto_url TEXT DEFAULT '',
  tema TEXT NOT NULL DEFAULT 'verde',
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fichas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  rut TEXT NOT NULL,
  edad INTEGER,
  telefono TEXT DEFAULT '',
  email TEXT DEFAULT '',
  diagnostico TEXT DEFAULT '',
  evaluacion TEXT DEFAULT '',
  plan TEXT DEFAULT '',
  notas TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  creada TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS citas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID NOT NULL REFERENCES fichas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hora TIME NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Tratamiento',
  estado TEXT NOT NULL DEFAULT 'Programada',
  obs TEXT DEFAULT '',
  creada TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha);
CREATE INDEX IF NOT EXISTS idx_fichas_nombre ON fichas(nombre);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
`;

async function ensureUsuarioIdColumn() {
  await pool.query(`
    ALTER TABLE fichas
    ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES usuarios(id) ON DELETE CASCADE
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fichas_usuario ON fichas(usuario_id)
  `);
}

async function ensureFichaEstadoColumn() {
  await pool.query(`
    ALTER TABLE fichas
    ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'Pendiente'
  `);
}

async function ensureTemaColumn() {
  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS tema TEXT NOT NULL DEFAULT 'verde'
  `);
}

async function seedUsuario() {
  const { rows } = await pool.query(
    "SELECT id FROM usuarios WHERE email = $1",
    ["vadhyr.cabezas@fichalab.cl"]
  );
  if (rows[0]) return rows[0].id;

  const hash = await bcrypt.hash("vadhyr123", 10);
  const inserted = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, profesion, telefono)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      "Vadhyr Alejandro Cabezas Farran",
      "vadhyr.cabezas@fichalab.cl",
      hash,
      "Kinesiólogo",
      "+56 9 0000 0000",
    ]
  );
  console.log("Usuario demo: vadhyr.cabezas@fichalab.cl / vadhyr123");
  return inserted.rows[0].id;
}

async function backfillFichas(usuarioId) {
  await pool.query(
    `UPDATE fichas SET usuario_id = $1 WHERE usuario_id IS NULL`,
    [usuarioId]
  );
}

async function seedDemo(usuarioId) {
  const { rows: existing } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM fichas WHERE usuario_id = $1",
    [usuarioId]
  );
  if (existing[0].n > 0) return;

  await pool.query(
    `INSERT INTO fichas
      (usuario_id, nombre, rut, edad, telefono, email, diagnostico, evaluacion, plan, notas)
     VALUES
      ($1, 'Camila Rojas', '18.234.567-8', 32, '+56 9 8765 4321', 'camila.rojas@email.cl',
       'Tendinopatía de manguito rotador derecho',
       'Dolor en ABD > 90°. Prueba de Neer positiva. Limitación funcional en elevación.',
       '3 sesiones/semana · movilización escapular, ejercicios isométricos, crioterapia.',
       'Sesión 1: buena tolerancia. Disminuyó dolor nocturno.'),
      ($1, 'Jorge Muñoz', '12.987.654-3', 48, '+56 9 7123 4567', 'jmunoz@email.cl',
       'Lumbalgia mecánica crónica',
       'Dolor lumbar bajo, irradiación glútea izquierda. Flexión limitada. Sin signos neurológicos.',
       'Educación postural, core stability, estiramientos de cadena posterior.',
       ''),
      ($1, 'Valentina Pérez', '20.111.222-5', 27, '+56 9 9988 7766', '',
       'Esguince de tobillo grado II (post-inmovilización)',
       'Edema residual. Propiocepción alterada. ROM dorsal incompleto.',
       'Reeducación propioceptiva, fortalecimiento peroneos, retorno gradual a deporte.',
       'Camina sin cojera. Pendiente saltos unipodales.')`,
    [usuarioId]
  );
}

async function seedCitas(usuarioId) {
  const { rows } = await pool.query(
    "SELECT id FROM fichas WHERE usuario_id = $1 ORDER BY creada ASC LIMIT 3",
    [usuarioId]
  );
  if (rows.length < 3) return;

  const { rows: existing } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM citas c
     JOIN fichas f ON f.id = c.paciente_id
     WHERE f.usuario_id = $1`,
    [usuarioId]
  );
  if (existing[0].n > 0) return;

  const hoy = new Date();
  const manana = new Date(hoy);
  manana.setDate(manana.getDate() + 1);
  const fHoy = hoy.toISOString().slice(0, 10);
  const fMan = manana.toISOString().slice(0, 10);

  await pool.query(
    `INSERT INTO citas (paciente_id, fecha, hora, tipo, estado, obs) VALUES
      ($1, $2, '09:30', 'Tratamiento', 'Confirmada', 'Continuar isométricos'),
      ($3, $2, '11:00', 'Evaluación', 'Programada', ''),
      ($4, $5, '10:00', 'Control', 'Programada', 'Revisar propiocepción')`,
    [rows[0].id, fHoy, rows[1].id, rows[2].id, fMan]
  );
}

async function main() {
  console.log("Conectando a Neon PostgreSQL…");
  await pool.query(SCHEMA);
  await ensureUsuarioIdColumn();
  await ensureFichaEstadoColumn();
  await ensureTemaColumn();
  console.log("Tablas listas.");

  const usuarioId = await seedUsuario();
  await backfillFichas(usuarioId);
  await seedDemo(usuarioId);
  await seedCitas(usuarioId);

  console.log("Datos demo OK (pacientes asociados al profesional).");
  await pool.end();
}

main().catch((err) => {
  console.error("Error al inicializar BD:", err.message);
  process.exit(1);
});
