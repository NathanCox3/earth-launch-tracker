import { getSqlClient } from "./db.mjs";
import { readEarthLaunchTrackerConfig } from "./config.mjs";
import { createLaunchRepository } from "./repository.mjs";
import { createFileLaunchRepository } from "./file-repository.mjs";
import { createLaunchSyncService } from "./sync.mjs";
import { createEarthLaunchTrackerApp } from "./app.mjs";

export function createEarthLaunchTrackerRuntime(config = readEarthLaunchTrackerConfig()) {
  const sql = getSqlClient(config.db.connectionString);
  const repository = sql
    ? createLaunchRepository({ sql })
    : createFileLaunchRepository({ dataFile: config.storage.dataFile });
  const syncService = createLaunchSyncService({ config, repository });
  const app = createEarthLaunchTrackerApp({
    config,
    repository,
    syncService
  });

  return {
    config,
    sql,
    repository,
    syncService,
    app
  };
}
