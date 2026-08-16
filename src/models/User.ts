import { Schema, model, type InferSchemaType, type Model } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 255,
    },
    passwordHash: { type: String, required: true },
    organizationName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      default: "My Organization",
    },
    role: { type: String, enum: ["organization"], default: "organization" },
    // Password-reset OTP — hashed, expiring, attempt-limited.
    otpHash: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpLastRequestedAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.otpHash;
        delete ret.otpExpiresAt;
        delete ret.otpLastRequestedAt;
        delete ret.otpAttempts;
        return ret;
      },
    },
  },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User: Model<UserDoc> = model<UserDoc>("User", userSchema);
