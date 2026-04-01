import path from "node:path";

const DEFAULT_PORT = 3001;
const DEFAULT_API_BASE = "https://ll.thespacedevs.com/2.0.0";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_REQUESTS_PER_HOUR = 15;
const DEFAULT_UPCOMING_STALE_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

export function readEarthLaunchTrackerConfig() {
  const requestIntervalMs = Math.ceil(
    (60 * 60 * 1000) /
      toPositiveNumber(process.env.LAUNCH_SYNC_MAX_REQUESTS_PER_HOUR, DEFAULT_MAX_REQUESTS_PER_HOUR)
  );

  return {
    runtime: {
      port: toPositiveNumber(process.env.LAUNCH_TRACKER_APP_PORT || process.env.PORT, DEFAULT_PORT)
    },
    app: {
      publicDir: path.resolve(process.cwd(), "src/public")
    },
    storage: {
      dataFile: path.resolve(process.cwd(), process.env.LAUNCH_TRACKER_DATA_FILE || ".launch-tracker-data.json")
    },
    db: {
      connectionString: normalizeString(process.env.DATABASE_URL)
    },
    source: {
      apiBase: normalizeString(process.env.LAUNCH_LIBRARY_API_BASE) || DEFAULT_API_BASE,
      pageSize: clamp(toPositiveNumber(process.env.LAUNCH_LIBRARY_PAGE_SIZE, DEFAULT_PAGE_SIZE), 1, 100)
    },
    sync: {
      adminSecret: normalizeString(process.env.LAUNCH_SYNC_SECRET),
      staleMs: toPositiveNumber(process.env.LAUNCH_UPCOMING_STALE_MS, DEFAULT_UPCOMING_STALE_MS),
      lockTtlMs: toPositiveNumber(process.env.LAUNCH_SYNC_LOCK_TTL_MS, DEFAULT_LOCK_TTL_MS),
      requestIntervalMs,
      maxRequestsPerHour: toPositiveNumber(
        process.env.LAUNCH_SYNC_MAX_REQUESTS_PER_HOUR,
        DEFAULT_MAX_REQUESTS_PER_HOUR
      )
    }
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
