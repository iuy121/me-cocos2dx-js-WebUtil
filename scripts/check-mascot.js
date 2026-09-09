"use strict";

var fs = require("fs");
var path = require("path");

var PUBLIC_DIR = path.resolve(__dirname, "..", "public");
var VENDOR_DIR = path.join(PUBLIC_DIR, "vendor");
var RUNTIME_DIR = path.join(VENDOR_DIR, "live2d-runtime");
var PIO_DIR = path.join(VENDOR_DIR, "mascot", "pio");
var APP_JS = path.join(PUBLIC_DIR, "app.js");

var failed = false;

function check(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    console.error("  FAIL " + name);
    console.error("       " + err.message);
    failed = true;
  }
}

function mustExist(p, kind) {
  if (!fs.existsSync(p)) {
    throw new Error("缺失 " + kind + ": " + p);
  }
}

function mustHaveSize(p, minBytes) {
  var size = fs.statSync(p).size;
  if (size < minBytes) {
    throw new Error("文件偏小（疑似 LFS 指针或下载未完成）: " + p + " 仅 " + size + " 字节");
  }
}

console.log("vendor/live2d-runtime");

check("pixi.min.js 存在", function () {
  var p = path.join(RUNTIME_DIR, "pixi.min.js");
  mustExist(p, "文件");
  mustHaveSize(p, 100 * 1024);
});

check("live2d.min.js 存在", function () {
  var p = path.join(RUNTIME_DIR, "live2d.min.js");
  mustExist(p, "文件");
  mustHaveSize(p, 50 * 1024);
});

check("pixi-live2d-display.min.js 存在", function () {
  var p = path.join(RUNTIME_DIR, "pixi-live2d-display.min.js");
  mustExist(p, "文件");
  mustHaveSize(p, 50 * 1024);
});

console.log("vendor/mascot/pio");

var indexJson = null;

check("index.json 存在且可解析", function () {
  var p = path.join(PIO_DIR, "index.json");
  mustExist(p, "文件");
  indexJson = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!indexJson || typeof indexJson !== "object") {
    throw new Error("index.json 顶层不是对象");
  }
  if (!Array.isArray(indexJson.costumes)) {
    throw new Error("index.json 缺 costumes 数组");
  }
  if (indexJson.costumes.length < 1) {
    throw new Error("index.json 至少需要 1 套服装");
  }
});

check("preview.png 存在", function () {
  var p = path.join(PIO_DIR, "preview.png");
  mustExist(p, "兜底图");
});

if (indexJson) {
  var seenKeys = {};
  indexJson.costumes.forEach(function (costume, i) {
    check("costume[" + i + "] 字段齐全", function () {
      if (!costume || typeof costume !== "object") throw new Error("不是对象");
      ["key", "label", "path"].forEach(function (k) {
        if (typeof costume[k] !== "string" || !costume[k]) {
          throw new Error("缺字段或不是字符串: " + k);
        }
      });
      if (seenKeys[costume.key]) {
        throw new Error("重复 key: " + costume.key);
      }
      seenKeys[costume.key] = true;
    });

    check("costume[" + i + "] model.json 存在 (" + costume.key + ")", function () {
      var p = path.join(PIO_DIR, costume.path);
      mustExist(p, "model.json");
    });
  });

  if (indexJson.default) {
    check("default 指向已存在的 key", function () {
      if (!seenKeys[indexJson.default]) {
        throw new Error("default 引用了不存在的 key: " + indexJson.default);
      }
    });
  }
}

console.log("public/app.js mascot position");

check("Haru 使用角色专属下移偏移", function () {
  var appCode = fs.readFileSync(APP_JS, "utf8");
  if (appCode.indexOf("MASCOT_CHARACTER_Y_OFFSETS") === -1) {
    throw new Error("缺少角色专属 Y 轴偏移配置");
  }
  if (!/haru:\s*28/.test(appCode)) {
    throw new Error("Haru 应配置为向下偏移 28px");
  }
  if (appCode.indexOf("getMascotYOffset") === -1) {
    throw new Error("缺少读取角色 Y 轴偏移的方法");
  }
  if (!/displayH\s*\*\s*0\.5\s*\+\s*getMascotYOffset\(\)/.test(appCode)) {
    throw new Error("Live2D 垂直定位应叠加角色专属偏移");
  }
});

if (failed) {
  process.exitCode = 1;
}
