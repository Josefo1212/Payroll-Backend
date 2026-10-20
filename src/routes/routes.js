import express from "express";
import { security } from "../security/Security.js";

const routes = express.Router();

// Endpoint único: todo el sistema se invoca por acá ({ subsystem, class,
// method, params }) y la autenticación es un objeto de negocio (Sesion)
// llamado por el mismo despacho, no rutas REST aparte.
routes.post("/execute", async (req, res) => {
  const { status, body } = await security.executeMethod(req.body, req);

  // logout destruye la sesión: sin ella no hay cookie que limpiar del lado
  // del cliente.
  if (!req.session) {
    res.clearCookie("connect.sid");
  }

  res.status(status).json(body);
});

export default routes;
