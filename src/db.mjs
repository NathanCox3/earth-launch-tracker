import postgres from "postgres";
import { createHttpError } from "./http.mjs";

const CLIENT_CACHE = new Map();

export function getSqlClient(connectionString) {
  if (!connectionString) {
    return null;
  }

  if (!CLIENT_CACHE.has(connectionString)) {
    CLIENT_CACHE.set(
      connectionString,
      postgres(connectionString, {
        max: 1,
        idle_timeout: 10,
        connect_timeout: 15,
        prepare: false,
        ssl: "require"
      })
    );
  }

  return CLIENT_CACHE.get(connectionString);
}

export function requireDatabase(sql) {
  if (!sql) {
    throw createHttpError(
      503,
      "DATABASE_URL is not configured yet. Add a managed Postgres connection string before using launch data."
    );
  }

  return sql;
}
