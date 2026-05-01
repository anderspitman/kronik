const PROJECTS_FILE = "projects.tsv";
const TIMES_FILE = "times.tsv";
const CONFIG_KEY = "kronik-webdav-config";
const THEME_KEY = "kronik-theme";
const EMPTY_PROJECTS_TSV = "id\tdisplay_name\n";
const EMPTY_TIMES_TSV = "timestamp\tproject_id\taction\n";
const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_HEIGHT = 96;
const CHART_MARGIN_TOP = 8;
const CHART_MARGIN_RIGHT = 36;
const CHART_MARGIN_BOTTOM = 28;
const CHART_MARGIN_LEFT = 36;
const CHART_MIN_WIDTH = 240;
const CHART_MIN_BAR_HEIGHT = 2;
const CHART_TICK_SIZE = 4;
const TIMELINE_MARGIN_TOP = 8;
const TIMELINE_MARGIN_BOTTOM = 28;
const TIMELINE_ROW_HEIGHT = 24;
const TIMELINE_ROW_GAP = 6;
const TIMELINE_BAR_HEIGHT = 12;
const TIMELINE_MIN_HEIGHT = 72;
const VALID_ACTIONS = new Set(["clock_in", "clock_out"]);
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const longDateFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const state = {
  config: loadConfig(),
  theme: loadThemePreference(),
  projects: [],
  times: [],
  remote: defaultRemoteState(),
  today: todayString(),
  dirty: false,
  loaded: false,
  busy: false,
  saving: false,
  pendingSave: false
};

const statusText = document.querySelector("#status-text");
const todayLabel = document.querySelector("#today-label");
const overviewTotal = document.querySelector("#overview-total");
const overviewEmpty = document.querySelector("#overview-empty");
const overviewChart = document.querySelector("#overview-chart");
const overviewRange = document.querySelector("#overview-range");
const overviewHistoryChart = document.querySelector("#overview-history-chart");
const overviewTimelineChart = document.querySelector("#overview-timeline-chart");
const overviewLegend = document.querySelector("#overview-legend");
const projectsEmpty = document.querySelector("#projects-empty");
const projectsList = document.querySelector("#projects-list");
const projectTemplate = document.querySelector("#project-template");
const loadButton = document.querySelector("#load-button");
const saveButton = document.querySelector("#save-button");
const themeToggleButton = document.querySelector("#theme-toggle-button");
const projectForm = document.querySelector("#project-form");
const projectMenu = document.querySelector("#project-menu");
const projectNameInput = document.querySelector("#project-name");
const configForm = document.querySelector("#config-form");
const configMenu = document.querySelector("#config-menu");
const configSummaryText = document.querySelector("#config-summary-text");
const webdavUrlInput = document.querySelector("#webdav-url");
const webdavUserInput = document.querySelector("#webdav-user");
const webdavPasswordInput = document.querySelector("#webdav-password");
const clearConfigButton = document.querySelector("#clear-config-button");
const clockButtons = document.querySelector("#clock-buttons");
const chartTooltip = document.querySelector("#chart-tooltip");
const chartTooltipDate = document.querySelector("#chart-tooltip-date");
const chartTooltipValue = document.querySelector("#chart-tooltip-value");
let resizeRenderTimer = 0;
let viewportRestoreFrame = 0;

applyThemePreference();
hydrateConfigForm();
render();
void maybeAutoLoad();

window.setInterval(() => {
  if (state.loaded && currentStatus().projectId) {
    render();
  }
}, 60000);

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});

loadButton.addEventListener("click", async () => {
  syncConfigFromForm();
  if (await loadRemoteState()) {
    configMenu.open = false;
  }
});

saveButton.addEventListener("click", () => {
  queueSave("Saving changes in the background.");
});

themeToggleButton.addEventListener("click", () => {
  state.theme = resolvedTheme() === "dark" ? "light" : "dark";
  persistThemePreference();
  applyThemePreference();
  render();
});

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!state.loaded) {
    setStatus("Load data before adding a project.", true);
    return;
  }

  const displayName = sanitizeField(projectNameInput.value);
  if (!displayName) {
    setStatus("Project name is required.", true);
    return;
  }

  if (state.projects.some((project) => project.displayName.toLowerCase() === displayName.toLowerCase())) {
    setStatus(`Project "${displayName}" already exists.`, true);
    return;
  }

  state.projects.push({
    id: nextProjectId(displayName),
    displayName
  });

  projectNameInput.value = "";
  projectMenu.open = false;
  markDirty(`Project "${displayName}" added locally. Saving in the background.`);
  render();
});

configForm.addEventListener("input", () => {
  syncConfigFromForm();
  render();
});

clearConfigButton.addEventListener("click", () => {
  clearStoredConfig();
});

clockButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-clock-action]");

  if (!button) {
    return;
  }

  if (button.dataset.clockAction === "clock-out") {
    clockOut();
    return;
  }

  clockIn(button.dataset.projectId || "");
});

registerThemeChangeListener(() => {
  if (state.theme) {
    return;
  }

  render();
});

[projectsList, overviewChart].forEach((container) => {
  container.addEventListener("pointermove", (event) => {
    const bar = closestChartBar(event.target);

    if (!bar) {
      hideChartTooltip();
      return;
    }

    showChartTooltip(bar, event.clientX, event.clientY);
  });

  container.addEventListener("pointerleave", () => {
    hideChartTooltip();
  });

  container.addEventListener("pointerdown", () => {
    hideChartTooltip();
  });
});

window.addEventListener("scroll", () => {
  hideChartTooltip();
}, true);

window.addEventListener("resize", () => {
  window.clearTimeout(resizeRenderTimer);
  resizeRenderTimer = window.setTimeout(() => {
    if (!state.loaded) {
      return;
    }

    render();
  }, 50);
});

async function maybeAutoLoad() {
  if (!hasStoredConnection()) {
    return;
  }

  await loadRemoteState();
}

function loadConfig() {
  try {
    return {
      ...defaultConfig(),
      ...(JSON.parse(window.localStorage.getItem(CONFIG_KEY)) || {})
    };
  } catch (error) {
    return defaultConfig();
  }
}

function loadThemePreference() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "";
  } catch (error) {
    return "";
  }
}

function defaultConfig() {
  return {
    baseUrl: "",
    username: "",
    password: ""
  };
}

function defaultRemoteState() {
  return {
    projectsEtag: "",
    timesEtag: "",
    loadedAt: "",
    projectsMissing: false,
    timesMissing: false
  };
}

function resolvedTheme() {
  return state.theme || (themeMediaQuery.matches ? "dark" : "light");
}

function applyThemePreference() {
  if (state.theme) {
    document.documentElement.dataset.theme = state.theme;
    return;
  }

  delete document.documentElement.dataset.theme;
}

function persistThemePreference() {
  try {
    if (state.theme) {
      window.localStorage.setItem(THEME_KEY, state.theme);
    } else {
      window.localStorage.removeItem(THEME_KEY);
    }
  } catch (error) {
    // Keep the in-memory preference if storage is unavailable.
  }
}

function registerThemeChangeListener(listener) {
  if (typeof themeMediaQuery.addEventListener === "function") {
    themeMediaQuery.addEventListener("change", listener);
    return;
  }

  if (typeof themeMediaQuery.addListener === "function") {
    themeMediaQuery.addListener(listener);
  }
}

function hydrateConfigForm() {
  webdavUrlInput.value = state.config.baseUrl;
  webdavUserInput.value = state.config.username;
  webdavPasswordInput.value = state.config.password;
}

function syncConfigFromForm() {
  state.config = {
    baseUrl: webdavUrlInput.value.trim().replace(/\/+$/, ""),
    username: webdavUserInput.value.trim(),
    password: webdavPasswordInput.value
  };

  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
}

function clearStoredConfig() {
  state.config = defaultConfig();
  window.localStorage.removeItem(CONFIG_KEY);
  hydrateConfigForm();
  configMenu.open = false;
  setStatus("Saved WebDAV connection cleared.");
  render();
}

function hasStoredConnection() {
  return Boolean(state.config.baseUrl && (state.config.password || state.config.username));
}

function authHeaders() {
  const headers = {};

  if (state.config.username) {
    headers.Authorization = `Basic ${window.btoa(`${state.config.username}:${state.config.password}`)}`;
  }

  return headers;
}

function buildUrl(name) {
  return `${state.config.baseUrl}/${encodeURIComponent(name)}`;
}

async function webdavFetch(name, options = {}) {
  if (!state.config.baseUrl) {
    throw new Error("A WebDAV base URL is required.");
  }

  return window.fetch(buildUrl(name), {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
}

async function readRemoteFile(name, emptyText) {
  const response = await webdavFetch(name, {
    cache: "no-store",
    headers: {
      Accept: "text/tab-separated-values,text/plain;q=0.9,*/*;q=0.1"
    }
  });

  if (response.status === 404) {
    return {
      text: emptyText,
      etag: "",
      missing: true
    };
  }

  if (!response.ok) {
    throw new Error(`${name} load failed with ${response.status}.`);
  }

  return {
    text: await response.text(),
    etag: response.headers.get("etag") || "",
    missing: false
  };
}

async function loadRemoteState() {
  setBusy(true);
  setStatus("Loading TSV files from WebDAV.");

  try {
    const [projectsFile, timesFile] = await Promise.all([
      readRemoteFile(PROJECTS_FILE, EMPTY_PROJECTS_TSV),
      readRemoteFile(TIMES_FILE, EMPTY_TIMES_TSV)
    ]);

    state.projects = parseProjects(projectsFile.text);
    state.times = parseTimes(timesFile.text);
    state.today = todayString();
    state.loaded = true;
    state.dirty = false;
    state.remote = {
      projectsEtag: projectsFile.etag,
      timesEtag: timesFile.etag,
      loadedAt: timestampString(),
      projectsMissing: projectsFile.missing,
      timesMissing: timesFile.missing
    };

    if (projectsFile.missing || timesFile.missing) {
      setStatus("Connected. Missing TSV files were initialized locally and will be created on first save.");
    } else {
      setStatus(`Loaded ${state.projects.length} projects from WebDAV.`);
    }

    render();
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  } finally {
    setBusy(false);
  }
}

async function saveRemoteState() {
  if (!state.loaded) {
    setStatus("Load data before saving.", true);
    return;
  }

  state.saving = true;
  render();
  setStatus("Uploading TSV files to WebDAV.");

  try {
    const [projectsResponse, timesResponse] = await Promise.all([
      writeRemoteFile(PROJECTS_FILE, serializeProjects(state.projects), state.remote.projectsEtag),
      writeRemoteFile(TIMES_FILE, serializeTimes(state.times), state.remote.timesEtag)
    ]);

    state.remote.projectsEtag = projectsResponse.headers.get("etag") || "";
    state.remote.timesEtag = timesResponse.headers.get("etag") || "";
    state.remote.projectsMissing = false;
    state.remote.timesMissing = false;
    state.remote.loadedAt = timestampString();
    state.dirty = false;
    state.pendingSave = false;

    setStatus("Changes uploaded.");
    render();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.saving = false;
    render();

    if (state.pendingSave) {
      state.pendingSave = false;
      queueSave("Uploading latest local changes.");
    }
  }
}

function queueSave(message) {
  if (!state.loaded) {
    setStatus("Load data before saving.", true);
    return;
  }

  if (!state.dirty && !state.remote.projectsMissing && !state.remote.timesMissing) {
    render();
    return;
  }

  if (message) {
    setStatus(message);
  }

  if (state.saving) {
    state.pendingSave = true;
    render();
    return;
  }

  void saveRemoteState();
}

async function writeRemoteFile(name, body, etag) {
  const headers = {
    "Content-Type": "text/tab-separated-values; charset=utf-8"
  };
  let response;

  if (etag) {
    headers["If-Match"] = etag;
  }

  response = await webdavFetch(name, {
    method: "PUT",
    headers,
    body
  });

  if (response.status === 412) {
    throw new Error(`${name} changed on the server since your last load. Reload before saving again.`);
  }

  if (!response.ok) {
    throw new Error(`${name} save failed with ${response.status}.`);
  }

  return response;
}

function parseProjects(text) {
  return parseTsv(text)
    .map((row) => ({
      id: sanitizeId(row.id || ""),
      displayName: sanitizeField(row.display_name || "")
    }))
    .filter((project) => project.id && project.displayName);
}

function parseTimes(text) {
  return parseTsv(text)
    .map((row) => ({
      timestamp: sanitizeField(row.timestamp || ""),
      projectId: sanitizeId(row.project_id || ""),
      action: sanitizeField(row.action || "")
    }))
    .filter((entry) => entry.timestamp && entry.projectId && VALID_ACTIONS.has(entry.action) && isValidTimestamp(entry.timestamp));
}

function parseTsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const columns = line.split("\t");
    return headers.reduce((row, header, index) => {
      row[header] = columns[index] || "";
      return row;
    }, {});
  });
}

function serializeProjects(projects) {
  const rows = [EMPTY_PROJECTS_TSV.trimEnd()];
  const sorted = [...projects].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" })
  );

  sorted.forEach((project) => {
    rows.push([sanitizeId(project.id), sanitizeField(project.displayName)].join("\t"));
  });

  return `${rows.join("\n")}\n`;
}

function serializeTimes(times) {
  const rows = [EMPTY_TIMES_TSV.trimEnd()];
  const sorted = sortEvents(times);

  sorted.forEach((entry) => {
    rows.push([sanitizeField(entry.timestamp), sanitizeId(entry.projectId), entry.action].join("\t"));
  });

  return `${rows.join("\n")}\n`;
}

function sanitizeField(value) {
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

function sanitizeId(value) {
  return sanitizeField(value).replace(/\s+/g, "_");
}

function slugify(value) {
  return sanitizeField(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "project";
}

function nextProjectId(displayName) {
  const base = slugify(displayName);
  const usedIds = new Set(state.projects.map((project) => project.id));
  let candidate = base;
  let index = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }

  return candidate;
}

function clockIn(projectId) {
  const project = state.projects.find((entry) => entry.id === projectId);
  const status = currentStatus();
  const timestamp = timestampString();

  if (!state.loaded) {
    setStatus("Load data before clocking in.", true);
    return;
  }

  if (!project) {
    setStatus("Unknown project.", true);
    return;
  }

  if (status.projectId === projectId) {
    setStatus(`Already clocked in to ${project.displayName}.`);
    return;
  }

  if (status.projectId) {
    state.times.push({
      timestamp,
      projectId: status.projectId,
      action: "clock_out"
    });
  }

  state.times.push({
    timestamp,
    projectId,
    action: "clock_in"
  });

  markDirty(`Clocked in to ${project.displayName}. Saving in the background.`);
  render();
}

function clockOut() {
  const status = currentStatus();
  const project = state.projects.find((entry) => entry.id === status.projectId);

  if (!state.loaded) {
    setStatus("Load data before clocking out.", true);
    return;
  }

  if (!status.projectId) {
    setStatus("No project is currently clocked in.");
    return;
  }

  state.times.push({
    timestamp: timestampString(),
    projectId: status.projectId,
    action: "clock_out"
  });

  markDirty(`Clocked out${project ? ` of ${project.displayName}` : ""}. Saving in the background.`);
  render();
}

function sortEvents(times) {
  return [...times].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    if (left.action !== right.action) {
      return left.action === "clock_out" ? -1 : 1;
    }

    return left.projectId.localeCompare(right.projectId);
  });
}

function currentStatus() {
  let projectId = "";
  let since = "";

  sortEvents(state.times).forEach((entry) => {
    if (entry.action === "clock_in") {
      projectId = entry.projectId;
      since = entry.timestamp;
      return;
    }

    if (!projectId || entry.projectId === projectId) {
      projectId = "";
      since = "";
    }
  });

  return {
    projectId,
    since
  };
}

function buildMinuteIndex() {
  const totalsByProject = new Map();
  const todayByProject = new Map();
  const minutesByDate = new Map();
  const sessionSegments = [];
  const events = sortEvents(state.times);
  const now = new Date();
  let activeProjectId = "";
  let activeStart = null;
  let firstDate = "";
  let lastDate = "";

  events.forEach((entry) => {
    const eventDate = new Date(entry.timestamp);

    if (entry.action === "clock_in") {
      if (activeProjectId && activeStart && eventDate > activeStart) {
        addSession(activeProjectId, activeStart, eventDate);
      }

      activeProjectId = entry.projectId;
      activeStart = eventDate;
      return;
    }

    if (activeProjectId && activeStart && entry.projectId === activeProjectId && eventDate > activeStart) {
      addSession(activeProjectId, activeStart, eventDate);
      activeProjectId = "";
      activeStart = null;
    }
  });

  if (activeProjectId && activeStart && now > activeStart) {
    addSession(activeProjectId, activeStart, now);
  }

  function addSession(projectId, start, end) {
    splitSessionByDate(start, end).forEach((segment) => {
      const minutes = Math.max(0, Math.round((segment.end - segment.start) / 60000));

      if (!minutes) {
        return;
      }

      sessionSegments.push({
        projectId,
        date: segment.date,
        start: segment.start,
        end: segment.end,
        minutes
      });
      totalsByProject.set(projectId, (totalsByProject.get(projectId) || 0) + minutes);

      if (segment.date === state.today) {
        todayByProject.set(projectId, (todayByProject.get(projectId) || 0) + minutes);
      }

      if (!minutesByDate.has(segment.date)) {
        minutesByDate.set(segment.date, {
          totalMinutes: 0,
          byProject: new Map()
        });
      }

      {
        const day = minutesByDate.get(segment.date);

        day.totalMinutes += minutes;
        day.byProject.set(projectId, (day.byProject.get(projectId) || 0) + minutes);
      }

      if (!firstDate || segment.date < firstDate) {
        firstDate = segment.date;
      }

      if (!lastDate || segment.date > lastDate) {
        lastDate = segment.date;
      }
    });
  }

  return {
    totalsByProject,
    todayByProject,
    minutesByDate,
    sessionSegments,
    firstDate,
    lastDate
  };
}

function splitSessionByDate(start, end) {
  const segments = [];
  let cursor = new Date(start);

  while (cursor < end) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);

    {
      const segmentEnd = nextMidnight < end ? nextMidnight : end;
      segments.push({
        date: dateKeyFromDate(cursor),
        start: new Date(cursor),
        end: new Date(segmentEnd)
      });
      cursor = new Date(segmentEnd);
    }
  }

  return segments;
}

function isValidTimestamp(timestamp) {
  return Number.isFinite(Date.parse(timestamp));
}

function formatDuration(minutes) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;

  if (!hours) {
    return `${remainder}m`;
  }

  if (!remainder) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

function formatHours(minutes) {
  const hours = minutes / 60;

  if (Number.isInteger(hours)) {
    return String(hours);
  }

  return hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDurationLabel(minutes) {
  const hours = minutes / 60;

  if (minutes < 60) {
    return `${Math.round(minutes)} minute${Math.round(minutes) === 1 ? "" : "s"}`;
  }

  return `${formatHours(minutes)} hour${hours === 1 ? "" : "s"}`;
}

function formatPercent(ratio) {
  const percentage = ratio * 100;
  const decimals = Number.isInteger(percentage) || percentage >= 99.95 ? 0 : 1;
  return `${percentage.toFixed(decimals).replace(/\.0$/, "")}%`;
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = parseDateKey(startDate);
  const end = parseDateKey(endDate);

  while (cursor <= end) {
    dates.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatShortDate(dateKey) {
  return shortDateFormatter.format(parseDateKey(dateKey));
}

function formatLongDate(dateKey) {
  return longDateFormatter.format(parseDateKey(dateKey));
}

function formatTime(timestamp) {
  return timeFormatter.format(new Date(timestamp));
}

function formatHistoryRange(history) {
  if (!history.length) {
    return "";
  }

  if (history.length === 1) {
    return formatShortDate(history[0].date);
  }

  return `${formatShortDate(history[0].date)} - ${formatShortDate(history[history.length - 1].date)}`;
}

function formatAxisHours(hours) {
  if (Number.isInteger(hours)) {
    return `${hours}h`;
  }

  return `${hours.toFixed(1).replace(/\.0$/, "")}h`;
}

function buildYAxis(maxMinutes) {
  const normalizedMaxHours = Math.max(maxMinutes / 60, 1);
  const rawStep = normalizedMaxHours / 3;
  const candidates = [0.5, 1, 2, 4, 6, 8, 12];
  const stepHours = candidates.find((step) => step >= rawStep) || 12;
  const maxHours = Math.ceil(normalizedMaxHours / stepHours) * stepHours;
  const ticks = [];

  for (let hours = 0; hours <= maxHours + 0.0001; hours += stepHours) {
    ticks.push(Number(hours.toFixed(2)));
  }

  return {
    maxHours,
    ticks
  };
}

function buildXAxisTicks(history) {
  const lastIndex = history.length - 1;
  const desiredTickCount = history.length <= 7 ? history.length : history.length <= 21 ? 6 : 5;
  const indices = new Set([0, lastIndex]);
  const step = Math.max(1, Math.ceil(lastIndex / Math.max(1, desiredTickCount - 1)));

  for (let index = step; index < lastIndex; index += step) {
    indices.add(index);
  }

  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => ({
      index,
      date: history[index].date
    }));
}

function historyRangeFromIndex(minuteIndex) {
  const startDate = minuteIndex.firstDate || state.today;
  const lastRecordedDate = minuteIndex.lastDate || state.today;
  const endDate = state.today > lastRecordedDate ? state.today : lastRecordedDate;

  return {
    startDate,
    endDate
  };
}

function historyDatesFromIndex(minuteIndex) {
  const { startDate, endDate } = historyRangeFromIndex(minuteIndex);
  return enumerateDates(startDate, endDate);
}

function projectOverviewColor(index, theme) {
  const hue = Math.round((18 + index * 137.508) % 360);
  const saturation = theme === "dark" ? 68 : 62;
  const lightness = theme === "dark" ? 56 : 44;

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function buildProjectHistory(project, minuteIndex) {
  return historyDatesFromIndex(minuteIndex).map((date) => {
    const day = minuteIndex.minutesByDate.get(date);
    const minutes = day ? day.byProject.get(project.id) || 0 : 0;
    const dateLabel = formatLongDate(date);
    const isToday = date === state.today;

    return {
      date,
      minutes,
      segments: minutes
        ? [
            {
              minutes,
              className: ["project-history-bar", isToday ? "is-today" : ""].filter(Boolean).join(" "),
              tooltipDate: dateLabel,
              tooltipValue: formatDurationLabel(minutes),
              ariaLabel: `${dateLabel}: ${formatDurationLabel(minutes)}`
            }
          ]
        : [],
      zeroBar: {
        className: ["project-history-bar", "is-zero", isToday ? "is-today" : ""]
          .filter(Boolean)
          .join(" "),
        tooltipDate: dateLabel,
        tooltipValue: "0 minutes",
        ariaLabel: `${dateLabel}: 0 minutes`
      }
    };
  });
}

function buildProjectOverview(projects, minuteIndex, theme) {
  const items = projects
    .map((project) => ({
      id: project.id,
      displayName: project.displayName,
      totalMinutes: minuteIndex.totalsByProject.get(project.id) || 0
    }))
    .sort((left, right) => {
      if (right.totalMinutes !== left.totalMinutes) {
        return right.totalMinutes - left.totalMinutes;
      }

      return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
    });
  const totalMinutes = items.reduce((sum, item) => sum + item.totalMinutes, 0);
  const activeItems = items
    .filter((item) => item.totalMinutes > 0)
    .map((item, index) => ({
      ...item,
      ratio: totalMinutes ? item.totalMinutes / totalMinutes : 0,
      color: projectOverviewColor(index, theme)
    }));
  const history = activeItems.length
    ? historyDatesFromIndex(minuteIndex).map((date) => {
        const day = minuteIndex.minutesByDate.get(date);
        const minutes = day ? day.totalMinutes : 0;
        const dateLabel = formatLongDate(date);
        const isToday = date === state.today;
        const segments = activeItems
          .map((item) => ({
            ...item,
            minutes: day ? day.byProject.get(item.id) || 0 : 0
          }))
          .filter((item) => item.minutes > 0)
          .map((item) => ({
            minutes: item.minutes,
            className: ["project-overview-segment", isToday ? "is-today" : ""].filter(Boolean).join(" "),
            fill: item.color,
            tooltipDate: dateLabel,
            tooltipValue:
              `${item.displayName}: ${formatDurationLabel(item.minutes)} ` +
              `(${formatPercent(minutes ? item.minutes / minutes : 0)} of day, ${formatPercent(item.ratio)} overall)`,
            ariaLabel: `${dateLabel} ${item.displayName}: ${formatDurationLabel(item.minutes)}`
          }));

        return {
          date,
          minutes,
          segments,
          zeroBar: {
            className: ["project-overview-zero-bar", isToday ? "is-today" : ""].filter(Boolean).join(" "),
            tooltipDate: dateLabel,
            tooltipValue: "0 minutes",
            ariaLabel: `${dateLabel}: 0 minutes`
          }
        };
      })
    : [];
  const timeline = activeItems.length
    ? buildProjectTimeline(activeItems, history, minuteIndex.sessionSegments)
    : [];

  return {
    totalMinutes,
    totalProjects: items.length,
    activeItems,
    inactiveCount: items.length - activeItems.length,
    history,
    timeline
  };
}

function buildProjectTimeline(projects, history, sessionSegments) {
  const dateIndices = new Map(history.map((entry, index) => [entry.date, index]));

  return projects.map((project) => {
    const ranges = sessionSegments
      .filter((segment) => segment.projectId === project.id && dateIndices.has(segment.date))
      .map((segment) => ({
        dateIndex: dateIndices.get(segment.date),
        date: segment.date,
        start: segment.start,
        end: segment.end,
        minutes: segment.minutes,
        startRatio: dayProgress(segment.start),
        endRatio: dayProgress(segment.end, segment.date)
      }));

    return {
      ...project,
      ranges
    };
  });
}

function dayProgress(date, segmentDate) {
  if (segmentDate && dateKeyFromDate(date) > segmentDate) {
    return 1;
  }

  const startOfDay = new Date(date);

  startOfDay.setHours(0, 0, 0, 0);
  const nextDay = new Date(startOfDay);

  nextDay.setDate(nextDay.getDate() + 1);

  return Math.min(1, Math.max(0, (date - startOfDay) / (nextDay - startOfDay)));
}

function closestChartBar(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(".project-history-bar, .project-overview-segment, .project-overview-zero-bar, .project-timeline-segment");
}

function showChartTooltip(bar, clientX, clientY) {
  chartTooltipDate.textContent = bar.dataset.tooltipDate || "";
  chartTooltipValue.textContent = bar.dataset.tooltipValue || "";
  chartTooltip.classList.add("is-visible");
  chartTooltip.setAttribute("aria-hidden", "false");
  positionChartTooltip(clientX, clientY);
}

function hideChartTooltip() {
  chartTooltip.classList.remove("is-visible");
  chartTooltip.setAttribute("aria-hidden", "true");
}

function positionChartTooltip(clientX, clientY) {
  const horizontalPadding = 12;
  const verticalPadding = 14;
  const { width, height } = chartTooltip.getBoundingClientRect();
  let left = clientX - width / 2;
  let top = clientY - height - verticalPadding;

  if (left < 8) {
    left = 8;
  } else if (left + width > window.innerWidth - 8) {
    left = window.innerWidth - width - 8;
  }

  if (top < 8) {
    top = clientY + horizontalPadding;
  }

  chartTooltip.style.left = `${left}px`;
  chartTooltip.style.top = `${top}px`;
}

function renderStackedHistoryChart(container, chartLabel, history) {
  const chartWidth = Math.max(Math.round(container.getBoundingClientRect().width), CHART_MIN_WIDTH);
  const plotLeft = CHART_MARGIN_LEFT;
  const plotTop = CHART_MARGIN_TOP;
  const plotBottom = CHART_HEIGHT - CHART_MARGIN_BOTTOM;
  const plotRight = chartWidth - CHART_MARGIN_RIGHT;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = Math.max(plotRight - plotLeft, history.length);
  const slotWidth = plotWidth / history.length;
  const barWidth = Math.max(slotWidth * 0.72, Math.min(1, slotWidth));
  const maxMinutes = Math.max(...history.map((entry) => entry.minutes), 0);
  const yAxis = buildYAxis(maxMinutes);
  const xTicks = buildXAxisTicks(history);
  const svg = document.createElementNS(SVG_NS, "svg");

  container.replaceChildren();

  svg.setAttribute("viewBox", `0 0 ${chartWidth} ${CHART_HEIGHT}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${chartLabel} from ${history[0].date} to ${history[history.length - 1].date}`);
  svg.classList.add("project-history-svg");

  yAxis.ticks.forEach((tickHours) => {
    const y = plotBottom - (tickHours / yAxis.maxHours) * plotHeight;
    const gridLine = document.createElementNS(SVG_NS, "line");
    const leftTick = document.createElementNS(SVG_NS, "line");
    const rightTick = document.createElementNS(SVG_NS, "line");
    const leftLabel = document.createElementNS(SVG_NS, "text");
    const rightLabel = document.createElementNS(SVG_NS, "text");

    gridLine.setAttribute("x1", String(plotLeft));
    gridLine.setAttribute("x2", String(plotRight));
    gridLine.setAttribute("y1", String(y));
    gridLine.setAttribute("y2", String(y));
    gridLine.setAttribute("class", tickHours === 0 ? "project-history-axis" : "project-history-gridline");
    svg.appendChild(gridLine);

    leftTick.setAttribute("x1", String(plotLeft - CHART_TICK_SIZE));
    leftTick.setAttribute("x2", String(plotLeft));
    leftTick.setAttribute("y1", String(y));
    leftTick.setAttribute("y2", String(y));
    leftTick.setAttribute("class", "project-history-axis-tick");
    svg.appendChild(leftTick);

    rightTick.setAttribute("x1", String(plotRight));
    rightTick.setAttribute("x2", String(plotRight + CHART_TICK_SIZE));
    rightTick.setAttribute("y1", String(y));
    rightTick.setAttribute("y2", String(y));
    rightTick.setAttribute("class", "project-history-axis-tick");
    svg.appendChild(rightTick);

    leftLabel.setAttribute("x", String(plotLeft - CHART_TICK_SIZE - 4));
    leftLabel.setAttribute("y", String(y + 3));
    leftLabel.setAttribute("text-anchor", "end");
    leftLabel.setAttribute("class", "project-history-axis-label");
    leftLabel.textContent = formatAxisHours(tickHours);
    svg.appendChild(leftLabel);

    rightLabel.setAttribute("x", String(plotRight + CHART_TICK_SIZE + 4));
    rightLabel.setAttribute("y", String(y + 3));
    rightLabel.setAttribute("text-anchor", "start");
    rightLabel.setAttribute("class", "project-history-axis-label");
    rightLabel.textContent = formatAxisHours(tickHours);
    svg.appendChild(rightLabel);
  });

  {
    const leftAxisLine = document.createElementNS(SVG_NS, "line");
    const rightAxisLine = document.createElementNS(SVG_NS, "line");

    leftAxisLine.setAttribute("x1", String(plotLeft));
    leftAxisLine.setAttribute("x2", String(plotLeft));
    leftAxisLine.setAttribute("y1", String(plotTop));
    leftAxisLine.setAttribute("y2", String(plotBottom));
    leftAxisLine.setAttribute("class", "project-history-axis");
    svg.appendChild(leftAxisLine);

    rightAxisLine.setAttribute("x1", String(plotRight));
    rightAxisLine.setAttribute("x2", String(plotRight));
    rightAxisLine.setAttribute("y1", String(plotTop));
    rightAxisLine.setAttribute("y2", String(plotBottom));
    rightAxisLine.setAttribute("class", "project-history-axis");
    svg.appendChild(rightAxisLine);
  }

  history.forEach((entry, index) => {
    const x = plotLeft + index * slotWidth + (slotWidth - barWidth) / 2;
    const segments = entry.segments || [];

    if (!segments.length) {
      const rect = document.createElementNS(SVG_NS, "rect");

      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(plotBottom - CHART_MIN_BAR_HEIGHT));
      rect.setAttribute("width", String(barWidth));
      rect.setAttribute("height", String(CHART_MIN_BAR_HEIGHT));
      rect.setAttribute("rx", "2");
      rect.setAttribute("class", entry.zeroBar.className);
      rect.setAttribute("aria-label", entry.zeroBar.ariaLabel);
      rect.dataset.tooltipDate = entry.zeroBar.tooltipDate;
      rect.dataset.tooltipValue = entry.zeroBar.tooltipValue;
      svg.appendChild(rect);
      return;
    }

    {
      const barHeight = Math.max(CHART_MIN_BAR_HEIGHT, ((entry.minutes / 60) / yAxis.maxHours) * plotHeight);
      const barTop = plotBottom - barHeight;
      let nextY = plotBottom;

      segments.forEach((segment, segmentIndex) => {
        const rect = document.createElementNS(SVG_NS, "rect");
        const segmentHeight =
          segmentIndex === segments.length - 1
            ? nextY - barTop
            : barHeight * (segment.minutes / entry.minutes);
        const y = nextY - segmentHeight;

        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(barWidth));
        rect.setAttribute("height", String(segmentHeight));
        rect.setAttribute("class", segment.className);
        rect.setAttribute("aria-label", segment.ariaLabel);
        rect.dataset.tooltipDate = segment.tooltipDate;
        rect.dataset.tooltipValue = segment.tooltipValue;

        if (segments.length === 1) {
          rect.setAttribute("rx", "2");
        }

        if (segment.fill) {
          rect.setAttribute("fill", segment.fill);
        }

        svg.appendChild(rect);
        nextY = y;
      });
    }
  });

  xTicks.forEach((tickEntry, tickIndex) => {
    const x = plotLeft + tickEntry.index * slotWidth + slotWidth / 2;
    const tick = document.createElementNS(SVG_NS, "line");
    const label = document.createElementNS(SVG_NS, "text");

    tick.setAttribute("x1", String(x));
    tick.setAttribute("x2", String(x));
    tick.setAttribute("y1", String(plotBottom));
    tick.setAttribute("y2", String(plotBottom + CHART_TICK_SIZE));
    tick.setAttribute("class", "project-history-axis-tick");
    svg.appendChild(tick);

    label.setAttribute("x", String(x));
    label.setAttribute("y", String(plotBottom + CHART_TICK_SIZE + 11));
    label.setAttribute(
      "text-anchor",
      tickIndex === 0 ? "start" : tickIndex === xTicks.length - 1 ? "end" : "middle"
    );
    label.setAttribute("class", "project-history-axis-label");
    label.textContent = formatShortDate(tickEntry.date);
    svg.appendChild(label);
  });

  container.appendChild(svg);
}

function renderProjectTimelineChart(container, chartLabel, history, timeline) {
  const chartWidth = Math.max(Math.round(container.getBoundingClientRect().width), CHART_MIN_WIDTH);
  const plotLeft = CHART_MARGIN_LEFT;
  const plotTop = TIMELINE_MARGIN_TOP;
  const plotBottom = plotTop + timeline.length * TIMELINE_ROW_HEIGHT + Math.max(0, timeline.length - 1) * TIMELINE_ROW_GAP;
  const chartHeight = Math.max(TIMELINE_MIN_HEIGHT, plotBottom + TIMELINE_MARGIN_BOTTOM);
  const plotRight = chartWidth - CHART_MARGIN_RIGHT;
  const plotWidth = Math.max(plotRight - plotLeft, history.length);
  const slotWidth = plotWidth / history.length;
  const xTicks = buildXAxisTicks(history);
  const svg = document.createElementNS(SVG_NS, "svg");

  container.replaceChildren();
  container.style.height = `${chartHeight}px`;

  svg.setAttribute("viewBox", `0 0 ${chartWidth} ${chartHeight}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${chartLabel} from ${history[0].date} to ${history[history.length - 1].date}`);
  svg.classList.add("project-history-svg");

  history.forEach((entry, index) => {
    const x = plotLeft + index * slotWidth;
    const line = document.createElementNS(SVG_NS, "line");

    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    line.setAttribute("y1", String(plotTop));
    line.setAttribute("y2", String(plotBottom));
    line.setAttribute("class", entry.date === state.today ? "project-timeline-today-line" : "project-timeline-gridline");
    svg.appendChild(line);
  });

  {
    const rightLine = document.createElementNS(SVG_NS, "line");

    rightLine.setAttribute("x1", String(plotRight));
    rightLine.setAttribute("x2", String(plotRight));
    rightLine.setAttribute("y1", String(plotTop));
    rightLine.setAttribute("y2", String(plotBottom));
    rightLine.setAttribute("class", "project-timeline-gridline");
    svg.appendChild(rightLine);
  }

  timeline.forEach((project, rowIndex) => {
    const rowTop = plotTop + rowIndex * (TIMELINE_ROW_HEIGHT + TIMELINE_ROW_GAP);
    const rowCenter = rowTop + TIMELINE_ROW_HEIGHT / 2;
    const guide = document.createElementNS(SVG_NS, "line");

    guide.setAttribute("x1", String(plotLeft));
    guide.setAttribute("x2", String(plotRight));
    guide.setAttribute("y1", String(rowCenter));
    guide.setAttribute("y2", String(rowCenter));
    guide.setAttribute("class", "project-timeline-row-guide");
    svg.appendChild(guide);

    project.ranges.forEach((range) => {
      const rect = document.createElementNS(SVG_NS, "rect");
      const x = plotLeft + (range.dateIndex + range.startRatio) * slotWidth;
      const width = Math.max(2, (range.endRatio - range.startRatio) * slotWidth);
      const y = rowCenter - TIMELINE_BAR_HEIGHT / 2;
      const rangeLabel = formatLongDate(range.date);
      const timeLabel = `${formatTime(range.start)} - ${formatTime(range.end)}`;

      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(TIMELINE_BAR_HEIGHT));
      rect.setAttribute("rx", "6");
      rect.setAttribute("class", "project-timeline-segment");
      rect.setAttribute("fill", project.color);
      rect.setAttribute("aria-label", `${project.displayName}, ${rangeLabel}, ${timeLabel}: ${formatDurationLabel(range.minutes)}`);
      rect.dataset.tooltipDate = rangeLabel;
      rect.dataset.tooltipValue = `${project.displayName}: ${timeLabel}, ${formatDurationLabel(range.minutes)}`;
      svg.appendChild(rect);
    });
  });

  xTicks.forEach((tickEntry, tickIndex) => {
    const x = plotLeft + tickEntry.index * slotWidth + slotWidth / 2;
    const tick = document.createElementNS(SVG_NS, "line");
    const label = document.createElementNS(SVG_NS, "text");

    tick.setAttribute("x1", String(x));
    tick.setAttribute("x2", String(x));
    tick.setAttribute("y1", String(plotBottom));
    tick.setAttribute("y2", String(plotBottom + CHART_TICK_SIZE));
    tick.setAttribute("class", "project-history-axis-tick");
    svg.appendChild(tick);

    label.setAttribute("x", String(x));
    label.setAttribute("y", String(plotBottom + CHART_TICK_SIZE + 11));
    label.setAttribute(
      "text-anchor",
      tickIndex === 0 ? "start" : tickIndex === xTicks.length - 1 ? "end" : "middle"
    );
    label.setAttribute("class", "project-history-axis-label");
    label.textContent = formatShortDate(tickEntry.date);
    svg.appendChild(label);
  });

  container.appendChild(svg);
}

function renderProjectOverview(projects, minuteIndex, theme) {
  const overview = buildProjectOverview(projects, minuteIndex, theme);

  overviewHistoryChart.replaceChildren();
  overviewTimelineChart.replaceChildren();
  overviewTimelineChart.style.height = "";
  overviewLegend.replaceChildren();
  overviewRange.textContent = "";

  if (!state.loaded) {
    overviewTotal.textContent = "Load data to see project totals.";
    overviewEmpty.textContent = "Load data to see daily project hours.";
    overviewEmpty.classList.remove("is-hidden");
    overviewChart.classList.add("is-hidden");
    return;
  }

  if (!overview.totalProjects) {
    overviewTotal.textContent = "No projects loaded.";
    overviewEmpty.textContent = "Add a project to start tracking time.";
    overviewEmpty.classList.remove("is-hidden");
    overviewChart.classList.add("is-hidden");
    return;
  }

  if (!overview.totalMinutes) {
    overviewTotal.textContent = `${overview.totalProjects} project${overview.totalProjects === 1 ? "" : "s"} loaded.`;
    overviewEmpty.textContent = "No tracked hours yet.";
    overviewEmpty.classList.remove("is-hidden");
    overviewChart.classList.add("is-hidden");
    return;
  }

  overviewTotal.textContent =
    `Total tracked: ${formatDurationLabel(overview.totalMinutes)} across ` +
    `${overview.activeItems.length} active project${overview.activeItems.length === 1 ? "" : "s"}` +
    `${overview.inactiveCount ? `, ${overview.inactiveCount} without time` : ""}.`;
  overviewRange.textContent = formatHistoryRange(overview.history);
  overviewEmpty.classList.add("is-hidden");
  overviewChart.classList.remove("is-hidden");
  renderStackedHistoryChart(overviewHistoryChart, "All projects daily hours", overview.history);
  renderProjectTimelineChart(overviewTimelineChart, "Project work timeline", overview.history, overview.timeline);

  overview.activeItems.forEach((item) => {
    const legendItem = document.createElement("div");
    const legendMain = document.createElement("div");
    const swatch = document.createElement("span");
    const name = document.createElement("span");
    const value = document.createElement("span");

    legendItem.className = "project-overview-legend-item";
    legendMain.className = "project-overview-legend-main";
    swatch.className = "project-overview-swatch";
    swatch.style.background = item.color;
    name.className = "project-overview-legend-name";
    name.textContent = item.displayName;
    value.className = "project-overview-legend-value";
    value.textContent = `${formatHours(item.totalMinutes)}h · ${formatPercent(item.ratio)}`;

    legendMain.appendChild(swatch);
    legendMain.appendChild(name);
    legendItem.appendChild(legendMain);
    legendItem.appendChild(value);
    overviewLegend.appendChild(legendItem);
  });
}

function snapshotViewport() {
  return {
    x: window.scrollX,
    y: window.scrollY
  };
}

function restoreViewport(viewport) {
  window.scrollTo(viewport.x, viewport.y);
  window.cancelAnimationFrame(viewportRestoreFrame);
  viewportRestoreFrame = window.requestAnimationFrame(() => {
    window.scrollTo(viewport.x, viewport.y);
    viewportRestoreFrame = 0;
  });
}

function renderClockButtons(projects, activeProjectId) {
  const fragment = document.createDocumentFragment();
  const clockOutButton = document.createElement("button");

  clockButtons.replaceChildren();
  clockOutButton.type = "button";
  clockOutButton.textContent = "Clock Out";
  clockOutButton.dataset.clockAction = "clock-out";
  clockOutButton.disabled = !state.loaded || state.busy || !activeProjectId;
  fragment.appendChild(clockOutButton);

  projects.forEach((project) => {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = project.displayName;
    button.dataset.clockAction = "clock-in";
    button.dataset.projectId = project.id;
    button.disabled = !state.loaded || state.busy;

    if (project.id === activeProjectId) {
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    fragment.appendChild(button);
  });

  clockButtons.appendChild(fragment);
}

function render() {
  const viewport = snapshotViewport();
  const sortedProjects = [...state.projects].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" })
  );
  const minuteIndex = buildMinuteIndex();
  const status = currentStatus();
  const activeProject = state.projects.find((project) => project.id === status.projectId);
  const theme = resolvedTheme();

  hideChartTooltip();
  renderClockButtons(sortedProjects, status.projectId);
  renderProjectOverview(sortedProjects, minuteIndex, theme);
  projectsList.innerHTML = "";

  sortedProjects.forEach((project) => {
    const fragment = projectTemplate.content.cloneNode(true);
    const todayMinutes = minuteIndex.todayByProject.get(project.id) || 0;
    const totalMinutes = minuteIndex.totalsByProject.get(project.id) || 0;
    const history = buildProjectHistory(project, minuteIndex);
    const historyRange = fragment.querySelector(".project-history-range");
    const historyChart = fragment.querySelector(".project-history-chart");
    const card = fragment.querySelector(".project-card");

    card.dataset.projectId = project.id;
    card.classList.toggle("is-active", project.id === status.projectId);
    fragment.querySelector(".project-name").textContent = project.displayName;
    fragment.querySelector(".project-meta").textContent =
      project.id === status.projectId && status.since
        ? `Clocked in since ${formatTime(status.since)}`
        : project.id;
    fragment.querySelector(".today-total").textContent = formatDuration(todayMinutes);
    fragment.querySelector(".project-total").textContent = `Total: ${formatDuration(totalMinutes)}`;
    historyRange.textContent = formatHistoryRange(history);

    projectsList.appendChild(fragment);
    renderStackedHistoryChart(historyChart, `${project.displayName} daily hours`, history);
  });

  projectsEmpty.classList.toggle("is-hidden", sortedProjects.length > 0);
  todayLabel.textContent = state.loaded
    ? activeProject
      ? `Clocked in: ${activeProject.displayName}`
      : "Clocked out"
    : "No data loaded";
  configSummaryText.textContent = buildConfigSummary();
  projectNameInput.disabled = !state.loaded || state.busy;
  loadButton.textContent = state.loaded ? "Reload data" : "Load data";
  themeToggleButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  themeToggleButton.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  themeToggleButton.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  saveButton.disabled =
    state.busy ||
    !state.loaded ||
    state.saving ||
    (!state.dirty && !state.remote.projectsMissing && !state.remote.timesMissing);
  saveButton.textContent = state.saving ? "Saving..." : "Save now";
  restoreViewport(viewport);
}

function buildConfigSummary() {
  if (!state.config.baseUrl) {
    return "No server saved.";
  }

  if (!state.config.username) {
    return `${state.config.baseUrl} without login credentials saved.`;
  }

  return `${state.config.baseUrl} as ${state.config.username}.`;
}

function markDirty(message) {
  state.dirty = true;
  setStatus(message);
  queueSave();
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "var(--status-error)" : "";
}

function setBusy(isBusy) {
  state.busy = isBusy;
  loadButton.disabled = isBusy;
  saveButton.disabled = isBusy || !state.loaded || !state.dirty;
  render();
}

function todayString() {
  return dateKeyFromDate(new Date());
}

function timestampString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}
