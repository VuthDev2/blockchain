import { env } from "../config/env.js";
import { Certificate } from "../models/Certificate.js";
import { nextCertificateId } from "../models/Counter.js";
import { User, type UserDoc } from "../models/User.js";
import { effectiveStatus, type CertificateStatus } from "../lib/status.js";
import { ApiError } from "../middleware/error.js";
import { isEmailConfigured, sendCertificateEmail } from "./email.js";
import { buildCertificatePdf } from "./certificate-pdf.js";
import {
  certificateHash,
  explorerUrl,
  getOnChainRecord,
  issuerAddress,
  submitIssueTransaction,
  submitRevokeTransaction,
  BLOCKCHAIN_NETWORK,
} from "./blockchain.js";

/** Convert a date-only string to a unix timestamp (end of that UTC day). */
function expirationToUnixSeconds(expirationDate: string): number {
  return Math.floor(new Date(`${expirationDate}T23:59:59Z`).getTime() / 1000);
}

export function normalizeCertificateId(value: string): string {
  return value.trim().toUpperCase();
}

const POPULATE_ISSUER = { path: "issuedBy", select: "name email organizationName" };

export async function createCertificate(
  input: {
    recipientName: string;
    recipientEmail: string;
    certificateTitle: string;
    course: string;
    description?: string;
    grade?: string;
    instructorName?: string;
    department?: string;
    issueDate: string;
    expirationDate?: string;
    origin: string;
  },
  userId: string,
): Promise<unknown> {
  const user = (await User.findById(userId)) as (UserDoc & { _id: unknown }) | null;
  if (!user) throw new ApiError(401, "Account no longer exists.");

  const certificateId = await nextCertificateId();
  const expirationDate = input.expirationDate ? input.expirationDate : null;

  // FR-05 — canonical hash before anything is persisted.
  const hash = await certificateHash({
    certificateId,
    recipientName: input.recipientName,
    certificateTitle: input.certificateTitle,
    course: input.course,
    issueDate: input.issueDate,
    expirationDate,
  });

  const issuer = await issuerAddress(String(user._id));

  // FR-06 — record on the chain first. NFR-04: on failure we do NOT save a
  // certificate that looks blockchain-verified.
  let receipt;
  try {
    receipt = await submitIssueTransaction({
      certificateId,
      hash,
      issuer,
      expiresAt: expirationDate ? expirationToUnixSeconds(expirationDate) : 0,
    });
  } catch {
    throw new ApiError(502, "Unable to record certificate on the blockchain. Please try again.");
  }

  const verificationUrl = `${input.origin.replace(/\/$/, "")}/verify/${certificateId}`;

  const doc = await Certificate.create({
    certificateId,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail.toLowerCase(),
    certificateTitle: input.certificateTitle,
    course: input.course,
    description: input.description ?? "",
    grade: input.grade || null,
    instructorName: input.instructorName || null,
    department: input.department || null,
    organizationName: user.organizationName,
    issueDate: input.issueDate,
    expirationDate: expirationDate ?? undefined,
    certificateHash: hash,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    issuerAddress: receipt.issuerAddress,
    blockchainNetwork: receipt.network,
    status: "VALID",
    verificationUrl,
    issuedBy: user._id,
  });

  // FR-09 — notify the recipient. Failures never block issuance (NFR-04);
  // without RESEND_API_KEY the email is skipped and the flow proceeds.
  if (isEmailConfigured()) {
    try {
      await sendCertificateEmail({
        recipientName: doc.recipientName,
        recipientEmail: doc.recipientEmail,
        certificateTitle: doc.certificateTitle,
        course: doc.course,
        certificateId: doc.certificateId,
        verificationUrl,
        pdfUrl: `${env.PUBLIC_API_URL}/api/certificates/${encodeURIComponent(doc.certificateId)}/pdf`,
      });
      doc.emailSentAt = new Date();
      await doc.save();
    } catch (error) {
      console.error(
        "[email] Failed to send certificate email:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const populated = await doc.populate(POPULATE_ISSUER);
  return withEffectiveStatus(populated);
}

/** FR-07 — server-generated certificate PDF (also used as the email download link). */
export async function getCertificatePdf(certificateId: string): Promise<{
  filename: string;
  buffer: Buffer;
}> {
  const normalized = normalizeCertificateId(certificateId);
  const doc = await Certificate.findOne({ certificateId: normalized });
  if (!doc) throw new ApiError(404, "Certificate not found. Please check the Certificate ID.");

  const buffer = buildCertificatePdf({
    certificateId: doc.certificateId,
    recipientName: doc.recipientName,
    certificateTitle: doc.certificateTitle,
    course: doc.course,
    organizationName: doc.organizationName,
    issueDate: dateOnly(doc.issueDate),
    expirationDate: doc.expirationDate ? dateOnly(doc.expirationDate) : null,
    description: doc.description || null,
    grade: doc.grade ?? null,
    instructorName: doc.instructorName ?? null,
    transactionHash: doc.transactionHash ?? null,
    verificationUrl: doc.verificationUrl,
  });
  return { filename: `${doc.certificateId}.pdf`, buffer };
}

/** FR-10 — list with optional search (ID / recipient name / email). */
export async function listCertificates(input: { search?: string; status?: string; userId: string }) {
  // Organization portal data is private to the signed-in issuer.
  const query = Certificate.find({ issuedBy: input.userId }).sort({ createdAt: -1 }).limit(500);

  const search = input.search?.trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    query.or([{ certificateId: regex }, { recipientName: regex }, { recipientEmail: regex }]);
  }

  const rows = await query.populate(POPULATE_ISSUER);

  let result = rows.map(withEffectiveStatus);
  if (input.status && input.status !== "ALL") {
    result = result.filter((r) => r.status === input.status);
  }
  return result;
}

export async function getCertificate(certificateId: string, userId: string) {
  const doc = await Certificate.findOne({
    certificateId: normalizeCertificateId(certificateId),
    issuedBy: userId,
  }).populate(POPULATE_ISSUER);
  if (!doc) throw new ApiError(404, "Certificate not found. Please check the Certificate ID.");
  return withEffectiveStatus(doc);
}

/** SRS §14 — PATCH: amend non-hashed presentation metadata only. */
export async function updateCertificate(
  certificateId: string,
  input: {
    recipientName?: string;
    recipientEmail?: string;
    certificateTitle?: string;
    course?: string;
    description?: string;
    grade?: string;
    instructorName?: string;
    department?: string;
    issueDate?: string;
    expirationDate?: string;
  },
  userId: string,
) {
  const normalized = normalizeCertificateId(certificateId);
  const doc = await Certificate.findOne({ certificateId: normalized });
  if (!doc) throw new ApiError(404, "Certificate not found. Please check the Certificate ID.");
  if (String(doc.issuedBy) !== userId) {
    throw new ApiError(404, "Certificate not found. Please check the Certificate ID.");
  }
  if (doc.status === "REVOKED") {
    throw new ApiError(409, "Revoked certificates cannot be edited.");
  }

  const toCompare = (field: "issueDate" | "expirationDate") =>
    doc[field] ? dateOnly(doc[field] as Date) : "";
  const hashChanged =
    (input.recipientName !== undefined && input.recipientName.trim() !== doc.recipientName) ||
    (input.certificateTitle !== undefined &&
      input.certificateTitle.trim() !== doc.certificateTitle) ||
    (input.course !== undefined && input.course.trim() !== doc.course) ||
    (input.issueDate !== undefined && input.issueDate !== toCompare("issueDate")) ||
    (input.expirationDate !== undefined &&
      (input.expirationDate || "") !== toCompare("expirationDate"));

  if (hashChanged) {
    // The deployed registry deliberately makes an issued certificate immutable.
    // Reusing its ID with another hash would fail on-chain and weaken verification.
    throw new ApiError(
      409,
      "Blockchain-protected certificate details cannot be changed. Issue a replacement certificate instead.",
    );
  }

  if (input.recipientName !== undefined) doc.recipientName = input.recipientName;
  if (input.recipientEmail !== undefined) doc.recipientEmail = input.recipientEmail.toLowerCase();
  if (input.certificateTitle !== undefined) doc.certificateTitle = input.certificateTitle;
  if (input.course !== undefined) doc.course = input.course;
  if (input.description !== undefined) doc.description = input.description;
  if (input.grade !== undefined) doc.grade = input.grade || null;
  if (input.instructorName !== undefined) doc.instructorName = input.instructorName || null;
  if (input.department !== undefined) doc.department = input.department || null;
  if (input.issueDate !== undefined) doc.issueDate = new Date(input.issueDate);
  if (input.expirationDate !== undefined) {
    doc.expirationDate = input.expirationDate ? new Date(input.expirationDate) : null;
  }

  await doc.save();
  return withEffectiveStatus(await doc.populate(POPULATE_ISSUER));
}

export async function revokeCertificate(
  input: { certificateId: string; reason?: string },
  userId: string,
) {
  const certificateId = normalizeCertificateId(input.certificateId);
  const doc = await Certificate.findOne({ certificateId });
  if (!doc) throw new ApiError(404, "Certificate not found. Please check the Certificate ID.");
  if (String(doc.issuedBy) !== userId) {
    throw new ApiError(404, "Certificate not found. Please check the Certificate ID.");
  }
  if (doc.status === "REVOKED") {
    throw new ApiError(409, "This certificate has already been revoked.");
  }

  const issuer = await issuerAddress(userId);
  try {
    await submitRevokeTransaction({ certificateId, reason: input.reason ?? "", issuer });
  } catch {
    throw new ApiError(502, "Unable to record the revocation on the blockchain. Please try again.");
  }

  doc.status = "REVOKED";
  doc.revokedAt = new Date();
  doc.revocationReason = input.reason?.trim() || "No reason provided";
  await doc.save();
  return withEffectiveStatus(await doc.populate(POPULATE_ISSUER));
}

/** FR-02 — dashboard statistics (total / valid / expired / revoked + recent). */
export async function dashboardStats(userId: string) {
  const rows = await Certificate.find({ issuedBy: userId }).sort({ createdAt: -1 }).limit(1000);
  const counts = { total: rows.length, valid: 0, expired: 0, revoked: 0 };
  for (const row of rows) {
    const status = effectiveStatus(row);
    if (status === "VALID") counts.valid += 1;
    else if (status === "EXPIRED") counts.expired += 1;
    else counts.revoked += 1;
  }
  const recent = rows.slice(0, 6).map((doc) => withEffectiveStatus(doc));
  return { counts, recent };
}

/**
 * FR-12 / FR-13 / FR-18 — public verification, no authentication required.
 * Recomputes the SHA-256 hash from stored data and compares it with the
 * on-chain record to detect tampering.
 */
export async function verifyCertificate(certificateId: string) {
  const normalized = normalizeCertificateId(certificateId);
  const doc = await Certificate.findOne({ certificateId: normalized });
  if (!doc) return { found: false as const, certificateId: normalized };

  const cert = {
    certificateId: doc.certificateId,
    recipientName: doc.recipientName ?? "",
    certificateTitle: doc.certificateTitle ?? "",
    course: doc.course ?? "",
    issueDate: doc.issueDate instanceof Date ? dateOnly(doc.issueDate) : String(doc.issueDate),
    expirationDate: doc.expirationDate ? dateOnly(doc.expirationDate) : null,
  };
  const recomputed = await certificateHash(cert);
  const hashMatches = recomputed === doc.certificateHash;

  // Read the record back from the deployed contract (when configured) so the
  // verification reflects the chain itself, not just the local database.
  const onChain = await getOnChainRecord(normalized);
  const onChainResult = onChain
    ? {
        checked: true,
        exists: onChain.exists,
        hashMatches:
          onChain.exists &&
          onChain.certificateHash !== null &&
          onChain.certificateHash.toLowerCase() === `0x${doc.certificateHash}`.toLowerCase(),
        revoked: onChain.exists ? onChain.revoked : false,
        issuer: onChain.issuer,
      }
    : {
        checked: false,
        exists: false,
        hashMatches: false,
        revoked: false,
        issuer: null,
      };

  return {
    found: true as const,
    hashMatches,
    computedHash: recomputed,
    onChain: onChainResult,
    status: effectiveStatus(doc),
    explorer: explorerUrl(doc.transactionHash),
    network: doc.blockchainNetwork ?? BLOCKCHAIN_NETWORK,
    certificate: {
      certificateId: doc.certificateId,
      recipientName: doc.recipientName,
      recipientEmail: doc.recipientEmail,
      certificateTitle: doc.certificateTitle,
      course: doc.course,
      description: doc.description || null,
      grade: doc.grade ?? null,
      organizationName: doc.organizationName,
      issueDate: dateOnly(doc.issueDate),
      expirationDate: doc.expirationDate ? dateOnly(doc.expirationDate) : null,
      certificateHash: doc.certificateHash,
      transactionHash: doc.transactionHash ?? null,
      blockNumber: doc.blockNumber ?? null,
      issuerAddress: doc.issuerAddress ?? null,
      blockchainNetwork: doc.blockchainNetwork,
      status: effectiveStatus(doc),
      revokedAt: doc.revokedAt?.toISOString() ?? null,
      revocationReason: doc.revocationReason ?? null,
      createdAt: doc.createdAt?.toISOString() ?? "",
    },
  };
}

function dateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Serialize a document and overwrite status with the computed effective status. */
function withEffectiveStatus(doc: {
  toJSON(options?: unknown): unknown;
  status?: string;
  revokedAt?: Date | null;
  expirationDate?: Date | null;
}): Record<string, unknown> & { status: CertificateStatus } {
  const json = doc.toJSON() as Record<string, unknown> & {
    status?: string;
    revokedAt?: Date | string | null;
    expirationDate?: Date | string | null;
  };
  json.status = effectiveStatus(json as never);
  return json as never;
}
