import { buildEmptyState, buildStreamAction, describeCountdown, formatLaunchDate } from "./view-model.js";

const STATIC_MODE = Boolean(window.__LAUNCH_TRACKER_STATIC__);
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;
const STATIC_RELOAD_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  timeline: "upcoming",
  page: 1,
  pageSize: 24,
  organization: "",
  country: "",
  location: "",
  launches: [],
  totalPages: 1,
  totalResults: 0,
  totals: {
    launches: 0,
    upcoming: 0,
    past: 0
  },
  lastUpcomingSyncAt: null,
  staticData: null,
  lastStaticReloadAt: 0,
  lastDynamicRefreshAt: 0,
  refreshInFlight: false
};

const refs = {
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  syncStatus: document.getElementById("sync-status"),
  title: document.getElementById("results-title"),
  subtitle: document.getElementById("results-subtitle"),
  totalLaunches: document.getElementById("total-launches"),
  totalUpcoming: document.getElementById("total-upcoming"),
  totalPast: document.getElementById("total-past"),
  previousPage: document.getElementById("previous-page"),
  nextPage: document.getElementById("next-page"),
  pageIndicator: document.getElementById("page-indicator"),
  organizationFilter: document.getElementById("organization-filter"),
  countryFilter: document.getElementById("country-filter"),
  locationFilter: document.getElementById("location-filter"),
  tabUpcoming: document.getElementById("tab-upcoming"),
  tabPast: document.getElementById("tab-past"),
  resetFilters: document.getElementById("reset-filters")
};

bootstrap().catch((error) => {
  setStatus(error?.message || "Failed to load the launch tracker.", "error");
});

setInterval(() => {
  renderCountdowns();
  void maybeRefreshData();
}, 1000);

async function bootstrap() {
  bindEvents();
  if (STATIC_MODE) {
    await loadStaticData();
  }
  await loadFilters();
  await loadLaunches();
}

function bindEvents() {
  refs.tabUpcoming.addEventListener("click", () => updateTimeline("upcoming"));
  refs.tabPast.addEventListener("click", () => updateTimeline("past"));
  refs.organizationFilter.addEventListener("change", onFilterChange);
  refs.countryFilter.addEventListener("change", onFilterChange);
  refs.locationFilter.addEventListener("change", onFilterChange);
  refs.previousPage.addEventListener("click", () => changePage(-1));
  refs.nextPage.addEventListener("click", () => changePage(1));
  refs.resetFilters.addEventListener("click", resetFilters);
}

async function loadFilters() {
  if (STATIC_MODE) {
    ensureStaticDataLoaded();
    const payload = state.staticData.filters;
    state.totals = payload.totals;
    renderMetaTotals();
    renderSelectOptions(refs.organizationFilter, payload.organizations, "name", "id");
    renderSelectOptions(refs.countryFilter, payload.countries, "name", "code");
    renderSelectOptions(refs.locationFilter, payload.locations, "name", "id");
    return;
  }

  const response = await fetch("/api/filters");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to load launch filters.");
  }

  state.totals = payload.totals;
  renderMetaTotals();
  renderSelectOptions(refs.organizationFilter, payload.organizations, "name", "id");
  renderSelectOptions(refs.countryFilter, payload.countries, "name", "code");
  renderSelectOptions(refs.locationFilter, payload.locations, "name", "id");
}

async function loadLaunches() {
  setStatus(`Loading ${state.timeline} launches...`, "loading");
  updateTimelineButtons();

  if (STATIC_MODE) {
    ensureStaticDataLoaded();
    const payload = buildStaticLaunchPayload();
    applyLaunchPayload(payload);
    setStatus("Launch catalog ready.", "success");
    return;
  }

  const response = await fetch(buildLaunchUrl());
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to load launches.");
  }

  applyLaunchPayload(payload);
  setStatus("Launch catalog ready.", "success");
}

function buildLaunchUrl() {
  const url = new URL("/api/launches", window.location.origin);
  url.searchParams.set("timeline", state.timeline);
  url.searchParams.set("page", String(state.page));
  url.searchParams.set("pageSize", String(state.pageSize));

  if (state.organization) {
    url.searchParams.set("organization", state.organization);
  }
  if (state.country) {
    url.searchParams.set("country", state.country);
  }
  if (state.location) {
    url.searchParams.set("location", state.location);
  }

  return url;
}

function renderMetaTotals() {
  refs.totalLaunches.textContent = formatCount(state.totals.launches);
  refs.totalUpcoming.textContent = formatCount(state.totals.upcoming);
  refs.totalPast.textContent = formatCount(state.totals.past);
}

function renderResults() {
  refs.title.textContent = state.timeline === "upcoming" ? "Upcoming launches" : "Past launches";
  refs.subtitle.textContent = `Showing ${formatCount(state.totalResults)} launches`;
  refs.results.innerHTML = "";

  if (!state.launches.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state panel";
    empty.textContent = buildEmptyState({
      timeline: state.timeline,
      activeFiltersCount: activeFiltersCount()
    });
    refs.results.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.launches.forEach((launch, index) => {
    fragment.appendChild(renderLaunchCard(launch, index));
  });
  refs.results.appendChild(fragment);
}

function renderLaunchCard(launch, index) {
  const card = document.createElement("article");
  card.className = "launch-card panel";
  card.dataset.index = String(index);

  const header = document.createElement("div");
  header.className = "card-header";

  const badge = document.createElement("span");
  badge.className = `countdown-badge tone-${describeCountdown(launch).tone}`;
  badge.dataset.role = "countdown";

  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = launch.name;
  const status = document.createElement("p");
  status.className = "card-status";
  status.textContent = launch.status?.name || "Unknown status";
  titleWrap.append(title, status);
  header.append(badge, titleWrap);

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.append(
    createMetaRow("Organization", launch.organization?.name || "Unknown"),
    createMetaRow("Location", buildLocationLabel(launch)),
    createMetaRow("Country", launch.launchCountry?.name || launch.launchCountry?.code || "Unknown")
  );

  const timing = document.createElement("div");
  timing.className = "timing-block";

  const timeParts = formatLaunchDate(launch, {
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });

  const localTime = document.createElement("p");
  localTime.className = "timing-primary";
  localTime.textContent = timeParts.local;

  const utcTime = document.createElement("p");
  utcTime.className = "timing-secondary";
  utcTime.textContent = timeParts.utc;
  timing.append(localTime, utcTime);

  const footer = document.createElement("div");
  footer.className = "card-footer";

  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(
    createTag(launch.timeline === "upcoming" ? "Scheduled" : "Completed"),
    createTag(launch.isTimeExact ? "Exact T-0" : "NET / TBD")
  );

  if (launch.pad?.name) {
    tags.append(createTag(launch.pad.name));
  }

  footer.appendChild(tags);

  const streamAction = buildStreamAction(launch);
  if (streamAction) {
    const link = document.createElement("a");
    link.className = "stream-link";
    link.href = streamAction.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = streamAction.label;
    footer.appendChild(link);
  }

  card.append(header, meta, timing, footer);
  updateCardCountdown(card, launch);
  return card;
}

function renderPagination() {
  refs.pageIndicator.textContent = `Page ${state.page} of ${state.totalPages}`;
  refs.previousPage.disabled = state.page <= 1;
  refs.nextPage.disabled = state.page >= state.totalPages;
}

function renderSyncStatus() {
  if (!state.lastUpcomingSyncAt) {
    refs.syncStatus.textContent = STATIC_MODE
      ? "Published site data is available."
      : "Upcoming sync has not completed yet.";
    return;
  }

  const formatted = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(state.lastUpcomingSyncAt));

  refs.syncStatus.textContent = `Upcoming data last refreshed ${formatted}.`;
}

async function maybeRefreshData() {
  if (document.hidden || state.refreshInFlight) {
    return;
  }

  state.refreshInFlight = true;

  try {
    if (STATIC_MODE) {
      const now = Date.now();
      if (now - state.lastStaticReloadAt < STATIC_RELOAD_INTERVAL_MS) {
        return;
      }

      const pageBefore = state.page;
      await loadStaticData({ force: true });
      await loadFilters();
      state.page = pageBefore;
      await loadLaunches();
      return;
    }

    const now = Date.now();
    if (now - state.lastDynamicRefreshAt < AUTO_REFRESH_INTERVAL_MS) {
      return;
    }

    state.lastDynamicRefreshAt = now;
    await loadFilters();
    await loadLaunches();
  } finally {
    state.refreshInFlight = false;
  }
}

function renderCountdowns() {
  const cards = refs.results.querySelectorAll(".launch-card");
  cards.forEach((card) => {
    const index = Number(card.dataset.index);
    const launch = state.launches[index];
    if (launch) {
      updateCardCountdown(card, launch);
    }
  });
}

function updateCardCountdown(card, launch) {
  const badge = card.querySelector('[data-role="countdown"]');
  if (!badge) {
    return;
  }

  const countdown = describeCountdown(launch, Date.now());
  badge.className = `countdown-badge tone-${countdown.tone}`;
  badge.textContent = countdown.text;
}

function renderSelectOptions(select, items, labelKey, valueKey) {
  const currentValue = select.value;
  const defaultOption = select.querySelector('option[value=""]');
  select.innerHTML = "";
  select.append(defaultOption);

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item[valueKey];
    option.textContent = item[labelKey];
    select.append(option);
  });

  select.value = currentValue;
}

async function loadStaticData({ force = false } = {}) {
  const url = new URL("./data/site-data.json", window.location.href);
  if (force) {
    url.searchParams.set("ts", String(Date.now()));
  }

  const response = await fetch(url, {
    cache: force ? "no-store" : "default"
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Unable to load published launch data.");
  }

  state.staticData = payload;
  state.lastStaticReloadAt = Date.now();
  state.lastUpcomingSyncAt = payload.sync?.upcomingLastCompletedAt || payload.generatedAt || null;
}

function ensureStaticDataLoaded() {
  if (!state.staticData) {
    throw new Error("Static site data has not loaded yet.");
  }
}

function buildStaticLaunchPayload() {
  const now = Date.now();
  const launches = state.staticData.launches
    .filter((launch) => {
      const launchTime = Date.parse(launch.net);
      return state.timeline === "upcoming" ? launchTime >= now : launchTime < now;
    })
    .filter((launch) => (state.organization ? launch.organization?.id === state.organization : true))
    .filter((launch) => (state.country ? launch.launchCountry?.code === state.country : true))
    .filter((launch) => (state.location ? launch.location?.id === state.location : true))
    .sort((left, right) => {
      const leftTime = Date.parse(left.net);
      const rightTime = Date.parse(right.net);
      return state.timeline === "upcoming" ? leftTime - rightTime : rightTime - leftTime;
    });

  const totalResults = launches.length;
  const totalPages = totalResults ? Math.ceil(totalResults / state.pageSize) : 1;
  const safePage = Math.min(Math.max(state.page, 1), totalPages);
  const start = (safePage - 1) * state.pageSize;

  return {
    items: launches.slice(start, start + state.pageSize),
    page: safePage,
    totalPages,
    totalResults,
    lastUpcomingSyncAt: state.staticData.sync?.upcomingLastCompletedAt || state.staticData.generatedAt || null
  };
}

function applyLaunchPayload(payload) {
  state.launches = payload.items || [];
  state.page = payload.page || 1;
  state.totalPages = payload.totalPages || 1;
  state.totalResults = payload.totalResults || 0;
  state.lastUpcomingSyncAt = payload.lastUpcomingSyncAt || null;
  renderResults();
  renderPagination();
  renderSyncStatus();
}

function createMetaRow(label, value) {
  const row = document.createElement("p");
  row.className = "meta-row";
  row.innerHTML = `<span>${label}</span><strong>${escapeHtml(value)}</strong>`;
  return row;
}

function createTag(text) {
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = text;
  return tag;
}

function setStatus(message, tone) {
  refs.status.textContent = message;
  refs.status.dataset.tone = tone;
}

function updateTimelineButtons() {
  refs.tabUpcoming.classList.toggle("is-active", state.timeline === "upcoming");
  refs.tabPast.classList.toggle("is-active", state.timeline === "past");
}

function updateTimeline(timeline) {
  if (timeline === state.timeline) {
    return;
  }

  state.timeline = timeline;
  state.page = 1;
  loadLaunches().catch((error) => setStatus(error?.message || "Unable to change timeline.", "error"));
}

function onFilterChange() {
  state.organization = refs.organizationFilter.value;
  state.country = refs.countryFilter.value;
  state.location = refs.locationFilter.value;
  state.page = 1;
  loadLaunches().catch((error) => setStatus(error?.message || "Unable to update filters.", "error"));
}

function changePage(direction) {
  const nextPage = state.page + direction;
  if (nextPage < 1 || nextPage > state.totalPages) {
    return;
  }

  state.page = nextPage;
  loadLaunches().catch((error) => setStatus(error?.message || "Unable to change page.", "error"));
}

function resetFilters() {
  refs.organizationFilter.value = "";
  refs.countryFilter.value = "";
  refs.locationFilter.value = "";
  onFilterChange();
}

function activeFiltersCount() {
  return Number(Boolean(state.organization)) + Number(Boolean(state.country)) + Number(Boolean(state.location));
}

function buildLocationLabel(launch) {
  return [launch.pad?.name, launch.location?.name].filter(Boolean).join(" • ") || "Unknown";
}

function formatCount(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
