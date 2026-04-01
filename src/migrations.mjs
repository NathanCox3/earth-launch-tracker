const MIGRATIONS = [
  {
    name: "001_launch_tracker_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS organizations (
        id BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        abbrev TEXT,
        type TEXT,
        country_code TEXT,
        country_name TEXT,
        info_url TEXT,
        wiki_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS locations (
        id BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        country_code TEXT,
        country_name TEXT,
        timezone_name TEXT,
        map_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pads (
        id BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
        country_code TEXT,
        country_name TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        map_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS launches (
        source_id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status_name TEXT NOT NULL,
        status_abbrev TEXT,
        status_description TEXT,
        net TIMESTAMPTZ NOT NULL,
        window_start TIMESTAMPTZ,
        window_end TIMESTAMPTZ,
        is_time_exact BOOLEAN NOT NULL DEFAULT FALSE,
        is_suborbital BOOLEAN NOT NULL DEFAULT FALSE,
        organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
        launch_country_code TEXT,
        launch_country_name TEXT,
        location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
        pad_id BIGINT REFERENCES pads(id) ON DELETE SET NULL,
        image_url TEXT,
        primary_stream_url TEXT,
        primary_stream_title TEXT,
        primary_stream_publisher TEXT,
        primary_stream_live BOOLEAN NOT NULL DEFAULT FALSE,
        source_last_updated TIMESTAMPTZ,
        last_synced_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS videos (
        id BIGSERIAL PRIMARY KEY,
        launch_source_id TEXT NOT NULL REFERENCES launches(source_id) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        title TEXT,
        publisher TEXT,
        priority INTEGER,
        is_live BOOLEAN NOT NULL DEFAULT FALSE,
        start_time TIMESTAMPTZ,
        end_time TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (launch_source_id, source_url)
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS launches_net_idx ON launches (net);
      CREATE INDEX IF NOT EXISTS launches_org_idx ON launches (organization_id);
      CREATE INDEX IF NOT EXISTS launches_country_idx ON launches (launch_country_code);
      CREATE INDEX IF NOT EXISTS launches_location_idx ON launches (location_id);
      CREATE INDEX IF NOT EXISTS videos_launch_idx ON videos (launch_source_id);
    `
  }
];

export async function applyMigrations({ sql, log = () => {} }) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRows = await sql.unsafe("SELECT name FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.name));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) {
      continue;
    }

    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx.unsafe("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
    });

    log(`Applied migration ${migration.name}`);
  }
}
