import app from './app.js';
import { dbService } from "./services/databaseService.js";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await dbService.testConnection();
    console.log("Database connection established");

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
  } catch (error) {
    console.error("Unable to establish database connection:", error);
    process.exitCode = 1;
  }
};

startServer();