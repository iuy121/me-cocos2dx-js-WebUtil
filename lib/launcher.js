"use strict";

// 客户端启动台核心：接管 jtool/start.bat + start.py 的职责，直接 spawn jt.exe。
//
// 为什么不复用 start.bat：
//   1. start.bat 写死 logName=logs/log<当天日期>，同一天所有实例共享一个日志文件，
//      这正是多开账号后日志混在一起没法排查的根因。这里改成每实例独立日志。
//   2. start.py 结尾是 os._exit(0)，jt.exe 变成孤儿进程，父进程拿不到 PID，
//      没法精确关闭某个实例。直接 spawn 就能持有 PID。
//
// jt.exe 启动前要改写 jtool/TestConfig.js 与 jtool/tool.json，这两个文件是全局共享的，
// 所以多开必须串行 + 间隔，并发会互相覆盖配置。

var fs = require("fs");
var path = require("path");
var spawn = require("child_process").spawn;
var execFile = require("child_process").execFile;
var gbk = require("./gbk");
var stateStore = require("./launcher-state");

var LAUNCH_GAP_MS = 2000; // 两次启动之间的间隔，给 jt.exe 读完配置的时间
var TAIL_POLL_MS = 400; // jt.exe 写日志不一定触发 watch 事件，用轮询兜底
var MAX_LINE_BYTES = 1024 * 512;
var HEALTH_CHECK_MS = 10000; // 进程健康检查间隔，兜底 exit 事件丢失

var instances = []; // 全部实例（含已退出的，日志仍可查）
var listeners = []; // SSE 订阅者
var launchQueue = [];
var launching = false;
var instanceSeq = 0;

/* ---------------- 路径解析 ---------------- */

function statDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (err) {
    return false;
  }
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch (err) {
    return false;
  }
}

// client 根目录 = 含 jtool/jt.exe 且下面挂着一堆 mjclient_* 的目录
function isClientRoot(dir) {
  return !!dir && statDir(dir) && fileExists(path.join(dir, "jtool", "jt.exe"));
}

function detectClientRoot() {
  var toolsRoot = path.resolve(__dirname, "..", ".."); // d:/6666/qx_client_Tools
  var workRoot = path.resolve(toolsRoot, ".."); // d:/6666

  var candidates = [];
  if (process.env.LAUNCHER_CLIENT_ROOT) candidates.push(path.resolve(process.env.LAUNCHER_CLIENT_ROOT));
  var saved = stateStore.readState().clientRoot;
  if (saved) candidates.push(path.resolve(saved));
  candidates.push(path.join(workRoot, "qixing", "client"));

  for (var i = 0; i < candidates.length; i++) {
    if (isClientRoot(candidates[i])) return candidates[i];
  }

  // 兜底：扫一层 <workRoot>/*/client
  try {
    var names = fs.readdirSync(workRoot);
    for (var j = 0; j < names.length; j++) {
      var guess = path.join(workRoot, names[j], "client");
      if (isClientRoot(guess)) return guess;
    }
  } catch (err) {
    // 扫描失败就返回空，由上层提示用户手填
  }
  return "";
}

function resolveClientRoot(explicitRoot) {
  if (explicitRoot) {
    var abs = path.resolve(String(explicitRoot));
    if (isClientRoot(abs)) return abs;
    return "";
  }
  return detectClientRoot();
}

/* ---------------- 工程扫描 ---------------- */

var PROJECT_NAME_RE = /^mjclient[-_].+/i;
var PROJECT_EXCLUDE = { resource: true, update: true, jtool: true };

function listProjects(clientRoot) {
  if (!clientRoot) return [];
  var names = [];
  try {
    names = fs.readdirSync(clientRoot);
  } catch (err) {
    return [];
  }

  var state = stateStore.readState();
  var out = [];
  names.forEach(function (name) {
    if (PROJECT_EXCLUDE[name.toLowerCase()]) return;
    if (!PROJECT_NAME_RE.test(name)) return;
    var dir = path.join(clientRoot, name);
    if (!statDir(dir)) return;
    // 壳工程的判定：main.js + project.json 同时存在
    if (!fileExists(path.join(dir, "main.js"))) return;
    if (!fileExists(path.join(dir, "project.json"))) return;

    var entry = state.projects[name] || {};
    out.push({
      name: name,
      count: Number(entry.count) || 0,
      lastUsedAt: Number(entry.lastUsedAt) || 0,
      lastSize: entry.lastSize || "",
      uids: (entry.uids || []).map(function (item) {
        return item.uid;
      })
    });
  });
  return out;
}

function sortProjects(list, sort) {
  var arr = list.slice();
  if (sort === "count") {
    arr.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  } else if (sort === "name") {
    arr.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  } else {
    // recent：用过的按最近时间在前，没用过的按名称排在后面
    arr.sort(function (a, b) {
      if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }
  return arr;
}

/* ---------------- 配置写入 ---------------- */

function backupOnce(filePath) {
  var bak = filePath + ".bak";
  if (fileExists(filePath) && !fileExists(bak)) {
    try {
      fs.writeFileSync(bak, fs.readFileSync(filePath));
    } catch (err) {
      // 备份失败不阻断启动，只是少一份还原兜底
    }
  }
}

// 等价于 start.py 对 TestConfig.js 的两处正则替换
function writeTestConfig(jtoolDir, uid, packageName) {
  var filePath = path.join(jtoolDir, "TestConfig.js");
  if (!fileExists(filePath)) throw new Error("找不到 TestConfig.js：" + filePath);
  backupOnce(filePath);

  var data = fs.readFileSync(filePath, "utf8");
  data = data.replace(/TestConfig\.mail = [0-9a-zA-Z]+/, "TestConfig.mail = " + uid);
  if (packageName) {
    data = data.replace(
      /TestConfig\.PackageName = "[\-a-zA-Z0-9._]+";/,
      'TestConfig.PackageName = "' + packageName + '";'
    );
  }
  fs.writeFileSync(filePath, data, "utf8");
}

// 等价于 start.py 对 tool.json 的键值覆盖（只改已存在的键，保持原有结构）
function writeToolJson(jtoolDir, patch) {
  var filePath = path.join(jtoolDir, "tool.json");
  if (!fileExists(filePath)) throw new Error("找不到 tool.json：" + filePath);
  backupOnce(filePath);

  var json;
  try {
    json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error("tool.json 不是有效 JSON：" + err.message);
  }
  Object.keys(patch).forEach(function (key) {
    json[key] = String(patch[key]);
  });
  fs.writeFileSync(filePath, JSON.stringify(json), "utf8");
  return json;
}

/* ---------------- 窗口平铺 ---------------- */

// 按当前运行中的实例数四宫格排布，避免新窗口盖住旧窗口
function computeWindowPos(width, height) {
  var running = instances.filter(function (item) {
    return item.status === "running";
  }).length;
  var col = running % 2;
  var row = Math.floor(running / 2) % 2;
  var stack = Math.floor(running / 4);
  return {
    winX: 260 + col * (Number(width) + 30) / 2 + stack * 40,
    winY: 50 + row * (Number(height) + 40) / 2 + stack * 30
  };
}

/* ---------------- 日志跟随 ---------------- */

function pushEvent(event) {
  var payload = "data: " + JSON.stringify(event) + "\n\n";
  listeners.slice().forEach(function (res) {
    try {
      res.write(payload);
    } catch (err) {
      removeListener(res);
    }
  });
}

function removeListener(res) {
  var idx = listeners.indexOf(res);
  if (idx !== -1) listeners.splice(idx, 1);
}

function addListener(res) {
  listeners.push(res);
}

function instanceSnapshot(item) {
  return {
    instanceId: item.instanceId,
    project: item.project,
    uid: item.uid,
    pid: item.pid,
    width: item.width,
    height: item.height,
    logPath: item.logPath,
    logName: item.logName,
    status: item.status,
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
    startedAt: item.startedAt,
    endedAt: item.endedAt || 0
  };
}

function startTail(item) {
  var decoder = gbk.createDecoder();
  var offset = 0;
  var carry = "";
  var reading = false;

  function emitLines(text) {
    if (!text) return;
    carry += text;
    var parts = carry.split(/\r?\n/);
    carry = parts.pop();
    if (carry.length > MAX_LINE_BYTES) {
      // 异常长行（例如二进制垃圾）直接切断，避免内存堆积
      parts.push(carry);
      carry = "";
    }
    if (!parts.length) return;
    pushEvent({
      type: "log",
      instanceId: item.instanceId,
      lines: parts
    });
  }

  function readMore() {
    if (reading || item.tailStopped) return;
    reading = true;
    fs.stat(item.logPath, function (statErr, st) {
      if (statErr || !st) {
        reading = false;
        return;
      }
      if (st.size < offset) offset = 0; // 日志被重建
      if (st.size === offset) {
        reading = false;
        return;
      }
      var stream = fs.createReadStream(item.logPath, { start: offset, end: st.size - 1 });
      stream.on("data", function (chunk) {
        offset += chunk.length;
        emitLines(decoder.write(chunk));
      });
      stream.on("error", function () {
        reading = false;
      });
      stream.on("end", function () {
        reading = false;
      });
    });
  }

  item.tailTimer = setInterval(readMore, TAIL_POLL_MS);
  readMore();
}

function stopTail(item) {
  item.tailStopped = true;
  if (item.tailTimer) {
    clearInterval(item.tailTimer);
    item.tailTimer = null;
  }
}

/* ---------------- 进程健康检查 ---------------- */

// child.unref() 后，若 jt.exe 被 taskkill /F、任务管理器强杀或自己崩溃，
// Node 端 child 的 exit 事件可能丢失（尤其在 Windows 下进程已脱离时）。
// 定期用 tasklist 查 PID 是否还活着，不活就把状态转成 dead，让列表自愈。
function isPidAlive(pid, callback) {
  if (!pid) {
    callback(false);
    return;
  }
  execFile("tasklist", ["/FI", "PID eq " + pid, "/NH", "/FO", "CSV"], function (err, stdout) {
    if (err) {
      // tasklist 不可用时，宁可误判为存活，避免误关实例
      callback(true);
      return;
    }
    // 输出含 PID 行才算活着；"信息: 没有运行的任务..." 视为已死
    var text = stdout.toString("utf8");
    callback(text.indexOf(String(pid)) !== -1);
  });
}

function markDead(item, reason) {
  if (item.status === "running") {
    item.status = "dead";
    item.endedAt = item.endedAt || Date.now();
    item.exitCode = null;
    item.deathReason = reason || "进程已退出（健康检查探测不到）";
    stopTail(item);
    pushEvent({ type: "instance", instance: instanceSnapshot(item) });
  }
}

function startHealthCheck() {
  return setInterval(function () {
    instances.forEach(function (item) {
      if (item.status !== "running") return;
      isPidAlive(item.pid, function (alive) {
        if (!alive) {
          markDead(item, "进程已退出（健康检查探测不到）");
        }
      });
    });
  }, HEALTH_CHECK_MS);
}

/* ---------------- 启动 ---------------- */

function timeStamp() {
  var d = new Date();
  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function doLaunch(task, callback) {
  var clientRoot = task.clientRoot;
  var jtoolDir = path.join(clientRoot, "jtool");
  var projectDir = path.join(clientRoot, task.project);

  if (!statDir(projectDir)) {
    callback(new Error("工程目录不存在：" + projectDir));
    return;
  }
  var jtExe = path.join(jtoolDir, "jt.exe");
  if (!fileExists(jtExe)) {
    callback(new Error("找不到 jt.exe：" + jtExe));
    return;
  }

  var logsDir = path.join(jtoolDir, "logs");
  try {
    if (!statDir(logsDir)) fs.mkdirSync(logsDir);
  } catch (err) {
    // 目录已存在即可
  }

  // 每实例独立日志，这是整个工具的关键：工程 + uid + 时间戳
  var logName = "logs/run_" + task.project + "_" + task.uid + "_" + timeStamp();
  var logPath = path.join(jtoolDir, logName.replace(/\//g, path.sep));
  var packageName = task.packageName || "com." + task.project + ".yq";
  var pos = computeWindowPos(task.width, task.height);

  try {
    writeTestConfig(jtoolDir, task.uid, packageName);
    writeToolJson(jtoolDir, {
      winX: Math.round(pos.winX),
      winY: Math.round(pos.winY),
      height: task.height,
      width: task.width,
      debugPort: "60" + task.uid,
      gamedir: "./,../" + task.project,
      packageName: packageName,
      logName: logName,
      main: "../" + task.project + "/main.js"
    });
  } catch (err) {
    callback(err);
    return;
  }

  // 预创建日志文件，tail 才能立刻开始跟随
  try {
    fs.writeFileSync(logPath, "");
  } catch (err) {
    // jt.exe 自己也会创建，这里失败不阻断
  }

  var child;
  try {
    child = spawn(jtExe, [], {
      cwd: jtoolDir,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
  } catch (err) {
    callback(new Error("启动 jt.exe 失败：" + err.message));
    return;
  }

  instanceSeq += 1;
  var item = {
    instanceId: "inst-" + instanceSeq,
    project: task.project,
    uid: task.uid,
    width: task.width,
    height: task.height,
    pid: child.pid,
    child: child,
    logName: logName,
    logPath: logPath,
    status: "running",
    startedAt: Date.now(),
    endedAt: 0
  };
  instances.push(item);

  child.on("error", function (err) {
    item.status = "error";
    item.errorMessage = err.message;
    item.endedAt = Date.now();
    stopTail(item);
    pushEvent({ type: "instance", instance: instanceSnapshot(item), message: err.message });
  });

  child.on("exit", function (code) {
    item.status = "exited";
    item.exitCode = typeof code === "number" ? code : null;
    item.endedAt = Date.now();
    // 退出后再收尾一次，把最后几行日志读完
    setTimeout(function () {
      stopTail(item);
      pushEvent({ type: "instance", instance: instanceSnapshot(item) });
    }, 1200);
    pushEvent({ type: "instance", instance: instanceSnapshot(item) });
  });

  child.unref();

  startTail(item);
  stateStore.recordLaunch({
    project: task.project,
    uid: task.uid,
    width: task.width,
    height: task.height
  });
  pushEvent({ type: "instance", instance: instanceSnapshot(item) });
  callback(null, item);
}

function pumpQueue() {
  if (launching) return;
  var task = launchQueue.shift();
  if (!task) return;
  launching = true;
  doLaunch(task, function (err, item) {
    if (err) {
      pushEvent({ type: "error", message: err.message, project: task.project, uid: task.uid });
      if (task.callback) task.callback(err);
    } else if (task.callback) {
      task.callback(null, item);
    }
    // 间隔后再处理下一个，避免并发覆盖 tool.json
    setTimeout(function () {
      launching = false;
      pumpQueue();
    }, LAUNCH_GAP_MS);
  });
}

function enqueueLaunch(task) {
  launchQueue.push(task);
  pumpQueue();
}

// 模块加载即启动健康检查轮询
startHealthCheck();

/* ---------------- 关闭 ---------------- */

function stopInstance(instanceId, callback) {
  var item = null;
  for (var i = 0; i < instances.length; i++) {
    if (instances[i].instanceId === instanceId) {
      item = instances[i];
      break;
    }
  }
  if (!item) {
    callback(new Error("找不到实例：" + instanceId));
    return;
  }
  if (item.status !== "running") {
    callback(null, instanceSnapshot(item));
    return;
  }
  // 直接 spawn 拿到的就是 jt.exe 本身的 PID，/T 一并带走子进程
  execFile("taskkill", ["/PID", String(item.pid), "/T", "/F"], function (err) {
    if (err && item.status === "running") {
      callback(new Error("关闭失败：" + err.message));
      return;
    }
    callback(null, instanceSnapshot(item));
  });
}

function clearInstance(instanceId) {
  for (var i = 0; i < instances.length; i++) {
    if (instances[i].instanceId === instanceId) {
      if (instances[i].status === "running") return false;
      stopTail(instances[i]);
      instances.splice(i, 1);
      return true;
    }
  }
  return false;
}

function listInstances() {
  return instances.map(instanceSnapshot);
}

module.exports = {
  SIZE_PRESETS: stateStore.SIZE_PRESETS,
  resolveClientRoot: resolveClientRoot,
  detectClientRoot: detectClientRoot,
  isClientRoot: isClientRoot,
  listProjects: listProjects,
  sortProjects: sortProjects,
  enqueueLaunch: enqueueLaunch,
  stopInstance: stopInstance,
  clearInstance: clearInstance,
  listInstances: listInstances,
  addListener: addListener,
  removeListener: removeListener,
  pushEvent: pushEvent
};
