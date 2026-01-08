import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
console.log("🚀 BACKEND VERSION: arcy-rentcar-backend vFINAL 2026-01-07");

const { Pool } = pkg;
const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());


app.get("/test-db", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ database: "OK", time: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ... (deja el resto igual)

/* ===== MIDDLEWARE ===== */
app.use(
  cors({
    origin: "*", // ✅ puedes restringirlo a tu dominio de GitHub Pages luego
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
   - Úsalo si quieres crear tablas desde el backend
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
        vehiculo_id INTEGER,
        fecha_inicio DATE,
        fecha_fin DATE,
        factura_id TEXT,
        estado TEXT DEFAULT 'activa'
      );

      CREATE INDEX IF NOT EXISTS idx_rentas_vehiculo_id ON rentas (vehiculo_id);
      CREATE INDEX IF NOT EXISTS idx_rentas_fechas ON rentas (fecha_inicio, fecha_fin);
      CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON facturas (fecha);
    `);

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
    // error típico: placa duplicada por UNIQUE
    res.status(500).json({ error: e.message });
  }
});

app.get("/vehiculos", async (req, res) => {
  try {
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

/* =======================
   RENTAS + DISPONIBILIDAD
======================= */
app.get("/disponibilidad/:vehiculo_id", async (req, res) => {
  const { vehiculo_id } = req.params;
  const { inicio, fin } = req.query;

  try {
    const r = await pool.query(
      `
      SELECT * FROM rentas
      WHERE vehiculo_id = $1
        AND estado = 'activa'
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
    const r = await pool.query("SELECT * FROM rentas ORDER BY id DESC");
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/rentas/vehiculo/:vehiculo_id", async (req, res) => {
  try {
    const { vehiculo_id } = req.params;
    const r = await pool.query(
      "SELECT * FROM rentas WHERE vehiculo_id = $1 AND estado = 'activa' ORDER BY id DESC",
      [vehiculo_id]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/rentas", async (req, res) => {
  const { vehiculo_id, fecha_inicio, fecha_fin, factura_id } = req.body;

  try {
    const check = await pool.query(
      `
      SELECT * FROM rentas
      WHERE vehiculo_id = $1
        AND estado = 'activa'
        AND fecha_inicio <= $3
        AND fecha_fin >= $2
      `,
      [vehiculo_id, fecha_inicio, fecha_fin]
    );

    if (check.rows.length > 0) {
      return res.status(400).json({ error: "Vehículo no disponible" });
    }

    await pool.query(
      `
      INSERT INTO rentas (vehiculo_id, fecha_inicio, fecha_fin, factura_id)
      VALUES ($1,$2,$3,$4)
      `,
      [vehiculo_id, fecha_inicio, fecha_fin, factura_id]
    );

    res.json({ status: "Renta creada ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
