import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let instance: ReturnType<typeof create> | undefined;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(url, { schema });
}

/** Lazily created so builds don't need database credentials. */
export function db() {
  return (instance ??= create());
}

export * from "./schema";
