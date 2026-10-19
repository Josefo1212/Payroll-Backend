import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { executeController } from "../controllers/executeController.js";

const executeRouter = Router();

// Sin sesión no se llega a executeMethod: el resultado correcto es 401.
executeRouter.post("/execute", requireAuth, executeController.ejecutar);

export default executeRouter;
