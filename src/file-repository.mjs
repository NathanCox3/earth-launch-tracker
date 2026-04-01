import { promises as fs } from "node:fs";
import path from "node:path";
import { createHttpError } from "./http.mjs";
import { getFilterCountryLabel, mapLaunchRecord } from "./normalize.mjs";

const LOCK_KEY = "sync_lock";
const UPCOMING_META_KEY = "upcoming_sync_meta";

export function createFileLaunchRepository({ dataFile, now = () => new Date() }) {
  return {
    listLaunches,
    listFilters,
    upsertLaunchBatch,
    getSyncState,
    setSyncState,
    clearSyncState,
    acquireSyncLock,
    releaseSyncLock
  };

  async function listLaunches({
    timeline = "upcoming",
    page = 1,
    pageSize = 24,
    organizationId = "",
    countryCode = "",
    locationId = ""
  } = {}) {
    const data = await loadData();
    const nowAt = now();
    const launches = data.launches
      .filter((launch) => (timeline === "upcoming" ? Date.parse(launch.net) >= nowAt.getTime() : Date.parse(launch.net) < nowAt.getTime()))
      .filter((launch) => (organizationId ? launch.organization?.sourceId === organizationId : true))
      .filter((launch) => (countryCode ? normalizeText(launch.launchCountryCode).toUpperCase() === countryCode.toUpperCase() : true))
      .filter((launch) => (locationId ? launch.location?.sourceId === locationId : true))
      .sort((left, right) => {
        const leftTime = Date.parse(left.net);
        const rightTime = Date.parse(right.net);
        return timeline === "upcoming" ? leftTime - rightTime : rightTime - leftTime;
      });

    const totalResults = launches.length;
    const totalPages = totalResults ? Math.ceil(totalResults / pageSize) : 1;
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * pageSize;
    const items = launches.slice(start, start + pageSize).map((launch) => mapLaunchRecord(launch, nowAt));
    const upcomingMeta = data.sync_state[UPCOMING_META_KEY] || null;

    return {
      items,
      page: safePage,
      pageSize,
      totalResults,
      totalPages,
      lastUpcomingSyncAt: upcomingMeta?.lastCompletedAt || null
    };
  }

  async function listFilters() {
    const data = await loadData();
    const organizations = new Map();
    const countries = new Map();
    const locations = new Map();
    let totalLaunches = 0;
    let upcomingLaunches = 0;
    let pastLaunches = 0;
    const nowMs = now().getTime();

    for (const launch of data.launches) {
      totalLaunches += 1;
      if (Date.parse(launch.net) >= nowMs) {
        upcomingLaunches += 1;
      } else {
        pastLaunches += 1;
      }

      if (launch.organization?.sourceId) {
        organizations.set(launch.organization.sourceId, {
          id: launch.organization.sourceId,
          name: launch.organization.name,
          abbrev: launch.organization.abbrev
        });
      }

      if (launch.launchCountryCode) {
        countries.set(launch.launchCountryCode, {
          code: launch.launchCountryCode,
          name: getFilterCountryLabel(launch.launchCountryCode, launch.launchCountryName)
        });
      }

      if (launch.location?.sourceId) {
        locations.set(launch.location.sourceId, {
          id: launch.location.sourceId,
          name: launch.location.name
        });
      }
    }

    return {
      organizations: [...organizations.values()].sort((a, b) => a.name.localeCompare(b.name)),
      countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
      locations: [...locations.values()].sort((a, b) => a.name.localeCompare(b.name)),
      totals: {
        launches: totalLaunches,
        upcoming: upcomingLaunches,
        past: pastLaunches
      }
    };
  }

  async function upsertLaunchBatch(launches) {
    if (!Array.isArray(launches) || launches.length === 0) {
      return { inserted: 0 };
    }

    const data = await loadData();
    const current = new Map(data.launches.map((launch) => [launch.sourceId, launch]));

    for (const launch of launches) {
      current.set(launch.sourceId, {
        ...launch,
        organization: launch.organization ? { ...launch.organization } : null,
        location: launch.location ? { ...launch.location } : null,
        pad: launch.pad ? { ...launch.pad } : null,
        videos: Array.isArray(launch.videos) ? launch.videos.map((video) => ({ ...video })) : [],
        primaryStream: launch.primaryStream ? { ...launch.primaryStream } : null
      });
    }

    data.launches = [...current.values()];
    await saveData(data);
    return { inserted: launches.length };
  }

  async function getSyncState(key) {
    const data = await loadData();
    return data.sync_state[key] || null;
  }

  async function setSyncState(key, value) {
    const data = await loadData();
    data.sync_state[key] = value;
    await saveData(data);
  }

  async function clearSyncState(key) {
    const data = await loadData();
    delete data.sync_state[key];
    await saveData(data);
  }

  async function acquireSyncLock({ mode, owner, ttlMs }) {
    const data = await loadData();
    const current = data.sync_state[LOCK_KEY];
    const currentExpiresAt = current?.expiresAt ? Date.parse(current.expiresAt) : 0;
    if (current && currentExpiresAt > now().getTime()) {
      throw Object.assign(createHttpError(409, "A launch sync is already in progress."), {
        code: "sync_locked",
        current
      });
    }

    const value = {
      mode,
      owner,
      expiresAt: new Date(now().getTime() + ttlMs).toISOString()
    };
    data.sync_state[LOCK_KEY] = value;
    await saveData(data);
    return value;
  }

  async function releaseSyncLock(owner) {
    const data = await loadData();
    if (data.sync_state[LOCK_KEY]?.owner === owner) {
      delete data.sync_state[LOCK_KEY];
      await saveData(data);
    }
  }

  async function loadData() {
    try {
      const text = await fs.readFile(dataFile, "utf8");
      const parsed = JSON.parse(text);
      return normalizeData(parsed);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          launches: [],
          sync_state: {}
        };
      }

      throw error;
    }
  }

  async function saveData(data) {
    const normalized = normalizeData(data);
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    const tempFile = `${dataFile}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, dataFile);
  }
}

function normalizeData(data) {
  return {
    launches: Array.isArray(data?.launches) ? data.launches : [],
    sync_state: typeof data?.sync_state === "object" && data.sync_state ? data.sync_state : {}
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
