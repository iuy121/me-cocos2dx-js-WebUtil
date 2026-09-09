"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.resolve(__dirname, "..");
var APP_JS = path.join(ROOT, "public", "app.js");

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

ClassList.prototype.contains = function (name) {
  return !!this.names[name];
};

function createStyle() {
  return {
    writeCount: 0,
    values: {},
    setProperty: function (name, value) {
      this.writeCount += 1;
      this.values[name] = String(value);
    }
  };
}

function createElement(tagName, id) {
  var node = {
    id: id || "",
    tagName: String(tagName || "").toUpperCase(),
    children: [],
    parentNode: null,
    className: "",
    hidden: false,
    attributes: {},
    events: {},
    style: createStyle(),
    classList: new ClassList(),
    appendChild: function (child) {
      if (child && child.isFragment) {
        while (child.children.length) {
          this.appendChild(child.children.shift());
        }
        return child;
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild: function (child) {
      var index = this.children.indexOf(child);
      if (index !== -1) {
        this.children.splice(index, 1);
        child.parentNode = null;
      }
      return child;
    },
    contains: function (child) {
      if (child === this) return true;
      for (var i = 0; i < this.children.length; i += 1) {
        if (this.children[i].contains(child)) return true;
      }
      return false;
    },
    addEventListener: function (type, handler) {
      if (!this.events[type]) this.events[type] = [];
      this.events[type].push(handler);
    },
    dispatchEvent: function (event) {
      event.currentTarget = event.currentTarget || this;
      var handlers = this.events[event.type] || [];
      handlers.forEach(function (handler) {
        handler(event);
      });
    },
    getAttribute: function (name) {
      return this.attributes[name] || "";
    },
    setAttribute: function (name, value) {
      this.attributes[name] = String(value);
    },
    closest: function () {
      return null;
    },
    getBoundingClientRect: function () {
      return { left: 0, top: 0, width: 320, height: 480 };
    }
  };

  Object.defineProperty(node, "textContent", {
    get: function () {
      return this._textContent || "";
    },
    set: function (value) {
      this._textContent = String(value || "");
      if (this._textContent === "") {
        this.children.forEach(function (child) {
          child.parentNode = null;
        });
        this.children = [];
      }
    }
  });

  return node;
}

function createHarness() {
  var elements = {};
  var documentEvents = {};
  var windowEvents = {};
  var sidebar = createElement("aside", "sidebar");

  function getElement(id) {
    if (!elements[id]) {
      elements[id] = createElement("div", id);
    }
    return elements[id];
  }

  [
    "mascotStage",
    "mascotRain",
    "mascotBubble",
    "clickEffects",
    "live2dCanvas",
    "mascotFallback",
    "mascotCostumeBtn",
    "mascotCharacterBtn"
  ].forEach(getElement);

  var documentMock = {
    hidden: false,
    head: createElement("head", "head"),
    addEventListener: function (type, handler) {
      if (!documentEvents[type]) documentEvents[type] = [];
      documentEvents[type].push(handler);
    },
    createElement: function (tagName) {
      return createElement(tagName);
    },
    createDocumentFragment: function () {
      var fragment = createElement("#fragment");
      fragment.isFragment = true;
      return fragment;
    },
    getElementById: getElement,
    querySelector: function (selector) {
      return selector === ".sidebar" ? sidebar : null;
    }
  };

  var context = {
    console: console,
    document: documentMock,
    localStorage: {
      getItem: function () { return null; },
      setItem: function () {}
    },
    fetch: function () {
      return new Promise(function () {});
    },
    Promise: Promise,
    Math: Math,
    Date: Date,
    performance: {
      now: function () { return 0; }
    },
    setTimeout: function () { return 1; },
    clearTimeout: function () {},
    requestAnimationFrame: function (handler) {
      handler();
      return 1;
    },
    cancelAnimationFrame: function () {},
    addEventListener: function (type, handler) {
      if (!windowEvents[type]) windowEvents[type] = [];
      windowEvents[type].push(handler);
    },
    matchMedia: function () {
      return { matches: false };
    },
    innerWidth: 1280,
    innerHeight: 720
  };
  context.window = context;

  function fireDocument(type) {
    (documentEvents[type] || []).forEach(function (handler) {
      handler({ type: type });
    });
  }

  return {
    elements: elements,
    document: documentMock,
    fireDocument: fireDocument,
    runMascotModule: function () {
      var appCode = fs.readFileSync(APP_JS, "utf8");
      var marker = "\n\n(function () {\n  var REDUCE_MOTION";
      var start = appCode.indexOf(marker);
      if (start === -1) {
        throw new Error("未找到吉祥物模块边界，无法执行雨点动画检查");
      }
      vm.runInNewContext(appCode.slice(start), context, {
        filename: APP_JS
      });
      fireDocument("DOMContentLoaded");
    }
  };
}

function assertRainCount(rain) {
  assert.strictEqual(rain.children.length, 8, "应保持 8 个下落元素");
}

var harness = createHarness();
harness.runMascotModule();

var rain = harness.elements.mascotRain;
assertRainCount(rain);

var firstItem = rain.children[0];
harness.document.hidden = true;
harness.fireDocument("visibilitychange");
assert(rain.classList.contains("is-paused"), "页面隐藏时应暂停下落动画");

var writeCount = firstItem.style.writeCount;
firstItem.dispatchEvent({
  type: "animationiteration",
  animationName: "mascot-resource-fall"
});
assert.strictEqual(
  firstItem.style.writeCount,
  writeCount,
  "页面隐藏时补发的动画迭代事件不应重置元素"
);

harness.document.hidden = false;
harness.fireDocument("visibilitychange");
assert(!rain.classList.contains("is-paused"), "页面恢复可见时应恢复下落动画");
assertRainCount(rain);
assert.notStrictEqual(
  rain.children[0],
  firstItem,
  "页面恢复可见时应重建下落元素，丢弃后台补帧状态"
);

writeCount = firstItem.style.writeCount;
firstItem.dispatchEvent({
  type: "animationiteration",
  animationName: "mascot-resource-fall"
});
assert.strictEqual(
  firstItem.style.writeCount,
  writeCount,
  "已被移除的旧元素收到补发事件时不应再次重置"
);

console.log("吉祥物下落动画恢复检查通过");
