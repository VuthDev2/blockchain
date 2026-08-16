import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "./error.js";
import type { AuthUser } from "../services/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** JWT bearer-token guard for protected API routes. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header) return next(new ApiError(401, "Unauthorized: No authorization header provided"));
  if (!header.startsWith("Bearer ")) {
    return next(new ApiError(401, "Unauthorized: Only Bearer tokens are supported"));
  }
  const token = header.replace("Bearer ", "");
  if (!token) return next(new ApiError(401, "Unauthorized: No token provided"));

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser & { purpose?: string };
    // Password-reset tokens share the signing secret but must never authenticate
    // API requests — they carry no user id and a distinct purpose claim.
    if (payload.purpose === "password-reset" || !payload.id) {
      return next(new ApiError(401, "Unauthorized: Invalid token"));
    }
    req.user = payload;
    next();
  } catch {
    next(new ApiError(401, "Unauthorized: Invalid or expired token"));
  }
}
