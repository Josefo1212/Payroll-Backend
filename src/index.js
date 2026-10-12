import app from './app.js';
import { dbService } from "./services/databaseService.js";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Closing server...`);
    server.close(async () => {
      await dbService.pool.end();
      process.exit(0);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
};

startServer();