import { createEarthLaunchTrackerRuntime } from "./bootstrap.mjs";

const mode = process.argv[2] === "backfill" ? "backfill" : "upcoming";
const pageBudget = toPositiveNumber(process.argv[3], mode === "backfill" ? 10 : Infinity);

const runtime = createEarthLaunchTrackerRuntime();

const result = await runtime.syncService.runSync({
  mode,
  pageBudget,
  allowWait: true,
  reason: "cli"
});

console.log(JSON.stringify(result, null, 2));
if (runtime.sql) {
  await runtime.sql.end({ timeout: 5 });
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
