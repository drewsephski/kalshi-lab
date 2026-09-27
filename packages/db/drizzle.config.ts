import { defineConfig } from "drizzle-kit";

// Generation needs no credentials. Migration uses the explicit runtime below.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
