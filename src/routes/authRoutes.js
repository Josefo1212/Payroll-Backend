import { Router } from "express";
import { getCurrentUser, login, logout } from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const authRouter = Router();

authRouter.post("/api/login", login);
authRouter.get("/api/me", requireAuth, getCurrentUser);
authRouter.post("/api/logout", logout);

export default authRouter;
