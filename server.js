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
  ssl: {
    rejectUnauthorized: false
  }
});

/* ===== ROOT TEST ===== */
app.get("/", (req, res) => {
  res.json({
    status: "Servidor Arcy Rent Car ONLINE 🚗🔥"
  });
});

/* ===== DB TEST ===== */
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      database: "OK",
      time: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ===== CREATE CLIENT ===== */
app.post("/clientes", async (req, res) => {
  const { nombre, telefono } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO clientes (nombre, telefono) VALUES ($1, $2) RETURNING *",
      [nombre, telefono]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ===== CREATE FACTURA ===== */
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
      `INSERT INTO facturas 
      (id, fecha, cliente_nombre, cliente_telefono, vehiculo, placa, dias, precio_dia, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, fecha, cliente_nombre, cliente_telefono, vehiculo, placa, dias, precio_dia, total]
    );

    res.json({ status: "Factura guardada ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ===== START SERVER ===== */
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
