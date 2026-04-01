import {
  STATIC_FILES,
  createHttpError,
  jsonResponse,
  readJsonBody,
  resolvePathname,
  serveStaticFile
} from "./http.mjs";

export function createEarthLaunchTrackerApp({
  config,
  repository,
  syncService
}) {
  return async function handle(request) {
    try {
      const url = new URL(request.url);
      const pathname = resolvePathname(url);

      if (request.method === "GET" && STATIC_FILES[pathname]) {
        return serveStaticFile(config.app.publicDir, STATIC_FILES[pathname]);
      }

      if (request.method === "GET" && pathname === "/api/launches") {
        await syncService.maybeRefreshUpcoming();
        const page = clampPositiveInteger(url.searchParams.get("page"), 1);
        const pageSize = clampPositiveInteger(url.searchParams.get("pageSize"), 24, 1, 48);
        const timeline = url.searchParams.get("timeline") === "past" ? "past" : "upcoming";

        const payload = await repository.listLaunches({
          timeline,
          page,
          pageSize,
          organizationId: normalizeText(url.searchParams.get("organization")),
          countryCode: normalizeText(url.searchParams.get("country")),
          locationId: normalizeText(url.searchParams.get("location"))
        });

        return jsonResponse(200, payload);
      }

      if (request.method === "GET" && pathname === "/api/filters") {
        const payload = await repository.listFilters();
        return jsonResponse(200, payload);
      }

      if (request.method === "POST" && pathname === "/api/admin/sync") {
        authorizeSyncRequest(request, config.sync.adminSecret);
        const body = await readJsonBody(request);
        const payload = await syncService.runSync({
          mode: body?.mode,
          pageBudget: clampPositiveInteger(body?.pageBudget, Infinity, 1, 5000),
          allowWait: body?.allowWait !== false,
          reason: "admin_endpoint"
        });

        return jsonResponse(200, payload);
      }

      return jsonResponse(404, { error: "Not found" });
    } catch (error) {
      return jsonResponse(Number(error?.statusCode) || 500, {
        error: error?.message || "Unexpected server error."
      });
    }
  };
}

function authorizeSyncRequest(request, secret) {
  if (!secret) {
    throw createHttpError(503, "LAUNCH_SYNC_SECRET is not configured yet.");
  }

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (token !== secret) {
    throw createHttpError(401, "Unauthorized.");
  }
}

function clampPositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(max, parsed);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}
