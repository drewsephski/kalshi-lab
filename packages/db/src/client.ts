import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function createDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  const client = postgres(databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ...(url.hostname.endsWith(".neon.tech") ? { ssl: "require" as const } : {}),
    connection: { statement_timeout: 15_000 },
    onnotice: () => {},
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
