import { Router } from "express";
import { dashboardStats } from "../services/certificates.js";
import { requireAuth } from "../middleware/auth.js";

export const statsRouter = Router();

statsRouter.use(requireAuth);

/** FR-02 — GET /api/dashboard/stats */
statsRouter.get("/stats", async (req, res) => {
  const result = await dashboardStats(req.user!.id);
  res.json(result);
});
