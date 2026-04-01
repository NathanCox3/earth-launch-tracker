export function buildStreamAction(launch) {
  if (!launch?.stream?.available || !launch?.stream?.url) {
    return null;
  }

  if (launch.stream.live || launch.countdownState === "live") {
    return { label: "Watch live", url: launch.stream.url };
  }

  if (launch.timeline === "upcoming") {
    return { label: "Livestream available", url: launch.stream.url };
  }

  return { label: "Watch replay", url: launch.stream.url };
}

export function formatLaunchDate(launch, { locale, timeZone } = {}) {
  if (!launch?.net) {
    return {
      local: "TBD",
      utc: "Launch date pending"
    };
  }

  const net = new Date(launch.net);
  const localFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
  const utcFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
  const localText = localFormatter.format(net);
  const utcText = utcFormatter.format(net);

  if (!launch.isTimeExact) {
    return {
      local: `NET ${localText}`,
      utc: `UTC ${utcText}`
    };
  }

  return {
    local: localText,
    utc: `UTC ${utcText}`
  };
}

export function describeCountdown(launch, now = Date.now()) {
  if (!launch?.net) {
    return { text: "TBD", tone: "muted" };
  }

  if (launch.countdownState === "live" || launch.stream?.live) {
    return { text: "Live now", tone: "live" };
  }

  const deltaMs = Date.parse(launch.net) - now;
  if (!launch.isTimeExact && deltaMs >= 0) {
    return { text: "NET pending exact T-0", tone: "muted" };
  }

  if (deltaMs >= 0) {
    return { text: `T-${formatDuration(deltaMs)}`, tone: "upcoming" };
  }

  return { text: `T+${formatDuration(Math.abs(deltaMs))}`, tone: "past" };
}

export function buildEmptyState({ timeline, activeFiltersCount }) {
  if (activeFiltersCount > 0) {
    return `No ${timeline} launches match the selected filters.`;
  }

  if (timeline === "upcoming") {
    return "No upcoming launches are stored yet. Run a sync to load the latest schedule.";
  }

  return "No past launches are stored yet. Run the backfill script to build the history.";
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (days > 0 || hours > 0) {
    parts.push(`${String(hours).padStart(days > 0 ? 2 : 1, "0")}h`);
  }
  parts.push(`${String(minutes).padStart(2, "0")}m`);
  parts.push(`${String(seconds).padStart(2, "0")}s`);
  return parts.join(" ");
}
