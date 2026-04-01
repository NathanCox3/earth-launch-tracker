import test from "node:test";
import assert from "node:assert/strict";
import { deriveCountdownState, normalizeLaunchRecord } from "./normalize.mjs";

function buildRawLaunch(overrides = {}) {
  return {
    id: "launch-1",
    slug: "falcon-9-starlink",
    name: "Falcon 9 | Starlink",
    status: {
      name: "Go for Launch",
      abbrev: "Go",
      description: "Current T-0 confirmed."
    },
    net: "2026-04-02T18:30:00Z",
    window_start: "2026-04-02T18:30:00Z",
    window_end: "2026-04-02T19:15:00Z",
    net_precision: {
      abbrev: "MIN"
    },
    launch_service_provider: {
      id: 121,
      name: "SpaceX",
      abbrev: "SpX",
      type: "Commercial",
      country_code: "US"
    },
    mission: {
      orbit: {
        name: "Low Earth Orbit",
        abbrev: "LEO",
        celestial_body: {
          name: "Earth"
        }
      }
    },
    pad: {
      id: 16,
      name: "Space Launch Complex 40",
      latitude: "28.5619",
      longitude: "-80.5774",
      location: {
        id: 12,
        name: "Cape Canaveral, Florida, USA",
        timezone_name: "America/New_York",
        country: {
          name: "United States",
          alpha_2_code: "US"
        },
        celestial_body: {
          name: "Earth"
        }
      }
    },
    vid_urls: [
      {
        url: "https://youtube.com/watch?v=replay",
        title: "Replay stream",
        publisher: "SpaceX",
        priority: 5,
        live: false
      },
      {
        url: "https://youtube.com/watch?v=live",
        title: "Live stream",
        publisher: "SpaceX",
        priority: 10,
        live: true
      }
    ],
    image: {
      image_url: "https://images.example/falcon9.jpg"
    },
    ...overrides
  };
}

test("normalizeLaunchRecord keeps orbital Earth launches and prefers the live webcast", () => {
  const launch = normalizeLaunchRecord(buildRawLaunch());

  assert.equal(launch.name, "Falcon 9 | Starlink");
  assert.equal(launch.organization.name, "SpaceX");
  assert.equal(launch.launchCountryName, "United States");
  assert.equal(launch.primaryStream.url, "https://youtube.com/watch?v=live");
  assert.equal(launch.primaryStream.live, true);
  assert.equal(launch.isTimeExact, true);
});

test("normalizeLaunchRecord keeps suborbital launches in scope", () => {
  const launch = normalizeLaunchRecord(
    buildRawLaunch({
      mission: {
        orbit: {
          name: "Suborbital",
          abbrev: "Sub",
          celestial_body: { name: "Earth" }
        }
      }
    })
  );

  assert.equal(launch.isSuborbital, true);
  assert.equal(launch.sourceId, "launch-1");
});

test("normalizeLaunchRecord handles missing location country fields and absent streams", () => {
  const launch = normalizeLaunchRecord(
    buildRawLaunch({
      net_precision: { abbrev: "DAY" },
      vid_urls: [],
      pad: {
        id: 16,
        name: "Unknown Pad",
        location: {
          id: 12,
          name: "Unknown Test Site",
          celestial_body: { name: "Earth" }
        }
      }
    })
  );

  assert.equal(launch.launchCountryCode, "");
  assert.equal(launch.primaryStream, null);
  assert.equal(launch.isTimeExact, false);
});

test("normalizeLaunchRecord excludes non-Earth launches", () => {
  const launch = normalizeLaunchRecord(
    buildRawLaunch({
      pad: {
        id: 16,
        name: "Moon Pad Alpha",
        location: {
          id: 12,
          name: "Mare Tranquillitatis",
          celestial_body: { name: "Moon" }
        }
      }
    })
  );

  assert.equal(launch, null);
});

test("deriveCountdownState distinguishes live, upcoming, past, and tbd states", () => {
  const now = new Date("2026-04-01T12:00:00Z");

  assert.equal(
    deriveCountdownState(
      { net: "2026-04-02T12:00:00Z", isTimeExact: true, stream: { live: false } },
      now
    ),
    "upcoming"
  );
  assert.equal(
    deriveCountdownState(
      { net: "2026-04-01T11:00:00Z", isTimeExact: true, stream: { live: false } },
      now
    ),
    "past"
  );
  assert.equal(
    deriveCountdownState(
      { net: "2026-04-02T12:00:00Z", isTimeExact: false, stream: { live: false } },
      now
    ),
    "tbd"
  );
  assert.equal(
    deriveCountdownState(
      { net: "2026-04-02T12:00:00Z", isTimeExact: true, stream: { live: true } },
      now
    ),
    "live"
  );
});
