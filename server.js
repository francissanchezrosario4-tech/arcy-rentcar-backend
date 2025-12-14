import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* ===== TEST SERVER ===== */
app.get("/", (req, res) => {
  res.json({ status: "Servidor Arcy Rent Car ONLINE 🚗🔥" });
});

/* ===== TEST DB ===== */
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      database: "OK",
      time: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
/* ===== CREATE TABLES (RUN ONCE) ===== */
app.get("/setup-db", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        telefono TEXT
      );

      CREATE TABLE IF NOT EXISTS vehiculos (
        id SERIAL PRIMARY KEY,
        marca TEXT,
        modelo TEXT,
        placa TEXT,
        precio_dia NUMERIC
      );

      CREATE TABLE IF NOT EXISTS facturas (
        id TEXT PRIMARY KEY,
        fecha DATE,
        cliente_id INTEGER REFERENCES clientes(id),
        vehiculo_id INTEGER REFERENCES vehiculos(id),
        dias INTEGER,
        precio_dia NUMERIC,
        total NUMERIC
      );
    `);

    res.json({ status: "Tablas creadas correctamente ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
