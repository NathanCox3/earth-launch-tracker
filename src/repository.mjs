import { requireDatabase } from "./db.mjs";
import { createHttpError } from "./http.mjs";
import { getFilterCountryLabel, mapLaunchRow } from "./normalize.mjs";

const LOCK_KEY = "sync_lock";

export function createLaunchRepository({ sql, now = () => new Date() }) {
  return {
    listLaunches,
    listFilters,
    upsertLaunchBatch,
    getSyncState,
    setSyncState,
    clearSyncState,
    acquireSyncLock,
    releaseSyncLock
  };

  async function listLaunches({
    timeline = "upcoming",
    page = 1,
    pageSize = 24,
    organizationId = "",
    countryCode = "",
    locationId = ""
  } = {}) {
    const db = requireDatabase(sql);
    const nowAt = now();
    const params = [];
    const where = [];

    where.push(buildParam(params, "l.net >= ", "l.net < ", timeline === "upcoming", nowAt.toISOString()));

    if (organizationId) {
      where.push(`org.source_id = ${pushParam(params, organizationId)}`);
    }

    if (countryCode) {
      where.push(`UPPER(l.launch_country_code) = ${pushParam(params, countryCode.toUpperCase())}`);
    }

    if (locationId) {
      where.push(`loc.source_id = ${pushParam(params, locationId)}`);
    }

    const order = timeline === "upcoming" ? "l.net ASC, l.name ASC" : "l.net DESC, l.name ASC";
    const baseFrom = `
      FROM launches l
      LEFT JOIN organizations org ON org.id = l.organization_id
      LEFT JOIN locations loc ON loc.id = l.location_id
      LEFT JOIN pads p ON p.id = l.pad_id
      WHERE ${where.join(" AND ")}
    `;

    const countRows = await db.unsafe(`SELECT COUNT(*)::INT AS count ${baseFrom}`, params);
    const totalResults = countRows[0]?.count || 0;
    const totalPages = totalResults ? Math.ceil(totalResults / pageSize) : 1;
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const offset = (safePage - 1) * pageSize;
    const pageParams = [...params, pageSize, offset];

    const rows = await db.unsafe(
      `
        SELECT
          l.source_id,
          l.slug,
          l.name,
          l.status_name,
          l.status_abbrev,
          l.status_description,
          l.net,
          l.window_start,
          l.window_end,
          l.is_time_exact,
          l.image_url,
          l.primary_stream_url,
          l.primary_stream_title,
          l.primary_stream_publisher,
          l.primary_stream_live,
          l.launch_country_code,
          l.launch_country_name,
          l.last_synced_at,
          org.source_id AS org_source_id,
          org.name AS org_name,
          org.abbrev AS org_abbrev,
          loc.source_id AS location_source_id,
          loc.name AS location_name,
          loc.timezone_name AS location_timezone_name,
          p.source_id AS pad_source_id,
          p.name AS pad_name,
          p.latitude AS pad_latitude,
          p.longitude AS pad_longitude
        ${baseFrom}
        ORDER BY ${order}
        LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
      `,
      pageParams
    );

    const upcomingMeta = await getSyncState("upcoming_sync_meta");

    return {
      items: rows.map((row) => mapLaunchRow(row, nowAt)),
      page: safePage,
      pageSize,
      totalResults,
      totalPages,
      lastUpcomingSyncAt: upcomingMeta?.lastCompletedAt || null
    };
  }

  async function listFilters() {
    const db = requireDatabase(sql);

    const [organizations, countries, locations, totals] = await Promise.all([
      db.unsafe(`
        SELECT DISTINCT org.source_id AS id, org.name, org.abbrev
        FROM launches l
        JOIN organizations org ON org.id = l.organization_id
        ORDER BY org.name ASC
      `),
      db.unsafe(`
        SELECT DISTINCT launch_country_code AS code, launch_country_name AS name
        FROM launches
        WHERE launch_country_code IS NOT NULL AND launch_country_code <> ''
        ORDER BY launch_country_name ASC, launch_country_code ASC
      `),
      db.unsafe(`
        SELECT DISTINCT loc.source_id AS id, loc.name
        FROM launches l
        JOIN locations loc ON loc.id = l.location_id
        ORDER BY loc.name ASC
      `),
      db.unsafe(`
        SELECT
          COUNT(*)::INT AS total_launches,
          COUNT(*) FILTER (WHERE net >= NOW())::INT AS upcoming_launches,
          COUNT(*) FILTER (WHERE net < NOW())::INT AS past_launches
        FROM launches
      `)
    ]);

    return {
      organizations: organizations.map((row) => ({
        id: row.id,
        name: row.name,
        abbrev: row.abbrev
      })),
      countries: countries.map((row) => ({
        code: row.code,
        name: getFilterCountryLabel(row.code, row.name)
      })),
      locations: locations.map((row) => ({
        id: row.id,
        name: row.name
      })),
      totals: {
        launches: totals[0]?.total_launches || 0,
        upcoming: totals[0]?.upcoming_launches || 0,
        past: totals[0]?.past_launches || 0
      }
    };
  }

  async function upsertLaunchBatch(launches) {
    const db = requireDatabase(sql);
    if (!Array.isArray(launches) || launches.length === 0) {
      return { inserted: 0 };
    }

    await db.begin(async (tx) => {
      for (const launch of launches) {
        const organizationId = launch.organization
          ? await upsertEntity(tx, "organizations", {
              source_id: launch.organization.sourceId,
              name: launch.organization.name,
              abbrev: launch.organization.abbrev,
              type: launch.organization.type,
              country_code: launch.organization.countryCode,
              country_name: launch.organization.countryName,
              info_url: launch.organization.infoUrl,
              wiki_url: launch.organization.wikiUrl,
              updated_at: launch.syncedAt
            })
          : null;

        const locationId = launch.location
          ? await upsertEntity(tx, "locations", {
              source_id: launch.location.sourceId,
              name: launch.location.name,
              country_code: launch.location.countryCode,
              country_name: launch.location.countryName,
              timezone_name: launch.location.timeZone,
              map_url: launch.location.mapUrl,
              updated_at: launch.syncedAt
            })
          : null;

        const padId = launch.pad
          ? await upsertEntity(tx, "pads", {
              source_id: launch.pad.sourceId,
              name: launch.pad.name,
              location_id: locationId,
              country_code: launch.pad.countryCode,
              country_name: launch.pad.countryName,
              latitude: launch.pad.latitude,
              longitude: launch.pad.longitude,
              map_url: launch.pad.mapUrl,
              updated_at: launch.syncedAt
            })
          : null;

        await upsertLaunch(tx, {
          source_id: launch.sourceId,
          slug: launch.slug,
          name: launch.name,
          status_name: launch.status.name,
          status_abbrev: launch.status.abbrev,
          status_description: launch.status.description,
          net: launch.net,
          window_start: launch.windowStart,
          window_end: launch.windowEnd,
          is_time_exact: launch.isTimeExact,
          is_suborbital: launch.isSuborbital,
          organization_id: organizationId,
          launch_country_code: launch.launchCountryCode,
          launch_country_name: launch.launchCountryName,
          location_id: locationId,
          pad_id: padId,
          image_url: launch.imageUrl,
          primary_stream_url: launch.primaryStream?.url || null,
          primary_stream_title: launch.primaryStream?.title || null,
          primary_stream_publisher: launch.primaryStream?.publisher || null,
          primary_stream_live: Boolean(launch.primaryStream?.live),
          source_last_updated: launch.sourceLastUpdated,
          last_synced_at: launch.syncedAt,
          updated_at: launch.syncedAt
        });

        await tx.unsafe("DELETE FROM videos WHERE launch_source_id = $1", [launch.sourceId]);

        for (const video of launch.videos) {
          await tx.unsafe(
            `
              INSERT INTO videos (
                launch_source_id,
                source_url,
                title,
                publisher,
                priority,
                is_live,
                start_time,
                end_time
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (launch_source_id, source_url) DO UPDATE SET
                title = EXCLUDED.title,
                publisher = EXCLUDED.publisher,
                priority = EXCLUDED.priority,
                is_live = EXCLUDED.is_live,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time
            `,
            [
              launch.sourceId,
              video.url,
              video.title,
              video.publisher,
              video.priority,
              video.live,
              video.startTime,
              video.endTime
            ]
          );
        }
      }
    });

    return { inserted: launches.length };
  }

  async function getSyncState(key) {
    const db = requireDatabase(sql);
    const rows = await db.unsafe("SELECT value FROM sync_state WHERE key = $1", [key]);
    return rows[0]?.value || null;
  }

  async function setSyncState(key, value) {
    const db = requireDatabase(sql);
    await db.unsafe(
      `
        INSERT INTO sync_state (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
      `,
      [key, JSON.stringify(value)]
    );
  }

  async function clearSyncState(key) {
    const db = requireDatabase(sql);
    await db.unsafe("DELETE FROM sync_state WHERE key = $1", [key]);
  }

  async function acquireSyncLock({ mode, owner, ttlMs }) {
    const db = requireDatabase(sql);
    const expiresAt = new Date(now().getTime() + ttlMs).toISOString();
    const value = { mode, owner, expiresAt };
    const rows = await db.unsafe(
      `
        INSERT INTO sync_state (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
        WHERE COALESCE((sync_state.value->>'expiresAt')::timestamptz <= NOW(), true)
        RETURNING value
      `,
      [LOCK_KEY, JSON.stringify(value)]
    );

    if (rows.length === 0) {
      const current = await getSyncState(LOCK_KEY);
      throw Object.assign(createHttpError(409, "A launch sync is already in progress."), {
        code: "sync_locked",
        current
      });
    }

    return rows[0].value;
  }

  async function releaseSyncLock(owner) {
    const db = requireDatabase(sql);
    await db.unsafe("DELETE FROM sync_state WHERE key = $1 AND value->>'owner' = $2", [LOCK_KEY, owner]);
  }
}

async function upsertEntity(tx, tableName, data) {
  const columns = Object.keys(data);
  const values = columns.map((column) => data[column]);
  const updateColumns = columns.filter((column) => column !== "source_id");
  const query = `
    INSERT INTO ${quoteIdent(tableName)} (${columns.map(quoteIdent).join(", ")})
    VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})
    ON CONFLICT (source_id) DO UPDATE SET
      ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}
    RETURNING id
  `;
  const rows = await tx.unsafe(query, values);
  return rows[0].id;
}

async function upsertLaunch(tx, data) {
  const columns = Object.keys(data);
  const values = columns.map((column) => data[column]);
  const updateColumns = columns.filter((column) => column !== "source_id");
  const query = `
    INSERT INTO launches (${columns.map(quoteIdent).join(", ")})
    VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})
    ON CONFLICT (source_id) DO UPDATE SET
      ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}
  `;
  await tx.unsafe(query, values);
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function pushParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function buildParam(params, whenTrue, whenFalse, condition, value) {
  const placeholder = pushParam(params, value);
  return condition ? `${whenTrue}${placeholder}` : `${whenFalse}${placeholder}`;
}
