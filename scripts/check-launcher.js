"use strict";

// 客户端启动台的静态校验：GBK 解码正确性、状态记忆、路由与前端结构完整。
// jt.exe 需要真实 Windows 环境，这里不实拉进程，只做可离线验证的部分。

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var PUBLIC_DIR = path.join(ROOT, "public");
var LIB_DIR = path.join(ROOT, "lib");
var SERVER_JS = path.join(ROOT, "server.js");
var APP_JS = path.join(PUBLIC_DIR, "app.js");
var INDEX_HTML = path.join(PUBLIC_DIR, "index.html");
var STYLES_CSS = path.join(PUBLIC_DIR, "styles.css");

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function mustContain(text, expected, label) {
  assert(text.indexOf(expected) !== -1, label + " 应包含: " + expected);
}

/* --------------- GBK 解码 ---------------- */

var gbk = require(path.join(LIB_DIR, "gbk"));

// 用真实 GBK 字节验证：'元素宽度' 的 cp936 编码
var elementBytes = Buffer.from([0xd4, 0xaa, 0xcb, 0xd8, 0xbf, 0xed, 0xb6, 0xc8]);
assert.strictEqual(gbk.decode(elementBytes), "元素宽度", "GBK 整体解码");

// 跨 chunk 边界：逐字节喂入，结果应与整体一致
var streamOut = "";
var decoder = gbk.createDecoder();
for (var i = 0; i < elementBytes.length; i++) {
  streamOut += decoder.write(elementBytes.slice(i, i + 1));
}
streamOut += decoder.flush();
assert.strictEqual(streamOut, "元素宽度", "GBK 流式逐字节解码应与整体一致");

/* ------------- 状态记忆 ---------------- */

var stateStore = require(path.join(LIB_DIR, "launcher-state"));
assert(typeof stateStore.recordLaunch === "function", "launcher-state 导出 recordLaunch");
assert(Array.isArray(stateStore.SIZE_PRESETS) && stateStore.SIZE_PRESETS.length === 9,
  "应有 9 个尺寸档位");
assert.strictEqual(stateStore.DEFAULT_SIZE_KEY, "1000x526", "默认档位 1000x526");

// 档位高度序列应与客户端 isLongScreen 分档一致
var heights = stateStore.SIZE_PRESETS.map(function (s) { return s.height; });
assert.deepStrictEqual(heights, [800, 714, 645, 588, 526, 488, 465, 440, 417], "档位高度序列");

/* ---------------- 路由注册 ---------------- */

var serverJs = read(SERVER_JS);
[
  "/api/launcher/projects",
  "/api/launcher/instances",
  "/api/launcher/stream",
  "/api/launcher/log",
  "/api/launcher/launch",
  "/api/launcher/stop",
  "/api/launcher/clear",
  "/api/launcher/sort"
].forEach(function (route) {
  mustContain(serverJs, route, "server.js 路由");
});

/* ------------- 前端结构 ---------------- */

var appJs = read(APP_JS);
var indexHtml = read(INDEX_HTML);
var stylesCss = read(STYLES_CSS);

mustContain(indexHtml, 'data-target="launcher"', "侧边栏导航");
mustContain(indexHtml, 'data-view="launcher"', "启动台 view");
mustContain(indexHtml, 'id="launcherProjectGrid"', "工程列表容器");
mustContain(indexHtml, 'id="launcherLogArea"', "日志区容器");
mustContain(appJs, "window.__launcherInit", "启动台初始化入口");
mustContain(appJs, "/api/launcher/stream", "SSE 订阅");

// 样式必须真正落到 styles.css（曾因写错路径导致启动台裸奔）
mustContain(stylesCss, ".launcher-project-grid", "工程卡片网格样式");
mustContain(stylesCss, ".launcher-log-area", "日志区样式");
mustContain(stylesCss, ".launcher-size-chip", "尺寸档位样式");

console.log("客户端启动台检查通过");
