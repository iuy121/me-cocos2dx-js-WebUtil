"use strict";

// 同步撤销（undo）存储：/api/apply 覆盖目标前，把旧内容留底，
// 手滑同步错目录时可以整批回滚到覆盖前。
//
// 存储结构：
//   data/undo/<batchId>/
//     manifest.json   —— 批次元信息 + 每个目标的还原指令
//     0.bin, 1.bin …  —— 被覆盖目标的原始字节（beforeExisted=true 才有）
//
// manifest.entries[i].targetPath 存的是工程相对路径标签（如 res/a/b.png），
// 还原时由调用方提供 projectRoot 再拼绝对路径，保持与其它接口一致的传参方式。

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var UNDO_DIR = path.join(__dirname, "..", "data", "undo");
var MAX_BATCHES = 20; // 自动保留最近这么多批，防止无限堆积

function ensureDir() {
  try {
    if (!fs.existsSync(UNDO_DIR)) fs.mkdirSync(UNDO_DIR, { recursive: true });
  } catch (err) {
    // 读写时会再次报错，这里不阻断
  }
}

function newBatchId() {
  // 用随机字节避免同秒多批碰撞，不用递增计数（重启后丢了也能读历史）
  return crypto.randomBytes(6).toString("hex");
}

// entries: [{ beforeBytes(Buffer|可选), targetPath(标签), beforeExisted }]
//   调用方在覆盖目标之前读好旧字节传进来，避免覆盖后再读拿到新内容。
// meta: { createdAt, projectRoot, summary }
// 返回 manifest。存不了的批次条目记 storeError，还原时跳过。
function saveBatch(entries, meta) {
  ensureDir();
  var batchId = newBatchId();
  var dir = path.join(UNDO_DIR, batchId);
  fs.mkdirSync(dir, { recursive: true });

  var manifest = {
    batchId: batchId,
    createdAt: meta.createdAt || 0,
    projectRoot: meta.projectRoot || "",
    summary: meta.summary || {},
    entries: []
  };

  entries.forEach(function (e, idx) {
    var entry = {
      targetPath: e.targetPath,
      beforeExisted: !!e.beforeExisted
    };
    if (e.beforeExisted) {
      var storeName = idx + ".bin";
      try {
        if (e.beforeBytes) {
          fs.writeFileSync(path.join(dir, storeName), e.beforeBytes);
        } else {
          // 没传字节（旧路径），记成无法还原
          entry.storeError = "未提供覆盖前字节";
        }
        if (!entry.storeError) entry.store = storeName;
      } catch (err) {
        entry.storeError = err.message;
      }
    }
    manifest.entries.push(entry);
  });

  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  return manifest;
}

function readManifest(batchId) {
  var p = path.join(UNDO_DIR, batchId, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    return null;
  }
}

// 还原一批：projectRoot 由调用方提供，拼回绝对路径后再写回。
// 还原后默认不删批次，方便重复/排查；clearBatch 单独清。
function restoreBatch(batchId, projectRoot, safeResolve) {
  var manifest = readManifest(batchId);
  if (!manifest) {
    return { ok: false, message: "撤销记录不存在：" + batchId };
  }

  var dir = path.join(UNDO_DIR, batchId);
  var results = [];

  manifest.entries.forEach(function (entry) {
    if (!entry.targetPath) {
      results.push({ targetPath: "", status: "skipped", message: "记录缺少目标路径" });
      return;
    }
    // targetPath 是工程相对标签，交给调用方的 safeResolve 校验越界
    var targetFull = safeResolve(projectRoot, entry.targetPath);
    if (!targetFull) {
      results.push({ targetPath: entry.targetPath, status: "error", message: "目标路径越界" });
      return;
    }

    if (!entry.beforeExisted) {
      // 覆盖前文件不存在（apply 新建的），撤销 = 删掉它
      try {
        if (fs.existsSync(targetFull)) {
          fs.unlinkSync(targetFull);
          results.push({ targetPath: entry.targetPath, status: "deleted", message: "已删除（还原到未创建）" });
        } else {
          results.push({ targetPath: entry.targetPath, status: "skipped", message: "目标已不存在" });
        }
      } catch (err) {
        results.push({ targetPath: entry.targetPath, status: "error", message: err.message });
      }
      return;
    }

    // 覆盖前文件存在，撤销 = 把留底字节写回
    if (!entry.store) {
      results.push({ targetPath: entry.targetPath, status: "error", message: entry.storeError || "未留底，无法还原" });
      return;
    }
    try {
      fs.copyFileSync(path.join(dir, entry.store), targetFull);
      results.push({ targetPath: entry.targetPath, status: "restored", message: "已还原到覆盖前内容" });
    } catch (err) {
      results.push({ targetPath: entry.targetPath, status: "error", message: err.message });
    }
  });

  var summary = { restored: 0, deleted: 0, skipped: 0, error: 0 };
  results.forEach(function (r) {
    if (summary[r.status] === undefined) summary[r.status] = 0;
    summary[r.status] += 1;
  });

  return { ok: true, batchId: batchId, summary: summary, results: results };
}

function listBatches() {
  ensureDir();
  var names;
  try {
    names = fs.readdirSync(UNDO_DIR);
  } catch (err) {
    return [];
  }
  var out = [];
  names.forEach(function (name) {
    var manifest = readManifest(name);
    if (!manifest) return;
    out.push({
      batchId: manifest.batchId,
      createdAt: manifest.createdAt || 0,
      projectRoot: manifest.projectRoot || "",
      summary: manifest.summary || {},
      entryCount: (manifest.entries || []).length
    });
  });
  out.sort(function (a, b) {
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return out;
}

function clearBatch(batchId) {
  var dir = path.join(UNDO_DIR, batchId);
  if (!fs.existsSync(dir)) return false;
  try {
    // 递归删
    var stack = [dir];
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var entries;
      try {
        entries = fs.readdirSync(cur);
      } catch (err) {
        entries = [];
      }
      if (!entries.length) {
        stack.pop();
        if (cur !== dir) {
          // 留到下一轮删空目录，dir 最后删
        }
        try { fs.rmdirSync(cur); } catch (err) {}
        continue;
      }
      for (var i = 0; i < entries.length; i++) {
        var child = path.join(cur, entries[i]);
        try {
          if (fs.statSync(child).isDirectory()) {
            stack.push(child);
          } else {
            fs.unlinkSync(child);
          }
        } catch (err) {
          // 单个删失败不阻断，继续
        }
      }
      // 下一轮再来清空后的目录
      return clearBatch(batchId);
    }
    return true;
  } catch (err) {
    return false;
  }
}

// 自动裁剪：保留最近 MAX_BATCHES 批，更老的删掉
function prune() {
  var batches = listBatches();
  if (batches.length <= MAX_BATCHES) return 0;
  var removed = 0;
  for (var i = MAX_BATCHES; i < batches.length; i++) {
    if (clearBatch(batches[i].batchId)) removed += 1;
  }
  return removed;
}

module.exports = {
  UNDO_DIR: UNDO_DIR,
  saveBatch: saveBatch,
  readManifest: readManifest,
  restoreBatch: restoreBatch,
  listBatches: listBatches,
  clearBatch: clearBatch,
  prune: prune
};
