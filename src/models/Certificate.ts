import { Schema, model, type InferSchemaType, type Model } from "mongoose";

const certificateSchema = new Schema(
  {
    certificateId: { type: String, required: true, unique: true, trim: true },
    recipientName: { type: String, required: true, trim: true, maxlength: 120 },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    certificateTitle: { type: String, required: true, trim: true, maxlength: 160 },
    course: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 1000 },
    grade: { type: String, default: null, maxlength: 40 },
    instructorName: { type: String, default: null, maxlength: 120 },
    department: { type: String, default: null, maxlength: 120 },
    organizationName: { type: String, required: true, default: "My Organization" },
    issueDate: { type: Date, required: true },
    expirationDate: { type: Date, default: null },
    certificateHash: { type: String, required: true },
    transactionHash: { type: String, default: null },
    blockNumber: { type: Number, default: null },
    issuerAddress: { type: String, default: null },
    blockchainNetwork: { type: String, default: "Ethereum Sepolia (simulated)" },
    status: { type: String, enum: ["VALID", "REVOKED"], default: "VALID" },
    pdfUrl: { type: String, default: null },
    verificationUrl: { type: String, default: "" },
    revokedAt: { type: Date, default: null },
    revocationReason: { type: String, default: null },
    emailSentAt: { type: Date, default: null },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.issuedBy;
        if (ret.issueDate instanceof Date) ret.issueDate = toDateOnly(ret.issueDate);
        if (ret.expirationDate instanceof Date) ret.expirationDate = toDateOnly(ret.expirationDate);
        if (ret.revokedAt instanceof Date) ret.revokedAt = ret.revokedAt.toISOString();
        if (ret.emailSentAt instanceof Date) ret.emailSentAt = ret.emailSentAt.toISOString();
        if (ret.createdAt instanceof Date) ret.createdAt = ret.createdAt.toISOString();
        if (ret.updatedAt instanceof Date) ret.updatedAt = ret.updatedAt.toISOString();
        return ret;
      },
    },
  },
);

certificateSchema.index({ recipientEmail: 1 });
certificateSchema.index({ recipientName: 1 });
certificateSchema.index({ createdAt: -1 });

/** NFR-02 / SRS §10 — date-only values keep the frontend parsing logic intact. */
function toDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type CertificateDoc = InferSchemaType<typeof certificateSchema>;

export const Certificate: Model<CertificateDoc> = model<CertificateDoc>(
  "Certificate",
  certificateSchema,
);
