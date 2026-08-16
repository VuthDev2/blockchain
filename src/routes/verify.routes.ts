import { Router } from "express";
import { z } from "zod";
import { verifyCertificate } from "../services/certificates.js";

const certificateIdParam = z.object({
  certificateId: z.string().trim().min(3).max(40),
});

export const verifyRouter = Router();

/** SRS §14 — GET /api/verify/:certificateId (public, no auth) */
verifyRouter.get("/:certificateId", async (req, res) => {
  const { certificateId } = certificateIdParam.parse(req.params);
  const result = await verifyCertificate(certificateId);
  res.json(result);
});
