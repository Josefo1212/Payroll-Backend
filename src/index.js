import app from './app.js';
import { db } from "./database/Database.js";
import { datosSegurosDeError } from "./errors/logError.js";
import { security } from "./security/Security.js";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await security.loadPermission();

    if (security.PublicProfileId == null) {
      throw new Error(
        "No existe el perfil 'Publico'. Aplicá db/seed-seguridad.sql antes de arrancar.",
      );
    }
  } catch (error) {
    console.error(
      "Fallo al cargar permisos. El servidor no arranca:",
      datosSegurosDeError(error),
    );
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
