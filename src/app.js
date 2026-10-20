import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import { datosSegurosDeError } from "./errors/logError.js";
import routes from "./routes/routes.js";

dotenv.config();

const esProduccion = process.env.NODE_ENV === "production";

if (esProduccion && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET es obligatoria en producción.");
}

const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));

app.use(session({
  name: "connect.sid",
  secret: process.env.SESSION_SECRET || "secreto_solo_desarrollo",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: esProduccion,
    maxAge: 1000 * 60 * 60 * 24,
  },
}));

app.use("/api", routes);


app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "JSON inválido en el cuerpo de la petición." });
  }

  console.error("Error no controlado:", datosSegurosDeError(error));
  res.status(500).json({ error: "Error interno del servidor." });
});

export default app;
