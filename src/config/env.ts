import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Empty string (from a placeholder .env) counts as unset — the server boots
  // and reports a clear message instead of crashing.
  MONGODB_URI: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  // Blockchain (FR-06) — optional. When RPC + private key + contract address are
  // all set, certificates are written to the deployed CertificateRegistry
  // contract; otherwise a deterministic simulation is used so local development
  // works without a wallet or RPC endpoint.
  BLOCKCHAIN_RPC_URL: z
    .preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  BLOCKCHAIN_PRIVATE_KEY: z
    .preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{64}$/,
          "BLOCKCHAIN_PRIVATE_KEY must be a 0x-prefixed 64-char hex private key",
        )
        .optional(),
    ),
  BLOCKCHAIN_CONTRACT_ADDRESS: z
    .preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{40}$/,
          "BLOCKCHAIN_CONTRACT_ADDRESS must be a 0x-prefixed 40-char address",
        )
        .optional(),
    ),
  BLOCKCHAIN_NETWORK_NAME: z.string().default("Ethereum Sepolia"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  // Email (FR-09) — optional: issuance still succeeds when unset.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("KITCHAIN <onboarding@resend.dev>"),
  // Sandbox inbox: while EMAIL_FROM uses @resend.dev (no verified domain), Resend
  // only delivers to this address or manually authorized recipients. Certificate
  // emails are routed here so issuance never fails with a 422.
  EMAIL_TEST_INBOX: z.string().default("onboarding@resend.dev"),
  // Public base URL of this API, used to build the PDF download link in emails.
  PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The server should still boot so the health check can report the problem,
  // but we surface the missing variables loudly.
  console.error("[env] Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
