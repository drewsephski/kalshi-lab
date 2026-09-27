import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.ts";

async function main(): Promise<void> {
  const database = createDatabase();
  try {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations", import.meta.url),
      ),
    });
    console.log("Database migrations applied.");
  } finally {
    await database.close();
  }
}
main().catch(() => {
  console.error(
    "Database migration failed; check DATABASE_URL, connectivity, and migration permissions.",
  );
  process.exitCode = 1;
});
