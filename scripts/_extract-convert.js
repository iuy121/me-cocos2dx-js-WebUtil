"use strict";

// 从 public/tools/json-to-csd/index.html 抽取 <script> 里的纯转换函数，
// 组装成一个可在 Node 下调用 convertJsonToCsdXml 的模块，用于离线对比验证。
var fs = require("fs");
var path = require("path");

var HTML = path.join(__dirname, "..", "public", "tools", "json-to-csd", "index.html");

function extractConvertModule() {
  var html = fs.readFileSync(HTML, "utf8");
  var start = html.indexOf("<script>");
  var end = html.lastIndexOf("</script>");
  if (start === -1 || end === -1) {
    throw new Error("未找到 <script> 段");
  }
  var code = html.slice(start + "<script>".length, end);

  // 只保留转换相关的纯函数：从 const XML_INDENT 到 convertJsonToCsdXml 结束。
  var begin = code.indexOf("const XML_INDENT");
  if (begin === -1) throw new Error("未找到 XML_INDENT");
  var tail = code.indexOf("// 检查 File System Access API 支持");
  if (tail === -1) throw new Error("未找到转换段结尾");
  var slice = code.slice(begin, tail);

  // generateUUID 在前面单独定义，补进来
  var uuidStart = code.indexOf("function generateUUID");
  var uuidEnd = code.indexOf("}", code.indexOf("}", uuidStart) + 1) + 1;
  var uuidFn = code.slice(uuidStart, uuidEnd);

  var moduleCode =
    '"use strict";\n' +
    "const COCOS_STUDIO_VERSION = '3.10.0.0';\n" +
    uuidFn + "\n" +
    slice + "\n" +
    "module.exports = { convertJsonToCsdXml: convertJsonToCsdXml };\n";
  return moduleCode;
}

var out = path.join(__dirname, "_convert.generated.js");
fs.writeFileSync(out, extractConvertModule(), "utf8");
console.log("written", out);
