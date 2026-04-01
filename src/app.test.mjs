import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createEarthLaunchTrackerApp } from "./app.mjs";

const FIXTURE_CONFIG = {
  app: {
    publicDir: path.resolve(process.cwd(), "src/public")
  },
  sync: {
    adminSecret: "secret-token"
  }
};

test("root request serves the launch tracker landing page", async () => {
  const app = createEarthLaunchTrackerApp({
    config: FIXTURE_CONFIG,
    repository: {
      listLaunches: async () => ({}),
      listFilters: async () => ({})
    },
    syncService: {
      maybeRefreshUpcoming: async () => ({}),
      runSync: async () => ({})
    }
  });

  const response = await app(new Request("http://localhost/"));
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.match(text, /Earth Launch Tracker/);
});

test("launches endpoint refreshes upcoming data and forwards parsed filters", async () => {
  let refreshCalled = false;
  let capturedParams = null;
  const app = createEarthLaunchTrackerApp({
    config: FIXTURE_CONFIG,
    repository: {
      listLaunches: async (params) => {
        capturedParams = params;
        return { items: [], page: 2, totalPages: 3, totalResults: 20 };
      },
      listFilters: async () => ({})
    },
    syncService: {
      maybeRefreshUpcoming: async () => {
        refreshCalled = true;
      },
      runSync: async () => ({})
    }
  });

  const response = await app(
    new Request(
      "http://localhost/api/launches?timeline=past&page=2&pageSize=12&organization=spx&country=US&location=ccafs"
    )
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(refreshCalled, true);
  assert.deepEqual(capturedParams, {
    timeline: "past",
    page: 2,
    pageSize: 12,
    organizationId: "spx",
    countryCode: "US",
    locationId: "ccafs"
  });
  assert.equal(payload.page, 2);
});

test("filters endpoint returns the repository payload", async () => {
  const app = createEarthLaunchTrackerApp({
    config: FIXTURE_CONFIG,
    repository: {
      listLaunches: async () => ({}),
      listFilters: async () => ({ organizations: [{ id: "1", name: "NASA" }] })
    },
    syncService: {
      maybeRefreshUpcoming: async () => ({}),
      runSync: async () => ({})
    }
  });

  const response = await app(new Request("http://localhost/api/filters"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.organizations[0].name, "NASA");
});

test("admin sync endpoint requires a bearer token", async () => {
  const app = createEarthLaunchTrackerApp({
    config: FIXTURE_CONFIG,
    repository: {
      listLaunches: async () => ({}),
      listFilters: async () => ({})
    },
    syncService: {
      maybeRefreshUpcoming: async () => ({}),
      runSync: async () => ({ mode: "upcoming", processedPages: 1 })
    }
  });

  const unauthorized = await app(
    new Request("http://localhost/api/admin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "upcoming" })
    })
  );

  assert.equal(unauthorized.status, 401);

  const authorized = await app(
    new Request("http://localhost/api/admin/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token"
      },
      body: JSON.stringify({ mode: "upcoming", pageBudget: 2 })
    })
  );
  const payload = await authorized.json();

  assert.equal(authorized.status, 200);
  assert.equal(payload.processedPages, 1);
});
