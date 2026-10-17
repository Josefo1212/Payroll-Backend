import { pool } from "../src/config/database.js";

// Componente único de acceso a datos. Los objetos de negocio y los servicios
// no usan el pool suelto: pasan por acá para tener el mismo manejo de errores
// y transacciones.
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
      console.error("Error ejecutando query:", { texto, error });
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
      await cliente.query("ROLLBACK");
      console.error("Transacción abortada (ROLLBACK aplicado):", error);
      throw error;
    } finally {
      cliente.release();
    }
  };
}

export const db = new Database(pool);
