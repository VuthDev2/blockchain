import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User, type UserDoc } from "../models/User.js";
import { ApiError } from "../middleware/error.js";
import { isEmailConfigured, sendOtpEmail, sendWelcomeEmail } from "./email.js";

const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000; // codes expire after 10 minutes
const OTP_MAX_ATTEMPTS = 5; // lock a code after 5 wrong guesses
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000; // at most one code per minute per account
const OTP_RESET_TOKEN_TTL = "15m";

/** Cryptographically random 6-digit code. */
function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  organizationName: string;
  role: string;
}

function toAuthUser(user: UserDoc & { _id: unknown }): AuthUser {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    organizationName: user.organizationName,
    role: user.role,
  };
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export async function signup(input: {
  name: string;
  organizationName: string;
  email: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, "An account with this email already exists.");
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    name: input.name,
    organizationName: input.organizationName,
    email: input.email.toLowerCase(),
    passwordHash,
    role: "organization",
  });
  const authUser = toAuthUser(user);

  // Welcome email — best-effort only: signup must succeed even if email fails
  // (NFR pattern: without RESEND_API_KEY it's skipped entirely).
  if (isEmailConfigured()) {
    try {
      await sendWelcomeEmail({
        email: user.email,
        name: user.name,
        organizationName: user.organizationName,
      });
    } catch (error) {
      console.error(
        "[email] Failed to send welcome email:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { token: signToken(authUser), user: authUser };
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ token: string; user: AuthUser }> {
  const user = await User.findOne({ email: input.email.toLowerCase() });
  if (!user) throw new ApiError(401, "Invalid email or password.");
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new ApiError(401, "Invalid email or password.");
  const authUser = toAuthUser(user);
  return { token: signToken(authUser), user: authUser };
}

export async function getMe(userId: string): Promise<AuthUser> {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(401, "Account no longer exists.");
  return toAuthUser(user);
}

/**
 * Start a password reset: email a 6-digit OTP. Never reveals whether an account
 * exists. When email is not configured outside production, the code is returned
 * as devOtp so the flow stays testable locally — production deployments must
 * set RESEND_API_KEY (devOtp is never returned there).
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ message: string; devOtp?: string }> {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return { message: "If an account exists for that email, a verification code has been sent." };
  }

  // Cooldown: don't let anyone trigger a flood of OTP emails to a single account.
  if (
    user.otpLastRequestedAt &&
    Date.now() - user.otpLastRequestedAt.getTime() < OTP_REQUEST_COOLDOWN_MS
  ) {
    throw new ApiError(429, "Please wait a moment before requesting another code.");
  }

  const otp = generateOtp();
  user.otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.otpLastRequestedAt = new Date();
  user.otpAttempts = 0;
  await user.save();

  let devOtp: string | undefined;
  if (isEmailConfigured()) {
    await sendOtpEmail(user.email, otp);
  } else if (env.NODE_ENV !== "production") {
    // No email service in dev — surface the code so the flow stays testable.
    // Never returned in production: that would be an account-takeover vector.
    devOtp = otp;
    console.warn(`[auth] Email not configured — OTP for ${user.email} (dev only): ${otp}`);
  }

  return {
    message: "If an account exists for that email, a verification code has been sent.",
    devOtp,
  };
}

/** Verify the emailed code and return a short-lived password-reset token. */
export async function verifyOtp(
  email: string,
  otp: string,
): Promise<{ token: string; email: string }> {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !user.otpHash || !user.otpExpiresAt) {
    throw new ApiError(400, "Verification code is invalid or expired. Request a new one.");
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "This code has expired. Request a new one.");
  }
  if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many incorrect attempts. Request a new code.");
  }

  const ok = await bcrypt.compare(otp, user.otpHash);
  if (!ok) {
    user.otpAttempts += 1;
    await user.save();
    const remaining = OTP_MAX_ATTEMPTS - user.otpAttempts;
    throw new ApiError(
      400,
      remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`
        : "Too many incorrect attempts. Request a new code.",
    );
  }

  user.otpHash = null;
  user.otpExpiresAt = null;
  user.otpAttempts = 0;
  await user.save();

  const token = jwt.sign({ sub: String(user._id), purpose: "password-reset" }, env.JWT_SECRET, {
    expiresIn: OTP_RESET_TOKEN_TTL,
  });
  return { token, email: user.email };
}

/** Set a new password using a reset token minted by verifyOtp. */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ message: string }> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw new ApiError(400, "This reset link is invalid or has expired. Request a new code.");
  }
  if (payload.purpose !== "password-reset" || !payload.sub) {
    throw new ApiError(400, "This reset link is invalid or has expired. Request a new code.");
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new ApiError(400, "This reset link is invalid or has expired. Request a new code.");
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.otpHash = null;
  user.otpExpiresAt = null;
  user.otpAttempts = 0;
  await user.save();

  return { message: "Your password has been updated. Sign in with your new password." };
}
