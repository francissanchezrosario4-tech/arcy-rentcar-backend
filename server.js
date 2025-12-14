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
/* ===== CREATE TABLES (RUN ONCE) ===== */
const createTablesSQL = `
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
`;

async function setupDatabase() {
  await pool.query(createTablesSQL);
}

app.get("/setup-db", async (req, res) => {
  try {
    await setupDatabase();
    res.json({ status: "Tablas creadas correctamente ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/setup-db", async (req, res) => {
  try {
    await setupDatabase();
    res.json({ status: "Tablas creadas correctamente ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
