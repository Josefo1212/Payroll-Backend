import express from "express";
import { security } from "../security/Security.js";
import authRoutes from "./authRoutes.js";

const routes = express.Router();

routes.use(authRoutes);

routes.post("/execute", async (req, res) => {
  const { status, body } = await security.executeMethod(req.body, req);

  if (!req.session) {
    res.clearCookie("connect.sid");
  }

  res.status(status).json(body);
});

export default routes;
