import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { datosSegurosDeError } from "./errors/logError.js";
import routes from "./routes/routes.js";

dotenv.config();

const esProduccion = process.env.NODE_ENV === "production";

if (esProduccion && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET es obligatoria en producción.");
}

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet());

app.use(express.json({ limit: "10kb" }));
const origenesPermitidos = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((origen) => origen.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (origenesPermitidos.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origen no permitido por CORS"));
  },
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
