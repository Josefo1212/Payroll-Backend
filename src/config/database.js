import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL es requerida para conectar con la base de datos");
}

// SSL configurable: Neon lo exige; un PostgreSQL local normalmente no lo
// tiene. `true` verifica el certificado (no usa rejectUnauthorized: false).
// `no-verify` queda solo como escape para un certificado que no se pueda
// validar, nunca como opción por defecto.
const modoSsl = (process.env.DATABASE_SSL ?? "true").toLowerCase();
const ssl =
  modoSsl === "false"
    ? false
    : modoSsl === "no-verify"
      ? { rejectUnauthorized: false }
      : true;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("Error inesperado en el pool de PostgreSQL:", error);
});