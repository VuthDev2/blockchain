export type CertificateStatus = "VALID" | "EXPIRED" | "REVOKED";

/** Status priority: REVOKED > EXPIRED > VALID (FR-14, FR-16). */
export function effectiveStatus(cert: {
  status?: string;
  revokedAt?: Date | string | null;
  expirationDate?: Date | string | null;
}): CertificateStatus {
  if (cert.status === "REVOKED" || cert.revokedAt) return "REVOKED";
  if (cert.expirationDate) {
    const expires = new Date(cert.expirationDate).getTime();
    if (Number.isFinite(expires) && Date.now() > expires) return "EXPIRED";
  }
  return "VALID";
}
