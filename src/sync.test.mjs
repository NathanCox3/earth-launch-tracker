import test from "node:test";
import assert from "node:assert/strict";
import { createLaunchSyncService } from "./sync.mjs";

function buildConfig(overrides = {}) {
  return {
    source: {
      apiBase: "https://example.test",
      pageSize: 100
    },
    sync: {
      staleMs: 15 * 60 * 1000,
      lockTtlMs: 10 * 60 * 1000,
      requestIntervalMs: 0,
      maxRequestsPerHour: 15
    },
    ...overrides
  };
}

function buildRepository() {
  const state = new Map();
  const launches = [];
  let lock = null;

  return {
    launches,
    state,
    async getSyncState(key) {
      return state.get(key) || null;
    },
    async setSyncState(key, value) {
      state.set(key, value);
    },
    async upsertLaunchBatch(items) {
      launches.push(...items);
      return { inserted: items.length };
    },
    async acquireSyncLock({ mode, owner, ttlMs }) {
      const now = Date.now();
      if (lock && Date.parse(lock.expiresAt) > now) {
        const error = new Error("locked");
        error.code = "sync_locked";
        throw error;
      }

      lock = {
        mode,
        owner,
        expiresAt: new Date(now + ttlMs).toISOString()
      };
      return lock;
    },
    async releaseSyncLock(owner) {
      if (lock?.owner === owner) {
        lock = null;
      }
    }
  };
}

function buildResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

function buildRawLaunch(id) {
  return {
    id,
    slug: `launch-${id}`,
    name: `Launch ${id}`,
    status: { name: "Go", abbrev: "Go" },
    net: "2026-04-02T18:30:00Z",
    window_start: "2026-04-02T18:30:00Z",
    window_end: "2026-04-02T18:45:00Z",
    net_precision: { abbrev: "MIN" },
    mission: {
      orbit: {
        name: "Low Earth Orbit",
        abbrev: "LEO",
        celestial_body: { name: "Earth" }
      }
    },
    launch_service_provider: {
      id: 1,
      name: "Provider"
    },
    pad: {
      id: 1,
      name: "Pad",
      location: {
        id: 1,
        name: "Location",
        celestial_body: { name: "Earth" }
      }
    },
    vid_urls: []
  };
}

test("backfill sync stores checkpoints and resumes from the previous offset", async () => {
  const repository = buildRepository();
  const pages = [
    { next: "page-2", results: [buildRawLaunch("1")] },
    { next: null, results: [buildRawLaunch("2")] }
  ];
  let fetchCount = 0;

  const syncService = createLaunchSyncService({
    config: buildConfig(),
    repository,
    fetchImpl: async () => buildResponse(pages[fetchCount++]),
    now: () => new Date("2026-04-01T12:00:00Z")
  });

  const firstRun = await syncService.runSync({
    mode: "backfill",
    pageBudget: 1,
    allowWait: false,
    reason: "test"
  });

  assert.equal(firstRun.processedPages, 1);
  assert.equal(repository.launches.length, 1);
  assert.equal(repository.state.get("backfill_sync_meta").offset, 100);
  assert.equal(repository.state.get("backfill_sync_meta").complete, false);

  const secondRun = await syncService.runSync({
    mode: "backfill",
    pageBudget: 10,
    allowWait: false,
    reason: "test"
  });

  assert.equal(secondRun.processedPages, 1);
  assert.equal(repository.launches.length, 2);
  assert.equal(repository.state.get("backfill_sync_meta").offset, 0);
  assert.equal(repository.state.get("backfill_sync_meta").complete, true);
});

test("sync respects the self-throttle guard when waiting is disabled", async () => {
  const repository = buildRepository();
  await repository.setSyncState("source_rate_limit", {
    nextAllowedAt: "2026-04-01T12:10:00Z"
  });
  let fetchCount = 0;

  const syncService = createLaunchSyncService({
    config: buildConfig({
      sync: {
        staleMs: 15 * 60 * 1000,
        lockTtlMs: 10 * 60 * 1000,
        requestIntervalMs: 240000,
        maxRequestsPerHour: 15
      }
    }),
    repository,
    fetchImpl: async () => {
      fetchCount += 1;
      return buildResponse({ next: null, results: [] });
    },
    now: () => new Date("2026-04-01T12:00:00Z")
  });

  const result = await syncService.runSync({
    mode: "upcoming",
    pageBudget: 1,
    allowWait: false,
    reason: "test"
  });

  assert.equal(result.reason, "rate_limited");
  assert.equal(fetchCount, 0);
});
