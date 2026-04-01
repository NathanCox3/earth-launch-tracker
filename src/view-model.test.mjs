import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEmptyState,
  buildStreamAction,
  describeCountdown,
  formatLaunchDate
} from "./public/view-model.js";

test("buildStreamAction labels live, upcoming, and replay links correctly", () => {
  assert.deepEqual(
    buildStreamAction({
      timeline: "upcoming",
      countdownState: "live",
      stream: { available: true, live: true, url: "https://live.example" }
    }),
    { label: "Watch live", url: "https://live.example" }
  );

  assert.deepEqual(
    buildStreamAction({
      timeline: "upcoming",
      countdownState: "upcoming",
      stream: { available: true, live: false, url: "https://future.example" }
    }),
    { label: "Livestream available", url: "https://future.example" }
  );

  assert.deepEqual(
    buildStreamAction({
      timeline: "past",
      countdownState: "past",
      stream: { available: true, live: false, url: "https://replay.example" }
    }),
    { label: "Watch replay", url: "https://replay.example" }
  );
});

test("describeCountdown distinguishes exact countdowns from NET and past launches", () => {
  const now = Date.parse("2026-04-01T12:00:00Z");

  assert.equal(
    describeCountdown(
      { net: "2026-04-01T12:10:00Z", isTimeExact: true, countdownState: "upcoming", stream: { live: false } },
      now
    ).text,
    "T-10m 00s"
  );

  assert.equal(
    describeCountdown(
      { net: "2026-04-01T12:10:00Z", isTimeExact: false, countdownState: "tbd", stream: { live: false } },
      now
    ).text,
    "NET pending exact T-0"
  );

  assert.equal(
    describeCountdown(
      { net: "2026-04-01T11:50:00Z", isTimeExact: true, countdownState: "past", stream: { live: false } },
      now
    ).text,
    "T+10m 00s"
  );
});

test("formatLaunchDate renders local and UTC labels", () => {
  const formatted = formatLaunchDate(
    {
      net: "2026-04-02T18:30:00Z",
      isTimeExact: true
    },
    {
      locale: "en-US",
      timeZone: "America/Los_Angeles"
    }
  );

  assert.match(formatted.local, /Apr/);
  assert.match(formatted.local, /PDT/);
  assert.match(formatted.utc, /UTC/);
});

test("buildEmptyState changes copy when filters are active", () => {
  assert.match(buildEmptyState({ timeline: "upcoming", activeFiltersCount: 0 }), /Run a sync/);
  assert.match(buildEmptyState({ timeline: "past", activeFiltersCount: 1 }), /selected filters/);
});
