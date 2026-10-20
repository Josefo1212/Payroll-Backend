import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import { security } from "./security/Security.js";

dotenv.config();

const esProduccion = process.env.NODE_ENV === "production";

// En producción el secreto de sesión es obligatorio: firmar con uno por
// defecto permite falsificar cookies. En desarrollo se admite uno local.
if (esProduccion && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET es obligatoria en producción.");
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));

// express-session configuration
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

// Endpoint único: todo el sistema se invoca por acá ({ subsystem, class,
// method, params }) y la autenticación es un objeto de negocio (Sesion)
// llamado por el mismo despacho, no rutas REST aparte.
app.post("/api/execute", async (req, res) => {
  const { status, body } = await security.executeMethod(req.body, req);

  // logout destruye la sesión: sin ella no hay cookie que limpiar del lado
  // del cliente.
  if (!req.session) {
    res.clearCookie("connect.sid");
  }

  res.status(status).json(body);
});

// Manejador de errores al final de la cadena. Cualquier error no traducido
// (incluido JSON malformado, que express.json lanza como SyntaxError 400)
// termina acá.
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "JSON inválido en el cuerpo de la petición." });
  }

  console.error("Error no controlado:", error);
  res.status(500).json({ error: "Error interno del servidor." });
});

export default app;
