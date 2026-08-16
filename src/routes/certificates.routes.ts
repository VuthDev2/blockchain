import { Router } from "express";
import { z } from "zod";
import {
  createCertificate,
  getCertificate,
  getCertificatePdf,
  listCertificates,
  revokeCertificate,
  updateCertificate,
} from "../services/certificates.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError } from "../middleware/error.js";

export const createCertificateSchema = z.object({
  recipientName: z.string().trim().min(2, "Recipient name is required").max(120),
  recipientEmail: z.string().trim().email("Enter a valid email address").max(255),
  certificateTitle: z.string().trim().min(2, "Certificate title is required").max(160),
  course: z.string().trim().min(2, "Course or program name is required").max(160),
  description: z.string().trim().max(1000).optional().default(""),
  grade: z.string().trim().max(40).optional().default(""),
  instructorName: z.string().trim().max(120).optional().default(""),
  department: z.string().trim().max(120).optional().default(""),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Issue date is required"),
  expirationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  origin: z.string().trim().url().max(300),
});

export const revokeSchema = z.object({
  certificateId: z.string().trim().min(3).max(40),
  reason: z.string().trim().max(300).optional().default(""),
});

export const updateCertificateSchema = z.object({
  recipientName: z.string().trim().min(2, "Recipient name is required").max(120).optional(),
  recipientEmail: z.string().trim().email("Enter a valid email address").max(255).optional(),
  certificateTitle: z.string().trim().min(2, "Certificate title is required").max(160).optional(),
  course: z.string().trim().min(2, "Course or program name is required").max(160).optional(),
  description: z.string().trim().max(1000).optional(),
  grade: z.string().trim().max(40).optional().or(z.literal("")),
  instructorName: z.string().trim().max(120).optional().or(z.literal("")),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  expirationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
});

const certificateIdParam = z.object({
  certificateId: z.string().trim().min(3).max(40),
});

export const certificatesRouter = Router();

/**
 * Public certificate routes — mounted BEFORE the authenticated router so emailed
 * download links work without a session (same data the public verify page shows).
 */
export const publicCertificatesRouter = Router();

/** SRS §14 (optional) — GET /api/certificates/:certificateId/pdf */
publicCertificatesRouter.get("/:certificateId/pdf", async (req, res) => {
  const { certificateId } = certificateIdParam.parse(req.params);
  const { filename, buffer } = await getCertificatePdf(certificateId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

certificatesRouter.use(requireAuth);

/** SRS §14 — POST /api/certificates */
certificatesRouter.post("/", async (req, res) => {
  const input = createCertificateSchema.parse(req.body);
  if (input.expirationDate && input.expirationDate < input.issueDate) {
    throw new ApiError(400, "Expiration date must be after the issue date.");
  }
  const cert = await createCertificate(input, req.user!.id);
  res.status(201).json(cert);
});

/** SRS §14 — GET /api/certificates?search=&status= */
certificatesRouter.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await listCertificates({ search, status, userId: req.user!.id });
  res.json(rows);
});

/** SRS §14 — GET /api/certificates/:certificateId */
certificatesRouter.get("/:certificateId", async (req, res) => {
  const { certificateId } = certificateIdParam.parse(req.params);
  const cert = await getCertificate(certificateId, req.user!.id);
  res.json(cert);
});

/** SRS §14 — PATCH /api/certificates/:certificateId */
certificatesRouter.patch("/:certificateId", async (req, res) => {
  const { certificateId } = certificateIdParam.parse(req.params);
  const input = updateCertificateSchema.parse(req.body ?? {});
  const cert = await updateCertificate(certificateId, input, req.user!.id);
  res.json(cert);
});

/** SRS §14 — POST /api/certificates/:certificateId/revoke */
certificatesRouter.post("/:certificateId/revoke", async (req, res) => {
  const { certificateId } = certificateIdParam.parse(req.params);
  const input = revokeSchema.parse({ certificateId, reason: req.body?.reason ?? "" });
  const cert = await revokeCertificate(input, req.user!.id);
  res.json(cert);
});
