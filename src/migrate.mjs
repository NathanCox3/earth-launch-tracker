import { readEarthLaunchTrackerConfig } from "./config.mjs";
import { getSqlClient, requireDatabase } from "./db.mjs";
import { applyMigrations } from "./migrations.mjs";

const config = readEarthLaunchTrackerConfig();
const sqlClient = getSqlClient(config.db.connectionString);

if (!sqlClient) {
  console.log("No DATABASE_URL configured; skipping SQL migrations because the local file store is active.");
  process.exitCode = 0;
} else {
  const sql = requireDatabase(sqlClient);

  await applyMigrations({
    sql,
    log: (message) => console.log(message)
  });

  console.log("Launch tracker database is ready.");
  await sql.end({ timeout: 5 });
}
