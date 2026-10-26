import express from "express";
import { db } from "../database/Database.js";
import { Session } from "../bo/Session/Session.js";
import { Token } from "../bo/Session/Token.js";
import { ErrorNegocio } from "../errors/ErrorNegocio.js";
import { verificarOrigenCsrf } from "../middlewares/csrf.js";

const authRoutes = express.Router();

authRoutes.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    const session = new Session(db, req);
    const resultado = await session.login(username, password);
    return res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

authRoutes.post("/logout", verificarOrigenCsrf, async (req, res) => {
  try {
    const session = new Session(db, req);
    const resultado = await session.logout();
    return res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

authRoutes.post("/refresh", verificarOrigenCsrf, async (req, res) => {
  try {
    const token = new Token(db, req);
    const resultado = await token.refresh();
    return res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

authRoutes.get("/me", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const session = new Session(db, req);
    const resultado = session.getSession();
    if (!resultado) {
      return res.status(200).json(null);
    }
    return res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof ErrorNegocio) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
});

export default authRoutes;
