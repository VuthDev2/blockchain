import mongoose from "mongoose";

let connecting: Promise<boolean> | null = null;

/**
 * Connect to MongoDB. If MONGODB_URI is not configured yet, the server still
 * boots and serves /api/health, but database routes return 503 with a clear
 * message pointing at the missing variable.
 */
export function connectDb(): Promise<boolean> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(true);

  if (!connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error(
        "[db] MONGODB_URI is not set. Add it to backend/.env (see .env.example) — " +
          "e.g. mongodb+srv://<user>:<password>@<cluster>.mongodb.net/kitchain",
      );
      connecting = Promise.resolve(false);
      return connecting;
    }

    connecting = mongoose
      .connect(uri)
      .then(() => {
        console.log("[db] Connected to MongoDB");
        return true;
      })
      .catch((error) => {
        console.error(
          "[db] MongoDB connection failed:",
          error instanceof Error ? error.message : error,
        );
        connecting = null; // allow retrying on the next request
        return false;
      });
  }

  return connecting;
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
