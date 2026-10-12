import { pool } from "../config/database.js";
class DatabaseService {
  constructor() {
    this.pool = pool;
  }

  async query(text, params = []) {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        console.warn(`Query lenta (${duration}ms): ${text}`);
      }

      return result;
    } catch (error) {
      console.error("Error ejecutando query:", { text, error });
      throw error;
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Transacción abortada (ROLLBACK aplicado):", error);
      throw error;
    } finally {
      client.release();
    }
  }
}

export const dbService = new DatabaseService();