import path from "node:path";
import { promises as fs } from "node:fs";
import { readEarthLaunchTrackerConfig } from "../src/config.mjs";
import { mapLaunchRecord } from "../src/normalize.mjs";

const config = readEarthLaunchTrackerConfig();
const rootDir = process.cwd();
const publicDir = path.join(rootDir, "src/public");
const docsDir = path.join(rootDir, "docs");
const dataDir = path.join(docsDir, "data");

const rawData = await readLaunchData(config.storage.dataFile);
const now = new Date();
const launches = rawData.launches
  .map((launch) => toStaticLaunch(launch, now))
  .sort((left, right) => Date.parse(right.net) - Date.parse(left.net));
const filters = buildFilters(launches, now);
const payload = {
  generatedAt: now.toISOString(),
  launches,
  filters,
  sync: {
    upcomingLastCompletedAt: rawData.sync_state?.upcoming_sync_meta?.lastCompletedAt || null,
    backfillLastCompletedAt: rawData.sync_state?.backfill_sync_meta?.lastCompletedAt || null
  }
};

await fs.rm(docsDir, { recursive: true, force: true });
await fs.mkdir(dataDir, { recursive: true });
await fs.cp(publicDir, docsDir, { recursive: true });

const indexPath = path.join(docsDir, "index.html");
const indexHtml = await fs.readFile(indexPath, "utf8");
const staticIndexHtml = indexHtml.replace(
  '<script type="module" src="./app.js?v=1"></script>',
  '<script>window.__LAUNCH_TRACKER_STATIC__ = true;</script>\n    <script type="module" src="./app.js?v=1"></script>'
);

await fs.writeFile(indexPath, staticIndexHtml, "utf8");
await fs.writeFile(path.join(docsDir, "404.html"), staticIndexHtml, "utf8");
await fs.writeFile(path.join(docsDir, ".nojekyll"), "\n", "utf8");
await fs.writeFile(path.join(dataDir, "site-data.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Exported static launch tracker to ${docsDir}`);

async function readLaunchData(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
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

function toStaticLaunch(launch, now) {
  return mapLaunchRecord(
    {
      id: launch.sourceId,
      slug: launch.slug,
      name: launch.name,
      status: launch.status,
      net: launch.net,
      windowStart: launch.windowStart,
      windowEnd: launch.windowEnd,
      isTimeExact: launch.isTimeExact,
      organization: launch.organization
        ? {
            id: launch.organization.sourceId,
            name: launch.organization.name,
            abbrev: launch.organization.abbrev
          }
        : null,
      launchCountry: {
        code: launch.launchCountryCode,
        name: launch.launchCountryName || launch.launchCountryCode || "Unknown"
      },
      location: launch.location
        ? {
            id: launch.location.sourceId,
            name: launch.location.name,
            timeZone: launch.location.timeZone
          }
        : null,
      pad: launch.pad
        ? {
            id: launch.pad.sourceId,
            name: launch.pad.name,
            latitude: launch.pad.latitude,
            longitude: launch.pad.longitude
          }
        : null,
      stream: launch.primaryStream
        ? {
            available: true,
            live: Boolean(launch.primaryStream.live),
            url: launch.primaryStream.url,
            title: launch.primaryStream.title,
            publisher: launch.primaryStream.publisher
          }
        : {
            available: false,
            live: false,
            url: "",
            title: "",
            publisher: ""
          },
      image: launch.imageUrl,
      lastSyncedAt: launch.syncedAt
    },
    now
  );
}

function buildFilters(launches, now) {
  const organizations = new Map();
  const countries = new Map();
  const locations = new Map();
  let upcoming = 0;
  let past = 0;

  for (const launch of launches) {
    if (Date.parse(launch.net) >= now.getTime()) {
      upcoming += 1;
    } else {
      past += 1;
    }

    if (launch.organization?.id) {
      organizations.set(launch.organization.id, {
        id: launch.organization.id,
        name: launch.organization.name,
        abbrev: launch.organization.abbrev
      });
    }

    if (launch.launchCountry?.code) {
      countries.set(launch.launchCountry.code, {
        code: launch.launchCountry.code,
        name: launch.launchCountry.name
      });
    }

    if (launch.location?.id) {
      locations.set(launch.location.id, {
        id: launch.location.id,
        name: launch.location.name
      });
    }
  }

  return {
    organizations: [...organizations.values()].sort((a, b) => a.name.localeCompare(b.name)),
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    locations: [...locations.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totals: {
      launches: launches.length,
      upcoming,
      past
    }
  };
}
