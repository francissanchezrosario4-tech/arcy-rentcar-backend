import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== MIDDLEWARE ===== */
app.use(
  cors({
    origin: "*", // luego puedes restringirlo a tu GitHub Pages
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

/* ===== DATABASE ===== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =======================
   HELPERS: ESTADOS AUTO
======================= */

/**
 * Normaliza estados de rentas por fecha:
 * - pendiente -> activa cuando ya llegó la fecha_inicio
 * - activa -> finalizada cuando ya pasó fecha_fin
 */
async function normalizeRentasEstados(clientOrPool) {
  const db = clientOrPool;
  await db.query(`
    UPDATE rentas
    SET estado = 'activa'
    WHERE estado = 'pendiente'
      AND fecha_inicio <= CURRENT_DATE;
  `);

  await db.query(`
    UPDATE rentas
    SET estado = 'finalizada'
    WHERE estado = 'activa'
      AND fecha_fin < CURRENT_DATE;
  `);
}

/**
 * Recalcula el estado del vehículo (sin tocar "Mantenimiento"):
 * - Rentado: si hay renta ACTIVA hoy
 * - Reservado: si hay renta PENDIENTE futura
 * - Disponible: si no hay rentas activas/pendientes
 */
async function recalcVehiculoEstado(clientOrPool, vehiculo_id) {
  const db = clientOrPool;

  // Si está en mantenimiento, no lo cambiamos.
  const v = await db.query("SELECT estado FROM vehiculos WHERE id = $1", [
    vehiculo_id,
  ]);
  if (v.rows[0]?.estado === "Mantenimiento") return;

  const hasActiva = await db.query(
    `
    SELECT 1
    FROM rentas r
    WHERE r.vehiculo_id = $1
      AND r.estado = 'activa'
      AND CURRENT_DATE BETWEEN r.fecha_inicio AND r.fecha_fin
    LIMIT 1
    `,
    [vehiculo_id]
  );

  if (hasActiva.rows.length > 0) {
    await db.query("UPDATE vehiculos SET estado = 'Rentado' WHERE id = $1", [
      vehiculo_id,
    ]);
    return;
  }

  const hasPendiente = await db.query(
    `
    SELECT 1
    FROM rentas r
    WHERE r.vehiculo_id = $1
      AND r.estado = 'pendiente'
      AND r.fecha_inicio > CURRENT_DATE
    LIMIT 1
    `,
    [vehiculo_id]
  );

  if (hasPendiente.rows.length > 0) {
    await db.query("UPDATE vehiculos SET estado = 'Reservado' WHERE id = $1", [
      vehiculo_id,
    ]);
    return;
  }

  await db.query("UPDATE vehiculos SET estado = 'Disponible' WHERE id = $1", [
    vehiculo_id,
  ]);
}

/**
 * Recalcula estados de TODOS los vehículos (sin tocar "Mantenimiento")
 */
async function recalcTodosVehiculos(clientOrPool) {
  const db = clientOrPool;
  // Normaliza primero
  await normalizeRentasEstados(db);

  // Rentado
  await db.query(`
    UPDATE vehiculos v
    SET estado = 'Rentado'
    WHERE v.estado <> 'Mantenimiento'
      AND EXISTS (
        SELECT 1 FROM rentas r
        WHERE r.vehiculo_id = v.id
          AND r.estado = 'activa'
          AND CURRENT_DATE BETWEEN r.fecha_inicio AND r.fecha_fin
      );
  `);

  // Reservado (solo si NO está rentado)
  await db.query(`
    UPDATE vehiculos v
    SET estado = 'Reservado'
    WHERE v.estado <> 'Mantenimiento'
      AND NOT EXISTS (
        SELECT 1 FROM rentas r
        WHERE r.vehiculo_id = v.id
          AND r.estado = 'activa'
          AND CURRENT_DATE BETWEEN r.fecha_inicio AND r.fecha_fin
      )
      AND EXISTS (
        SELECT 1 FROM rentas r
        WHERE r.vehiculo_id = v.id
          AND r.estado = 'pendiente'
          AND r.fecha_inicio > CURRENT_DATE
      );
  `);

  // Disponible (si no hay activa ni pendiente)
  await db.query(`
    UPDATE vehiculos v
    SET estado = 'Disponible'
    WHERE v.estado <> 'Mantenimiento'
      AND NOT EXISTS (
        SELECT 1 FROM rentas r
        WHERE r.vehiculo_id = v.id
          AND (
            (r.estado = 'activa' AND CURRENT_DATE BETWEEN r.fecha_inicio AND r.fecha_fin)
            OR (r.estado = 'pendiente' AND r.fecha_inicio > CURRENT_DATE)
          )
      );
  `);
}

/* =======================
   HEALTH + TESTS
======================= */
app.get("/", (req, res) => {
  res.json({ status: "Servidor Arcy Rent Car ONLINE 🚗🔥" });
});

app.get("/test-db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ database: "OK", time: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   SETUP (OPCIONAL)
   - crea tablas si no existen
   - (si ya existen, no borra nada)
======================= */
app.get("/setup-all", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        telefono TEXT,
        cedula TEXT,
        nota TEXT,
        valoracion INTEGER DEFAULT 5
      );

      CREATE TABLE IF NOT EXISTS vehiculos (
        id SERIAL PRIMARY KEY,
        marca TEXT,
        modelo TEXT,
        ano INTEGER,
        placa TEXT UNIQUE,
        estado TEXT DEFAULT 'Disponible',
        precio_dia NUMERIC,
        imagen TEXT
      );

      CREATE TABLE IF NOT EXISTS facturas (
        id TEXT PRIMARY KEY,
        fecha DATE,
        cliente_nombre TEXT,
        cliente_telefono TEXT,
        vehiculo TEXT,
        placa TEXT,
        dias INTEGER,
        precio_dia NUMERIC,
        total NUMERIC
      );

      CREATE TABLE IF NOT EXISTS rentas (
        id SERIAL PRIMARY KEY,
        vehiculo_id INTEGER REFERENCES vehiculos(id) ON DELETE RESTRICT,
        fecha_inicio DATE,
        fecha_fin DATE,
        factura_id TEXT REFERENCES facturas(id) ON DELETE CASCADE,
        estado TEXT DEFAULT 'pendiente'
      );

      CREATE INDEX IF NOT EXISTS idx_rentas_vehiculo_id ON rentas (vehiculo_id);
      CREATE INDEX IF NOT EXISTS idx_rentas_fechas ON rentas (fecha_inicio, fecha_fin);
      CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON facturas (fecha);
      CREATE INDEX IF NOT EXISTS idx_rentas_factura_id ON rentas (factura_id);
      CREATE INDEX IF NOT EXISTS idx_rentas_estado ON rentas (estado);
    `);

    // Ajusta estados automáticamente al arrancar (por si hay rentas viejas)
    await recalcTodosVehiculos(pool);

    res.json({ status: "Tablas creadas/aseguradas ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   CLIENTES
======================= */
app.post("/clientes", async (req, res) => {
  const { nombre, telefono, cedula, nota, valoracion } = req.body;

  try {
    const r = await pool.query(
      `
      INSERT INTO clientes (nombre, telefono, cedula, nota, valoracion)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        nombre,
        telefono || "",
        cedula || "",
        nota || "",
        Number(valoracion ?? 5),
      ]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/clientes", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM clientes ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/clientes/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, cedula, nota, valoracion } = req.body;

  try {
    const r = await pool.query(
      `
      UPDATE clientes
      SET nombre=$1, telefono=$2, cedula=$3, nota=$4, valoracion=$5
      WHERE id=$6
      RETURNING *
      `,
      [
        nombre,
        telefono || "",
        cedula || "",
        nota || "",
        Number(valoracion ?? 5),
        id,
      ]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/clientes/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM clientes WHERE id=$1", [id]);
    res.json({ status: "Cliente eliminado ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   VEHICULOS
======================= */
app.post("/vehiculos", async (req, res) => {
  const { marca, modelo, placa, precio_dia, ano, estado, imagen } = req.body;

  try {
    const r = await pool.query(
      `
      INSERT INTO vehiculos (marca, modelo, placa, precio_dia, ano, estado, imagen)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        marca || "",
        modelo || "",
        placa || null,
        precio_dia ?? 0,
        ano ?? null,
        estado ?? "Disponible",
        imagen ?? "",
      ]
    );

    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * ✅ IMPORTANTE:
 * Antes de devolver vehículos, normalizamos estados de rentas y recalculamos
 * estados de vehículos (Rentado/Reservado/Disponible).
 */
app.get("/vehiculos", async (req, res) => {
  try {
    await recalcTodosVehiculos(pool);
    const r = await pool.query("SELECT * FROM vehiculos ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/vehiculos/:id", async (req, res) => {
  const { id } = req.params;
  const { marca, modelo, placa, precio_dia, ano, estado, imagen } = req.body;

  try {
    const r = await pool.query(
      `
      UPDATE vehiculos
      SET marca=$1, modelo=$2, placa=$3, precio_dia=$4, ano=$5, estado=$6, imagen=$7
      WHERE id=$8
      RETURNING *
      `,
      [
        marca || "",
        modelo || "",
        placa || null,
        precio_dia ?? 0,
        ano ?? null,
        estado ?? "Disponible",
        imagen ?? "",
        id,
      ]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Vehículo no encontrado" });
    }
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/vehiculos/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM vehiculos WHERE id=$1", [id]);
    res.json({ status: "Vehículo eliminado ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   FACTURAS
======================= */
app.post("/facturas", async (req, res) => {
  const {
    id,
    fecha,
    cliente_nombre,
    cliente_telefono,
    vehiculo,
    placa,
    dias,
    precio_dia,
    total,
  } = req.body;

  try {
    await pool.query(
      `
      INSERT INTO facturas
      (id, fecha, cliente_nombre, cliente_telefono, vehiculo, placa, dias, precio_dia, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        id,
        fecha,
        cliente_nombre,
        cliente_telefono || "",
        vehiculo,
        placa || "",
        dias,
        precio_dia,
        total,
      ]
    );

    res.json({ status: "Factura guardada ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/facturas", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM facturas ORDER BY fecha DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * ✅ BORRADO LIMPIO:
 * - elimina renta(s) asociadas a la factura
 * - elimina la factura
 * - recalcula estados de los vehículos afectados
 */
app.delete("/facturas/:id", async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const vr = await client.query(
      "SELECT DISTINCT vehiculo_id FROM rentas WHERE factura_id = $1",
      [id]
    );

    await client.query("DELETE FROM rentas WHERE factura_id = $1", [id]);
    await client.query("DELETE FROM facturas WHERE id = $1", [id]);

    // recalcula cada vehículo afectado
    for (const row of vr.rows) {
      if (row.vehiculo_id) await recalcVehiculoEstado(client, row.vehiculo_id);
    }

    await client.query("COMMIT");
    res.json({ status: "Factura y renta(s) eliminadas ✅" });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* =======================
   RENTAS + DISPONIBILIDAD
======================= */
app.get("/disponibilidad/:vehiculo_id", async (req, res) => {
  const { vehiculo_id } = req.params;
  const { inicio, fin } = req.query;

  try {
    // Considera activa y pendiente (para bloquear reservas)
    const r = await pool.query(
      `
      SELECT * FROM rentas
      WHERE vehiculo_id = $1
        AND estado IN ('activa','pendiente')
        AND fecha_inicio <= $3
        AND fecha_fin >= $2
      `,
      [vehiculo_id, inicio, fin]
    );

    res.json({ disponible: r.rows.length === 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/rentas", async (req, res) => {
  try {
    await normalizeRentasEstados(pool);
    const r = await pool.query("SELECT * FROM rentas ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/rentas/vehiculo/:vehiculo_id", async (req, res) => {
  try {
    const { vehiculo_id } = req.params;
    await normalizeRentasEstados(pool);
    const r = await pool.query(
      "SELECT * FROM rentas WHERE vehiculo_id = $1 AND estado IN ('activa','pendiente') ORDER BY id DESC",
      [vehiculo_id]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * ✅ CREA RENTA:
 * - si fecha_inicio > hoy -> estado 'pendiente' (reservada)
 * - si fecha_inicio <= hoy -> estado 'activa' (rentada)
 * - luego actualiza estado del vehículo automáticamente
 */
app.post("/rentas", async (req, res) => {
  const { vehiculo_id, fecha_inicio, fecha_fin, factura_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bloquea si hay choque de fechas con activa o pendiente
    const check = await client.query(
      `
      SELECT 1 FROM rentas
      WHERE vehiculo_id = $1
        AND estado IN ('activa','pendiente')
        AND fecha_inicio <= $3
        AND fecha_fin >= $2
      LIMIT 1
      `,
      [vehiculo_id, fecha_inicio, fecha_fin]
    );

    if (check.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Vehículo no disponible" });
    }

    // Define estado según fecha
    const estado =
      new Date(fecha_inicio) > new Date(new Date().toISOString().slice(0, 10))
        ? "pendiente"
        : "activa";

    await client.query(
      `
      INSERT INTO rentas (vehiculo_id, fecha_inicio, fecha_fin, factura_id, estado)
      VALUES ($1,$2,$3,$4,$5)
      `,
      [vehiculo_id, fecha_inicio, fecha_fin, factura_id, estado]
    );

    await recalcVehiculoEstado(client, vehiculo_id);

    await client.query("COMMIT");
    res.json({ status: "Renta creada ✅", estado });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});

