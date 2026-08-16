import { Schema, model, type InferSchemaType, type Model } from "mongoose";

/**
 * Atomic sequence for Certificate IDs (SRS FR-04). Each document tracks the
 * serial for one year, so CERT-2026-00001 resets when the year rolls over.
 */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  year: { type: Number, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export type CounterDoc = InferSchemaType<typeof counterSchema>;

export const Counter: Model<CounterDoc> = model<CounterDoc>("Counter", counterSchema);

export async function nextCertificateId(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const result = await Counter.findOneAndUpdate(
    { _id: "certificateSerial", year },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const serial = (result?.seq ?? 1).toString().padStart(5, "0");
  return `CERT-${year}-${serial}`;
}
