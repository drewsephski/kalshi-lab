import type { createDatabase } from "@kalshi-lab/db";
export type ReturnTypeDatabase = ReturnType<typeof createDatabase>["db"];
