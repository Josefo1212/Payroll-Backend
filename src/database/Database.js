import { pool } from "../config/database.js";
import { datosSegurosDeError } from "../errors/logError.js";

class Database {
  constructor(conexiones) {
    this.pool = conexiones;
  }

  query = async (texto, params = []) => {
    const inicio = Date.now();
    try {
      const resultado = await this.pool.query(texto, params);
      const duracion = Date.now() - inicio;

      if (duracion > 1000) {
        console.warn(`Query lenta (${duracion}ms): ${texto}`);
      }

      return resultado;
    } catch (error) {
      console.error("Error ejecutando query:", {
        texto,
        ...datosSegurosDeError(error),
      });
      throw error;
    }
  };

  transaction = async (callback) => {
    const cliente = await this.pool.connect();
    try {
      await cliente.query("BEGIN");
      const resultado = await callback(cliente);
      await cliente.query("COMMIT");
      return resultado;
    } catch (error) {
      try {
        await cliente.query("ROLLBACK");
      } catch (errorRollback) {
        console.error(
          "Error al hacer ROLLBACK:",
          datosSegurosDeError(errorRollback),
        );
      }
      console.error(
        "Transacción abortada (ROLLBACK aplicado):",
        datosSegurosDeError(error),
      );
      throw error;
    } finally {
      cliente.release();
    }
  };
}

export const db = new Database(pool);
