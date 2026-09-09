var http = require("http");
var fs = require("fs");
var path = require("path");
var url = require("url");
var crypto = require("crypto");
var execFile = require("child_process").execFile;
var parseMod = require("./lib/parse");
var parseGitStatus = parseMod.parseGitStatus;
var parseGitNameStatus = parseMod.parseGitNameStatus;
var parseSvnStatusXml = parseMod.parseSvnStatusXml;
var parseSvnDiffXml = parseMod.parseSvnDiffXml;
var launcher = require("./lib/launcher");
var launcherState = require("./lib/launcher-state");
var undoStore = require("./lib/undo");

var PORT = Number(process.env.PORT || 33210);
var PUBLIC_DIR = path.join(__dirname, "public");
var DEFAULT_PROJECT_ROOT = path.resolve(__dirname, "..");
var UNDO_DIR = path.join(__dirname, "data", "undo");
var IMAGE_EXTS = {
  ".png": true,
  ".jpg": true,
  ".jpeg": true,
  ".webp": true,
  ".bmp": true,
  ".gif": true
};
var PREFERRED_RES_DIRS = [
  "res",
  "res_majiang",
  "res_zipai",
  "res_poker",
  "res_paodekuai",
  "res_goldField"
];
var SUPPORTED_VCS = { git: true, svn: true };

function sendJson(res, statusCode, data) {
  var body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(text);
}

function readBody(req, callback) {
  var chunks = [];
  var total = 0;
  req.on("data", function (chunk) {
    total += chunk.length;
    if (total > 1024 * 1024 * 4) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", function () {
    var raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) {
      callback(null, {});
      return;
    }
    try {
      callback(null, JSON.parse(raw));
    } catch (err) {
      callback(new Error("请求体不是有效 JSON"));
    }
  });
  req.on("error", callback);
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function trimLeadingSlash(value) {
  return normalizeSlash(value).replace(/^\/+/, "");
}

function isImagePath(filePath) {
  return !!IMAGE_EXTS[path.extname(filePath).toLowerCase()];
}

function isJsonPath(filePath) {
  return path.extname(filePath).toLowerCase() === ".json";
}

function isInside(parent, child) {
  var rel = path.relative(parent, child);
  return rel === "" || (rel && rel.indexOf("..") !== 0 && !path.isAbsolute(rel));
}

function safeResolve(root, relPath) {
  var full = path.resolve(root, relPath);
  if (!isInside(root, full)) {
    return null;
  }
  return full;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    return false;
  }
}

function statDir(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (err) {
    return false;
  }
}

function sha1(filePath) {
  var hash = crypto.createHash("sha1");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function findResRoots(projectRoot) {
  var result = [];
  var used = {};
  PREFERRED_RES_DIRS.forEach(function (name) {
    var full = path.join(projectRoot, name);
    if (statDir(full)) {
      used[name.toLowerCase()] = true;
      result.push({ name: name, full: full });
    }
  });

  try {
    fs.readdirSync(projectRoot).forEach(function (name) {
      var full = path.join(projectRoot, name);
      if (/^res/i.test(name) && statDir(full) && !used[name.toLowerCase()]) {
        used[name.toLowerCase()] = true;
        result.push({ name: name, full: full });
      }
    });
  } catch (err) {}

  return result;
}

function pickVcs(value) {
  var vcs = String(value || "").toLowerCase();
  if (!vcs) return "git";
  if (!SUPPORTED_VCS[vcs]) return null;
  return vcs;
}

function detectVcs(root) {
  if (statDir(path.join(root, ".git"))) return "git";
  if (statDir(path.join(root, ".svn"))) return "svn";
  return "";
}

function validateProjectRoot(projectRoot, vcsHint) {
  if (!projectRoot) {
    return { ok: false, message: "请填写工程根目录" };
  }
  var root = path.resolve(String(projectRoot));
  if (!statDir(root)) {
    return { ok: false, message: "工程根目录不存在：" + root };
  }
  if (!statDir(path.join(root, "ui"))) {
    return { ok: false, message: "未找到 ui 目录：" + root };
  }
  var vcs = pickVcs(vcsHint);
  if (vcs === null) {
    return { ok: false, message: "不支持的版本管理类型：" + vcsHint };
  }
  if (!vcsHint) {
    vcs = detectVcs(root) || "git";
  }
  if (vcs === "git" && !statDir(path.join(root, ".git"))) {
    return { ok: false, message: "该目录不是 git 工程根目录：" + root };
  }
  if (vcs === "svn" && !statDir(path.join(root, ".svn"))) {
    return { ok: false, message: "该目录不是 svn 工作副本根目录：" + root };
  }
  return { ok: true, root: root, vcs: vcs };
}

function runCommand(cmd, args, projectRoot, callback) {
  execFile(cmd, args, {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
    encoding: "buffer"
  }, function (err, stdout, stderr) {
    if (err) {
      var msg = (Buffer.isBuffer(stderr) ? stderr.toString("utf8") : (stderr || err.message || "")).trim();
      callback(new Error(msg || (cmd + " 执行失败")));
      return;
    }
    callback(null, stdout || Buffer.alloc(0));
  });
}

function runGit(projectRoot, args, callback) {
  runCommand("git", args, projectRoot, callback);
}

function runSvn(projectRoot, args, callback) {
  runCommand("svn", args, projectRoot, callback);
}

// 抽象接口：给定 targets（工作副本相对目录），返回归一 changes 列表
function vcsListChanges(projectRoot, vcs, mode, options, callback) {
  var targets = options.targets || [];
  if (vcs === "svn") {
    if (mode === "diff") {
      var base = options.base;
      var head = options.head;
      if (!base || !head) {
        callback(new Error("diff 模式需要 base 和 head 版本号"));
        return;
      }
      var diffArgs = ["diff", "--summarize", "--xml", "-r", base + ":" + head];
      targets.forEach(function (t) { diffArgs.push(t); });
      runSvn(projectRoot, diffArgs, function (err, stdout) {
        if (err) { callback(err); return; }
        callback(null, parseSvnDiffXml(stdout));
      });
      return;
    }
    var statusArgs = ["status", "--xml"];
    targets.forEach(function (t) { statusArgs.push(t); });
    runSvn(projectRoot, statusArgs, function (err, stdout) {
      if (err) { callback(err); return; }
      callback(null, parseSvnStatusXml(stdout));
    });
    return;
  }

  if (mode === "diff") {
    if (!options.base || !options.head) {
      callback(new Error("diff 模式需要 base 和 head"));
      return;
    }
    var gitArgs = [
      "-c", "core.quotepath=false",
      "diff",
      "--name-status",
      "-z",
      "--diff-filter=ACMR",
      String(options.base),
      String(options.head),
      "--"
    ].concat(targets);
    runGit(projectRoot, gitArgs, function (err, stdout) {
      if (err) { callback(err); return; }
      callback(null, parseGitNameStatus(stdout));
    });
    return;
  }

  var statusGitArgs = [
    "-c", "core.quotepath=false",
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--"
  ].concat(targets);
  runGit(projectRoot, statusGitArgs, function (err, stdout) {
    if (err) { callback(err); return; }
    callback(null, parseGitStatus(stdout));
  });
}

function isTrackedChange(change) {
  return String(change.gitStatus || "").trim() !== "??";
}

// SVN 侧的还原：先 revert，未跟踪文件不能自动还原
function svnRevertPaths(projectRoot, paths, callback) {
  if (!paths.length) {
    callback(null);
    return;
  }
  var args = ["revert", "--depth=empty"].concat(paths);
  runSvn(projectRoot, args, function (err) {
    callback(err || null);
  });
}

function toUiRelative(changedPath) {
  var normalized = trimLeadingSlash(changedPath);
  var uiPrefix = "ui/";
  var cocosPrefix = "ui/cocosstudio/";
  if (normalized.indexOf(uiPrefix) !== 0) {
    return null;
  }
  var rel = normalized.indexOf(cocosPrefix) === 0 ?
    normalized.slice(cocosPrefix.length) :
    normalized.slice(uiPrefix.length);
  if (!rel || !isImagePath(rel)) {
    return null;
  }
  return rel;
}

function toUiJsonRelativeFromCsd(changedPath) {
  var normalized = trimLeadingSlash(changedPath);
  var cocosPrefix = "ui/cocosstudio/";
  if (normalized.indexOf(cocosPrefix) !== 0) {
    return null;
  }
  var rel = normalized.slice(cocosPrefix.length);
  if (!rel || path.extname(rel).toLowerCase() !== ".csd") {
    return null;
  }
  return normalizeSlash(rel).replace(/\.csd$/i, ".json");
}

function isUiOrResJsonPath(changedPath) {
  var normalized = trimLeadingSlash(changedPath);
  if (!isJsonPath(normalized)) return false;
  return normalized.indexOf("ui/res/") === 0 || normalized.indexOf("res/") === 0;
}

function buildCsdJsonWhitelist(changes) {
  var whitelist = {};
  changes.forEach(function (change) {
    var sourceRel = toUiJsonRelativeFromCsd(change.path);
    if (!sourceRel) return;
    whitelist[normalizeSlash(path.join("ui/res", sourceRel))] = true;
    whitelist[normalizeSlash(path.join("res", sourceRel))] = true;
  });
  return whitelist;
}

function resolveTargets(projectRoot, sourceRel, resRoots) {
  var targets = [];

  resRoots.forEach(function (root) {
    var targetFull = path.join(root.full, sourceRel);
    var parent = path.dirname(targetFull);

    if (root.name === "res") {
      targets.push({
        dir: root.name,
        relativePath: normalizeSlash(path.join(root.name, sourceRel)),
        exists: fileExists(targetFull),
        willCreateDir: !fileExists(targetFull) && !statDir(parent)
      });
      return;
    }

    if (fileExists(targetFull)) {
      targets.push({
        dir: root.name,
        relativePath: normalizeSlash(path.join(root.name, sourceRel)),
        exists: true,
        manualOnly: true
      });
    }
  });

  return targets;
}

function getPreferredTargetDir(targets) {
  for (var i = 0; i < targets.length; i += 1) {
    if (targets[i].dir === "res") {
      return "res";
    }
  }
  return "";
}

function buildScanItems(projectRoot, changes) {
  var seen = {};
  var resRoots = findResRoots(projectRoot);
  var items = [];

  changes.forEach(function (change) {
    var sourceRel = toUiRelative(change.path);
    if (!sourceRel || seen[sourceRel]) return;
    seen[sourceRel] = true;

    var sourceProjectPath = normalizeSlash(change.path);
    var sourceFull = path.join(projectRoot, sourceProjectPath);
    if (!fileExists(sourceFull) || !isImagePath(sourceFull)) return;

    var targets = resolveTargets(projectRoot, sourceRel, resRoots);
    var preferredTargetDir = getPreferredTargetDir(targets);
    var state = preferredTargetDir ? "ready" : "missing";
    if (!preferredTargetDir && targets.length > 0) state = "conflict";

    items.push({
      id: crypto.createHash("sha1").update(sourceRel).digest("hex").slice(0, 12),
      gitStatus: change.gitStatus,
      svnStatus: change.svnStatus || "",
      sourceRel: sourceRel,
      sourcePath: sourceProjectPath,
      previewPath: sourceProjectPath,
      size: fs.statSync(sourceFull).size,
      state: state,
      selected: state === "ready",
      selectedTargetDir: preferredTargetDir,
      targets: targets
    });
  });

  return items;
}

function buildCsdJsonScanItems(projectRoot, changes) {
  var seen = {};
  var items = [];
  var resRoot = path.join(projectRoot, "res");
  var hasResRoot = statDir(resRoot);

  changes.forEach(function (change) {
    var sourceRel = toUiJsonRelativeFromCsd(change.path);
    if (!sourceRel || seen[sourceRel]) return;
    seen[sourceRel] = true;

    var csdProjectPath = normalizeSlash(change.path);
    var sourceProjectPath = normalizeSlash(path.join("ui/res", sourceRel));
    var sourceFull = path.join(projectRoot, sourceProjectPath);
    var sourceExists = fileExists(sourceFull) && isJsonPath(sourceFull);
    var targetProjectPath = normalizeSlash(path.join("res", sourceRel));
    var state = hasResRoot && sourceExists ? "ready" : "missing";
    var message = "";

    if (!hasResRoot) {
      message = "未找到 res 目录";
    } else if (!sourceExists) {
      message = "未找到 ui 同名 json";
    }

    items.push({
      id: crypto.createHash("sha1").update(sourceRel).digest("hex").slice(0, 12),
      gitStatus: change.gitStatus,
      svnStatus: change.svnStatus || "",
      csdPath: csdProjectPath,
      sourceRel: sourceRel,
      sourcePath: sourceProjectPath,
      targetPath: targetProjectPath,
      state: state,
      selected: state === "ready",
      message: message
    });
  });

  return items;
}

function listRestoreJsonCandidates(projectRoot, vcs, callback) {
  vcsListChanges(projectRoot, vcs, "status", { targets: ["ui/cocosstudio"] }, function (csdErr, csdChanges) {
    if (csdErr) {
      callback(csdErr);
      return;
    }

    var whitelist = buildCsdJsonWhitelist(csdChanges);
    vcsListChanges(projectRoot, vcs, "status", { targets: ["ui/res", "res"] }, function (jsonErr, jsonChanges) {
      if (jsonErr) {
        callback(jsonErr);
        return;
      }

      var seen = {};
      var items = [];
      jsonChanges.forEach(function (change) {
        var changedPath = normalizeSlash(change.path);
        if (!isUiOrResJsonPath(changedPath) || whitelist[changedPath] || seen[changedPath]) {
          return;
        }
        seen[changedPath] = true;

        var restorable = isTrackedChange(change);
        items.push({
          path: changedPath,
          gitStatus: change.gitStatus,
          svnStatus: change.svnStatus || "",
          restorable: restorable,
          reason: restorable ?
            "未命中本地 CSD 白名单" :
            "未跟踪文件，不能自动还原"
        });
      });

      var summary = { total: items.length, restorable: 0, untracked: 0 };
      items.forEach(function (item) {
        if (item.restorable) {
          summary.restorable += 1;
        } else {
          summary.untracked += 1;
        }
      });

      callback(null, {
        whitelistCount: Object.keys(whitelist).length,
        summary: summary,
        items: items
      });
    });
  });
}

function restoreJsonPathsGit(projectRoot, paths, callback) {
  if (!paths.length) {
    callback(null);
    return;
  }

  var args = ["restore", "--source=HEAD", "--staged", "--worktree", "--"].concat(paths);
  runGit(projectRoot, args, function (restoreErr) {
    if (!restoreErr) {
      callback(null);
      return;
    }

    var resetArgs = ["reset", "HEAD", "--"].concat(paths);
    runGit(projectRoot, resetArgs, function (resetErr) {
      if (resetErr) {
        callback(restoreErr);
        return;
      }
      var checkoutArgs = ["checkout", "--"].concat(paths);
      runGit(projectRoot, checkoutArgs, callback);
    });
  });
}

function restoreJsonPaths(projectRoot, vcs, paths, callback) {
  if (vcs === "svn") {
    svnRevertPaths(projectRoot, paths, callback);
    return;
  }
  restoreJsonPathsGit(projectRoot, paths, callback);
}

function handleScan(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }

    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }

    var projectRoot = validation.root;
    var vcs = validation.vcs;
    var mode = body.mode === "diff" ? "diff" : "status";
    var options = { targets: ["ui"] };
    if (mode === "diff") {
      if (!body.base || !body.head) {
        sendJson(res, 400, { ok: false, message: "diff 模式需要 base 和 head" });
        return;
      }
      options.base = String(body.base);
      options.head = String(body.head);
    }

    vcsListChanges(projectRoot, vcs, mode, options, function (vcsErr, changes) {
      if (vcsErr) {
        sendJson(res, 500, { ok: false, message: vcsErr.message });
        return;
      }
      var items = buildScanItems(projectRoot, changes);
      var summary = { total: items.length, ready: 0, conflict: 0, missing: 0 };
      items.forEach(function (item) {
        summary[item.state] += 1;
      });
      sendJson(res, 200, {
        ok: true,
        projectRoot: projectRoot,
        vcs: vcs,
        mode: mode,
        summary: summary,
        items: items
      });
    });
  });
}

function handleCsdJsonScan(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }

    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }

    var projectRoot = validation.root;
    var vcs = validation.vcs;

    vcsListChanges(projectRoot, vcs, "status", { targets: ["ui/cocosstudio"] }, function (vcsErr, changes) {
      if (vcsErr) {
        sendJson(res, 500, { ok: false, message: vcsErr.message });
        return;
      }
      var items = buildCsdJsonScanItems(projectRoot, changes);
      var summary = { total: items.length, ready: 0, missing: 0 };
      items.forEach(function (item) {
        summary[item.state] += 1;
      });
      sendJson(res, 200, {
        ok: true,
        projectRoot: projectRoot,
        vcs: vcs,
        summary: summary,
        items: items
      });
    });
  });
}

function handleRestoreCsdJsonPreview(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }

    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }

    listRestoreJsonCandidates(validation.root, validation.vcs, function (listErr, data) {
      if (listErr) {
        sendJson(res, 500, { ok: false, message: listErr.message });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        projectRoot: validation.root,
        vcs: validation.vcs,
        whitelistCount: data.whitelistCount,
        summary: data.summary,
        items: data.items
      });
    });
  });
}

function handleApply(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }

    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }

    var projectRoot = validation.root;
    var resRoots = findResRoots(projectRoot);
    var resRootMap = {};
    resRoots.forEach(function (item) {
      resRootMap[item.name] = item.full;
    });

    var list = Array.isArray(body.items) ? body.items : [];
    var results = [];
    // 本批被覆盖/新建目标的留底信息，成功同步后才落盘成 undo 批次
    var undoEntries = [];

    list.forEach(function (item) {
      var sourceRel = trimLeadingSlash(item.sourceRel);
      var targetDir = String(item.targetDir || "");
      var sourceProjectPath = trimLeadingSlash(item.sourcePath || "");
      var sourceFull = sourceProjectPath ?
        safeResolve(projectRoot, sourceProjectPath) :
        safeResolve(path.join(projectRoot, "ui", "cocosstudio"), sourceRel);
      var targetRoot = resRootMap[targetDir];

      if (!sourceFull || !isInside(path.join(projectRoot, "ui"), sourceFull) || !targetRoot || !isImagePath(sourceRel)) {
        results.push({ sourceRel: sourceRel, targetDir: targetDir, status: "error", message: "非法路径或非图片资源" });
        return;
      }
      if (!fileExists(sourceFull)) {
        results.push({ sourceRel: sourceRel, targetDir: targetDir, status: "error", message: "源图片不存在" });
        return;
      }

      var targetFull = safeResolve(targetRoot, sourceRel);
      if (!targetFull || !isInside(targetRoot, targetFull)) {
        results.push({ sourceRel: sourceRel, targetDir: targetDir, status: "error", message: "目标路径越界" });
        return;
      }
      try {
        if (!statDir(path.dirname(targetFull))) {
          fs.mkdirSync(path.dirname(targetFull), { recursive: true });
        }
        var beforeExisted = fileExists(targetFull);
        var beforeHash = beforeExisted ? sha1(targetFull) : "";
        var sourceHash = sha1(sourceFull);
        if (beforeHash && beforeHash === sourceHash) {
          results.push({ sourceRel: sourceRel, targetDir: targetDir, status: "skipped", message: "内容一致，已跳过" });
          return;
        }
        // 覆盖前留底：存在的把旧字节读进内存，不存在的标记 beforeExisted=false（撤销=删除）。
        // 必须在 copyFileSync 之前读，否则读到的是覆盖后的新内容。
        var undoEntry = {
          targetPath: normalizeSlash(path.join(targetDir, sourceRel)),
          beforeExisted: beforeExisted
        };
        if (beforeExisted) {
          undoEntry.beforeBytes = fs.readFileSync(targetFull);
        }
        undoEntries.push(undoEntry);
        fs.copyFileSync(sourceFull, targetFull);
        results.push({
          sourceRel: sourceRel,
          targetDir: targetDir,
          targetPath: normalizeSlash(path.join(targetDir, sourceRel)),
          status: "copied",
          beforeHash: beforeHash,
          afterHash: sha1(targetFull)
        });
      } catch (copyErr) {
        results.push({ sourceRel: sourceRel, targetDir: targetDir, status: "error", message: copyErr.message });
      }
    });

    var summary = { copied: 0, skipped: 0, error: 0 };
    results.forEach(function (item) {
      if (summary[item.status] === undefined) summary[item.status] = 0;
      summary[item.status] += 1;
    });

    // 只有真正改动过目标（copied）才落 undo 批次；全 skipped/error 的不留痕
    var undoBatch = null;
    if (undoEntries.length) {
      try {
        undoBatch = undoStore.saveBatch(undoEntries, {
          createdAt: Date.now(),
          projectRoot: projectRoot,
          summary: { copied: summary.copied || 0, skipped: summary.skipped || 0, error: summary.error || 0 }
        });
        undoStore.prune();
      } catch (undoErr) {
        // 留底失败不阻断同步结果，但回传里告知可撤销批次缺失
        undoBatch = { undoError: undoErr.message };
      }
    }

    sendJson(res, 200, {
      ok: true,
      summary: summary,
      results: results,
      undoBatch: undoBatch
    });
  });
}

function handleCsdJsonApply(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }

    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }

    var projectRoot = validation.root;
    var uiRoot = path.join(projectRoot, "ui");
    var resRoot = path.join(projectRoot, "res");
    var list = Array.isArray(body.items) ? body.items : [];
    var results = [];

    list.forEach(function (item) {
      var sourceRel = trimLeadingSlash(item.sourceRel);
      var sourceProjectPath = trimLeadingSlash(item.sourcePath || "");
      var sourceFull = sourceProjectPath ?
        safeResolve(projectRoot, sourceProjectPath) :
        safeResolve(projectRoot, normalizeSlash(path.join("ui", sourceRel)));
      var targetProjectPath = trimLeadingSlash(item.targetPath || normalizeSlash(path.join("res", sourceRel)));
      var targetFull = safeResolve(projectRoot, targetProjectPath);

      if (!statDir(resRoot)) {
        results.push({ sourceRel: sourceRel, status: "error", message: "未找到 res 目录" });
        return;
      }
      if (!sourceFull || !isInside(uiRoot, sourceFull) || !isJsonPath(sourceFull)) {
        results.push({ sourceRel: sourceRel, status: "error", message: "非法路径或非 json 资源" });
        return;
      }
      if (!targetFull || !isInside(resRoot, targetFull) || !isJsonPath(targetFull)) {
        results.push({ sourceRel: sourceRel, status: "error", message: "目标路径越界或非 json" });
        return;
      }
      if (!fileExists(sourceFull)) {
        results.push({ sourceRel: sourceRel, status: "error", message: "源 json 不存在" });
        return;
      }

      try {
        if (!statDir(path.dirname(targetFull))) {
          fs.mkdirSync(path.dirname(targetFull), { recursive: true });
        }
        var beforeHash = fileExists(targetFull) ? sha1(targetFull) : "";
        var sourceHash = sha1(sourceFull);
        if (beforeHash && beforeHash === sourceHash) {
          results.push({ sourceRel: sourceRel, targetPath: targetProjectPath, status: "skipped", message: "内容一致，已跳过" });
          return;
        }
        fs.copyFileSync(sourceFull, targetFull);
        results.push({
          sourceRel: sourceRel,
          targetPath: targetProjectPath,
          status: "copied",
          beforeHash: beforeHash,
          afterHash: sha1(targetFull)
        });
      } catch (copyErr) {
        results.push({ sourceRel: sourceRel, status: "error", message: copyErr.message });
      }
    });

    var summary = { copied: 0, skipped: 0, error: 0 };
    results.forEach(function (item) {
      if (summary[item.status] === undefined) summary[item.status] = 0;
      summary[item.status] += 1;
    });
    sendJson(res, 200, { ok: true, summary: summary, results: results });
  });
}

function handleRestoreCsdJson(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }

    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }

    var vcs = validation.vcs;
    listRestoreJsonCandidates(validation.root, vcs, function (listErr, data) {
      if (listErr) {
        sendJson(res, 500, { ok: false, message: listErr.message });
        return;
      }

      var requestedPaths = Array.isArray(body.paths) && body.paths.length ?
        body.paths.map(trimLeadingSlash) :
        data.items.map(function (item) { return item.path; });
      var candidateMap = {};
      var restorePaths = [];
      var results = [];

      data.items.forEach(function (item) {
        candidateMap[item.path] = item;
      });

      requestedPaths.forEach(function (itemPath) {
        var candidate = candidateMap[itemPath];
        if (!candidate) {
          results.push({ path: itemPath, status: "skipped", message: "当前不在可还原范围内" });
          return;
        }
        if (!candidate.restorable) {
          results.push({ path: itemPath, status: "skipped", message: candidate.reason });
          return;
        }
        restorePaths.push(itemPath);
      });

      restoreJsonPaths(validation.root, vcs, restorePaths, function (restoreErr) {
        if (restoreErr) {
          restorePaths.forEach(function (itemPath) {
            results.push({ path: itemPath, status: "error", message: restoreErr.message });
          });
        } else {
          var restoredMsg = vcs === "svn" ? "已还原到工作副本基准" : "已还原到 HEAD";
          restorePaths.forEach(function (itemPath) {
            results.push({ path: itemPath, status: "restored", message: restoredMsg });
          });
        }

        var summary = { restored: 0, skipped: 0, error: 0 };
        results.forEach(function (item) {
          summary[item.status] += 1;
        });

        sendJson(res, 200, {
          ok: true,
          vcs: vcs,
          whitelistCount: data.whitelistCount,
          summary: summary,
          results: results
        });
      });
    });
  });
}

function handleImage(req, res, parsedUrl) {
  var projectRoot = parsedUrl.query.projectRoot;
  var relPath = parsedUrl.query.path;
  var validation = validateProjectRoot(projectRoot, parsedUrl.query.vcs);
  if (!validation.ok) {
    sendText(res, 400, validation.message);
    return;
  }
  var filePath = safeResolve(validation.root, relPath);
  if (!filePath || !fileExists(filePath) || !isImagePath(filePath)) {
    sendText(res, 404, "图片不存在");
    return;
  }
  var ext = path.extname(filePath).toLowerCase();
  var type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".webp" ? "image/webp" :
    ext === ".gif" ? "image/gif" :
    ext === ".bmp" ? "image/bmp" : "image/png";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, parsedUrl) {
  var pathname = decodeURIComponent(parsedUrl.pathname || "/");
  if (pathname === "/") pathname = "/index.html";
  var filePath = safeResolve(PUBLIC_DIR, trimLeadingSlash(pathname));
  if (!filePath || !fileExists(filePath) || statDir(filePath)) {
    sendText(res, 404, "Not Found");
    return;
  }
  var ext = path.extname(filePath).toLowerCase();
  var type = ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" :
    ext === ".js" ? "application/javascript; charset=utf-8" :
    ext === ".json" ? "application/json; charset=utf-8" :
    ext === ".png" ? "image/png" :
    ext === ".ico" ? "image/x-icon" :
    ext === ".svg" ? "image/svg+xml" :
    ext === ".webp" ? "image/webp" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function handleDetectVcs(req, res, parsedUrl) {
  var projectRoot = parsedUrl.query.projectRoot;
  if (!projectRoot) {
    sendJson(res, 400, { ok: false, message: "缺少 projectRoot" });
    return;
  }
  var root = path.resolve(String(projectRoot));
  if (!statDir(root)) {
    sendJson(res, 200, { ok: true, exists: false, vcs: "" });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    exists: true,
    hasUi: statDir(path.join(root, "ui")),
    vcs: detectVcs(root)
  });
}

/* ---------------- 客户端启动台 ---------------- */

// 返回工程列表 + 记忆状态（尺寸档位、每工程 uid、排序偏好）
function handleLauncherProjects(req, res, parsedUrl) {
  var clientRoot = launcher.resolveClientRoot(parsedUrl.query.clientRoot);
  var state = launcherState.readState();
  if (!clientRoot) {
    sendJson(res, 200, {
      ok: true,
      clientRoot: "",
      detected: launcher.detectClientRoot(),
      projects: [],
      sizes: launcherState.rankedSizes(state),
      defaultSize: launcherState.defaultSizeKey(state),
      projectSort: state.projectSort,
      lastProject: state.lastProject,
      message: "未找到 client 根目录，请手动指定（需包含 jtool/jt.exe）"
    });
    return;
  }
  var projects = launcher.sortProjects(
    launcher.listProjects(clientRoot),
    state.projectSort
  );
  sendJson(res, 200, {
    ok: true,
    clientRoot: clientRoot,
    projects: projects,
    sizes: launcherState.rankedSizes(state),
    defaultSize: launcherState.defaultSizeKey(state),
    projectSort: state.projectSort,
    lastProject: state.lastProject
  });
}

// 当前实例快照（刷新页面后恢复列表）
function handleLauncherInstances(req, res) {
  sendJson(res, 200, { ok: true, instances: launcher.listInstances() });
}

function handleLauncherLaunch(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }
    var clientRoot = launcher.resolveClientRoot(body.clientRoot);
    if (!clientRoot) {
      sendJson(res, 400, { ok: false, message: "未找到有效的 client 根目录（需包含 jtool/jt.exe）" });
      return;
    }
    var project = String(body.project || "").trim();
    if (!project) {
      sendJson(res, 400, { ok: false, message: "缺少工程名" });
      return;
    }
    // uid 支持逗号批量：1000001,1000002 串行开两个实例
    var uids = String(body.uid || "")
      .split(/[,，\s]+/)
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean);
    if (!uids.length) {
      sendJson(res, 400, { ok: false, message: "缺少账号 uid" });
      return;
    }
    for (var i = 0; i < uids.length; i++) {
      if (!/^[0-9a-zA-Z]+$/.test(uids[i])) {
        sendJson(res, 400, { ok: false, message: "uid 含非法字符：" + uids[i] });
        return;
      }
    }
    var width = Number(body.width) || 1000;
    var height = Number(body.height) || 526;

    uids.forEach(function (uid) {
      launcher.enqueueLaunch({
        clientRoot: clientRoot,
        project: project,
        uid: uid,
        width: width,
        height: height,
        packageName: body.packageName ? String(body.packageName) : ""
      });
    });
    sendJson(res, 200, { ok: true, queued: uids.length });
  });
}

function handleLauncherStop(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }
    var instanceId = String(body.instanceId || "");
    if (!instanceId) {
      sendJson(res, 400, { ok: false, message: "缺少 instanceId" });
      return;
    }
    launcher.stopInstance(instanceId, function (stopErr, snapshot) {
      if (stopErr) {
        sendJson(res, 500, { ok: false, message: stopErr.message });
        return;
      }
      sendJson(res, 200, { ok: true, instance: snapshot });
    });
  });
}

function handleLauncherClear(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }
    var instanceId = String(body.instanceId || "");
    var removed = launcher.clearInstance(instanceId);
    if (!removed) {
      sendJson(res, 400, { ok: false, message: "实例不存在或仍在运行" });
      return;
    }
    sendJson(res, 200, { ok: true });
  });
}

function handleLauncherSort(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }
    var state = launcherState.setProjectSort(String(body.sort || ""));
    sendJson(res, 200, { ok: true, projectSort: state.projectSort });
  });
}

// SSE：全部实例复用一条连接，事件里带 instanceId 区分
function handleLauncherStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 3000\n\n");
  res.write("data: " + JSON.stringify({ type: "hello", instances: launcher.listInstances() }) + "\n\n");
  launcher.addListener(res);

  // 心跳，避免代理/浏览器断掉空闲连接
  var heartbeat = setInterval(function () {
    try {
      res.write(": ping\n\n");
    } catch (hbErr) {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on("close", function () {
    clearInterval(heartbeat);
    launcher.removeListener(res);
  });
}

// 打开/下载某实例的原始日志（GBK 解码为 utf8 文本返回）
function handleLauncherLog(req, res, parsedUrl) {
  var instanceId = String(parsedUrl.query.instanceId || "");
  var target = null;
  launcher.listInstances().forEach(function (item) {
    if (item.instanceId === instanceId) target = item;
  });
  if (!target || !target.logPath) {
    sendText(res, 404, "日志不存在");
    return;
  }
  fs.readFile(target.logPath, function (readErr, buf) {
    if (readErr) {
      sendText(res, 404, "日志读取失败");
      return;
    }
    var gbk = require("./lib/gbk");
    var text;
    try {
      text = gbk.decode(buf);
    } catch (decodeErr) {
      // 日志里可能混入非 GBK 字节（偶发 UTF-8 或损坏数据），
      // 兜底按 utf8 解，并在开头标注，避免一条坏日志把整个接口拖成 500。
      text = "[日志含非 GBK 字节，已回退 utf8 解码]\n" + buf.toString("utf8");
    }
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(text);
  });
}

function handleUndoList(req, res) {
  void req;
  sendJson(res, 200, { ok: true, batches: undoStore.listBatches() });
}

function handleUndoRestore(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }
    var validation = validateProjectRoot(body.projectRoot, body.vcs);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, message: validation.message });
      return;
    }
    var batchId = String(body.batchId || "").trim();
    if (!batchId) {
      sendJson(res, 400, { ok: false, message: "缺少 batchId" });
      return;
    }
    // 还原路径同样走 safeResolve，避免被 manifest 里的相对路径带出越界
    var result = undoStore.restoreBatch(batchId, validation.root, safeResolve);
    sendJson(res, result.ok ? 200 : 404, result);
  });
}

function handleUndoClear(req, res) {
  readBody(req, function (err, body) {
    if (err) {
      sendJson(res, 400, { ok: false, message: err.message });
      return;
    }
    var batchId = String(body.batchId || "").trim();
    if (!batchId) {
      sendJson(res, 400, { ok: false, message: "缺少 batchId" });
      return;
    }
    var removed = undoStore.clearBatch(batchId);
    sendJson(res, 200, { ok: removed, batchId: batchId });
  });
}

function handleConfig(req, res) {
  void req; // 该接口仅返回静态配置，不读取请求体
  sendJson(res, 200, { ok: true, defaultProjectRoot: DEFAULT_PROJECT_ROOT, port: PORT });
}

// method + pathname -> handler 的路由表，新增接口只改这里
var ROUTES = [
  { method: "GET",  path: "/api/config",                    handler: handleConfig },
  { method: "GET",  path: "/api/detect-vcs",                handler: handleDetectVcs },
  { method: "GET",  path: "/api/image",                     handler: handleImage },
  { method: "GET",  path: "/api/launcher/projects",         handler: handleLauncherProjects },
  { method: "GET",  path: "/api/launcher/instances",         handler: handleLauncherInstances },
  { method: "GET",  path: "/api/launcher/stream",           handler: handleLauncherStream },
  { method: "GET",  path: "/api/launcher/log",              handler: handleLauncherLog },
  { method: "POST", path: "/api/scan",                      handler: handleScan },
  { method: "POST", path: "/api/scan-csd-json",             handler: handleCsdJsonScan },
  { method: "POST", path: "/api/restore-csd-json-preview", handler: handleRestoreCsdJsonPreview },
  { method: "POST", path: "/api/apply",                     handler: handleApply },
  { method: "POST", path: "/api/apply-csd-json",            handler: handleCsdJsonApply },
  { method: "POST", path: "/api/restore-csd-json",          handler: handleRestoreCsdJson },
  { method: "POST", path: "/api/undo/list",                  handler: handleUndoList },
  { method: "POST", path: "/api/undo/restore",               handler: handleUndoRestore },
  { method: "POST", path: "/api/undo/clear",                 handler: handleUndoClear },
  { method: "POST", path: "/api/launcher/launch",           handler: handleLauncherLaunch },
  { method: "POST", path: "/api/launcher/stop",             handler: handleLauncherStop },
  { method: "POST", path: "/api/launcher/clear",            handler: handleLauncherClear },
  { method: "POST", path: "/api/launcher/sort",             handler: handleLauncherSort }
];

var server = http.createServer(function (req, res) {
  var parsedUrl = url.parse(req.url, true);
  for (var i = 0; i < ROUTES.length; i++) {
    var route = ROUTES[i];
    if (route.method === req.method && route.path === parsedUrl.pathname) {
      route.handler(req, res, parsedUrl);
      return;
    }
  }
  if (req.method === "GET") {
    serveStatic(req, res, parsedUrl);
    return;
  }
  sendText(res, 405, "Method Not Allowed");
});

function startServer(port) {
  server.listen(port, function () {
    console.log("ui-image-res-sync 已启动");
    console.log("访问地址：http://127.0.0.1:" + port);
    console.log("默认工程目录：" + DEFAULT_PROJECT_ROOT);
  });
}

server.on("error", function (err) {
  if (err && err.code === "EADDRINUSE") {
    var suggested = Number(process.env.PORT) || PORT;
    console.error("[端口被占用] " + suggested + " 已被占用，可能是另一个实例还在跑。");
    console.error("  - 关掉旧实例后再试，或");
    console.error("  - 换端口启动：PORT=" + (suggested + 1) + " npm start");
    process.exit(1);
  }
  throw err;
});

startServer(PORT);
