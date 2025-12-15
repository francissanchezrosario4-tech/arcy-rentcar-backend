import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

/* ===== MIDDLEWARE ===== */
app.use(cors());
app.use(express.json());

/* ===== DATABASE ===== */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =======================
   TESTS
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
   SETUP (RUN ONCE)
======================= */
app.get("/setup-rentas", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rentas (
        id SERIAL PRIMARY KEY,
        vehiculo_id INTEGER,
        fecha_inicio DATE,
        fecha_fin DATE,
        factura_id TEXT,
        estado TEXT DEFAULT 'activa'
      );
    `);

    res.json({ status: "Tabla rentas creada ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =======================
   CLIENTES
======================= */
app.post("/clientes", async (req, res) => {
  const { nombre, telefono } = req.body;

  try {
    const r = await pool.query(
      "INSERT INTO clientes (nombre, telefono) VALUES ($1,$2) RETURNING *",
      [nombre, telefono]
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

/* =======================
   VEHICULOS
======================= */
app.post("/vehiculos", async (req, res) => {
  const { marca, modelo, placa, precio_dia } = req.body;

  try {
    const r = await pool.query(
      `
      INSERT INTO vehiculos (marca, modelo, placa, precio_dia)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [marca, modelo, placa, precio_dia]
    );
    res.json(r.rows[0]);
  } catch (e) {
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
    total
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
        total
      ]
    );

    res.json({ status: "Factura guardada ✅" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/facturas", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM facturas ORDER BY fecha DESC"
    );
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
});

app.post("/rentas", async (req, res) => {
  const { vehiculo_id, fecha_inicio, fecha_fin, factura_id } = req.body;

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
});

/* =======================
   START SERVER
======================= */
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});