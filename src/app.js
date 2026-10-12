import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { testConnection } from "./services/databaseService.js";
import { pool } from "./config/database.js";

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// express-session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'secreto_por_defecto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 
  }
}));

// diagnostic ednpoiun
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

// sesionExist
export const requireAuth = (req, res, next) => {
  if (!req.session.userID) {
    return res.status(401).json({ error: "No autorizado. Debes iniciar sesión." });
  }
  next();
};

// auth and create session
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  try {
    // Auth
    const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
    const user = result.rows[0];

    // validation
    if (!user) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }

    // Validation
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    }

    // CreateSession: Llenado del Session Object
    req.session.userID = user.id;
    //bd
    req.session.userName = user.nombre || user.email; 
    req.session.Profile = user.rol || 'usuario'; 

    // Respuesta al cliente
    res.status(200).json({
      mensaje: "Login exitoso",
      user: { 
        id: user.id, 
        email: user.email,
        nombre: req.session.userName,
        perfil: req.session.Profile
      } 
    });

  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// get session
app.get("/api/me", requireAuth, (req, res) => {
  res.status(200).json({
    userID: req.session.userID,
    userName: req.session.userName,
    Profile: req.session.Profile
  });
});

// close session
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Error al cerrar la sesión" });
    }
    res.clearCookie("connect.sid"); 
    res.status(200).json({ mensaje: "Sesión cerrada correctamente" });
  });
});

export default app;