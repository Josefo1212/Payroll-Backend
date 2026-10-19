import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/authRoutes.js";
import executeRoutes from "./routes/executeRoutes.js";
import { requireAuth } from "./middleware/requireAuth.js";

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));

// express-session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'secreto_por_defecto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 
  }
}));

app.use(authRoutes);
app.use(executeRoutes);

export { requireAuth };
export default app;