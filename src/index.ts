import "./config/env.js";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { connectDb, isDbConnected } from "./db/connect.js";
import { authRouter } from "./routes/auth.routes.js";
import { certificatesRouter, publicCertificatesRouter } from "./routes/certificates.routes.js";
import { verifyRouter } from "./routes/verify.routes.js";
import { statsRouter } from "./routes/stats.routes.js";
import { errorHandler, notFoundHandler, ApiError } from "./middleware/error.js";

const app = express();

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: isDbConnected() ? "connected" : "disconnected" });
});

/** DB guard — return 503 with a helpful message until MongoDB is connected. */
app.use("/api", (_req, _res, next) => {
  if (!isDbConnected()) {
    next(
      new ApiError(
        503,
        "Database is not connected. Set MONGODB_URI in backend/.env and restart the server.",
      ),
    );
    return;
  }
  next();
});

app.use("/api/auth", authRouter);
// Public routes first so /api/certificates/:id/pdf bypasses auth.
app.use("/api/certificates", publicCertificatesRouter);
app.use("/api/certificates", certificatesRouter);
app.use("/api/verify", verifyRouter);
app.use("/api/dashboard", statsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`[api] KITCHAIN API listening on http://localhost:${env.PORT}`);
  // Keep retrying MongoDB until it connects (e.g. credentials fixed or network
  // access allowed) — the health endpoint flips to "connected" automatically.
  const RETRY_MS = 15_000;
  async function ensureDbConnection(): Promise<void> {
    const ok = await connectDb();
    if (!ok) setTimeout(ensureDbConnection, RETRY_MS);
  }
  void ensureDbConnection();
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
