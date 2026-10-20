import app from './app.js';
import { db } from "./database/Database.js";
import { security } from "./security/Security.js";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  // Los permisos deben estar en memoria ANTES de aceptar la primera
  // petición: sin loadPermission() no hay mapa de permisos y todo saldría
  // 401/403.
  try {
    await security.loadPermission();
  } catch (error) {
    console.error("No se pudieron cargar los permisos:", error);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Closing server...`);
    server.close(async () => {
      await db.pool.end();
      process.exit(0);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
};

startServer();