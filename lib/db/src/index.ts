import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/vyapaarai",
});
export const db = drizzle(pool, { schema });

export * from "./schema";
