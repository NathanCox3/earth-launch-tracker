const PRECISE_TIME_ABBREVS = new Set(["MIN", "SEC"]);
const STREAM_PRIORITY_MULTIPLIER = 1000;

export function normalizeLaunchPage(payload, syncedAt = new Date()) {
  const items = Array.isArray(payload?.results) ? payload.results : [];
  return items.map((item) => normalizeLaunchRecord(item, syncedAt)).filter(Boolean);
}

export function normalizeLaunchRecord(raw, syncedAt = new Date()) {
  if (!raw || !raw.net || !isEarthLaunch(raw)) {
    return null;
  }

  const organization = normalizeOrganization(raw.launch_service_provider);
  const location = normalizeLocation(raw.pad?.location);
  const pad = normalizePad(raw.pad, location);
  const videos = normalizeVideos(raw.vid_urls || raw.vidURLs || [], raw.webcast_live);
  const primaryStream = pickPrimaryStream(videos);
  const launchCountryCode = location?.countryCode || normalizeCountryCode(raw.pad?.country_code);
  const launchCountryName = location?.countryName || normalizeCountryName(raw.pad?.country?.name, launchCountryCode);

  return {
    sourceId: String(raw.id),
    slug: normalizeText(raw.slug) || slugify(raw.name || raw.id),
    name: normalizeText(raw.name) || "Unnamed launch",
    status: {
      name: normalizeText(raw.status?.name) || "Unknown",
      abbrev: normalizeText(raw.status?.abbrev),
      description: normalizeText(raw.status?.description)
    },
    net: normalizeIsoTimestamp(raw.net),
    windowStart: normalizeIsoTimestamp(raw.window_start),
    windowEnd: normalizeIsoTimestamp(raw.window_end),
    isTimeExact: isExactLaunchTime(raw),
    isSuborbital: Boolean(raw.mission?.orbit?.abbrev === "Sub" || raw.mission?.orbit?.name === "Suborbital"),
    organization,
    launchCountryCode,
    launchCountryName,
    location,
    pad,
    imageUrl: normalizeImageUrl(raw.image),
    sourceLastUpdated: normalizeIsoTimestamp(raw.last_updated || raw.updated),
    syncedAt: toIsoString(syncedAt),
    videos,
    primaryStream
  };
}

export function isEarthLaunch(raw) {
  const bodyName =
    normalizeText(raw?.pad?.location?.celestial_body?.name) ||
    normalizeText(raw?.mission?.orbit?.celestial_body?.name);

  if (!bodyName) {
    return true;
  }

  return bodyName.toLowerCase() === "earth";
}

export function deriveCountdownState(launch, now = new Date()) {
  if (!launch) {
    return "tbd";
  }

  if (launch?.stream?.live || launch?.primaryStreamLive) {
    return "live";
  }

  if (!launch.net) {
    return "tbd";
  }

  const netMs = Date.parse(launch.net);
  if (!Number.isFinite(netMs)) {
    return "tbd";
  }

  if (!launch.isTimeExact) {
    return netMs >= now.getTime() ? "tbd" : "past";
  }

  return netMs >= now.getTime() ? "upcoming" : "past";
}

export function deriveTimeline(launch, now = new Date()) {
  if (!launch?.net) {
    return "upcoming";
  }

  return Date.parse(launch.net) >= now.getTime() ? "upcoming" : "past";
}

export function mapLaunchRow(row, now = new Date()) {
  return mapLaunchRecord(
    {
      id: row.source_id,
      slug: row.slug,
      name: row.name,
      status: {
        name: row.status_name,
        abbrev: row.status_abbrev,
        description: row.status_description
      },
      net: row.net?.toISOString?.() || row.net,
      windowStart: row.window_start?.toISOString?.() || row.window_start,
      windowEnd: row.window_end?.toISOString?.() || row.window_end,
      isTimeExact: row.is_time_exact,
      organization: row.org_source_id
        ? {
            id: row.org_source_id,
            name: row.org_name,
            abbrev: row.org_abbrev
          }
        : null,
      launchCountry: {
        code: row.launch_country_code,
        name: row.launch_country_name || row.launch_country_code || "Unknown"
      },
      location: row.location_source_id
        ? {
            id: row.location_source_id,
            name: row.location_name,
            timeZone: row.location_timezone_name
          }
        : null,
      pad: row.pad_source_id
        ? {
            id: row.pad_source_id,
            name: row.pad_name,
            latitude: row.pad_latitude,
            longitude: row.pad_longitude
          }
        : null,
      stream: {
        available: Boolean(row.primary_stream_url),
        live: Boolean(row.primary_stream_live),
        url: row.primary_stream_url,
        title: row.primary_stream_title,
        publisher: row.primary_stream_publisher
      },
      image: row.image_url,
      lastSyncedAt: row.last_synced_at?.toISOString?.() || row.last_synced_at
    },
    now
  );
}

export function mapLaunchRecord(record, now = new Date()) {
  const launch = {
    ...record,
    stream: record.stream || {
      available: Boolean(record.primaryStream?.url),
      live: Boolean(record.primaryStream?.live),
      url: record.primaryStream?.url,
      title: record.primaryStream?.title,
      publisher: record.primaryStream?.publisher
    }
  };

  launch.timeline = deriveTimeline(launch, now);
  launch.countdownState = deriveCountdownState(
    {
      net: launch.net,
      isTimeExact: launch.isTimeExact,
      stream: launch.stream
    },
    now
  );

  if (!launch.launchCountry) {
    launch.launchCountry = {
      code: launch.launchCountryCode,
      name: launch.launchCountryName || launch.launchCountryCode || "Unknown"
    };
  }

  return launch;
}

export function getFilterCountryLabel(code, name) {
  return normalizeText(name) || normalizeText(code) || "Unknown";
}

function normalizeOrganization(raw) {
  if (!raw?.id) {
    return null;
  }

  return {
    sourceId: String(raw.id),
    name: normalizeText(raw.name) || "Unknown organization",
    abbrev: normalizeText(raw.abbrev),
    type: normalizeText(raw.type?.name || raw.type),
    countryCode: normalizeCountryCode(raw.country?.alpha_2_code || raw.country?.alpha_3_code || raw.country_code),
    countryName: normalizeCountryName(
      raw.country?.name,
      raw.country?.alpha_2_code || raw.country?.alpha_3_code || raw.country_code
    ),
    infoUrl: normalizeText(raw.info_url),
    wikiUrl: normalizeText(raw.wiki_url)
  };
}

function normalizeLocation(raw) {
  if (!raw?.id) {
    return null;
  }

  const countryCode = normalizeCountryCode(raw.country?.alpha_2_code || raw.country?.alpha_3_code || raw.country_code);
  return {
    sourceId: String(raw.id),
    name: normalizeText(raw.name) || "Unknown location",
    countryCode,
    countryName: normalizeCountryName(raw.country?.name, countryCode),
    timeZone: normalizeText(raw.timezone_name),
    mapUrl: normalizeText(raw.map_url)
  };
}

function normalizePad(raw, location) {
  if (!raw?.id) {
    return null;
  }

  const countryCode = location?.countryCode || normalizeCountryCode(raw.country?.alpha_2_code || raw.country?.alpha_3_code || raw.country_code);
  return {
    sourceId: String(raw.id),
    name: normalizeText(raw.name) || "Unknown pad",
    locationSourceId: location?.sourceId || null,
    countryCode,
    countryName: location?.countryName || normalizeCountryName(raw.country?.name, countryCode),
    latitude: normalizeNumber(raw.latitude),
    longitude: normalizeNumber(raw.longitude),
    mapUrl: normalizeText(raw.map_url)
  };
}

function normalizeVideos(items, webcastLive) {
  return items
    .map((item) => ({
      url: normalizeText(item?.url),
      title: normalizeText(item?.title),
      publisher: normalizeText(item?.publisher || item?.source),
      priority: normalizeNumber(item?.priority, 0),
      live: Boolean(item?.live || webcastLive),
      startTime: normalizeIsoTimestamp(item?.start_time),
      endTime: normalizeIsoTimestamp(item?.end_time)
    }))
    .filter((item) => item.url)
    .sort((left, right) => {
      const leftScore = Number(left.live) * STREAM_PRIORITY_MULTIPLIER + Number(left.priority || 0);
      const rightScore = Number(right.live) * STREAM_PRIORITY_MULTIPLIER + Number(right.priority || 0);
      return rightScore - leftScore;
    });
}

function pickPrimaryStream(videos) {
  const stream = videos[0];
  if (!stream) {
    return null;
  }

  return {
    available: true,
    live: Boolean(stream.live),
    url: stream.url,
    title: stream.title,
    publisher: stream.publisher
  };
}

function isExactLaunchTime(raw) {
  if (!raw?.net || raw?.tbdtime || raw?.tbddate) {
    return false;
  }

  const abbrev = normalizeText(raw?.net_precision?.abbrev).toUpperCase();
  return PRECISE_TIME_ABBREVS.has(abbrev);
}

function normalizeCountryCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeCountryName(name, fallbackCode) {
  return normalizeText(name) || normalizeText(fallbackCode);
}

function normalizeImageUrl(image) {
  if (typeof image === "string") {
    return normalizeText(image);
  }

  return normalizeText(image?.image_url || image?.thumbnail_url || image?.url);
}

function normalizeIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toIsoString(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function slugify(value) {
  return (
    String(value || "launch")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "launch"
  );
}
