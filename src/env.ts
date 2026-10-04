const int = (value: string | undefined, dflt: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : dflt;
};

export const env = {
  port: int(process.env.PORT, 8010),
  // On ox the release is read-only; OX_DATA_DIR is the writable, kept dir.
  databasePath: process.env.DATABASE_PATH ?? `${process.env.OX_DATA_DIR ?? "."}/data/db.sqlite3`,
  sessionSecret:
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === "production"
      ? (() => {
          throw new Error("SESSION_SECRET must be set in production");
        })()
      : "dev-insecure-secret"),
};
