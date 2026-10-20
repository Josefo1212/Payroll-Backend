import express from "express";
import { security } from "../security/Security.js";

const routes = express.Router();

routes.post("/execute", async (req, res) => {
  const { status, body } = await security.executeMethod(req.body, req);

  if (!req.session) {
    res.clearCookie("connect.sid");
  }

  res.status(status).json(body);
});

export default routes;
