import express from "express";
import dotenv from "dotenv";
import { testConnection } from "./services/databaseService.js";

dotenv.config();
const app = express();

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/health/database", async (_request, response) => {
  try {
    const result = await testConnection();
    response.json({ status: "ok", database: result });
  } catch (error) {
    console.error("Database health check failed:", error);
    response.status(503).json({ status: "error", message: "Database connection failed" });
  }
});

export default app;