"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.resolve(__dirname, "..");
var INDEX_HTML = path.join(ROOT, "public", "index.html");
var APP_JS = path.join(ROOT, "public", "app.js");
var STORAGE_KEY = "ui-image-res-sync.recentProjectRoots";

function ClassList() {
  this.names = {};
}

ClassList.prototype.add = function () {
  for (var i = 0; i < arguments.length; i += 1) {
    this.names[arguments[i]] = true;
  }
};

ClassList.prototype.remove = function () {
  for (var i = 0; i < arguments.length; i += 1) {
    delete this.names[arguments[i]];
  }
};

ClassList.prototype.toggle = function (name, force) {
  if (force === false) {
    delete this.names[name];
    return false;
  }
  this.names[name] = true;
  return true;
};

function createElement(id) {
  return {
    id: id,
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    hidden: false,
    style: {},
    attributes: {},
    events: {},
    classList: new ClassList(),
    addEventListener: function (type, handler) {
      if (!this.events[type]) this.events[type] = [];
      this.events[type].push(handler);
    },
    getAttribute: function (name) {
      return this.attributes[name] || "";
    },
    setAttribute: function (name, value) {
      this.attributes[name] = String(value);
    },
    focus: function () {}
  };
}

function createHarness(recentRoots) {
  var elements = {};
  var domReadyHandlers = [];
  var storage = {};
  storage[STORAGE_KEY] = JSON.stringify(recentRoots);

  function getElement(id) {
    if (!elements[id]) {
      elements[id] = createElement(id);
    }
    return elements[id];
  }

  var documentMock = {
    addEventListener: function (type, handler) {
      if (type === "DOMContentLoaded") {
        domReadyHandlers.push(handler);
      }
    },
    getElementById: getElement,
    querySelectorAll: function () {
      return [];
    }
  };

  var context = {
    console: console,
    document: documentMock,
    localStorage: {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
      },
      setItem: function (key, value) {
        storage[key] = String(value);
      }
    },
    fetch: function () {
      return Promise.resolve({
        ok: true,
        json: function () {
          return Promise.resolve({
            ok: true,
            defaultProjectRoot: "D:/default"
          });
        }
      });
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise
  };
  context.window = context;

  return {
    elements: elements,
    runApp: function () {
      var appCode = fs.readFileSync(APP_JS, "utf8");
      var sidebarIndex = appCode.indexOf("function initSidebar");
      var firstModuleEnd = sidebarIndex === -1 ? -1 : appCode.lastIndexOf("\n\n(function () {", sidebarIndex);
      if (firstModuleEnd === -1) {
        throw new Error("未找到主业务模块边界，无法执行最近工程检查");
      }
      vm.runInNewContext(appCode.slice(0, firstModuleEnd), context, {
        filename: APP_JS
      });
      domReadyHandlers.forEach(function (handler) {
        handler();
      });
    }
  };
}

function countRecentButtons(html) {
  var matches = html.match(/data-action="recent-project-root"/g);
  return matches ? matches.length : 0;
}

async function main() {
  var indexHtml = fs.readFileSync(INDEX_HTML, "utf8");
  assert(
    indexHtml.indexOf('id="recentProjectRootButtons"') !== -1,
    "页面需要提供可见的最近工程列表容器"
  );

  var recentRoots = [
    "D:/Client5",
    "D:/Client4",
    "D:/Client3",
    "D:/Client2",
    "D:/Client1",
    "D:/Client0"
  ];
  var harness = createHarness(recentRoots);
  harness.runApp();

  await Promise.resolve();
  await Promise.resolve();

  var buttons = harness.elements.recentProjectRootButtons;
  assert(buttons, "最近工程列表容器应被初始化");
  assert.strictEqual(
    countRecentButtons(buttons.innerHTML),
    5,
    "刷新后应展示最近五个工程按钮"
  );
  assert(buttons.innerHTML.indexOf("D:/Client5") !== -1, "应展示最新工程");
  assert(buttons.innerHTML.indexOf("D:/Client1") !== -1, "应展示第五个工程");
  assert.strictEqual(
    buttons.innerHTML.indexOf("D:/Client0"),
    -1,
    "超过五个的旧工程不应展示"
  );

  var clickHandlers = buttons.events.click || [];
  assert(clickHandlers.length > 0, "最近工程按钮应支持点击回填工程路径");
  var clickedButton = {
    getAttribute: function (name) {
      if (name === "data-action") return "recent-project-root";
      if (name === "data-root") return "D:/Client3";
      return "";
    },
    closest: function () {
      return clickedButton;
    }
  };
  clickHandlers[0]({ target: clickedButton });
  assert.strictEqual(
    harness.elements.projectRoot.value,
    "D:/Client3",
    "点击历史工程后应回填到工程根目录输入框"
  );

  console.log("最近工程历史检查通过");
}

main().catch(function (err) {
  console.error("最近工程历史检查失败");
  console.error(err.message);
  process.exit(1);
});
