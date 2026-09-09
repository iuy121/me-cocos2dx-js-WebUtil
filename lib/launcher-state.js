"use strict";

// 启动台的记忆状态：工程使用频率、每个工程各自的最近 uid、尺寸档位偏好。
// 放在服务端而不是 localStorage，换浏览器或清缓存都不丢。

var fs = require("fs");
var path = require("path");

var DATA_DIR = path.join(__dirname, "..", "data");
var STATE_PATH = path.join(DATA_DIR, "launcher-state.json");

var MAX_UIDS_PER_PROJECT = 5;
var STATE_VERSION = 1;

// 固定尺寸档位，宽恒为 1000，比例来自客户端 isLongScreen() 的分档
var SIZE_PRESETS = [
  { key: "1000x800", width: 1000, height: 800, ratio: 1.25 },
  { key: "1000x714", width: 1000, height: 714, ratio: 1.4 },
  { key: "1000x645", width: 1000, height: 645, ratio: 1.55 },
  { key: "1000x588", width: 1000, height: 588, ratio: 1.7 },
  { key: "1000x526", width: 1000, height: 526, ratio: 1.9 },
  { key: "1000x488", width: 1000, height: 488, ratio: 2.05 },
  { key: "1000x465", width: 1000, height: 465, ratio: 2.15 },
  { key: "1000x440", width: 1000, height: 440, ratio: 2.27 },
  { key: "1000x417", width: 1000, height: 417, ratio: 2.4 }
];
var DEFAULT_SIZE_KEY = "1000x526";

function emptyState() {
  return {
    version: STATE_VERSION,
    clientRoot: "",
    lastProject: "",
    projectSort: "recent",
    sizes: [],
    projects: {}
  };
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  } catch (err) {
    // 目录已存在或无权限，读写时会再次报错，这里不阻断
  }
}

function normalizeState(raw) {
  var state = emptyState();
  if (!raw || typeof raw !== "object") return state;

  if (typeof raw.clientRoot === "string") state.clientRoot = raw.clientRoot;
  if (typeof raw.lastProject === "string") state.lastProject = raw.lastProject;
  if (raw.projectSort === "recent" || raw.projectSort === "count" || raw.projectSort === "name") {
    state.projectSort = raw.projectSort;
  }

  if (Array.isArray(raw.sizes)) {
    state.sizes = raw.sizes
      .filter(function (item) {
        return item && typeof item.key === "string";
      })
      .map(function (item) {
        return {
          key: item.key,
          count: Number(item.count) || 0,
          lastUsedAt: Number(item.lastUsedAt) || 0
        };
      });
  }

  if (raw.projects && typeof raw.projects === "object") {
    Object.keys(raw.projects).forEach(function (name) {
      var entry = raw.projects[name];
      if (!entry || typeof entry !== "object") return;
      var uids = [];
      if (Array.isArray(entry.uids)) {
        uids = entry.uids
          .filter(function (item) {
            return item && typeof item.uid === "string" && item.uid;
          })
          .map(function (item) {
            return {
              uid: item.uid,
              count: Number(item.count) || 0,
              lastUsedAt: Number(item.lastUsedAt) || 0
            };
          })
          .slice(0, MAX_UIDS_PER_PROJECT);
      }
      state.projects[name] = {
        count: Number(entry.count) || 0,
        lastUsedAt: Number(entry.lastUsedAt) || 0,
        lastSize: typeof entry.lastSize === "string" ? entry.lastSize : "",
        uids: uids
      };
    });
  }

  return state;
}

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return emptyState();
    return normalizeState(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")));
  } catch (err) {
    // 文件损坏时不要让整个工具挂掉，退回空状态
    return emptyState();
  }
}

// 原子写：先写 .tmp 再 rename，避免中途崩溃留下半个 JSON
function writeState(state) {
  ensureDataDir();
  var tmpPath = STATE_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  try {
    fs.renameSync(tmpPath, STATE_PATH);
  } catch (err) {
    // Windows 上目标被占用时 rename 会失败，退化成直接覆盖
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
    try {
      fs.unlinkSync(tmpPath);
    } catch (cleanupErr) {
      // 临时文件残留不影响功能
    }
  }
}

function findSizePreset(key) {
  for (var i = 0; i < SIZE_PRESETS.length; i++) {
    if (SIZE_PRESETS[i].key === key) return SIZE_PRESETS[i];
  }
  return null;
}

function bumpRanked(list, key, keyField, now) {
  var found = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i][keyField] === key) {
      found = list[i];
      break;
    }
  }
  if (!found) {
    found = {};
    found[keyField] = key;
    found.count = 0;
    found.lastUsedAt = 0;
    list.unshift(found);
  }
  found.count += 1;
  found.lastUsedAt = now;
  // 最近使用优先，次数作为次级排序
  list.sort(function (a, b) {
    if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    return b.count - a.count;
  });
  return list;
}

// 记录一次启动：工程次数、该工程的 uid 列表、尺寸档位统计
function recordLaunch(options) {
  var project = String(options.project || "");
  var uid = String(options.uid || "");
  var width = Number(options.width) || 0;
  var height = Number(options.height) || 0;
  if (!project) return readState();

  var now = Date.now();
  var state = readState();

  var entry = state.projects[project];
  if (!entry) {
    entry = { count: 0, lastUsedAt: 0, lastSize: "", uids: [] };
    state.projects[project] = entry;
  }
  entry.count += 1;
  entry.lastUsedAt = now;
  state.lastProject = project;

  if (uid) {
    bumpRanked(entry.uids, uid, "uid", now);
    // 每个工程只保留最近 5 个不同 uid
    entry.uids = entry.uids.slice(0, MAX_UIDS_PER_PROJECT);
  }

  if (width && height) {
    var sizeKey = width + "x" + height;
    entry.lastSize = sizeKey;
    // 只统计预设档位，自定义尺寸不污染档位排序
    if (findSizePreset(sizeKey)) {
      bumpRanked(state.sizes, sizeKey, "key", now);
    }
  }

  writeState(state);
  return state;
}

function setProjectSort(sort) {
  var state = readState();
  if (sort === "recent" || sort === "count" || sort === "name") {
    state.projectSort = sort;
    writeState(state);
  }
  return state;
}

// 按记忆的统计给尺寸档位排序：用过的按热度在前，没用过的保持原始档位顺序在后
function rankedSizes(state) {
  var stats = {};
  (state.sizes || []).forEach(function (item) {
    stats[item.key] = item;
  });
  var used = [];
  var unused = [];
  SIZE_PRESETS.forEach(function (preset) {
    var stat = stats[preset.key];
    var item = {
      key: preset.key,
      width: preset.width,
      height: preset.height,
      ratio: preset.ratio,
      count: stat ? stat.count : 0,
      lastUsedAt: stat ? stat.lastUsedAt : 0
    };
    if (item.count > 0) used.push(item);
    else unused.push(item);
  });
  used.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastUsedAt - a.lastUsedAt;
  });
  return used.concat(unused);
}

function defaultSizeKey(state) {
  var ranked = rankedSizes(state);
  if (ranked.length && ranked[0].count > 0) return ranked[0].key;
  return DEFAULT_SIZE_KEY;
}

module.exports = {
  STATE_PATH: STATE_PATH,
  SIZE_PRESETS: SIZE_PRESETS,
  DEFAULT_SIZE_KEY: DEFAULT_SIZE_KEY,
  MAX_UIDS_PER_PROJECT: MAX_UIDS_PER_PROJECT,
  readState: readState,
  writeState: writeState,
  recordLaunch: recordLaunch,
  setProjectSort: setProjectSort,
  rankedSizes: rankedSizes,
  defaultSizeKey: defaultSizeKey,
  findSizePreset: findSizePreset
};
