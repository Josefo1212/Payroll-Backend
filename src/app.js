import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import helmet from "helmet";
import { db } from "./database/Database.js";
import { PostgresSessionStore } from "./database/SessionStore.js";
import { cookieSegura, esOrigenPermitido } from "./config/http.js";
import { verificarOrigen } from "./middlewares/csrf.js";
import { datosSegurosDeError } from "./errors/logError.js";
import routes from "./routes/routes.js";

const esProduccion = process.env.NODE_ENV === "production";

if (esProduccion && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET es obligatoria en producción.");
}

if (!esProduccion && !process.env.SESSION_SECRET) {
  console.warn(
    "SESSION_SECRET no está definida: se usa un secreto de desarrollo. " +
      "No uses este valor fuera de la laptop.",
  );
}

const secretoSesion = process.env.SESSION_SECRET || "secreto_solo_desarrollo";

const app = express();

app.disable("x-powered-by");
// Una sola capa de proxy (el balanceador del despliegue). Necesario para que
// req.ip sea la IP del cliente y para que la cookie `secure` se emita.
app.set("trust proxy", 1);

// El backend no sirve HTML: la CSP más estricta posible y sin inline. Los
// headers por defecto de helmet se conservan (nosniff, frameguard, etc.).
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    // HSTS solo tiene sentido sobre HTTPS real.
    hsts: esProduccion
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

// No se lanza un error para un origen no permitido: sin cabeceras CORS el
// navegador ya impide leer la respuesta. El 403 real lo da verificarOrigen.
app.use(
  cors({
    origin: (origin, callback) => callback(null, esOrigenPermitido(origin)),
    credentials: true,
    maxAge: 600,
  }),
);

app.use(express.json({ limit: "10kb" }));

// Nada de lo que responde esta API debe quedar en caché del navegador ni de
// un proxy intermedio: incluye datos de sesión y de nómina.
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  next();
});

// Cubre login, logout, refresh y /execute: cualquier método que cambia
// estado exige un origen permitido (o ninguno, si no viene de un navegador).
app.use(verificarOrigen);

app.use(
  session({
    name: "connect.sid",
    secret: secretoSesion,
    resave: false,
    saveUninitialized: false,
    // Las sesiones sobreviven al reinicio y no se acumulan en memoria.
    store: new PostgresSessionStore(db.pool),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSegura(),
      maxAge: 1000 * 60 * 60 * 24,
    },
  }),
);

app.use("/api", routes);

// 404 en JSON para no devolver el HTML de Express ni filtrar la versión.
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada." });
});

app.use((error, req, res, next) => {
  // Errores del body parser: se traducen a JSON y no se registran como 500.
  if (error?.type === "entity.too.large" || error?.status === 413) {
    return res.status(413).json({ error: "El cuerpo de la petición es demasiado grande." });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: "JSON inválido en el cuerpo de la petición." });
  }
  if (error?.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: "Solicitud inválida." });
  }

  console.error("Error no controlado:", datosSegurosDeError(error));
  return res.status(500).json({ error: "Error interno del servidor." });
});

export default app;
