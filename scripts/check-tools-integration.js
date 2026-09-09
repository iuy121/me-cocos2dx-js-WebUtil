"use strict";

var assert = require("assert");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var PUBLIC_DIR = path.join(ROOT, "public");
var INDEX_HTML = path.join(PUBLIC_DIR, "index.html");
var APP_JS = path.join(PUBLIC_DIR, "app.js");
var SERVER_JS = path.join(ROOT, "server.js");
var GAME_REPORT = path.join(PUBLIC_DIR, "tools", "game-ui-report.html");
var JSON_TO_CSD = path.join(PUBLIC_DIR, "tools", "json-to-csd", "index.html");
var JSON_TO_CSD_README = path.join(PUBLIC_DIR, "tools", "json-to-csd", "README.md");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function mustExist(filePath, label) {
  assert(fs.existsSync(filePath), label + " 应存在: " + filePath);
}

function mustContain(text, expected, label) {
  assert(text.indexOf(expected) !== -1, label + " 应包含: " + expected);
}

function mustNotContain(text, unexpected, label) {
  assert.strictEqual(
    text.indexOf(unexpected),
    -1,
    label + " 不应包含: " + unexpected
  );
}

function countMatches(text, pattern) {
  var matches = text.match(pattern);
  return matches ? matches.length : 0;
}

mustExist(GAME_REPORT, "七星玩法 UI 映射页");
mustExist(JSON_TO_CSD, "JSON 转 CSD 内置页");
mustExist(JSON_TO_CSD_README, "JSON 转 CSD 说明文档");

var gameReportHtml = read(GAME_REPORT);
var jsonToCsdHtml = read(JSON_TO_CSD);
var indexHtml = read(INDEX_HTML);
var appJs = read(APP_JS);
var serverJs = read(SERVER_JS);

mustContain(gameReportHtml, "<title>七星玩法UI映射</title>", "七星玩法 UI 映射页");
mustContain(gameReportHtml, "<th>来源客户端</th>", "七星玩法 UI 映射页");
mustContain(gameReportHtml, "LocalConfig ∩ gameListConfig + QXYYQP", "七星玩法 UI 映射页");
mustContain(gameReportHtml, "sourceByGameId", "七星玩法 UI 映射页");
mustContain(gameReportHtml, "row.insertBefore(createSourceCell(row.dataset.gameId), row.cells[4] || null)", "七星玩法 UI 映射页");
assert.strictEqual(
  countMatches(gameReportHtml, /<th(?:\s|>)/g),
  10,
  "七星玩法 UI 映射页应包含 10 个表头列"
);
assert.strictEqual(
  countMatches(gameReportHtml, /<tr data-game-id="/g),
  60,
  "七星玩法 UI 映射页应覆盖 60 个玩法"
);
[
  "2018108",
  "2019214",
  "2025301",
  "2018080",
  "2019196"
].forEach(function (gameId) {
  mustContain(gameReportHtml, 'data-game-id="' + gameId + '"', "七星玩法 UI 映射页");
});
mustContain(jsonToCsdHtml, "<title>Cocos Studio JSON 转 CSD 工具</title>", "JSON 转 CSD 内置页");

mustContain(indexHtml, 'data-target="game-ui-report"', "侧边栏导航");
mustContain(indexHtml, 'id="gameUiReportFrame"', "七星玩法 UI 映射 iframe");
mustContain(indexHtml, 'data-src="/tools/game-ui-report.html"', "七星玩法 UI 映射 iframe");
mustContain(indexHtml, 'data-src="/tools/json-to-csd/index.html"', "JSON 转 CSD iframe");

mustContain(appJs, "activateToolFrame", "侧边栏脚本");
mustContain(appJs, "gameUiReportFrame", "侧边栏脚本");
mustNotContain(appJs, "renderGameJsonModal", "主业务初始化脚本");

mustNotContain(serverJs, "EXTERNAL_JSON_TO_CSD", "服务端静态资源逻辑");
mustNotContain(serverJs, "serveExternalJsonToCsd", "服务端静态资源逻辑");
mustNotContain(serverJs, "/external/json-to-csd/", "服务端静态资源逻辑");

var logoBuffer = fs.readFileSync(path.join(PUBLIC_DIR, "logo.png"));
var pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
assert(logoBuffer.slice(0, 8).equals(pngSignature), "项目 Logo 应是 PNG 图片");
assert(logoBuffer.readUInt32BE(16) > 0 && logoBuffer.readUInt32BE(20) > 0, "项目 Logo 尺寸应有效");

[
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 }
].forEach(function (asset) {
  var buffer = fs.readFileSync(path.join(PUBLIC_DIR, asset.name));
  assert(buffer.slice(0, 8).equals(pngSignature), asset.name + " 应是 PNG 图片");
  assert.strictEqual(buffer.readUInt32BE(16), asset.size, asset.name + " 宽度应正确");
  assert.strictEqual(buffer.readUInt32BE(20), asset.size, asset.name + " 高度应正确");
  assert.strictEqual(buffer[25], 6, asset.name + " 应保留透明通道");
});

var faviconBuffer = fs.readFileSync(path.join(PUBLIC_DIR, "favicon.ico"));
assert.strictEqual(faviconBuffer.readUInt16LE(0), 0, "ICO 文件头应正确");
assert.strictEqual(faviconBuffer.readUInt16LE(2), 1, "浏览器图标应是 ICO 类型");
var faviconSizes = [];
var faviconCount = faviconBuffer.readUInt16LE(4);
for (var iconIndex = 0; iconIndex < faviconCount; iconIndex += 1) {
  var entryOffset = 6 + iconIndex * 16;
  var iconWidth = faviconBuffer[entryOffset] || 256;
  var iconHeight = faviconBuffer[entryOffset + 1] || 256;
  var iconLength = faviconBuffer.readUInt32LE(entryOffset + 8);
  var iconOffset = faviconBuffer.readUInt32LE(entryOffset + 12);
  assert.strictEqual(iconWidth, iconHeight, "ICO 各尺寸应为正方形");
  assert(iconOffset >= 6 + faviconCount * 16 && iconLength > 0, "ICO 图像数据应有效");
  assert(iconOffset + iconLength <= faviconBuffer.length, "ICO 图像数据应完整");
  faviconSizes.push(iconWidth);
}
assert.deepStrictEqual(faviconSizes, [16, 32, 48, 64, 128, 256], "ICO 应包含六种图标尺寸");

var brandVersion = "?v=" + crypto.createHash("sha256").update(logoBuffer).digest("hex").slice(0, 12);
var iconLinks = [
  '<link rel="icon" type="image/x-icon" href="/favicon.ico' + brandVersion + '">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png' + brandVersion + '">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png' + brandVersion + '">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png' + brandVersion + '">'
];
[
  INDEX_HTML,
  GAME_REPORT,
  JSON_TO_CSD,
  path.join(PUBLIC_DIR, "pelican-bike.html"),
  path.join(PUBLIC_DIR, "test.html")
].forEach(function (pagePath) {
  var pageHtml = read(pagePath);
  iconLinks.forEach(function (iconLink) {
    mustContain(pageHtml, iconLink, path.relative(PUBLIC_DIR, pagePath) + " 项目图标");
  });
});
mustContain(indexHtml, 'src="/logo.png' + brandVersion + '"', "侧边栏项目 Logo");
mustContain(indexHtml, 'alt="资源同步台标志"', "侧边栏 Logo 替代文本");

console.log("工具页内置整合检查通过");
console.log("项目 Logo 与浏览器图标检查通过");
