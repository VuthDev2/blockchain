import { Router } from "express";
import { z } from "zod";
import {
  login,
  getMe,
  signup,
  requestPasswordReset,
  verifyOtp,
  resetPassword,
} from "../services/auth.js";
import { requireAuth } from "../middleware/auth.js";

const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(120),
  organizationName: z.string().trim().min(1, "Organization name is required").max(120),
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(1, "Password is required").max(72),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
});

const verifyOtpSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  otp: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is missing"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

export const authRouter = Router();

/** SRS §14 — POST /api/auth/signup */
authRouter.post("/signup", async (req, res) => {
  const input = signupSchema.parse(req.body);
  const result = await signup(input);
  res.status(201).json(result);
});

/** SRS §14 — POST /api/auth/login */
authRouter.post("/login", async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await login(input);
  res.json(result);
});

/** SRS §14 — POST /api/auth/logout (stateless: the client discards the JWT) */
authRouter.post("/logout", requireAuth, (_req, res) => {
  res.status(204).end();
});

/** SRS §14 — GET /api/auth/me */
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await getMe(req.user!.id);
  res.json({ user });
});

/** POST /api/auth/forgot-password — email a 6-digit verification code. */
authRouter.post("/forgot-password", async (req, res) => {
  const input = forgotPasswordSchema.parse(req.body);
  const result = await requestPasswordReset(input.email);
  res.json(result);
});

/** POST /api/auth/verify-otp — exchange a valid code for a short-lived reset token. */
authRouter.post("/verify-otp", async (req, res) => {
  const input = verifyOtpSchema.parse(req.body);
  const result = await verifyOtp(input.email, input.otp);
  res.json(result);
});

/** POST /api/auth/reset-password — set a new password with a reset token. */
authRouter.post("/reset-password", async (req, res) => {
  const input = resetPasswordSchema.parse(req.body);
  const result = await resetPassword(input.token, input.password);
  res.json(result);
});
