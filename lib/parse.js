"use strict";

function trimLeadingSlash(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function splitNullBuffer(buffer) {
  if (!buffer) return [];
  var bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  var tokens = [];
  var start = 0;
  for (var i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) {
      tokens.push(bytes.slice(start, i).toString("utf8"));
      start = i + 1;
    }
  }
  if (start < bytes.length) {
    tokens.push(bytes.slice(start, bytes.length).toString("utf8"));
  }
  return tokens;
}

function isPureDelete(code) {
  return code === "D " || code === " D" || code === "DD";
}

// status -z 条目格式：
//   "XY<space>path"                   （普通条目）
//   "XY<space>new"  + "old"           （重命名/复制：to 在前 token，from 在下一个 token）
function parseGitStatus(buffer) {
  var tokens = splitNullBuffer(buffer);
  var result = [];
  var i = 0;
  while (i < tokens.length) {
    var token = tokens[i];
    if (!token || token.length < 4) { i += 1; continue; }
    var code = token.slice(0, 2);
    var rawPath = token.slice(3);
    var firstChar = code.charAt(0);
    var isRenameOrCopy = firstChar === "R" || firstChar === "C";

    if (isRenameOrCopy) {
      i += 2;
      if (isPureDelete(code)) continue;
      result.push({ gitStatus: code, path: trimLeadingSlash(rawPath) });
    } else {
      i += 1;
      if (isPureDelete(code)) continue;
      var statusText = code.trim() || "M";
      result.push({ gitStatus: statusText, path: trimLeadingSlash(rawPath) });
    }
  }
  return result;
}

// diff --name-status -z 条目格式：
//   <code>\0<path>\0                  （A/M/T/...）
//   R<score>\0<from>\0<to>\0          （R/C：from 在前，to 在后）
function parseGitNameStatus(buffer) {
  var tokens = splitNullBuffer(buffer);
  var result = [];
  var i = 0;
  while (i < tokens.length) {
    var code = tokens[i];
    if (!code) { i += 1; continue; }
    i += 1;
    var first = code.charAt(0);
    var isRenameOrCopy = first === "R" || first === "C";

    if (isRenameOrCopy) {
      var newPath = tokens[i + 1] || "";
      i += 2;
      result.push({ gitStatus: code, path: trimLeadingSlash(newPath) });
    } else {
      var p = tokens[i] || "";
      i += 1;
      if (first === "D") continue;
      result.push({ gitStatus: code, path: trimLeadingSlash(p) });
    }
  }
  return result;
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
      var code = parseInt(hex, 16);
      return isNaN(code) ? "" : String.fromCharCode(code);
    })
    .replace(/&#(\d+);/g, function (_, dec) {
      var code = parseInt(dec, 10);
      return isNaN(code) ? "" : String.fromCharCode(code);
    })
    .replace(/&amp;/g, "&");
}

// SVN item -> 归一状态。null 表示应当忽略（例如已删除、被忽略）
function svnItemToGitStatus(item) {
  switch (item) {
    case "modified": return "M";
    case "added": return "A";
    case "replaced": return "M";
    case "conflicted": return "M";
    case "unversioned": return "??";
    case "deleted": return null;
    case "missing": return null;
    case "external": return null;
    case "ignored": return null;
    case "obstructed": return null;
    case "normal": return null;
    case "none": return null;
    case "incomplete": return null;
    default: return "M";
  }
}

// svn status --xml：
//   <entry path="..."><wc-status item="..." .../></entry>
function parseSvnStatusXml(buffer) {
  var text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  var result = [];
  var entryRe = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/g;
  var m;
  while ((m = entryRe.exec(text)) !== null) {
    var attrs = m[1];
    var body = m[2];
    var pathMatch = /\bpath\s*=\s*"([^"]*)"/.exec(attrs);
    if (!pathMatch) continue;
    var wcMatch = /<wc-status\b([^>]*)/.exec(body);
    if (!wcMatch) continue;
    var itemMatch = /\bitem\s*=\s*"([^"]*)"/.exec(wcMatch[1]);
    if (!itemMatch) continue;
    var item = itemMatch[1];
    var status = svnItemToGitStatus(item);
    if (status === null) continue;
    result.push({
      gitStatus: status,
      svnStatus: item,
      path: trimLeadingSlash(decodeXmlEntities(pathMatch[1]))
    });
  }
  return result;
}

// svn diff --summarize --xml：
//   <path kind="file" item="...">rel/path</path>
function parseSvnDiffXml(buffer) {
  var text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  var result = [];
  var pathRe = /<path\b([^>]*)>([\s\S]*?)<\/path>/g;
  var m;
  while ((m = pathRe.exec(text)) !== null) {
    var attrs = m[1];
    var rawPath = m[2].replace(/^\s+|\s+$/g, "");
    if (!rawPath) continue;
    var kindMatch = /\bkind\s*=\s*"([^"]*)"/.exec(attrs);
    if (kindMatch && kindMatch[1] && kindMatch[1] !== "file") continue;
    var itemMatch = /\bitem\s*=\s*"([^"]*)"/.exec(attrs);
    var item = itemMatch ? itemMatch[1] : "modified";
    var status = svnItemToGitStatus(item);
    if (status === null) continue;
    result.push({
      gitStatus: status,
      svnStatus: item,
      path: trimLeadingSlash(decodeXmlEntities(rawPath))
    });
  }
  return result;
}

module.exports = {
  parseGitStatus: parseGitStatus,
  parseGitNameStatus: parseGitNameStatus,
  parseSvnStatusXml: parseSvnStatusXml,
  parseSvnDiffXml: parseSvnDiffXml,
  splitNullBuffer: splitNullBuffer,
  trimLeadingSlash: trimLeadingSlash,
  svnItemToGitStatus: svnItemToGitStatus
};
