const PROJECTS_FILE = "projects.tsv";
const TIMES_FILE = "times.tsv";
const CONFIG_KEY = "kronik-webdav-config";
const THEME_KEY = "kronik-theme";
const EMPTY_PROJECTS_TSV = "id\tname\tlast_modified\n";
const EMPTY_TIMES_TSV = "date\tproject_id\tblocks_15m\n";
const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_HEIGHT = 96;
const CHART_MARGIN_TOP = 8;
const CHART_MARGIN_RIGHT = 36;
const CHART_MARGIN_BOTTOM = 28;
const CHART_MARGIN_LEFT = 36;
const CHART_MIN_WIDTH = 240;
const CHART_MIN_BAR_HEIGHT = 2;
const CHART_TICK_SIZE = 4;
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});
const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

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
const projectsEmpty = document.querySelector("#projects-empty");
const projectsList = document.querySelector("#projects-list");
const projectTemplate = document.querySelector("#project-template");
const loadButton = document.querySelector("#load-button");
const saveButton = document.querySelector("#save-button");
const themeToggleButton = document.querySelector("#theme-toggle-button");
const projectForm = document.querySelector("#project-form");
const projectNameInput = document.querySelector("#project-name");
const configForm = document.querySelector("#config-form");
const configMenu = document.querySelector("#config-menu");
const configSummaryText = document.querySelector("#config-summary-text");
const webdavUrlInput = document.querySelector("#webdav-url");
const webdavUserInput = document.querySelector("#webdav-user");
const webdavPasswordInput = document.querySelector("#webdav-password");
const clearConfigButton = document.querySelector("#clear-config-button");
const chartTooltip = document.querySelector("#chart-tooltip");
const chartTooltipDate = document.querySelector("#chart-tooltip-date");
const chartTooltipValue = document.querySelector("#chart-tooltip-value");
let resizeRenderTimer = 0;

applyThemePreference();
hydrateConfigForm();
render();
void maybeAutoLoad();

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});

loadButton.addEventListener("click", async () => {
  syncConfigFromForm();
  await loadRemoteState();
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

  const name = sanitizeField(projectNameInput.value);
  if (!name) {
    setStatus("Project name is required.", true);
    return;
  }

  if (state.projects.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
    setStatus(`Project "${name}" already exists.`, true);
    return;
  }

  const nextId = state.projects.reduce((maxId, project) => Math.max(maxId, project.id), 0) + 1;
  state.projects.push({
    id: nextId,
    name,
    lastModified: timestampString()
  });

  projectNameInput.value = "";
  markDirty(`Project "${name}" added locally. Saving in the background.`);
  render();
});

configForm.addEventListener("input", () => {
  syncConfigFromForm();
  render();
});

clearConfigButton.addEventListener("click", () => {
  clearStoredConfig();
});

registerThemeChangeListener(() => {
  if (state.theme) {
    return;
  }

  render();
});

projectsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest("[data-project-id]");
  let delta;

  if (!button || !card) {
    return;
  }

  if (!state.loaded) {
    setStatus("Load data before editing time.", true);
    return;
  }

  delta = Number(button.dataset.delta || "0");
  updateTodayBlocks(Number(card.dataset.projectId), delta);
});

projectsList.addEventListener("pointermove", (event) => {
  const bar = closestChartBar(event.target);

  if (!bar) {
    hideChartTooltip();
    return;
  }

  showChartTooltip(bar, event.clientX, event.clientY);
});

projectsList.addEventListener("pointerleave", () => {
  hideChartTooltip();
});

projectsList.addEventListener("pointerdown", () => {
  hideChartTooltip();
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
    // Ignore storage failures and continue with the in-memory preference.
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

  const response = await window.fetch(buildUrl(name), {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  return response;
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
      setStatus(
        "Connected. Missing TSV files were initialized locally and will be created on first save."
      );
    } else {
      setStatus(`Loaded ${state.projects.length} projects from WebDAV.`);
    }

    render();
  } catch (error) {
    setStatus(error.message, true);
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
    throw new Error(
      `${name} changed on the server since your last load. Reload before saving again.`
    );
  }

  if (!response.ok) {
    throw new Error(`${name} save failed with ${response.status}.`);
  }

  return response;
}

function parseProjects(text) {
  return parseTsv(text)
    .map((row) => ({
      id: Number(row.id),
      name: sanitizeField(row.name || ""),
      lastModified: row.last_modified || "never"
    }))
    .filter((project) => Number.isFinite(project.id) && project.name);
}

function parseTimes(text) {
  return parseTsv(text)
    .map((row) => ({
      date: row.date || "",
      projectId: Number(row.project_id),
      blocks: Number(row.blocks_15m)
    }))
    .filter((entry) => entry.date && Number.isFinite(entry.projectId) && Number.isFinite(entry.blocks))
    .map((entry) => ({
      ...entry,
      blocks: Math.max(0, entry.blocks)
    }));
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
  const sorted = [...projects].sort((left, right) => left.id - right.id);

  sorted.forEach((project) => {
    rows.push([project.id, sanitizeField(project.name), project.lastModified || "never"].join("\t"));
  });

  return `${rows.join("\n")}\n`;
}

function serializeTimes(times) {
  const rows = [EMPTY_TIMES_TSV.trimEnd()];
  const sorted = [...times]
    .filter((entry) => entry.blocks > 0)
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }
      return left.projectId - right.projectId;
    });

  sorted.forEach((entry) => {
    rows.push([entry.date, entry.projectId, Math.max(0, entry.blocks)].join("\t"));
  });

  return `${rows.join("\n")}\n`;
}

function sanitizeField(value) {
  return String(value).replace(/[\t\r\n]+/g, " ").trim();
}

function updateTodayBlocks(projectId, delta) {
  const project = state.projects.find((entry) => entry.id === projectId);
  const timeEntry = findOrCreateTodayEntry(projectId);

  if (!project || !timeEntry) {
    setStatus("Unknown project.", true);
    return;
  }

  if (delta < 0 && timeEntry.blocks === 0) {
    setStatus(`No time recorded yet for ${project.name}.`, true);
    return;
  }

  timeEntry.blocks = Math.max(0, timeEntry.blocks + delta);
  project.lastModified = timestampString();
  markDirty(`Updated ${project.name} by ${delta > 0 ? "+" : ""}${delta * 15} minutes locally.`);
  render();
}

function findOrCreateTodayEntry(projectId) {
  let entry = state.times.find((item) => item.projectId === projectId && item.date === state.today);

  if (!entry) {
    entry = {
      date: state.today,
      projectId,
      blocks: 0
    };
    state.times.push(entry);
  }

  return entry;
}

function todayBlocksForProject(projectId) {
  const entry = state.times.find((item) => item.projectId === projectId && item.date === state.today);
  return entry ? entry.blocks : 0;
}

function totalBlocksForProject(projectId) {
  return state.times
    .filter((entry) => entry.projectId === projectId)
    .reduce((sum, entry) => sum + entry.blocks, 0);
}

function historyForProject(projectId) {
  const projectEntries = state.times
    .filter((entry) => entry.projectId === projectId)
    .sort((left, right) => left.date.localeCompare(right.date));

  if (!projectEntries.length) {
    return [{ date: state.today, blocks: 0 }];
  }

  const blocksByDate = new Map(
    projectEntries.map((entry) => [entry.date, entry.blocks])
  );
  const firstDate = projectEntries[0].date;
  const lastRecordedDate = projectEntries[projectEntries.length - 1].date;
  const lastDate = state.today > lastRecordedDate ? state.today : lastRecordedDate;

  return enumerateDates(firstDate, lastDate).map((date) => ({
    date,
    blocks: blocksByDate.get(date) || 0
  }));
}

function formatBlocks(blocks) {
  const totalMinutes = blocks * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${minutes}m`;
  }

  if (!minutes) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function formatHours(blocks) {
  const hours = blocks / 4;

  if (Number.isInteger(hours)) {
    return String(hours);
  }

  return hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatHoursLabel(blocks) {
  const hours = blocks / 4;
  return `${formatHours(blocks)} hour${hours === 1 ? "" : "s"}`;
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  const cursor = parseDateKey(startDate);
  const end = parseDateKey(endDate);

  while (cursor <= end) {
    dates.push(dateKeyFromDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}

function dateKeyFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatShortDate(dateKey) {
  return shortDateFormatter.format(parseDateKey(dateKey));
}

function formatLongDate(dateKey) {
  return longDateFormatter.format(parseDateKey(dateKey));
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

function buildYAxis(maxBlocks) {
  const normalizedMaxHours = Math.max(maxBlocks / 4, 1);
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

function closestChartBar(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest(".project-history-bar");
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

function renderHistoryChart(container, projectName, history) {
  const chartWidth = Math.max(Math.round(container.getBoundingClientRect().width), CHART_MIN_WIDTH);
  const plotLeft = CHART_MARGIN_LEFT;
  const plotTop = CHART_MARGIN_TOP;
  const plotBottom = CHART_HEIGHT - CHART_MARGIN_BOTTOM;
  const plotRight = chartWidth - CHART_MARGIN_RIGHT;
  const plotHeight = plotBottom - plotTop;
  const plotWidth = Math.max(plotRight - plotLeft, history.length);
  const slotWidth = plotWidth / history.length;
  const barWidth = Math.max(slotWidth * 0.72, Math.min(1, slotWidth));
  const maxBlocks = Math.max(...history.map((entry) => entry.blocks), 0);
  const yAxis = buildYAxis(maxBlocks);
  const xTicks = buildXAxisTicks(history);
  const svg = document.createElementNS(SVG_NS, "svg");

  container.replaceChildren();

  svg.setAttribute("viewBox", `0 0 ${chartWidth} ${CHART_HEIGHT}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${projectName} daily hours from ${history[0].date} to ${history[history.length - 1].date}`
  );
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
    const rect = document.createElementNS(SVG_NS, "rect");
    const hours = entry.blocks / 4;
    const barHeight = entry.blocks
      ? Math.max(CHART_MIN_BAR_HEIGHT, Math.round((hours / yAxis.maxHours) * plotHeight))
      : CHART_MIN_BAR_HEIGHT;
    const x = plotLeft + index * slotWidth + (slotWidth - barWidth) / 2;
    const y = plotBottom - barHeight;

    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(barWidth));
    rect.setAttribute("height", String(barHeight));
    rect.setAttribute("rx", "2");
    rect.setAttribute("aria-label", `${formatLongDate(entry.date)}: ${formatHoursLabel(entry.blocks)}`);
    rect.dataset.tooltipDate = formatLongDate(entry.date);
    rect.dataset.tooltipValue = formatHoursLabel(entry.blocks);
    rect.setAttribute(
      "class",
      [
        "project-history-bar",
        entry.blocks ? "" : "is-zero",
        entry.date === state.today ? "is-today" : ""
      ]
        .filter(Boolean)
        .join(" ")
    );

    svg.appendChild(rect);
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

function render() {
  const sortedProjects = [...state.projects].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
  const theme = resolvedTheme();

  hideChartTooltip();
  projectsList.innerHTML = "";

  sortedProjects.forEach((project) => {
    const fragment = projectTemplate.content.cloneNode(true);
    const todayBlocks = todayBlocksForProject(project.id);
    const totalBlocks = totalBlocksForProject(project.id);
    const history = historyForProject(project.id);
    const historyRange = fragment.querySelector(".project-history-range");
    const historyChart = fragment.querySelector(".project-history-chart");
    const card = fragment.querySelector(".project-card");

    card.dataset.projectId = String(project.id);
    fragment.querySelector(".project-name").textContent = project.name;
    fragment.querySelector(".project-meta").textContent = `Project #${project.id}`;
    fragment.querySelector(".today-total").textContent = formatBlocks(todayBlocks);
    fragment.querySelector(".project-total").textContent = `Total: ${formatBlocks(totalBlocks)}`;
    fragment.querySelector(".project-modified").textContent = `Last modified: ${project.lastModified || "never"}`;
    historyRange.textContent = formatHistoryRange(history);

    fragment.querySelector(".increment").dataset.action = "adjust";
    fragment.querySelector(".increment").dataset.delta = "1";
    fragment.querySelector(".decrement").dataset.action = "adjust";
    fragment.querySelector(".decrement").dataset.delta = "-1";

    projectsList.appendChild(fragment);
    renderHistoryChart(historyChart, project.name, history);
  });

  projectsEmpty.classList.toggle("is-hidden", sortedProjects.length > 0);
  todayLabel.textContent = state.loaded ? state.today : "No data loaded";
  configSummaryText.textContent = buildConfigSummary();
  projectNameInput.disabled = !state.loaded || state.busy;
  loadButton.textContent = state.loaded ? "Reload data" : "Load data";
  themeToggleButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  themeToggleButton.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  themeToggleButton.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
  );
  saveButton.disabled =
    state.busy ||
    !state.loaded ||
    state.saving ||
    (!state.dirty && !state.remote.projectsMissing && !state.remote.timesMissing);
  saveButton.textContent = state.saving ? "Saving..." : "Save now";
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
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function timestampString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
