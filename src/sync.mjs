import { createHttpError } from "./http.mjs";
import { normalizeLaunchPage } from "./normalize.mjs";

export function createLaunchSyncService({
  config,
  repository,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date()
}) {
  return {
    maybeRefreshUpcoming,
    runSync
  };

  async function maybeRefreshUpcoming() {
    const meta = (await repository.getSyncState("upcoming_sync_meta")) || {};
    const lastCompletedAt = meta.lastCompletedAt ? Date.parse(meta.lastCompletedAt) : 0;
    const isStale = !lastCompletedAt || now().getTime() - lastCompletedAt > config.sync.staleMs;

    if (!isStale) {
      return { refreshed: false, reason: "fresh" };
    }

    try {
      const result = await runSync({
        mode: "upcoming",
        pageBudget: 1,
        allowWait: false,
        reason: "stale_on_read"
      });
      return {
        refreshed: result.processedPages > 0,
        reason: result.reason || "refreshed"
      };
    } catch (error) {
      if (error?.code === "sync_locked") {
        return { refreshed: false, reason: "locked" };
      }

      throw error;
    }
  }

  async function runSync({
    mode = "upcoming",
    pageBudget = Infinity,
    allowWait = true,
    reason = "manual"
  } = {}) {
    const syncMode = mode === "backfill" ? "backfill" : "upcoming";
    const owner = `sync-${syncMode}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await repository.acquireSyncLock({
      mode: syncMode,
      owner,
      ttlMs: config.sync.lockTtlMs
    });

    try {
      const stateKey = syncMode === "backfill" ? "backfill_sync_meta" : "upcoming_sync_meta";
      const previousMeta = (await repository.getSyncState(stateKey)) || {};
      let offset = syncMode === "backfill" ? Number(previousMeta.offset || 0) : 0;
      let processedPages = 0;
      let processedLaunches = 0;
      let hasNext = true;

      while (hasNext && processedPages < pageBudget) {
        const throttle = await waitForTurn({ allowWait });
        if (throttle.skipped) {
          return {
            mode: syncMode,
            processedPages,
            processedLaunches,
            reason: throttle.reason
          };
        }

        const response = await fetchLaunchPage(syncMode, offset);
        const launches = normalizeLaunchPage(response, now());
        await repository.upsertLaunchBatch(launches);

        processedPages += 1;
        processedLaunches += launches.length;
        hasNext = Boolean(response.next);
        offset += config.source.pageSize;

        await repository.setSyncState(stateKey, {
          mode: syncMode,
          offset: hasNext ? offset : 0,
          processedPages,
          lastPageCount: launches.length,
          lastRunAt: now().toISOString(),
          lastCompletedAt: hasNext ? previousMeta.lastCompletedAt || null : now().toISOString(),
          complete: !hasNext
        });
      }

      if (processedPages > 0 && syncMode === "upcoming") {
        await repository.setSyncState(stateKey, {
          mode: syncMode,
          offset: 0,
          processedPages,
          lastRunAt: now().toISOString(),
          lastCompletedAt: now().toISOString(),
          complete: true
        });
      }

      return {
        mode: syncMode,
        processedPages,
        processedLaunches,
        reason
      };
    } finally {
      await repository.releaseSyncLock(owner);
    }
  }

  async function fetchLaunchPage(mode, offset) {
    const isBackfill = mode === "backfill";
    const basePath = isBackfill ? "/launch/previous/" : "/launch/upcoming/";
    const url = new URL(`${config.source.apiBase}${basePath}`);
    url.searchParams.set("format", "json");
    url.searchParams.set("mode", "detailed");
    url.searchParams.set("limit", String(config.source.pageSize));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("ordering", isBackfill ? "-net" : "net");

    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw createHttpError(502, `Launch source sync failed with status ${response.status}.`);
    }

    await rememberRequest();
    return response.json();
  }

  async function waitForTurn({ allowWait }) {
    const rateState = (await repository.getSyncState("source_rate_limit")) || {};
    const nextAllowedAt = rateState.nextAllowedAt ? Date.parse(rateState.nextAllowedAt) : 0;
    const waitMs = Math.max(0, nextAllowedAt - now().getTime());

    if (waitMs <= 0) {
      return { skipped: false };
    }

    if (!allowWait) {
      return { skipped: true, reason: "rate_limited" };
    }

    await sleep(waitMs);
    return { skipped: false };
  }

  async function rememberRequest() {
    const requestAt = now();
    await repository.setSyncState("source_rate_limit", {
      lastRequestAt: requestAt.toISOString(),
      nextAllowedAt: new Date(requestAt.getTime() + config.sync.requestIntervalMs).toISOString(),
      requestIntervalMs: config.sync.requestIntervalMs,
      maxRequestsPerHour: config.sync.maxRequestsPerHour
    });
  }
}
