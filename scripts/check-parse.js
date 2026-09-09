"use strict";

var assert = require("assert");
var parse = require("../lib/parse");

var NUL = Buffer.from([0]);

function buf() {
  var parts = [];
  for (var i = 0; i < arguments.length; i += 1) {
    var a = arguments[i];
    parts.push(Buffer.isBuffer(a) ? a : Buffer.from(a, "utf8"));
  }
  return Buffer.concat(parts);
}

function run(name, fn) {
  try {
    fn();
    console.log("  ok  " + name);
  } catch (err) {
    console.error("  FAIL " + name);
    console.error("       " + err.message);
    process.exitCode = 1;
  }
}

console.log("parseGitStatus");

run("case1 plain untracked", function () {
  var out = parse.parseGitStatus(buf("?? ui/cocosstudio/new.png", NUL));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/new.png");
  assert.strictEqual(out[0].gitStatus, "??");
});

run("case2 chinese path no quotes", function () {
  var out = parse.parseGitStatus(buf("?? ui/cocosstudio/亲友圈/new.png", NUL));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/亲友圈/new.png");
});

run("case3 space in path", function () {
  var out = parse.parseGitStatus(buf(" M ui/cocosstudio/my dir/foo bar.png", NUL));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/my dir/foo bar.png");
  assert.strictEqual(out[0].gitStatus, "M");
});

run("case4 rename: take new path (status -z: to first, from second)", function () {
  var out = parse.parseGitStatus(buf(
    "R  ui/cocosstudio/new/dst.png", NUL,
    "ui/cocosstudio/old/src.png", NUL
  ));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/new/dst.png");
});

run("case5 pure delete skipped", function () {
  var out = parse.parseGitStatus(buf("D  ui/cocosstudio/gone.png", NUL));
  assert.strictEqual(out.length, 0);
});

run("case6 mixed batch", function () {
  var out = parse.parseGitStatus(buf(
    "?? ui/cocosstudio/a.png", NUL,
    " M ui/cocosstudio/b.png", NUL,
    "D  ui/cocosstudio/c.png", NUL,
    "R  ui/cocosstudio/new.png", NUL, "ui/cocosstudio/old.png", NUL,
    "?? ui/cocosstudio/中文/d.png", NUL
  ));
  assert.strictEqual(out.length, 4);
  assert.strictEqual(out[0].path, "ui/cocosstudio/a.png");
  assert.strictEqual(out[1].path, "ui/cocosstudio/b.png");
  assert.strictEqual(out[2].path, "ui/cocosstudio/new.png");
  assert.strictEqual(out[3].path, "ui/cocosstudio/中文/d.png");
});

console.log("parseGitNameStatus");

run("case7 plain modify", function () {
  var out = parse.parseGitNameStatus(buf("M", NUL, "ui/cocosstudio/foo.png", NUL));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/foo.png");
});

run("case8 add chinese", function () {
  var out = parse.parseGitNameStatus(buf("A", NUL, "ui/cocosstudio/亲友圈/x.png", NUL));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/亲友圈/x.png");
});

run("case9 rename: take new path (diff -z: from first, to second)", function () {
  var out = parse.parseGitNameStatus(buf(
    "R100", NUL, "ui/cocosstudio/old.png", NUL, "ui/cocosstudio/new.png", NUL
  ));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].path, "ui/cocosstudio/new.png");
});

run("case10 delete skipped", function () {
  var out = parse.parseGitNameStatus(buf("D", NUL, "ui/cocosstudio/gone.png", NUL));
  assert.strictEqual(out.length, 0);
});

run("case11 diff mixed", function () {
  var out = parse.parseGitNameStatus(buf(
    "M", NUL, "ui/cocosstudio/a.png", NUL,
    "D", NUL, "ui/cocosstudio/b.png", NUL,
    "A", NUL, "ui/cocosstudio/中文/c.png", NUL,
    "R90", NUL, "ui/cocosstudio/old.png", NUL, "ui/cocosstudio/new.png", NUL
  ));
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].path, "ui/cocosstudio/a.png");
  assert.strictEqual(out[1].path, "ui/cocosstudio/中文/c.png");
  assert.strictEqual(out[2].path, "ui/cocosstudio/new.png");
});

console.log("parseSvnStatusXml");

run("case12 svn modified/added/unversioned/deleted", function () {
  var xml = ""
    + '<?xml version="1.0" encoding="UTF-8"?>'
    + '<status>'
    + '  <target path=".">'
    + '    <entry path="ui/cocosstudio/mod.png"><wc-status item="modified" props="none" revision="10"/></entry>'
    + '    <entry path="ui/cocosstudio/add.png"><wc-status item="added" props="none"/></entry>'
    + '    <entry path="ui/cocosstudio/new.png"><wc-status item="unversioned" props="none"/></entry>'
    + '    <entry path="ui/cocosstudio/gone.png"><wc-status item="deleted" props="none"/></entry>'
    + '    <entry path="ui/cocosstudio/ignored.png"><wc-status item="ignored" props="none"/></entry>'
    + '  </target>'
    + '</status>';
  var out = parse.parseSvnStatusXml(Buffer.from(xml, "utf8"));
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].path, "ui/cocosstudio/mod.png");
  assert.strictEqual(out[0].gitStatus, "M");
  assert.strictEqual(out[0].svnStatus, "modified");
  assert.strictEqual(out[1].path, "ui/cocosstudio/add.png");
  assert.strictEqual(out[1].gitStatus, "A");
  assert.strictEqual(out[2].path, "ui/cocosstudio/new.png");
  assert.strictEqual(out[2].gitStatus, "??");
});

run("case13 svn xml chinese and entities", function () {
  var xml = ""
    + '<status><target path=".">'
    + '<entry path="ui/cocosstudio/亲友圈/foo.png"><wc-status item="modified"/></entry>'
    + '<entry path="ui/cocosstudio/a &amp; b/x.png"><wc-status item="modified"/></entry>'
    + '</target></status>';
  var out = parse.parseSvnStatusXml(xml);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].path, "ui/cocosstudio/亲友圈/foo.png");
  assert.strictEqual(out[1].path, "ui/cocosstudio/a & b/x.png");
});

console.log("parseSvnDiffXml");

run("case14 svn diff summarize xml", function () {
  var xml = ""
    + '<?xml version="1.0" encoding="UTF-8"?>'
    + '<diff>'
    + '  <paths>'
    + '    <path kind="file" item="modified" props="none">ui/cocosstudio/a.png</path>'
    + '    <path kind="file" item="added" props="none">ui/cocosstudio/b.png</path>'
    + '    <path kind="file" item="deleted" props="none">ui/cocosstudio/gone.png</path>'
    + '    <path kind="dir" item="added" props="none">ui/cocosstudio/newdir</path>'
    + '  </paths>'
    + '</diff>';
  var out = parse.parseSvnDiffXml(Buffer.from(xml, "utf8"));
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].path, "ui/cocosstudio/a.png");
  assert.strictEqual(out[0].gitStatus, "M");
  assert.strictEqual(out[1].path, "ui/cocosstudio/b.png");
  assert.strictEqual(out[1].gitStatus, "A");
});

if (process.exitCode === 1) {
  console.error("\nFAILED");
  process.exit(1);
}
console.log("\nAll parse tests passed");
