const PROJECTS_FILE = "projects.tsv";
const TIMES_FILE = "times.tsv";
const CONFIG_KEY = "kronik-webdav-config";
const THEME_KEY = "kronik-theme";
const EMPTY_PROJECTS_TSV = "id\tname\tlast_modified\n";
const EMPTY_TIMES_TSV = "date\tproject_id\tblocks_15m\n";
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

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

function render() {
  const sortedProjects = [...state.projects].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
  const theme = resolvedTheme();

  projectsList.innerHTML = "";

  sortedProjects.forEach((project) => {
    const fragment = projectTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".project-card");
    const todayBlocks = todayBlocksForProject(project.id);
    const totalBlocks = totalBlocksForProject(project.id);

    card.dataset.projectId = String(project.id);
    fragment.querySelector(".project-name").textContent = project.name;
    fragment.querySelector(".project-meta").textContent = `Project #${project.id}`;
    fragment.querySelector(".today-total").textContent = formatBlocks(todayBlocks);
    fragment.querySelector(".project-total").textContent = `Total: ${formatBlocks(totalBlocks)}`;
    fragment.querySelector(".project-modified").textContent = `Last modified: ${project.lastModified || "never"}`;

    fragment.querySelector(".increment").dataset.action = "adjust";
    fragment.querySelector(".increment").dataset.delta = "1";
    fragment.querySelector(".decrement").dataset.action = "adjust";
    fragment.querySelector(".decrement").dataset.delta = "-1";

    projectsList.appendChild(fragment);
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
