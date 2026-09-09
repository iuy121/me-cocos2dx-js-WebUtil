"use strict";

// GBK(cp936) 解码，零依赖。Node 10 没有 TextDecoder('gbk')，
// 码表由 scripts/_gen-gbk-table.ps1 离线生成到 lib/gbk-table.txt。
// jt.exe 写出的 logs/* 全是 GBK，直接按 utf8 读会整片乱码。

var fs = require("fs");
var path = require("path");

var TABLE_PATH = path.join(__dirname, "gbk-table.txt");
var LEAD_MIN = 0x81;
var LEAD_MAX = 0xfe;
var TRAIL_MIN = 0x40;
var TRAIL_MAX = 0xfe;
var REPLACEMENT = "�";

var table = null;

function loadTable() {
  if (table) return table;
  var raw = fs.readFileSync(TABLE_PATH, "utf8");
  var lines = raw.split("\n");
  var rows = new Array(LEAD_MAX - LEAD_MIN + 1);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    var tabAt = line.indexOf("\t");
    if (tabAt === -1) continue;
    var lead = parseInt(line.slice(0, tabAt), 16);
    if (isNaN(lead) || lead < LEAD_MIN || lead > LEAD_MAX) continue;
    rows[lead - LEAD_MIN] = line.slice(tabAt + 1);
  }
  table = rows;
  return table;
}

// 返回 { text, rest }：rest 是结尾那半个字符（只有 lead 字节先到时才非空），
// 调用方需要把它拼到下一段前面，否则每次读取边界都会吐一个乱码字符。
function decodeChunk(buffer) {
  var rows = loadTable();
  var out = [];
  var i = 0;
  var len = buffer.length;

  while (i < len) {
    var b = buffer[i];

    if (b < 0x80) {
      out.push(String.fromCharCode(b));
      i += 1;
      continue;
    }

    if (b === 0x80) {
      out.push("€");
      i += 1;
      continue;
    }

    if (b < LEAD_MIN || b > LEAD_MAX) {
      out.push(REPLACEMENT);
      i += 1;
      continue;
    }

    if (i + 1 >= len) {
      // lead 字节落在本段末尾，留给下一段
      return { text: out.join(""), rest: buffer.slice(i) };
    }

    var trail = buffer[i + 1];
    if (trail < TRAIL_MIN || trail > TRAIL_MAX) {
      // 非法尾字节：lead 记为乱码，尾字节退回重新按单字节解析
      out.push(REPLACEMENT);
      i += 1;
      continue;
    }

    var row = rows[b - LEAD_MIN];
    out.push(row ? row.charAt(trail - TRAIL_MIN) : REPLACEMENT);
    i += 2;
  }

  return { text: out.join(""), rest: null };
}

function decode(buffer) {
  return decodeChunk(buffer).text;
}

// 流式解码器，配合日志增量读取使用
function createDecoder() {
  var pending = null;

  return {
    write: function (buffer) {
      if (!buffer || !buffer.length) return "";
      var input = buffer;
      if (pending && pending.length) {
        input = Buffer.concat([pending, buffer]);
        pending = null;
      }
      var result = decodeChunk(input);
      pending = result.rest;
      return result.text;
    },
    flush: function () {
      if (!pending || !pending.length) return "";
      var leftover = pending;
      pending = null;
      var text = "";
      for (var i = 0; i < leftover.length; i++) text += REPLACEMENT;
      return text;
    }
  };
}

module.exports = {
  decode: decode,
  decodeChunk: decodeChunk,
  createDecoder: createDecoder
};
