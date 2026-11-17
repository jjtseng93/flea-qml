// ui.json's shape, the rule each key is measured against and the merges, with no disk in them:
// read a file onto the defaults, apply one caller patch, carry 0.1.3's view.json across.
// Upstream: src/uischema.rs, src/uistate.rs, src/uimigrate.rs, src/uiplugins.rs.

const DEFAULTS = {
  view: "list",
  pickerView: "list",
  density: "compact",
  columns: ["name", "size", "date"],
  columnsLimit: 3,
  columnWidths: {},
  addressBar: "breadcrumb",
  sort: { key: "name", reverse: false },
  rememberSort: true,
  folderSorts: {},
  rememberViewPerFolder: false,
  folderViews: {},
  dual: { paths: [], focus: 0, split: 5000 },
  foldersFirst: true,
  groupByKind: false,
  hidden: false,
  langMarks: true,
  hiddenLast: false,
  showGitStatus: false,
  highlightToday: false,
  wrapAtEnds: false,
  escapeUp: false,
  openMode: "double",
  clickRename: true,
  openFoldersWhileDragging: false,
  // Always on; accept old boolean settings but normalize them to true.
  keyHints: true,
  startIn: "home",
  startFolder: "",
  lastPath: "",
  lastTabs: { paths: [], index: 0 },
  newTab: "current",
  trashAutoEmpty: false,
  trashSweptOn: 0,
  places: {
    favourites: [],
    showHome: true, showRecent: false, showNetwork: true, showDevices: true, showTrash: true,
    driveSize: false, trashCount: false, showUnmounted: true, showTags: false, rail: "shown", autoHide: false, sidebarWidth: 160,
  },
  shelf: { enabled: false, bar: true, rail: "off", screenshots: true, recordings: true, recent: 3 },
  preview: {
    column: true, loadOn: "automatic", thumbnails: "media", thumbSize: "medium",
    thumbNetwork: false, thumbPhone: false, thumbUsb: true,
    ctrlZoom: true, volume: 100, width: 0, tracks: [], wrap: false,
  },
  previewFacts: "full",
  keys: "default",
  display: { textSize: { mode: "system" }, hyprlandIcons: false },
  menu: {
    hidden: ["delete", "openTerminal", "placeMenu", "runScript", "moveto", "copyto", "properties", "permissions",
      "copyAs", "pasteAs", "invertSelection", "extThumbs", "run", "openAsText", "openAgent"],
  },
  plugins: {},
  stateVersion: 4,
};
export const defaults = () => structuredClone(DEFAULTS);

const OPTIONAL_COLUMNS = ["mode", "size", "date", "kind"];
const COLUMN_KEYS = ["name", "mode", "size", "date", "kind"];
const COLUMN_WIDTH_KEYS = ["mode", "size", "date", "kind"];
const COLUMN_WIDTH_MIN = 48, COLUMN_WIDTH_MAX = 480;
const SORT_KEYS = ["name", "size", "date", "kind"];
const TEXT_SIZE_STOPS = [9, 10, 11, 12, 14, 16, 20];
const SIDEBAR_STOPS = [160, 192, 224, 256];
const MAX_LAST_TABS = 9, MAX_FOLDER_SORTS = 500, MAX_FOLDER_VIEWS = 500;
const MAX_PLUGINS = 256, MAX_PLUGIN_SETTINGS = 64, MAX_PLUGIN_ID = 64;
const STATE_VERSION = "stateVersion";

// Rules: a kind, plus its words, range or sub-schema.
const bool = { kind: "bool" };
const word = (...words) => ({ kind: "word", words });
const count = (low, high) => ({ kind: "count", low, high });
const group = (schema) => ({ kind: "group", schema });
const r = (kind) => ({ kind });

const SCHEMA = {
  view: word("list", "columns", "grid", "dual"),
  pickerView: word("list", "grid"),
  density: word("tight", "compact", "normal", "comfortable"),
  columns: r("columns"),
  columnsLimit: count(2, 5),
  columnWidths: r("columnWidths"),
  addressBar: word("path", "breadcrumb"),
  sort: group({ key: word(...SORT_KEYS), reverse: bool }),
  rememberSort: bool,
  folderSorts: r("folderSorts"),
  rememberViewPerFolder: bool,
  folderViews: r("folderViews"),
  dual: group({ paths: r("pair"), focus: count(0, 1), split: count(0, 10000) }),
  foldersFirst: bool,
  groupByKind: bool,
  hidden: bool,
  langMarks: bool,
  hiddenLast: bool,
  showGitStatus: bool,
  highlightToday: bool,
  wrapAtEnds: bool,
  escapeUp: bool,
  openMode: word("double", "single"),
  clickRename: bool,
  openFoldersWhileDragging: bool,
  keyHints: r("alwaysTrue"),
  startIn: word("home", "last", "folder"),
  startFolder: r("place"),
  lastPath: r("place"),
  lastTabs: r("lastTabs"),
  newTab: word("current", "home", "start"),
  trashAutoEmpty: bool,
  trashSweptOn: count(0, 4000000),
  places: group({
    favourites: r("favourites"), showHome: bool, showRecent: bool, showNetwork: bool, showDevices: bool,
    showTrash: bool, driveSize: bool, trashCount: bool, showUnmounted: bool, showTags: bool,
    rail: word("shown", "hidden"), autoHide: bool, sidebarWidth: r("sidebarWidth"),
  }),
  shelf: group({
    enabled: bool, bar: bool, rail: word("off", "left", "right", "bottom"),
    screenshots: bool, recordings: bool, recent: count(0, 6),
  }),
  preview: group({
    column: bool, loadOn: word("automatic", "manual"), thumbnails: word("off", "images", "media"),
    thumbSize: word("small", "medium", "large", "xlarge", "huge", "largest"),
    thumbNetwork: bool, thumbPhone: bool, thumbUsb: bool, ctrlZoom: bool,
    volume: count(0, 100), width: count(0, 100), tracks: r("tracks"), wrap: bool,
  }),
  previewFacts: word("compact", "full"),
  keys: word("default", "vim", "mac", "windows"),
  display: group({ textSize: group({ mode: r("textSize") }), hyprlandIcons: bool }),
  menu: group({ hidden: r("ids") }),
  plugins: r("plugins"),
  [STATE_VERSION]: r("version"),
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isWhole = (v) => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
// A remembered place: an absolute path or a URI naming its root.
const isPlace = (s) => typeof s === "string" && (s.startsWith("/") || s.includes("://"));
const isActionId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]+$/.test(s);
const isSortOrder = (v) =>
  isObject(v) && Object.keys(v).length === 2 && SORT_KEYS.includes(v.key) && typeof v.reverse === "boolean";
const isFolderView = (v) => ["list", "columns", "grid"].includes(v);
const isPluginId = (id) =>
  id.length <= MAX_PLUGIN_ID && id.split(".").length >= 2 && id.split(".").every((s) => /^[a-z0-9_-]+$/.test(s));
const isScalar = (v) => typeof v === "boolean" || typeof v === "number" || typeof v === "string";
const pluginEntryFits = (entry, patch) =>
  isObject(entry) &&
  Object.entries(entry).every(([key, inner]) =>
    key === "enabled" ? typeof inner === "boolean"
      : key === "settings" ? isObject(inner) && Object.keys(inner).length <= MAX_PLUGIN_SETTINGS
          && Object.values(inner).every((v) => isScalar(v) || (patch && v === null))
        : false);

function fits(rule, v) {
  switch (rule.kind) {
    case "bool":
    case "alwaysTrue": return typeof v === "boolean";
    case "word": return rule.words.includes(v);
    case "count": return isWhole(v) && v >= rule.low && v <= rule.high;
    case "group": return isObject(v);
    case "columns": {
      if (!Array.isArray(v)) return false;
      const seen = new Set();
      for (const key of v) {
        if (!COLUMN_KEYS.includes(key) || seen.has(key)) return false;
        seen.add(key);
      }
      return seen.has("name");
    }
    case "favourites": return Array.isArray(v);
    case "sidebarWidth": return typeof v === "number" && Number.isFinite(v);
    // The two panes or nothing: a third path is a shape no restore can read.
    case "pair": return Array.isArray(v) && (v.length === 0 || v.length === 2) && v.every(isPlace);
    case "place": return typeof v === "string" && (v === "" || isPlace(v));
    case "ids": return Array.isArray(v) && v.every(isActionId);
    case "lastTabs": {
      if (!isObject(v) || Object.keys(v).length !== 2 || !Array.isArray(v.paths)) return false;
      if (v.paths.length > MAX_LAST_TABS || !v.paths.every(isPlace) || !isWhole(v.index) || v.index < 0) return false;
      return v.paths.length === 0 ? v.index === 0 : v.index < v.paths.length;
    }
    case "folderSorts": return isObject(v) && Object.entries(v).every(([p, o]) => isPlace(p) && isSortOrder(o));
    case "folderViews": return isObject(v) && Object.entries(v).every(([p, o]) => isPlace(p) && isFolderView(o));
    case "columnWidths":
      return isObject(v) && Object.entries(v).every(([k, w]) =>
        COLUMN_WIDTH_KEYS.includes(k) && isWhole(w) && w >= COLUMN_WIDTH_MIN && w <= COLUMN_WIDTH_MAX);
    case "tracks": return Array.isArray(v) && v.length <= 4 && v.every((t) => fits(count(1, 10000), t));
    case "plugins":
      return isObject(v) && Object.keys(v).length <= MAX_PLUGINS
        && Object.entries(v).every(([id, e]) => isPluginId(id) && pluginEntryFits(e, false));
    case "version": return isWhole(v) && v >= 0;
    case "textSize": return v === "system" || TEXT_SIZE_STOPS.includes(v);
    default: return false;
  }
}

// A patch may forget a folder or a plugin with null; a stored map never holds one.
function fitsPatch(rule, v) {
  if (rule.kind === "folderSorts")
    return isObject(v) && Object.entries(v).every(([p, o]) => isPlace(p) && (o === null || isSortOrder(o)));
  if (rule.kind === "folderViews")
    return isObject(v) && Object.entries(v).every(([p, o]) => isPlace(p) && (o === null || isFolderView(o)));
  if (rule.kind === "plugins")
    return isObject(v) && Object.entries(v).every(([id, e]) => isPluginId(id) && (e === null || pluginEntryFits(e, true)));
  return fits(rule, v);
}

// One elided line for an error sentence, never the whole document.
function oneLine(v) {
  const flat = JSON.stringify(v) ?? String(v);
  return [...flat].length > 40 ? `${[...flat].slice(0, 40).join("")}...` : flat;
}

function check(patch, schema, prefix) {
  for (const [key, value] of Object.entries(patch)) {
    const rule = schema[key];
    if (!rule) throw new Error(`${prefix}${key} is not a ui.json key`);
    if (rule.kind === "group") {
      if (!isObject(value)) throw new Error(`${prefix}${key} takes an object, not ${oneLine(value)}`);
      check(value, rule.schema, `${prefix}${key}.`);
    } else if (rule.kind === "version") {
      // A front end that could write the stamp could rewind a migration the file has already had.
      throw new Error(`${prefix}${key} is kept by Flea and no patch sets it`);
    } else if (!fitsPatch(rule, value)) throw new Error(`${prefix}${key} does not take ${oneLine(value)}`);
  }
}

function normalized(rule, value) {
  if (rule?.kind === "alwaysTrue") return true;
  if (rule?.kind === "sidebarWidth") {
    const wanted = typeof value === "number" ? value : 160;
    return SIDEBAR_STOPS.reduce((best, stop) => (Math.abs(stop - wanted) < Math.abs(best - wanted) ? stop : best));
  }
  // The maps are oldest first, so a write past their cap drops the longest-ago entries.
  if (rule?.kind === "folderSorts" || rule?.kind === "folderViews") {
    const cap = rule.kind === "folderViews" ? MAX_FOLDER_VIEWS : MAX_FOLDER_SORTS;
    const entries = Object.entries(value);
    return entries.length > cap ? Object.fromEntries(entries.slice(entries.length - cap)) : value;
  }
  return value;
}

const cleanMap = (value, keep) =>
  Object.fromEntries(Object.entries(isObject(value) ? value : {}).filter(([k, v]) => keep(k, v)));
const cleanPlugins = (value) =>
  Object.fromEntries(Object.entries(isObject(value) ? value : {})
    .filter(([id, e]) => isPluginId(id) && pluginEntryFits(e, false)).slice(0, MAX_PLUGINS));

// Known keys in the shipped order, then whatever a newer Flea left behind, kept as it was read.
function merge(fallback, found, schema) {
  if (!isObject(found)) return structuredClone(fallback);
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    const base = fallback[key];
    if (!(key in found)) out[key] = structuredClone(base);
    else if (rule.kind === "group") out[key] = merge(base, found[key], rule.schema);
    // A hand-edited map heals one bad entry rather than losing the key.
    else if (rule.kind === "folderSorts") out[key] = normalized(rule, cleanMap(found[key], (p, o) => isPlace(p) && isSortOrder(o)));
    else if (rule.kind === "folderViews") out[key] = normalized(rule, cleanMap(found[key], (p, o) => isPlace(p) && isFolderView(o)));
    else if (rule.kind === "plugins") out[key] = cleanPlugins(found[key]);
    else out[key] = fits(rule, found[key]) ? normalized(rule, structuredClone(found[key])) : structuredClone(base);
  }
  for (const [key, value] of Object.entries(found)) if (!(key in schema)) out[key] = value;
  return out;
}

// Each path or edge named is forgotten, then re-pushed newest; null forgets it outright.
function mergeEntries(held, patch, allowNull) {
  const out = { ...(isObject(held) ? held : {}) };
  for (const [key, value] of Object.entries(patch)) {
    delete out[key];
    if (!(allowNull && value === null)) out[key] = value;
  }
  return out;
}

function mergePlugins(held, patch) {
  const out = { ...(isObject(held) ? held : {}) };
  for (const [id, entry] of Object.entries(patch)) {
    const before = out[id];
    delete out[id];
    if (entry === null) continue;
    const next = { ...(isObject(before) ? before : {}) };
    for (const [key, value] of Object.entries(entry)) {
      if (key === "settings") {
        const settings = { ...(isObject(next.settings) ? next.settings : {}) };
        for (const [name, setting] of Object.entries(value)) {
          delete settings[name];
          if (setting !== null) settings[name] = setting;
        }
        next.settings = settings;
      } else next[key] = value;
    }
    out[id] = next;
  }
  return cleanPlugins(out);
}

function apply(current, patch, schema) {
  const out = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const rule = schema[key];
    if (rule?.kind === "group" && isObject(out[key])) out[key] = apply(out[key], value, rule.schema);
    // A map patch merges per entry, so one window's write keeps what another wrote since its read.
    else if (rule?.kind === "folderSorts" || rule?.kind === "folderViews") out[key] = normalized(rule, mergeEntries(out[key], value, true));
    else if (rule?.kind === "columnWidths") out[key] = mergeEntries(out[key], value, false);
    else if (rule?.kind === "plugins") out[key] = mergePlugins(out[key], value);
    else out[key] = normalized(rule, structuredClone(value));
  }
  return out;
}

// The one-time changes a stored file is owed, each recorded by the stateVersion it arrived in.
const withHidden = (state, change) => {
  const hidden = state.menu?.hidden;
  if (!Array.isArray(hidden) || hidden.some((item) => typeof item !== "string")) return state;
  return { ...state, menu: { ...state.menu, hidden: change([...hidden]) } };
};
const addMissing = (names) => (hidden) => [...hidden, ...names.filter((name) => !hidden.includes(name))];
const STEPS = [
  [1, (state) => ({ ...state, places: { ...state.places, showUnmounted: true } })],
  // copypath becomes copyAs where it stands; a file that held both keeps the first.
  [2, (state) => withHidden(state, (hidden) => {
    const kept = [];
    for (const item of hidden) {
      const name = item === "copypath" ? "copyAs" : item;
      if (!(name === "copyAs" && kept.includes("copyAs"))) kept.push(name);
    }
    return addMissing(["pasteAs", "invertSelection"])(kept);
  })],
  [3, (state) => withHidden(state, addMissing(["run", "openAsText"]))],
  [4, (state) => withHidden(state, (hidden) =>
    addMissing(hidden.includes("runScript") ? ["openAgent", "actions"] : ["openAgent"])(hidden))],
];
const storedVersion = (found) => (typeof found?.[STATE_VERSION] === "number" ? found[STATE_VERSION] : 0);
export const newerThanKnown = (found) => storedVersion(found) > STEPS.at(-1)[0];

function migrated(found, merged) {
  const stored = storedVersion(found);
  // Menu migrations apply to a saved list, never to the shipped default a missing one fell back to.
  const storedMenu = Array.isArray(found?.menu?.hidden)
    && JSON.stringify(found.menu.hidden) === JSON.stringify(merged.menu.hidden);
  let state = merged;
  for (const [version, step] of STEPS) {
    if (stored >= version) continue;
    if (version < 2 || storedMenu) state = step(state);
    state = { ...state, [STATE_VERSION]: version };
  }
  return state;
}

/** Whether a parsed document is a ui.json this Flea may read and rewrite. */
export function isUiDocument(doc) {
  if (!isObject(doc)) return false;
  if (STATE_VERSION in doc && (!isWhole(doc[STATE_VERSION]) || newerThanKnown(doc))) return false;
  const keys = Object.keys(doc);
  return keys.length === 0 || keys.some((key) => key in DEFAULTS);
}

/** Never fails: a file that cannot be read is one whose every key is the shipped default. */
export function fromFile(text) {
  let found;
  try {
    found = JSON.parse(text);
  } catch {
    return defaults();
  }
  return migrated(found, merge(DEFAULTS, found, SCHEMA));
}

/** 0.1.3's view.json named the hidden columns; uiScale is dropped on purpose. */
export function fromViewJson(text) {
  const out = defaults();
  let hidden;
  try {
    hidden = JSON.parse(text)?.hiddenCols;
  } catch {}
  if (!Array.isArray(hidden)) return out;
  out.columns = ["name", ...OPTIONAL_COLUMNS.filter((key) => !hidden.includes(key))];
  return out;
}

/** The whole patch is checked before any of it lands, so one bad key changes nothing. */
export function patched(current, patch) {
  if (!isObject(patch)) throw new Error("a ui.json patch must be a JSON object");
  check(patch, SCHEMA, "");
  return apply(merge(DEFAULTS, current, SCHEMA), patch, SCHEMA);
}

/** The file's own text for a document, two-space indented with a final newline. */
export const render = (state) => `${JSON.stringify(state, null, 2)}\n`;

// Persist only deviations. Recurse through schema groups, not user maps: a map entry
// may intentionally contain an empty object, false, or a value equal to another default.
export function overrides(state, baseline = defaults(), schema = SCHEMA) {
  const out = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === STATE_VERSION) { out[key] = value; continue; }
    if (schema[key]?.kind === "group" && isObject(value) && isObject(baseline[key])) {
      const nested = overrides(value, baseline[key], schema[key].schema);
      if (Object.keys(nested).length) out[key] = nested;
    } else if (JSON.stringify(value) !== JSON.stringify(baseline[key])) {
      out[key] = structuredClone(value);
    }
  }
  return out;
}
