(function () {
  var state = {
    defaultProjectRoot: "",
    projectRoot: "",
    recentProjectRoots: [],
    vcs: "git",
    items: [],
    csdItems: [],
    restorePreview: null,
    isBusy: false
  };

  var RECENT_PROJECT_ROOTS_KEY = "ui-image-res-sync.recentProjectRoots";
  var VCS_KEY = "ui-image-res-sync.vcs";
  var MAX_RECENT_PROJECT_ROOTS = 5;

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function initEls() {
    [
      "serverStatus",
      "projectRoot",
      "recentProjectRoots",
      "recentProjectRootButtons",
      "vcs",
      "mode",
      "baseRef",
      "headRef",
      "baseRefLabel",
      "headRefLabel",
      "topbarSubtitle",
      "useDefault",
      "scanBtn",
      "scanCsdBtn",
      "previewBtn",
      "applyBtn",
      "applyCsdBtn",
      "restoreCsdJsonBtn",
      "applyFromModalBtn",
      "clearPreviewSelectionBtn",
      "clearCsdSelectionBtn",
      "closePreview",
      "closeRestoreModal",
      "cancelRestoreBtn",
      "confirmRestoreBtn",
      "previewModal",
      "restoreModal",
      "previewGrid",
      "previewSubtitle",
      "resultList",
      "csdResultList",
      "restoreList",
      "restoreSubtitle",
      "restoreMetrics",
      "scanNote",
      "csdScanNote",
      "mTotal",
      "mReady",
      "mConflict",
      "mMissing",
      "selectReadyBtn",
      "selectReadyCsdBtn",
      "toast"
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  function api(path, options) {
    return fetch(path, options || {}).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.ok) {
          throw new Error(data.message || "请求失败");
        }
        return data;
      });
    });
  }

  function post(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      els.toast.classList.add("hidden");
    }, 3600);
  }

  function normalizeProjectRoot(value) {
    return String(value || "").trim();
  }

  function readRecentProjectRoots() {
    try {
      var raw = localStorage.getItem(RECENT_PROJECT_ROOTS_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.map(normalizeProjectRoot).filter(Boolean).slice(0, MAX_RECENT_PROJECT_ROOTS);
    } catch (err) {
      return [];
    }
  }

  function writeRecentProjectRoots(list) {
    try {
      localStorage.setItem(RECENT_PROJECT_ROOTS_KEY, JSON.stringify(list));
    } catch (err) {
      showToast("最近工程目录保存失败：" + err.message);
    }
  }

  function renderRecentProjectRoots() {
    if (!els.recentProjectRoots) return;
    els.recentProjectRoots.innerHTML = state.recentProjectRoots.map(function (root) {
      return '<option value="' + escapeHtml(root) + '"></option>';
    }).join("");

    if (!els.recentProjectRootButtons) return;
    if (!state.recentProjectRoots.length) {
      els.recentProjectRootButtons.innerHTML = "";
      return;
    }
    els.recentProjectRootButtons.innerHTML = state.recentProjectRoots.map(function (root) {
      return '<button class="recent-project-root" type="button" data-action="recent-project-root" data-root="' +
        escapeHtml(root) + '" title="' + escapeHtml(root) + '">' + escapeHtml(root) + '</button>';
    }).join("");
  }

  function rememberProjectRoot(projectRoot) {
    var root = normalizeProjectRoot(projectRoot);
    if (!root) return;

    var seen = {};
    var next = [root].concat(state.recentProjectRoots).filter(function (item) {
      var key = item.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, MAX_RECENT_PROJECT_ROOTS);

    state.recentProjectRoots = next;
    writeRecentProjectRoots(next);
    renderRecentProjectRoots();
  }

  function setStatus(text, kind) {
    els.serverStatus.textContent = text;
    els.serverStatus.classList.remove("connected", "busy", "error");
    if (kind) els.serverStatus.classList.add(kind);
  }

  function setBusy(isBusy, text) {
    state.isBusy = !!isBusy;
    els.scanBtn.disabled = state.isBusy;
    els.scanCsdBtn.disabled = state.isBusy;
    els.applyBtn.disabled = state.isBusy || getSelectedItems().length === 0;
    els.applyCsdBtn.disabled = state.isBusy || getSelectedCsdItems().length === 0;
    els.restoreCsdJsonBtn.disabled = state.isBusy;
    els.applyFromModalBtn.disabled = state.isBusy || getSelectedItems().length === 0;
    els.selectReadyBtn.disabled = state.isBusy || state.items.length === 0;
    els.selectReadyCsdBtn.disabled = state.isBusy || state.csdItems.length === 0;
    els.clearPreviewSelectionBtn.disabled = state.isBusy || state.items.length === 0;
    els.clearCsdSelectionBtn.disabled = state.isBusy || state.csdItems.length === 0;
    els.confirmRestoreBtn.disabled = state.isBusy;
    els.cancelRestoreBtn.disabled = state.isBusy;
    if (text) setStatus(text, isBusy ? "busy" : "connected");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function imageUrl(item) {
    return "/api/image?projectRoot=" + encodeURIComponent(state.projectRoot) +
      "&path=" + encodeURIComponent(item.previewPath);
  }

  function stateText(item) {
    if (item.state === "ready") return "可替换";
    if (item.state === "conflict") return "需选择";
    return "未命中";
  }

  function targetText(item) {
    if (!item.targets || item.targets.length === 0) return "未找到对应 res 目录";
    if (item.selectedTargetDir) {
      for (var i = 0; i < item.targets.length; i += 1) {
        if (item.targets[i].dir === item.selectedTargetDir) {
          return item.targets[i].relativePath;
        }
      }
    }
    return item.targets.map(function (target) {
      return target.relativePath;
    }).join(" / ");
  }

  function updateMetrics(summary) {
    els.mTotal.textContent = summary ? summary.total : 0;
    els.mReady.textContent = summary ? summary.ready : 0;
    els.mConflict.textContent = summary ? summary.conflict : 0;
    els.mMissing.textContent = summary ? summary.missing : 0;
  }

  function getSelectedItems() {
    return state.items.filter(function (item) {
      return item.selected && item.selectedTargetDir;
    });
  }

  function refreshButtons() {
    var hasItems = state.items.length > 0;
    var selectedCount = getSelectedItems().length;
    var csdSelectedCount = getSelectedCsdItems().length;
    els.previewBtn.disabled = state.isBusy || !hasItems;
    els.applyBtn.disabled = state.isBusy || selectedCount === 0;
    els.applyFromModalBtn.disabled = state.isBusy || selectedCount === 0;
    els.applyCsdBtn.disabled = state.isBusy || csdSelectedCount === 0;
    els.restoreCsdJsonBtn.disabled = state.isBusy;
    els.selectReadyBtn.disabled = state.isBusy || !hasItems;
    els.selectReadyCsdBtn.disabled = state.isBusy || state.csdItems.length === 0;
    els.clearPreviewSelectionBtn.disabled = state.isBusy || !hasItems;
    els.clearCsdSelectionBtn.disabled = state.isBusy || state.csdItems.length === 0;
    if (state.restorePreview) {
      els.confirmRestoreBtn.disabled = state.isBusy || state.restorePreview.summary.restorable === 0;
      els.cancelRestoreBtn.disabled = state.isBusy;
    }
    if (els.previewSubtitle) {
      if (hasItems) {
        els.previewSubtitle.textContent = "已选 " + selectedCount + " / 共 " + state.items.length + " · 只会处理已勾选且有目标目录的图片";
      } else {
        els.previewSubtitle.textContent = "只会处理已勾选且有目标目录的图片。";
      }
    }
  }

  function renderResultList() {
    if (!state.items.length) {
      els.resultList.innerHTML = '<div class="empty-state">' +
        '<div class="empty-title">暂无图片变更</div>' +
        '<div class="empty-hint">请填写工程目录后点上方"识别图片变更"。</div>' +
      '</div>';
      refreshButtons();
      return;
    }

    els.resultList.innerHTML = state.items.map(function (item, index) {
      var disabled = item.targets.length === 0 ? " disabled" : "";
      var checked = item.selected ? " checked" : "";
      var selectHtml = "";
      if (item.targets.length > 1) {
        selectHtml = '<select data-action="target" data-index="' + index + '">' +
          '<option value="">选择目标目录</option>' +
          item.targets.map(function (target) {
            var selected = target.dir === item.selectedTargetDir ? " selected" : "";
            return '<option value="' + escapeHtml(target.dir) + '"' + selected + '>' + escapeHtml(target.relativePath) + '</option>';
          }).join("") +
          '</select>';
      } else if (item.targets.length === 1) {
        selectHtml = '<div class="target-path">' + escapeHtml(item.targets[0].relativePath) + '</div>';
      } else {
        selectHtml = '<div class="target-path">请先确认目标目录是否存在</div>';
      }

      return '<div class="row">' +
        '<input type="checkbox" data-action="check" data-index="' + index + '"' + checked + disabled + '>' +
        '<div class="file-main">' +
          '<div class="file-path">' + escapeHtml(item.sourceRel) + '</div>' +
          '<div class="target-path">' + escapeHtml(targetText(item)) + '</div>' +
        '</div>' +
        '<div class="tag ' + item.state + '">' + stateText(item) + '</div>' +
        '<div>' + selectHtml + '</div>' +
      '</div>';
    }).join("");

    refreshButtons();
  }

  function renderPreview() {
    if (!state.items.length) {
      els.previewGrid.innerHTML = "";
      return;
    }

    els.previewGrid.innerHTML = state.items.map(function (item, index) {
      var checked = item.selected ? " checked" : "";
      var disabled = item.targets.length === 0 ? " disabled" : "";
      var selectHtml = "";
      if (item.targets.length > 1) {
        selectHtml = '<select data-action="target" data-index="' + index + '">' +
          '<option value="">选择目标目录</option>' +
          item.targets.map(function (target) {
            var selected = target.dir === item.selectedTargetDir ? " selected" : "";
            return '<option value="' + escapeHtml(target.dir) + '"' + selected + '>' + escapeHtml(target.relativePath) + '</option>';
          }).join("") +
          '</select>';
      } else if (item.targets.length === 1) {
        selectHtml = '<div class="target-path">' + escapeHtml(item.targets[0].relativePath) + '</div>';
      } else {
        selectHtml = '<div class="target-path">未命中目标目录</div>';
      }

      var cardClass = "card" + (item.selected ? " is-selected" : "");
      return '<article class="' + cardClass + '">' +
        '<div class="thumb"><img src="' + imageUrl(item) + '" alt="' + escapeHtml(item.sourceRel) + '"></div>' +
        '<div class="card-body">' +
          '<label><input type="checkbox" data-action="check" data-index="' + index + '"' + checked + disabled + '> 参与替换</label>' +
          '<div class="card-name">' + escapeHtml(item.sourceRel) + '</div>' +
          '<div class="tag ' + item.state + '">' + stateText(item) + '</div>' +
          selectHtml +
        '</div>' +
      '</article>';
    }).join("");
  }

  function getSelectedCsdItems() {
    return state.csdItems.filter(function (item) {
      return item.selected && item.state === "ready";
    });
  }

  function csdStateText(item) {
    return item.state === "ready" ? "可替换" : "未命中";
  }

  function csdTargetText(item) {
    if (item.targetPath) return item.targetPath;
    return item.message || "未找到目标";
  }

  function renderCsdResultList() {
    if (!state.csdItems.length) {
      els.csdResultList.innerHTML = '<div class="empty-state">' +
        '<div class="empty-title">暂无 CSD 本地变更</div>' +
        '<div class="empty-hint">点击上方"识别 CSD 本地变更"，会根据本地变更的 .csd 去查找 ui 下同名 .json。</div>' +
      '</div>';
      refreshButtons();
      return;
    }

    els.csdResultList.innerHTML = state.csdItems.map(function (item, index) {
      var disabled = item.state !== "ready" ? " disabled" : "";
      var checked = item.selected ? " checked" : "";
      return '<div class="row row-csd">' +
        '<input type="checkbox" data-action="check-csd" data-index="' + index + '"' + checked + disabled + '>' +
        '<div class="file-main">' +
          '<div class="file-path">' + escapeHtml(item.csdPath) + '</div>' +
          '<div class="target-path">' + escapeHtml(item.sourcePath + " -> " + csdTargetText(item)) + '</div>' +
        '</div>' +
        '<div class="tag ' + item.state + '">' + csdStateText(item) + '</div>' +
        '<div class="target-path">' + escapeHtml(item.message || "可一键替换到 res 根目录") + '</div>' +
      '</div>';
    }).join("");

    refreshButtons();
  }

  function renderRestoreModal() {
    var data = state.restorePreview;
    if (!data) {
      els.restoreMetrics.innerHTML = "";
      els.restoreList.innerHTML = "";
      refreshButtons();
      return;
    }

    els.restoreSubtitle.textContent = "会保留 " + data.whitelistCount + " 个由本地变更 CSD 映射出的白名单 JSON，仅还原其余本地改动项。";
    els.restoreMetrics.innerHTML =
      '<div class="metric-inline"><span>候选总数</span><strong>' + data.summary.total + '</strong></div>' +
      '<div class="metric-inline ready"><span>可还原</span><strong>' + data.summary.restorable + '</strong></div>' +
      '<div class="metric-inline missing"><span>未跟踪</span><strong>' + data.summary.untracked + '</strong></div>';

    if (!data.items.length) {
      els.restoreList.innerHTML = '<div class="empty-state">' +
        '<div class="empty-title">没有可处理的非白名单 JSON</div>' +
        '<div class="empty-hint">当前 `ui/res` 和 `res` 下的本地 JSON 改动都在本地变更 CSD 白名单内。</div>' +
      '</div>';
      refreshButtons();
      return;
    }

    els.restoreList.innerHTML = data.items.map(function (item) {
      return '<div class="row row-restore">' +
        '<div class="file-main">' +
          '<div class="file-path">' + escapeHtml(item.path) + '</div>' +
          '<div class="target-path">' + escapeHtml(item.reason) + '</div>' +
        '</div>' +
        '<div class="tag ' + (item.restorable ? "conflict" : "missing") + '">' + (item.restorable ? "可还原" : "未跟踪") + '</div>' +
      '</div>';
    }).join("");

    refreshButtons();
  }

  function syncItemFromControl(target) {
    if (!target || !target.getAttribute("data-action")) return;
    var index = Number(target.getAttribute("data-index"));
    var action = target.getAttribute("data-action");
    var item = state.items[index];
    if (!item) return;

    if (action === "check") {
      item.selected = target.checked;
    }
    if (action === "target") {
      item.selectedTargetDir = target.value;
      item.selected = !!target.value;
    }
    renderResultList();
    renderPreview();
    refreshButtons();
  }

  function syncCsdItemFromControl(target) {
    if (!target || !target.getAttribute("data-action")) return;
    var index = Number(target.getAttribute("data-index"));
    var action = target.getAttribute("data-action");
    var item = state.csdItems[index];
    if (!item) return;

    if (action === "check-csd") {
      item.selected = target.checked;
    }
    renderCsdResultList();
    refreshButtons();
  }

  function currentVcs() {
    var value = els.vcs ? els.vcs.value : state.vcs;
    return value === "svn" ? "svn" : "git";
  }

  function readStoredVcs() {
    try {
      var raw = localStorage.getItem(VCS_KEY);
      return raw === "svn" ? "svn" : "git";
    } catch (err) {
      return "git";
    }
  }

  function writeStoredVcs(vcs) {
    try {
      localStorage.setItem(VCS_KEY, vcs === "svn" ? "svn" : "git");
    } catch (err) {}
  }

  function vcsLabel() {
    return currentVcs() === "svn" ? "SVN" : "Git";
  }

  function updateVcsHints() {
    var vcs = currentVcs();
    state.vcs = vcs;
    if (els.topbarSubtitle) {
      els.topbarSubtitle.textContent = vcs === "svn" ?
        "从 svn 识别 `ui/cocosstudio` 图片变更，预览后覆盖到对应 `res*` 目录。" :
        "从 git 识别 `ui/cocosstudio` 图片变更，预览后覆盖到对应 `res*` 目录。";
    }
    if (els.baseRefLabel) {
      els.baseRefLabel.textContent = vcs === "svn" ? "起始版本" : "Base";
    }
    if (els.headRefLabel) {
      els.headRefLabel.textContent = vcs === "svn" ? "结束版本" : "Head";
    }
    if (els.baseRef) {
      els.baseRef.placeholder = vcs === "svn" ? "例如 1000" : "origin/master";
    }
    if (els.headRef && !els.headRef.value) {
      els.headRef.value = vcs === "svn" ? "HEAD" : "HEAD";
    }
  }

  function scan() {
    var projectRoot = els.projectRoot.value.trim();
    var mode = els.mode.value;
    var vcs = currentVcs();
    var body = { projectRoot: projectRoot, mode: mode, vcs: vcs };
    if (mode === "diff") {
      body.base = els.baseRef.value.trim();
      body.head = els.headRef.value.trim();
    }

    setBusy(true, "正在识别（" + vcsLabel() + "）");
    post("/api/scan", body).then(function (data) {
      state.projectRoot = data.projectRoot;
      state.vcs = data.vcs || vcs;
      if (els.vcs && data.vcs) {
        els.vcs.value = data.vcs;
        writeStoredVcs(data.vcs);
        updateVcsHints();
      }
      rememberProjectRoot(data.projectRoot);
      state.items = data.items || [];
      updateMetrics(data.summary);
      els.scanNote.textContent = "已识别 " + data.summary.total + " 个图片变更，其中 " + data.summary.ready + " 个可直接替换（" + (data.vcs === "svn" ? "SVN" : "Git") + "）。";
      setStatus("识别完成", "connected");
      renderResultList();
      renderPreview();
      if (state.items.length > 0) {
        openPreview();
      }
    }).catch(function (err) {
      showToast(err.message);
      setStatus("识别失败", "error");
    }).then(function () {
      setBusy(false);
      refreshButtons();
    });
  }

  function scanCsdJson() {
    var projectRoot = els.projectRoot.value.trim();
    var vcs = currentVcs();
    setBusy(true, "正在识别 CSD（" + vcsLabel() + "）");
    post("/api/scan-csd-json", {
      projectRoot: projectRoot,
      vcs: vcs
    }).then(function (data) {
      state.projectRoot = data.projectRoot;
      state.vcs = data.vcs || vcs;
      if (els.vcs && data.vcs) {
        els.vcs.value = data.vcs;
        writeStoredVcs(data.vcs);
        updateVcsHints();
      }
      rememberProjectRoot(data.projectRoot);
      state.csdItems = data.items || [];
      els.csdScanNote.textContent = "已识别 " + data.summary.total + " 个本地变更的 CSD，其中 " + data.summary.ready + " 个已命中 ui 同名 json（" + (data.vcs === "svn" ? "SVN" : "Git") + "）。";
      setStatus("CSD 识别完成", "connected");
      renderCsdResultList();
    }).catch(function (err) {
      showToast(err.message);
      setStatus("CSD 识别失败", "error");
    }).then(function () {
      setBusy(false);
      refreshButtons();
    });
  }

  function applySelected() {
    var selected = getSelectedItems();
    if (!selected.length) {
      showToast("没有可替换的图片");
      return;
    }

    setBusy(true, "正在替换");
    post("/api/apply", {
      projectRoot: state.projectRoot,
      vcs: state.vcs,
      items: selected.map(function (item) {
        return {
          sourceRel: item.sourceRel,
          sourcePath: item.sourcePath,
          targetDir: item.selectedTargetDir
        };
      })
    }).then(function (data) {
      setStatus("替换完成", "connected");
      showToast("替换完成：覆盖 " + data.summary.copied + " 个，跳过 " + data.summary.skipped + " 个，错误 " + data.summary.error + " 个。");
    }).catch(function (err) {
      showToast(err.message);
      setStatus("替换失败", "error");
    }).then(function () {
      setBusy(false);
      refreshButtons();
    });
  }

  function applySelectedCsd() {
    var selected = getSelectedCsdItems();
    if (!selected.length) {
      showToast("没有可替换的 json");
      return;
    }

    setBusy(true, "正在替换 JSON");
    post("/api/apply-csd-json", {
      projectRoot: state.projectRoot,
      vcs: state.vcs,
      items: selected.map(function (item) {
        return {
          sourceRel: item.sourceRel,
          sourcePath: item.sourcePath,
          targetPath: item.targetPath
        };
      })
    }).then(function (data) {
      setStatus("JSON 替换完成", "connected");
      showToast("JSON 替换完成：覆盖 " + data.summary.copied + " 个，跳过 " + data.summary.skipped + " 个，错误 " + data.summary.error + " 个。");
    }).catch(function (err) {
      showToast(err.message);
      setStatus("JSON 替换失败", "error");
    }).then(function () {
      setBusy(false);
      refreshButtons();
    });
  }

  function openPreview() {
    els.previewModal.classList.remove("hidden");
    renderPreview();
  }

  function closePreview() {
    els.previewModal.classList.add("hidden");
  }

  function openRestoreModal() {
    var projectRoot = els.projectRoot.value.trim();
    var vcs = currentVcs();
    setBusy(true, "正在计算还原范围（" + vcsLabel() + "）");
    post("/api/restore-csd-json-preview", {
      projectRoot: projectRoot,
      vcs: vcs
    }).then(function (data) {
      state.projectRoot = data.projectRoot;
      state.vcs = data.vcs || vcs;
      if (els.vcs && data.vcs) {
        els.vcs.value = data.vcs;
        writeStoredVcs(data.vcs);
        updateVcsHints();
      }
      rememberProjectRoot(data.projectRoot);
      state.restorePreview = data;
      renderRestoreModal();
      els.restoreModal.classList.remove("hidden");
      setStatus("还原范围已就绪", "connected");
    }).catch(function (err) {
      showToast(err.message);
      setStatus("还原范围识别失败", "error");
    }).then(function () {
      setBusy(false);
      refreshButtons();
    });
  }

  function closeRestoreModal() {
    els.restoreModal.classList.add("hidden");
  }

  function confirmRestore() {
    if (!state.restorePreview) {
      showToast("请先加载还原范围");
      return;
    }

    setBusy(true, "正在还原 JSON（" + vcsLabel() + "）");
    post("/api/restore-csd-json", {
      projectRoot: state.projectRoot,
      vcs: state.vcs,
      paths: state.restorePreview.items.map(function (item) {
        return item.path;
      })
    }).then(function (data) {
      setStatus("JSON 还原完成", "connected");
      showToast("JSON 还原完成：还原 " + data.summary.restored + " 个，跳过 " + data.summary.skipped + " 个，错误 " + data.summary.error + " 个。");
      closeRestoreModal();
      state.restorePreview = null;
      renderRestoreModal();
    }).catch(function (err) {
      showToast(err.message);
      setStatus("JSON 还原失败", "error");
    }).then(function () {
      setBusy(false);
      refreshButtons();
    });
  }

  function loadConfig() {
    state.recentProjectRoots = readRecentProjectRoots();
    renderRecentProjectRoots();

    var storedVcs = readStoredVcs();
    state.vcs = storedVcs;
    if (els.vcs) {
      els.vcs.value = storedVcs;
    }
    updateVcsHints();

    api("/api/config").then(function (data) {
      state.defaultProjectRoot = data.defaultProjectRoot;
      els.projectRoot.value = state.recentProjectRoots[0] || data.defaultProjectRoot;
      setStatus("本地服务已连接", "connected");
      detectVcsForCurrentRoot();
    }).catch(function (err) {
      setStatus("配置读取失败", "error");
      showToast(err.message);
    });
  }

  function detectVcsForCurrentRoot() {
    var projectRoot = els.projectRoot.value.trim();
    if (!projectRoot) return;
    fetch("/api/detect-vcs?projectRoot=" + encodeURIComponent(projectRoot))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.exists || !data.vcs) return;
        // 若历史已经选定，就不自动覆盖；仅在还是默认 git 且实际是 svn 时切换
        if (state.vcs === data.vcs) return;
        var stored = readStoredVcs();
        if (stored && stored !== "git") return;
        state.vcs = data.vcs;
        if (els.vcs) {
          els.vcs.value = data.vcs;
        }
        writeStoredVcs(data.vcs);
        updateVcsHints();
      })
      .catch(function () {});
  }

  function updateModeFields() {
    var isDiff = els.mode.value === "diff";
    var fields = document.querySelectorAll(".diff-field");
    for (var i = 0; i < fields.length; i += 1) {
      fields[i].style.display = isDiff ? "flex" : "none";
    }
  }

  function bindEvents() {
    els.useDefault.addEventListener("click", function () {
      els.projectRoot.value = state.defaultProjectRoot;
    });
    els.recentProjectRootButtons.addEventListener("click", function (event) {
      var target = event.target.closest('[data-action="recent-project-root"]');
      if (!target) return;
      els.projectRoot.value = target.getAttribute("data-root") || "";
      els.projectRoot.focus();
    });
    els.mode.addEventListener("change", updateModeFields);
    if (els.vcs) {
      els.vcs.addEventListener("change", function () {
        var vcs = currentVcs();
        state.vcs = vcs;
        writeStoredVcs(vcs);
        updateVcsHints();
      });
    }
    els.projectRoot.addEventListener("change", detectVcsForCurrentRoot);
    els.projectRoot.addEventListener("blur", detectVcsForCurrentRoot);
    els.scanBtn.addEventListener("click", scan);
    els.scanCsdBtn.addEventListener("click", scanCsdJson);
    els.previewBtn.addEventListener("click", openPreview);
    els.applyBtn.addEventListener("click", applySelected);
    els.applyCsdBtn.addEventListener("click", applySelectedCsd);
    els.restoreCsdJsonBtn.addEventListener("click", openRestoreModal);
    els.applyFromModalBtn.addEventListener("click", applySelected);
    els.closePreview.addEventListener("click", closePreview);
    els.closeRestoreModal.addEventListener("click", closeRestoreModal);
    els.cancelRestoreBtn.addEventListener("click", closeRestoreModal);
    els.confirmRestoreBtn.addEventListener("click", confirmRestore);
    els.previewModal.addEventListener("click", function (event) {
      if (event.target === els.previewModal) closePreview();
    });
    els.restoreModal.addEventListener("click", function (event) {
      if (event.target === els.restoreModal) closeRestoreModal();
    });
    els.selectReadyBtn.addEventListener("click", function () {
      state.items.forEach(function (item) {
        item.selected = item.state === "ready" && !!item.selectedTargetDir;
      });
      renderResultList();
      renderPreview();
    });
    els.clearPreviewSelectionBtn.addEventListener("click", function () {
      state.items.forEach(function (item) {
        item.selected = false;
      });
      renderResultList();
      renderPreview();
    });
    els.selectReadyCsdBtn.addEventListener("click", function () {
      state.csdItems.forEach(function (item) {
        item.selected = item.state === "ready";
      });
      renderCsdResultList();
    });
    els.clearCsdSelectionBtn.addEventListener("click", function () {
      state.csdItems.forEach(function (item) {
        item.selected = false;
      });
      renderCsdResultList();
    });
    els.resultList.addEventListener("change", function (event) {
      syncItemFromControl(event.target);
    });
    els.csdResultList.addEventListener("change", function (event) {
      syncCsdItemFromControl(event.target);
    });
    els.previewGrid.addEventListener("change", function (event) {
      syncItemFromControl(event.target);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initEls();
    bindEvents();
    updateModeFields();
    updateMetrics();
    renderResultList();
    renderCsdResultList();
    renderRestoreModal();
    loadConfig();
  });
})();

(function () {
  function activateToolFrame(frameId) {
    var frame = document.getElementById(frameId);
    if (frame && !frame.getAttribute("src")) {
      frame.setAttribute("src", frame.getAttribute("data-src"));
    }
  }

  function initSidebar() {
    var items = document.querySelectorAll(".sidebar-item");
    var views = document.querySelectorAll(".view");
    if (!items.length || !views.length) return;

    items.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-target");
        items.forEach(function (other) {
          other.classList.toggle("is-active", other === btn);
        });
        views.forEach(function (view) {
          view.classList.toggle("is-active", view.getAttribute("data-view") === target);
        });
        if (target === "json2csd") {
          activateToolFrame("json2csdFrame");
        }
        if (target === "game-ui-report") {
          activateToolFrame("gameUiReportFrame");
        }
        if (target === "launcher" && window.__launcherInit) {
          window.__launcherInit();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", initSidebar);
})();

(function () {
  function initAmbientBackground() {
    var bg = document.getElementById("ambientBg");
    if (!bg) return;

    var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    var pending = false;
    var lastEvent = null;

    function setZoneClass(target) {
      bg.classList.remove("is-over-nav", "is-over-data", "is-over-control");

      if (target.closest(".sidebar")) {
        bg.classList.add("is-over-nav");
        return;
      }

      if (target.closest(".metrics, .result-list, .preview-grid")) {
        bg.classList.add("is-over-data");
        return;
      }

      if (target.closest("button, input, select, .panel, .modal-card")) {
        bg.classList.add("is-over-control");
      }
    }

    document.addEventListener("pointermove", function (event) {
      lastEvent = event;
      if (pending) return;

      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        if (!lastEvent) return;

        var x = (lastEvent.clientX / Math.max(window.innerWidth, 1)) * 100;
        var y = (lastEvent.clientY / Math.max(window.innerHeight, 1)) * 100;
        bg.style.setProperty("--mouse-x", x.toFixed(2) + "%");
        bg.style.setProperty("--mouse-y", y.toFixed(2) + "%");
        setZoneClass(lastEvent.target);
      });
    }, { passive: true });

    document.addEventListener("pointerleave", function () {
      bg.classList.remove("is-over-nav", "is-over-data", "is-over-control");
      bg.style.setProperty("--mouse-x", "50%");
      bg.style.setProperty("--mouse-y", "44%");
    });
  }

  document.addEventListener("DOMContentLoaded", initAmbientBackground);
})();

(function () {
  var REDUCE_MOTION = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var IDEA_PHRASES = [
    "今天也要把灵感整理成可交付成果。",
    "越清晰的命名，越省排查时间。",
    "每一次小优化，都会积累成明显体验差异。",
    "先跑通，再打磨，最后做漂亮。",
    "耐心拆问题，复杂度自然会降下来。",
    "好的工具链，就是持续稳定的加速器。",
    "把焦点放在最关键的 20%，节奏会更好。"
  ];

  var PIO_PHRASES = [
    "看你点哪里呢～",
    "今天也辛苦啦。",
    "新衣服好看吗？",
    "下一套要穿哪件？",
    "鼠标不要乱戳啊。",
    "灵感卡住的时候，先去倒杯水。",
    "PR 合并前别忘了 self-review。",
    "嗯…这条还行。"
  ];

  var VENDOR_BASE = "/vendor/live2d-runtime/";
  var MASCOT_BASE = "/vendor/mascot/";
  var STORAGE_KEY_COSTUME = "mascot.costume";
  var STORAGE_KEY_CHARACTER = "mascot.character";
  var MASCOT_CHARACTER_Y_OFFSETS = {
    haru: 28
  };
  var MASCOT_RAIN_COUNT = 8;
  var MASCOT_RAIN_KINDS = [
    "lucky-star",
    "lucky-star",
    "lucky-star",
    "pinwheel"
  ];
  var MASCOT_RAIN_COLORS = [
    { a: "#fef3c7", b: "#f472b6", c: "#a855f7" },
    { a: "#e0f2fe", b: "#38bdf8", c: "#6366f1" },
    { a: "#fce7f3", b: "#fb7185", c: "#f59e0b" },
    { a: "#ecfeff", b: "#22d3ee", c: "#0ea5e9" },
    { a: "#ede9fe", b: "#a78bfa", c: "#ec4899" },
    { a: "#fef9c3", b: "#facc15", c: "#f97316" }
  ];
  var MASCOT_RAIN_TAILS = [
    "rgba(244, 114, 182, 0.32)",
    "rgba(56, 189, 248, 0.30)",
    "rgba(168, 85, 247, 0.28)",
    "rgba(250, 204, 21, 0.26)"
  ];

  function initMascotAndClickEffects() {
    var stage = document.getElementById("mascotStage");
    var rain = document.getElementById("mascotRain");
    var bubble = document.getElementById("mascotBubble");
    var effects = document.getElementById("clickEffects");
    var canvas = document.getElementById("live2dCanvas");
    var fallback = document.getElementById("mascotFallback");
    var costumeBtn = document.getElementById("mascotCostumeBtn");
    var characterBtn = document.getElementById("mascotCharacterBtn");
    var sidebar = document.querySelector(".sidebar");
    var hasMascot = !!(stage && bubble && sidebar && canvas && fallback && costumeBtn && characterBtn);
    var hasClickFx = !!effects;
    if (!hasMascot && !hasClickFx) return;

    var bubbleTimer = 0;
    var rainGeneration = 0;
    var wasDocumentHidden = document.hidden === true;
    var state = {
      app: null,
      model: null,
      characters: [],
      currentCharacter: null,
      costumes: [],
      currentIndex: 0,
      switching: false,
      pendingFocusX: 0,
      pendingFocusY: 0
    };

    function pick(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function configureRainItem(item, index) {
      var palette = pick(MASCOT_RAIN_COLORS);
      var kind = pick(MASCOT_RAIN_KINDS);
      var size = randomBetween(20, 38);
      var sideLeft = Math.random() < 0.5;
      var leftPercent = sideLeft
        ? randomBetween(2, 22)
        : randomBetween(78, 98);
      var drift = randomBetween(56, 132) * (sideLeft ? 1 : -1);
      var sway = randomBetween(-14, 14);
      var duration = randomBetween(11, 18.5);
      var spin = kind === "pinwheel" ? randomBetween(1.6, 2.8) : randomBetween(2.4, 4.4);
      var delay = index === undefined
        ? 0
        : (index / Math.max(MASCOT_RAIN_COUNT, 1)) * duration + randomBetween(0, duration * 0.08);
      item.className = "mascot-rain-item is-" + kind;
      item.innerHTML =
        '<span class="star-core">' +
          '<span class="star-base"></span>' +
          '<span class="star-facets"></span>' +
          '<span class="star-shine"></span>' +
          '<span class="star-rim"></span>' +
        '</span>';
      item.style.setProperty("--fall-left", leftPercent.toFixed(2) + "%");
      item.style.setProperty("--fall-size", size.toFixed(1) + "px");
      item.style.setProperty("--fall-duration", duration.toFixed(2) + "s");
      item.style.setProperty("--fall-delay", delay.toFixed(2) + "s");
      item.style.setProperty("--fall-drift", drift.toFixed(1) + "px");
      item.style.setProperty("--fall-sway", sway.toFixed(1) + "px");
      item.style.setProperty("--fall-rotate", randomBetween(-28, 28).toFixed(1) + "deg");
      item.style.setProperty("--fall-spin", spin.toFixed(2) + "s");
      item.style.setProperty("--fall-color-a", palette.a);
      item.style.setProperty("--fall-color-b", palette.b);
      item.style.setProperty("--fall-color-c", palette.c);
      item.style.setProperty("--fall-tail", pick(MASCOT_RAIN_TAILS));
    }

    function initMascotRain() {
      if (!rain || REDUCE_MOTION) return;
      rainGeneration += 1;
      rain.textContent = "";

      var fragment = document.createDocumentFragment();
      var currentGeneration = String(rainGeneration);
      for (var i = 0; i < MASCOT_RAIN_COUNT; i += 1) {
        var item = document.createElement("span");
        item.setAttribute("data-rain-generation", currentGeneration);
        configureRainItem(item, i);
        item.addEventListener("animationiteration", function (event) {
          if (event.animationName !== "mascot-resource-fall") return;
          // 页面后台恢复时，浏览器可能补发旧动画事件；只响应当前可见雨层。
          if (document.hidden === true || !rain.contains(event.currentTarget)) return;
          if (event.currentTarget.getAttribute("data-rain-generation") !== String(rainGeneration)) return;
          configureRainItem(event.currentTarget);
        });
        fragment.appendChild(item);
      }
      rain.appendChild(fragment);
    }

    function applyVisibilityState() {
      var hidden = document.hidden === true;
      if (rain) {
        rain.classList.toggle("is-paused", hidden);
        if (!hidden && wasDocumentHidden) {
          initMascotRain();
        }
      }
      wasDocumentHidden = hidden;
      if (state.app && state.app.ticker) {
        if (hidden) {
          state.app.ticker.stop();
        } else {
          state.app.ticker.start();
        }
      }
    }

    document.addEventListener("visibilitychange", applyVisibilityState);

    function showBubble(text) {
      if (!bubble) return;
      bubble.textContent = text;
      bubble.classList.add("is-visible");
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () {
        bubble.classList.remove("is-visible");
      }, 2500);
    }

    function showFallback() {
      if (!fallback.getAttribute("src")) {
        fallback.setAttribute("src", MASCOT_BASE + "preview.png");
      }
      fallback.hidden = false;
      canvas.style.visibility = "hidden";
    }

    function getMascotYOffset() {
      var characterId = state.currentCharacter ? state.currentCharacter.id : "";
      return MASCOT_CHARACTER_Y_OFFSETS[characterId] || 0;
    }

    function resizeLive2d() {
      if (!state.app) return;
      try {
        var rect = stage.getBoundingClientRect();
        // 整数 CSS 像素，避免亚像素引起的二次采样
        var displayW = Math.max(220, Math.floor(rect.width));
        var displayH = Math.max(220, Math.floor(rect.height));

        // autoDensity + resolution 会自动按 dpr 设置 drawing buffer 与 CSS 尺寸
        state.app.renderer.resize(displayW, displayH);

        if (!state.model) return;

        // 用模型「标称尺寸」算 fitScale，不用 getBounds()
        // getBounds 含动画位移，每帧抖动 → scale 抖动 → 纹理摩尔纹
        var internal = state.model.internalModel;
        var modelW = (internal && internal.originalWidth) ||
                     (state.model.width / (state.model.scale.x || 1)) ||
                     displayW;
        var modelH = (internal && internal.originalHeight) ||
                     (state.model.height / (state.model.scale.y || 1)) ||
                     displayH;

        // contain：等比缩放完整放入容器，留 8% 给挥手/浮动外扩
        var SAFE_PADDING = 0.92;
        var fitScale = Math.min(displayW / modelW, displayH / modelH) * SAFE_PADDING;
        if (!isFinite(fitScale) || fitScale <= 0) return;

        state.model.scale.set(fitScale);
        if (typeof state.model.anchor !== "undefined") {
          state.model.anchor.set(0.5, 0.5);
        }

        state.model.x = displayW * 0.5;
        state.model.y = displayH * 0.5 + getMascotYOffset();
        state.baseY = state.model.y;
      } catch (e) { /* swallow */ }
    }

    function applyModelFocus(nx, ny) {
      if (!state.model || REDUCE_MOTION) return;
      try {
        var internal = state.model.internalModel;
        if (internal && typeof internal.focusController === "object" &&
            typeof internal.focusController.focus === "function") {
          internal.focusController.focus(nx, ny);
        }
      } catch (e) { /* swallow */ }
    }

    function updateGaze(clientX, clientY) {
      if (REDUCE_MOTION) return;
      var rect = stage.getBoundingClientRect();
      var centerX = rect.left + rect.width * 0.55;
      var centerY = rect.top + rect.height * 0.5;
      var rangeX = Math.max(window.innerWidth, 480);
      var rangeY = Math.max(window.innerHeight, 480);
      var nx = Math.max(-1, Math.min(1, (clientX - centerX) / rangeX));
      var ny = Math.max(-1, Math.min(1, (clientY - centerY) / rangeY));
      state.pendingFocusX = nx;
      state.pendingFocusY = -ny;
      applyModelFocus(state.pendingFocusX, state.pendingFocusY);
    }

    function resetGaze() {
      state.pendingFocusX = 0;
      state.pendingFocusY = 0;
      applyModelFocus(0, 0);
    }

    function loadScript(url) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onload = function () { resolve(url); };
        s.onerror = function () {
          if (s.parentNode) s.parentNode.removeChild(s);
          reject(new Error("脚本加载失败: " + url));
        };
        document.head.appendChild(s);
      });
    }

    function loadRuntime() {
      return loadScript(VENDOR_BASE + "pixi.min.js")
        .then(function () { return loadScript(VENDOR_BASE + "live2d.min.js"); })
        .then(function () {
          // pixi-live2d-display 完整版在入口处同时校验 Cubism 2/4 运行时，缺一即抛
          // "Could not find Cubism 4 runtime"。本工程仅使用 Cubism 2 (.moc) 模型，
          // 这里注入空对象绕过同步检查，Cubism 4 代码路径不会被实际触发。
          if (!window.Live2DCubismCore) window.Live2DCubismCore = {};
          return loadScript(VENDOR_BASE + "pixi-live2d-display.min.js");
        })
        .then(function () {
          if (!(window.PIXI && window.PIXI.live2d && window.PIXI.live2d.Live2DModel)) {
            throw new Error("Live2D 运行时未就绪");
          }
        });
    }

    function loadCharacterList() {
      return fetch("/vendor/mascot/characters.json", { cache: "no-cache" })
        .then(function (resp) {
          if (!resp.ok) throw new Error("characters.json 加载失败");
          return resp.json();
        });
    }

    function loadCostumeList() {
      var characterPath = state.currentCharacter ? state.currentCharacter.path : "pio";
      return fetch("/vendor/mascot/" + characterPath + "/index.json", { cache: "no-cache" })
        .then(function (resp) {
          if (!resp.ok) throw new Error("index.json 加载失败");
          return resp.json();
        });
    }

    function loadModel(costume) {
      var basePath = state.currentCharacter ? state.currentCharacter.path + "/" : "pio/";
      return window.PIXI.live2d.Live2DModel.from(MASCOT_BASE + basePath + costume.path);
    }

    function playTapMotion(group) {
      if (!state.model || REDUCE_MOTION) return;
      try {
        if (typeof state.model.motion === "function") {
          state.model.motion(group);
        } else if (state.model.internalModel &&
          state.model.internalModel.motionManager &&
          typeof state.model.internalModel.motionManager.startMotion === "function") {
          state.model.internalModel.motionManager.startMotion(group);
        }
      } catch (e) { /* swallow */ }
    }

    function bindHitEvent(model) {
      if (typeof model.on !== "function") return;
      model.on("hit", function (hitAreas) {
        var area = Array.isArray(hitAreas) ? hitAreas[0] : hitAreas;
        var motionGroup = area === "head" ? "flick_head" : "tap_body";
        playTapMotion(motionGroup);
        showBubble(pick(PIO_PHRASES));
      });
    }

    function attachModel(model) {
      if (state.model) {
        state.app.stage.removeChild(state.model);
        if (typeof state.model.destroy === "function") {
          try { state.model.destroy({ children: true }); } catch (e) {}
        }
        state.model = null;
      }
      state.model = model;
      state.app.stage.addChild(model);

      // 开启纹理 mipmap，避免角色显示较小时的纹理缩小波纹
      try {
        var textures = model.internalModel && model.internalModel.textures;
        if (textures && textures.length && window.PIXI) {
          var mipmapMode = window.PIXI.MIPMAP_MODES
            ? window.PIXI.MIPMAP_MODES.POW2
            : true;
          for (var i = 0; i < textures.length; i++) {
            var bt = textures[i].baseTexture || textures[i];
            if (bt) {
              bt.mipmap = mipmapMode;
              if (typeof bt.update === "function") bt.update();
            }
          }
        }
      } catch (e) { /* swallow */ }

      resizeLive2d();
      applyModelFocus(state.pendingFocusX, state.pendingFocusY);
      bindHitEvent(model);
    }

    function pickInitialIndex(costumes, indexData) {
      var saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY_COSTUME); } catch (e) {}
      if (saved) {
        for (var i = 0; i < costumes.length; i += 1) {
          if (costumes[i].key === saved) return i;
        }
      }
      var defaultKey = indexData && indexData.default;
      if (defaultKey) {
        for (var j = 0; j < costumes.length; j += 1) {
          if (costumes[j].key === defaultKey) return j;
        }
      }
      return 0;
    }

    function switchCharacter() {
      if (state.switching || state.characters.length < 2) return;
      var currentIdx = -1;
      var currentId = state.currentCharacter ? state.currentCharacter.id : "pio";
      for (var i = 0; i < state.characters.length; i++) {
        if (state.characters[i].id === currentId) {
          currentIdx = i;
          break;
        }
      }
      if (currentIdx === -1) currentIdx = 0;
      var nextIdx = (currentIdx + 1) % state.characters.length;
      var nextChar = state.characters[nextIdx];

      state.switching = true;
      characterBtn.classList.add("is-spinning");
      canvas.style.opacity = "0.3";

      state.currentCharacter = nextChar;
      try { localStorage.setItem(STORAGE_KEY_CHARACTER, nextChar.id); } catch (e) {}

      loadCostumeList().then(function (indexData) {
        var costumes = (indexData && indexData.costumes) || [];
        if (!costumes.length) throw new Error("该角色未配置服装");
        state.costumes = costumes;
        state.currentIndex = 0;
        return loadModel(costumes[0]);
      }).then(function (model) {
        attachModel(model);
        canvas.style.opacity = "1";
        costumeBtn.hidden = state.costumes.length < 2;
        showBubble(nextChar.name + " 来啦！");
      }).catch(function (err) {
        console.warn("[mascot] 角色切换失败：", err);
        canvas.style.opacity = "1";
        showBubble("角色切换失败，保持当前角色。");
      }).then(function () {
        state.switching = false;
        characterBtn.classList.remove("is-spinning");
      });
    }

    function preloadOtherCharacters() {
      if (!state.characters || state.characters.length < 2) return;
      var currentId = state.currentCharacter ? state.currentCharacter.id : "pio";

      state.characters.forEach(function (char) {
        if (char.id === currentId) return;

        var charPath = char.path;
        fetch(MASCOT_BASE + charPath + "/index.json", { cache: "force-cache" })
          .then(function (resp) {
            if (!resp.ok) return null;
            return resp.json();
          })
          .then(function (indexData) {
            if (!indexData || !indexData.costumes || !indexData.costumes.length) return;
            var firstCostume = indexData.costumes[0];
            var modelPath = MASCOT_BASE + charPath + "/" + firstCostume.path;
            // 静默预加载，不处理错误，不影响主流程
            return window.PIXI.live2d.Live2DModel.from(modelPath, { autoInteract: false });
          })
          .then(function (model) {
            // 预加载成功后立即销毁，只是为了让 pixi-live2d-display 建立缓存
            if (model && typeof model.destroy === "function") {
              try { model.destroy({ children: true }); } catch (e) {}
            }
          })
          .catch(function () {
            // 静默失败，不影响用户体验
          });
      });
    }

    function switchCostume(delta) {
      if (state.switching || state.costumes.length < 2) return;
      var nextIndex = (state.currentIndex + delta + state.costumes.length) % state.costumes.length;
      var next = state.costumes[nextIndex];
      state.switching = true;
      costumeBtn.classList.add("is-spinning");
      canvas.style.opacity = "0.3";
      loadModel(next).then(function (model) {
        state.currentIndex = nextIndex;
        attachModel(model);
        canvas.style.opacity = "1";
        try { localStorage.setItem(STORAGE_KEY_COSTUME, next.key); } catch (e) {}
        showBubble(pick(PIO_PHRASES));
      }).catch(function (err) {
        console.warn("[mascot] 换装失败：", err);
        canvas.style.opacity = "1";
        showBubble("这件衣服找不到了，先用原来这套。");
      }).then(function () {
        state.switching = false;
        setTimeout(function () { costumeBtn.classList.remove("is-spinning"); }, 500);
      });
    }

    function initLive2d() {
      if (REDUCE_MOTION) {
        showFallback();
        return Promise.resolve();
      }
      return loadRuntime().then(function () {
        return loadCharacterList();
      }).then(function (characters) {
        state.characters = characters || [];
        var savedCharId = null;
        try { savedCharId = localStorage.getItem(STORAGE_KEY_CHARACTER); } catch (e) {}
        var foundChar = null;
        if (savedCharId) {
          for (var i = 0; i < state.characters.length; i++) {
            if (state.characters[i].id === savedCharId) {
              foundChar = state.characters[i];
              break;
            }
          }
        }
        state.currentCharacter = foundChar || state.characters[0] || { id: "pio", path: "pio", name: "Pio" };
        return loadCostumeList();
      }).then(function (indexData) {
        var costumes = (indexData && indexData.costumes) || [];
        if (!costumes.length) throw new Error("index.json 未配置服装");
        state.costumes = costumes;
        state.currentIndex = pickInitialIndex(costumes, indexData);
        var initialDpr = Math.max(1, window.devicePixelRatio || 1);
        state.app = new window.PIXI.Application({
          view: canvas,
          width: Math.max(220, canvas.clientWidth || 220),
          height: Math.max(220, canvas.clientHeight || 220),
          resolution: initialDpr,
          autoDensity: true,
          transparent: true,
          autoStart: true,
          antialias: true,
          powerPreference: "high-performance"
        });
        applyVisibilityState();
        return loadModel(costumes[state.currentIndex]).catch(function (err) {
          console.warn("[mascot] 当前服装加载失败，回退到第 0 套：", err);
          if (state.currentIndex !== 0) {
            state.currentIndex = 0;
            return loadModel(costumes[0]);
          }
          throw err;
        });
      }).then(function (model) {
        attachModel(model);
        if (state.costumes.length >= 2) {
          costumeBtn.hidden = false;
        }
        if (state.characters.length >= 2) {
          characterBtn.hidden = false;
        }
        var charName = state.currentCharacter ? state.currentCharacter.name : "Pio";
        showBubble(charName + " 来啦，点点我看看。");

        // 漂浮动画：在 PIXI ticker 内移动 model.y，避免 CSS transform 引起的合成层亚像素
        if (!REDUCE_MOTION && state.app && state.app.ticker) {
          var floatStartTime = performance.now();
          state.app.ticker.add(function () {
            if (!state.model || typeof state.baseY !== "number") return;
            var t = (performance.now() - floatStartTime) / 1000;
            // 频率约 0.28Hz (周期≈3.6s)，振幅 6px，与原 CSS mascot-float 一致
            state.model.y = state.baseY + Math.sin(t * 1.745) * 6;
          });
        }

        // 后台预加载其他角色的第一个 costume，避免首次切换时的循环加载
        setTimeout(function () {
          preloadOtherCharacters();
        }, 2000);
      }).catch(function (err) {
        console.warn("[mascot] Live2D 初始化失败：", err);
        showFallback();
        showBubble("Live2D 加载失败，已显示静态形象。");
      });
    }

    function clearOldEffects(maxKeep) {
      while (effects.children.length > maxKeep) {
        effects.removeChild(effects.firstChild);
      }
    }

    function createFirework(clientX, clientY) {
      var colors = ["#38bdf8", "#22d3ee", "#60a5fa", "#f59e0b", "#fb7185", "#a78bfa", "#34d399"];
      var particleCount = 14;
      var fragment = document.createDocumentFragment();
      for (var i = 0; i < particleCount; i += 1) {
        var dot = document.createElement("span");
        dot.className = "firework-dot";
        var angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.22;
        var distance = 28 + Math.random() * 62;
        var dx = Math.cos(angle) * distance;
        var dy = Math.sin(angle) * distance;
        dot.style.left = clientX + "px";
        dot.style.top = clientY + "px";
        dot.style.setProperty("--dx", dx.toFixed(1));
        dot.style.setProperty("--dy", dy.toFixed(1));
        dot.style.setProperty("--dot-color", colors[i % colors.length]);
        fragment.appendChild(dot);
        (function (node) {
          setTimeout(function () {
            if (node.parentNode) node.parentNode.removeChild(node);
          }, 920);
        })(dot);
      }
      effects.appendChild(fragment);
      clearOldEffects(100);
    }

    function createIdeaQuote(clientX, clientY) {
      var quote = document.createElement("div");
      quote.className = "idea-quote";
      quote.textContent = pick(IDEA_PHRASES);
      quote.style.left = clientX + "px";
      quote.style.top = clientY + "px";
      effects.appendChild(quote);
      clearOldEffects(100);
      setTimeout(function () {
        if (quote.parentNode) quote.parentNode.removeChild(quote);
      }, 1500);
      showBubble(quote.textContent);
    }

    if (hasMascot) {
      document.addEventListener("pointermove", function (event) {
        updateGaze(event.clientX, event.clientY);
      }, { passive: true });

      document.addEventListener("pointerleave", function () {
        resetGaze();
      });

      costumeBtn.addEventListener("click", function () {
        switchCostume(1);
      });

      characterBtn.addEventListener("click", function () {
        switchCharacter();
      });

      canvas.addEventListener("click", function () {
        if (!state.model) return;
        playTapMotion(Math.random() < 0.4 ? "flick_head" : "tap_body");
        showBubble(pick(PIO_PHRASES));
      });

      if (window.ResizeObserver) {
        var resizeRaf = 0;
        var ro = new ResizeObserver(function () {
          if (resizeRaf) cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(function () {
            resizeRaf = 0;
            resizeLive2d();
          });
        });
        ro.observe(stage);
      } else {
        window.addEventListener("resize", resizeLive2d);
      }
    }

    if (hasClickFx) {
      document.addEventListener("click", function (event) {
        var target = event.target;
        if (target.closest("button, input, select, textarea, label, a, .modal-card, .result-list, .preview-grid, .sidebar-item, .toast, .anime-mascot, .mascot-costume, .mascot-character")) {
          return;
        }
        createFirework(event.clientX, event.clientY);
        createIdeaQuote(event.clientX, event.clientY);
      });
    }

    if (hasMascot) {
      initMascotRain();
      applyVisibilityState();
      showBubble("Pio 加载中…");
      initLive2d();
    }
  }

  document.addEventListener("DOMContentLoaded", initMascotAndClickEffects);
})();

(function () {
  "use strict";

  // 客户端启动台前端：工程选择 + uid/尺寸记忆 + 多实例日志实时跟随。
  // 与主业务、sidebar、ambient、mascot 各 IIFE 同构，互不侵入。

  var MAX_LINES_PER_INSTANCE = 5000; // 单实例日志行数上限，超出滚动丢弃
  var ERROR_RE = /error|错误|异常|exception|fail|warn/i;

  var el = {};
  var launcher = {
    clientRoot: "",
    projects: [],
    sizes: [],
    projectSort: "recent",
    selectedProject: "",
    selectedSizeKey: "",
    customSize: false,
    logView: "split",
    filter: "",
    errorOnly: false,
    autoScroll: true,
    paused: false,
    instances: {}, // instanceId -> { meta, lines:[], color }
    order: [],     // instanceId 顺序
    es: null,
    loaded: false,
    colorSeq: 0
  };

  var COLORS = [
    "#5eead4", "#a5b4fc", "#fca5a5", "#fcd34d",
    "#7dd3fc", "#f0abfc", "#86efac", "#fdba74"
  ];

  function $(id) { return document.getElementById(id); }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function toast(message) {
    var t = $("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.add("hidden"); }, 2600);
  }

  function apiGet(path) {
    return fetch(path).then(function (r) { return r.json(); });
  }
  function apiPost(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  /* ---------------- 工程列表 ---------------- */

  function fetchProjects() {
    var q = launcher.clientRoot ? "?clientRoot=" + encodeURIComponent(launcher.clientRoot) : "";
    return apiGet("/api/launcher/projects" + q).then(function (data) {
      if (!data || !data.ok) {
        setStatus("加载失败", "error");
        return;
      }
      launcher.clientRoot = data.clientRoot || "";
      launcher.projects = data.projects || [];
      launcher.sizes = data.sizes || [];
      launcher.projectSort = data.projectSort || "recent";
      if (el.clientRoot && !el.clientRoot.value) {
        el.clientRoot.value = launcher.clientRoot;
      }
      if (data.message) {
        el.projectNote.textContent = data.message;
      } else {
        el.projectNote.textContent = "共 " + launcher.projects.length + " 个工程 · " + launcher.clientRoot;
      }
      syncSortButtons();
      renderSizes(data.defaultSize);
      renderPins();
      renderProjects();
      // 恢复上次选中的工程
      if (!launcher.selectedProject && data.lastProject) {
        selectProject(data.lastProject, true);
      }
    });
  }

  function syncSortButtons() {
    var btns = el.projectCol.querySelectorAll(".launcher-sort .chip");
    btns.forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-sort") === launcher.projectSort);
    });
  }

  function filteredProjects() {
    var kw = (el.projectSearch.value || "").trim().toLowerCase();
    if (!kw) return launcher.projects;
    return launcher.projects.filter(function (p) {
      return p.name.toLowerCase().indexOf(kw) !== -1;
    });
  }

  function renderPins() {
    // 高频前 8 个（有使用记录的）置顶快捷按钮
    var top = launcher.projects.filter(function (p) { return p.count > 0; })
      .slice()
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 8);
    el.projectPins.innerHTML = "";
    if (!top.length) {
      el.projectPins.classList.add("is-empty");
      return;
    }
    el.projectPins.classList.remove("is-empty");
    top.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "launcher-pin" + (p.name === launcher.selectedProject ? " is-active" : "");
      b.textContent = shortName(p.name);
      b.title = p.name + " · 用过 " + p.count + " 次";
      b.addEventListener("click", function () { selectProject(p.name); });
      el.projectPins.appendChild(b);
    });
  }

  function shortName(name) {
    return name.replace(/^mjclient[-_]/i, "");
  }

  function renderProjects() {
    var list = filteredProjects();
    el.projectGrid.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "launcher-empty";
      empty.textContent = launcher.clientRoot ? "没有匹配的工程。" : "未找到 client 目录，请在右侧填写。";
      el.projectGrid.appendChild(empty);
      return;
    }
    list.forEach(function (p) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "launcher-project-card" + (p.name === launcher.selectedProject ? " is-active" : "");
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", p.name === launcher.selectedProject ? "true" : "false");

      var title = document.createElement("div");
      title.className = "lp-name";
      title.textContent = shortName(p.name);
      card.appendChild(title);

      var meta = document.createElement("div");
      meta.className = "lp-meta";
      var bits = [];
      if (p.count > 0) bits.push(p.count + " 次");
      if (p.lastUsedAt) bits.push(fmtWhen(p.lastUsedAt));
      meta.textContent = bits.join(" · ") || "未使用";
      card.appendChild(meta);

      card.addEventListener("click", function () { selectProject(p.name); });
      el.projectGrid.appendChild(card);
    });
  }

  function fmtWhen(ts) {
    var diff = Date.now() - ts;
    var min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return min + " 分钟前";
    var h = Math.floor(min / 60);
    if (h < 24) return h + " 小时前";
    var d = Math.floor(h / 24);
    return d + " 天前";
  }

  function findProject(name) {
    for (var i = 0; i < launcher.projects.length; i++) {
      if (launcher.projects[i].name === name) return launcher.projects[i];
    }
    return null;
  }

  function selectProject(name, silent) {
    launcher.selectedProject = name;
    var p = findProject(name);
    renderProjects();
    renderPins();
    renderUidRecent(p);
    // 回填该工程上次用的尺寸档位
    if (p && p.lastSize && !launcher.customSize) {
      selectSize(p.lastSize, true);
    }
    if (!silent && el.uid) el.uid.focus();
    updateLaunchEnabled();
  }

  function renderUidRecent(p) {
    el.uidRecent.innerHTML = "";
    var uids = (p && p.uids) || [];
    if (!uids.length) return;
    uids.forEach(function (uid) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "launcher-uid-chip";
      b.textContent = uid;
      b.addEventListener("click", function () {
        el.uid.value = uid;
        updateLaunchEnabled();
        el.uid.focus();
      });
      el.uidRecent.appendChild(b);
    });
  }

  /* ---------------- 尺寸档位 ---------------- */

  function renderSizes(defaultKey) {
    el.sizeGrid.innerHTML = "";
    launcher.sizes.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "launcher-size-chip";
      b.setAttribute("data-size", s.key);
      b.innerHTML = "<strong>" + s.width + "×" + s.height + "</strong><span>" +
        s.ratio.toFixed(2) + (s.count ? " · " + s.count + "次" : "") + "</span>";
      b.addEventListener("click", function () {
        el.customToggle.checked = false;
        toggleCustom(false);
        selectSize(s.key);
      });
      el.sizeGrid.appendChild(b);
    });
    if (!launcher.selectedSizeKey) {
      selectSize(defaultKey || (launcher.sizes[0] && launcher.sizes[0].key), true);
    } else {
      highlightSize();
    }
  }

  function selectSize(key, silent) {
    launcher.selectedSizeKey = key;
    launcher.customSize = false;
    highlightSize();
    updateLaunchEnabled();
  }

  function highlightSize() {
    var chips = el.sizeGrid.querySelectorAll(".launcher-size-chip");
    chips.forEach(function (c) {
      c.classList.toggle("is-active", !launcher.customSize && c.getAttribute("data-size") === launcher.selectedSizeKey);
    });
  }

  function toggleCustom(on) {
    launcher.customSize = on;
    el.width.disabled = !on;
    el.height.disabled = !on;
    if (on) {
      var s = findSize(launcher.selectedSizeKey);
      if (s && !el.width.value) el.width.value = s.width;
      if (s && !el.height.value) el.height.value = s.height;
    }
    highlightSize();
    updateLaunchEnabled();
  }

  function findSize(key) {
    for (var i = 0; i < launcher.sizes.length; i++) {
      if (launcher.sizes[i].key === key) return launcher.sizes[i];
    }
    return null;
  }

  function resolveSize() {
    if (launcher.customSize) {
      return { width: Number(el.width.value) || 0, height: Number(el.height.value) || 0 };
    }
    var s = findSize(launcher.selectedSizeKey);
    return s ? { width: s.width, height: s.height } : { width: 1000, height: 526 };
  }

  /* ---------------- 启动 ---------------- */

  function updateLaunchEnabled() {
    var size = resolveSize();
    var ok = launcher.selectedProject &&
      (el.uid.value || "").trim() &&
      size.width > 0 && size.height > 0;
    el.launchBtn.disabled = !ok;
  }

  function doLaunch() {
    var size = resolveSize();
    var payload = {
      clientRoot: launcher.clientRoot,
      project: launcher.selectedProject,
      uid: (el.uid.value || "").trim(),
      width: size.width,
      height: size.height
    };
    el.launchBtn.disabled = true;
    apiPost("/api/launcher/launch", payload).then(function (data) {
      if (!data || !data.ok) {
        toast((data && data.message) || "启动失败");
        updateLaunchEnabled();
        return;
      }
      toast("已入队 " + data.queued + " 个实例");
      ensureStream();
      // 启动后刷新记忆（uid/尺寸统计会更新）
      setTimeout(fetchProjects, data.queued * 2200 + 400);
    }).catch(function () {
      toast("启动请求失败");
      updateLaunchEnabled();
    });
  }

  /* ---------------- 实例与日志 ---------------- */

  function ensureInstance(meta) {
    var rec = launcher.instances[meta.instanceId];
    if (!rec) {
      rec = { meta: meta, lines: [], color: COLORS[launcher.colorSeq++ % COLORS.length] };
      launcher.instances[meta.instanceId] = rec;
      launcher.order.push(meta.instanceId);
      renderInstanceLayout();
    } else {
      rec.meta = meta;
      updateInstanceHead(meta.instanceId);
    }
    return rec;
  }

  function appendLines(instanceId, lines) {
    var rec = launcher.instances[instanceId];
    if (!rec) return;
    for (var i = 0; i < lines.length; i++) {
      rec.lines.push(lines[i]);
    }
    if (rec.lines.length > MAX_LINES_PER_INSTANCE) {
      rec.lines.splice(0, rec.lines.length - MAX_LINES_PER_INSTANCE);
    }
    if (!launcher.paused) renderLogArea();
  }

  function lineMatches(text) {
    if (launcher.errorOnly && !ERROR_RE.test(text)) return false;
    if (launcher.filter && text.toLowerCase().indexOf(launcher.filter) === -1) return false;
    return true;
  }

  function renderInstanceLayout() {
    el.instances.innerHTML = "";
    if (!launcher.order.length) {
      el.logNote.textContent = "尚无实例。";
      return;
    }
    el.logNote.textContent = "共 " + launcher.order.length + " 个实例";
    launcher.order.forEach(function (id) {
      var rec = launcher.instances[id];
      var chip = document.createElement("div");
      chip.className = "launcher-inst-chip";
      chip.setAttribute("data-inst", id);
      chip.style.borderColor = rec.color;
      chip.innerHTML =
        '<span class="li-dot" style="background:' + rec.color + '"></span>' +
        '<span class="li-name">' + esc(shortName(rec.meta.project)) + " · " + esc(rec.meta.uid) + "</span>" +
        '<span class="li-state" data-role="state"></span>' +
        '<button class="li-stop" type="button" title="关闭进程">停</button>' +
        '<button class="li-open" type="button" title="打开原始日志">档</button>' +
        '<button class="li-remove" type="button" title="从监控列表移除">×</button>';
      chip.querySelector(".li-stop").addEventListener("click", function () { stopInstance(id); });
      chip.querySelector(".li-open").addEventListener("click", function () {
        window.open("/api/launcher/log?instanceId=" + encodeURIComponent(id), "_blank");
      });
      chip.querySelector(".li-remove").addEventListener("click", function () { removeInstance(id); });
      el.instances.appendChild(chip);
      updateInstanceHead(id);
    });
    renderLogArea();
  }

  function updateInstanceHead(id) {
    var rec = launcher.instances[id];
    var chip = el.instances.querySelector('[data-inst="' + id + '"]');
    if (!rec || !chip) return;
    var stateEl = chip.querySelector('[data-role="state"]');
    var m = rec.meta;
    var label = m.status === "running" ? "运行中 PID " + m.pid :
      m.status === "exited" ? "已退出 (" + (m.exitCode == null ? "?" : m.exitCode) + ")" :
      m.status === "error" ? "启动失败" : m.status;
    stateEl.textContent = label;
    chip.classList.toggle("is-running", m.status === "running");
    chip.classList.toggle("is-dead", m.status !== "running");
    var stopBtn = chip.querySelector(".li-stop");
    if (stopBtn) stopBtn.disabled = m.status !== "running";
    // 运行中不能直接移除，避免留下无人跟随的孤儿进程；需先「停」
    var removeBtn = chip.querySelector(".li-remove");
    if (removeBtn) removeBtn.disabled = m.status === "running";
  }

  function renderLogArea() {
    el.logArea.setAttribute("data-logview", launcher.logView);
    if (launcher.logView === "merged") {
      renderMerged();
    } else {
      renderSplit();
    }
  }

  function renderSplit() {
    el.logArea.innerHTML = "";
    if (!launcher.order.length) return;
    launcher.order.forEach(function (id) {
      var rec = launcher.instances[id];
      var col = document.createElement("div");
      col.className = "launcher-log-col";
      var head = document.createElement("div");
      head.className = "llc-head";
      head.style.color = rec.color;
      head.textContent = shortName(rec.meta.project) + " · " + rec.meta.uid;
      col.appendChild(head);
      var body = document.createElement("div");
      body.className = "llc-body";
      var html = "";
      rec.lines.forEach(function (line) {
        if (!lineMatches(line)) return;
        html += '<div class="log-line' + (ERROR_RE.test(line) ? " is-error" : "") + '">' + esc(line) + "</div>";
      });
      body.innerHTML = html;
      col.appendChild(body);
      el.logArea.appendChild(col);
      if (launcher.autoScroll) body.scrollTop = body.scrollHeight;
    });
  }

  function renderMerged() {
    el.logArea.innerHTML = "";
    var body = document.createElement("div");
    body.className = "launcher-log-merged";
    // 合并视图：各实例带彩色前缀 [工程#uid]，一眼分辨来源
    var html = "";
    launcher.order.forEach(function (id) {
      var rec = launcher.instances[id];
      var prefix = shortName(rec.meta.project) + "#" + rec.meta.uid;
      rec.lines.forEach(function (line) {
        if (!lineMatches(line)) return;
        html += '<div class="log-line' + (ERROR_RE.test(line) ? " is-error" : "") + '">' +
          '<span class="lm-prefix" style="color:' + rec.color + '">[' + esc(prefix) + "]</span> " +
          esc(line) + "</div>";
      });
    });
    body.innerHTML = html;
    el.logArea.appendChild(body);
    if (launcher.autoScroll) body.scrollTop = body.scrollHeight;
  }

  function stopInstance(id) {
    apiPost("/api/launcher/stop", { instanceId: id }).then(function (data) {
      if (!data || !data.ok) { toast((data && data.message) || "关闭失败"); return; }
      toast("已关闭");
    });
  }

  // 从监控界面移除一个已退出/失败的实例：后端删记录 + 本地清状态
  function removeInstance(id) {
    var rec = launcher.instances[id];
    if (rec && rec.meta && rec.meta.status === "running") {
      toast("请先停止运行中的实例");
      return;
    }
    apiPost("/api/launcher/clear", { instanceId: id }).then(function (data) {
      if (!data || !data.ok) { toast((data && data.message) || "移除失败"); return; }
      dropLocalInstance(id);
      renderInstanceLayout();
    }).catch(function () {
      toast("移除请求失败");
    });
  }

  function dropLocalInstance(id) {
    delete launcher.instances[id];
    var idx = launcher.order.indexOf(id);
    if (idx !== -1) launcher.order.splice(idx, 1);
  }

  // 一键清理所有已退出/失败的实例
  function clearDeadInstances() {
    var dead = launcher.order.filter(function (id) {
      var rec = launcher.instances[id];
      return rec && rec.meta && rec.meta.status !== "running";
    });
    if (!dead.length) {
      toast("没有可清理的实例");
      return;
    }
    var pending = dead.length;
    dead.forEach(function (id) {
      apiPost("/api/launcher/clear", { instanceId: id }).then(function (data) {
        if (data && data.ok) dropLocalInstance(id);
      }).catch(function () {}).then(function () {
        pending -= 1;
        if (pending === 0) {
          renderInstanceLayout();
          toast("已清理 " + dead.length + " 个实例");
        }
      });
    });
  }

  /* ---------------- SSE ---------------- */

  function ensureStream() {
    if (launcher.es) return;
    if (typeof EventSource === "undefined") {
      setStatus("浏览器不支持 SSE", "error");
      return;
    }
    var es = new EventSource("/api/launcher/stream");
    launcher.es = es;
    es.onopen = function () { setStatus("已连接", "ok"); };
    es.onerror = function () { setStatus("连接中断，重试中", "error"); };
    es.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleEvent(msg);
    };
  }

  function handleEvent(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "hello") {
      (msg.instances || []).forEach(function (m) { ensureInstance(m); });
      return;
    }
    if (msg.type === "instance") {
      ensureInstance(msg.instance);
      return;
    }
    if (msg.type === "log") {
      appendLines(msg.instanceId, msg.lines || []);
      return;
    }
    if (msg.type === "error") {
      toast(msg.message || "启动出错");
      return;
    }
  }

  function setStatus(text, kind) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.classList.remove("is-ok", "is-error");
    if (kind === "ok") el.status.classList.add("is-ok");
    if (kind === "error") el.status.classList.add("is-error");
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    el.projectSearch.addEventListener("input", renderProjects);
    el.refreshBtn.addEventListener("click", function () {
      launcher.clientRoot = (el.clientRoot.value || "").trim();
      fetchProjects();
    });
    el.launchBtn.addEventListener("click", doLaunch);
    el.uid.addEventListener("input", updateLaunchEnabled);
    el.uid.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !el.launchBtn.disabled) doLaunch();
    });
    el.customToggle.addEventListener("change", function () {
      toggleCustom(el.customToggle.checked);
    });
    el.width.addEventListener("input", updateLaunchEnabled);
    el.height.addEventListener("input", updateLaunchEnabled);

    el.projectCol.querySelectorAll(".launcher-sort .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var sort = b.getAttribute("data-sort");
        apiPost("/api/launcher/sort", { sort: sort }).then(function () {
          launcher.projectSort = sort;
          fetchProjects();
        });
      });
    });

    el.logTools.querySelectorAll(".launcher-view-toggle .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        launcher.logView = b.getAttribute("data-logview");
        el.logTools.querySelectorAll(".launcher-view-toggle .chip").forEach(function (o) {
          o.classList.toggle("is-active", o === b);
        });
        renderLogArea();
      });
    });

    el.logFilter.addEventListener("input", function () {
      launcher.filter = (el.logFilter.value || "").trim().toLowerCase();
      renderLogArea();
    });
    el.errorOnly.addEventListener("change", function () {
      launcher.errorOnly = el.errorOnly.checked;
      renderLogArea();
    });
    el.autoScroll.addEventListener("change", function () {
      launcher.autoScroll = el.autoScroll.checked;
      renderLogArea();
    });
    el.pauseBtn.addEventListener("click", function () {
      launcher.paused = !launcher.paused;
      el.pauseBtn.classList.toggle("is-active", launcher.paused);
      el.pauseBtn.textContent = launcher.paused ? "继续" : "暂停";
      if (!launcher.paused) renderLogArea();
    });
    el.clearBtn.addEventListener("click", function () {
      launcher.order.forEach(function (id) {
        if (launcher.instances[id]) launcher.instances[id].lines = [];
      });
      renderLogArea();
    });
    if (el.clearDeadBtn) {
      el.clearDeadBtn.addEventListener("click", clearDeadInstances);
    }
  }

  // 首次进入 launcher view 时初始化
  window.__launcherInit = function () {
    if (launcher.loaded) return;
    launcher.loaded = true;
    el.status = $("launcherStatus");
    el.projectCol = document.querySelector(".launcher-project-col");
    el.projectNote = $("launcherProjectNote");
    el.projectSearch = $("launcherProjectSearch");
    el.projectPins = $("launcherProjectPins");
    el.projectGrid = $("launcherProjectGrid");
    el.uid = $("launcherUid");
    el.uidRecent = $("launcherUidRecent");
    el.sizeGrid = $("launcherSizeGrid");
    el.customToggle = $("launcherSizeCustomToggle");
    el.width = $("launcherWidth");
    el.height = $("launcherHeight");
    el.clientRoot = $("launcherClientRoot");
    el.launchBtn = $("launcherLaunchBtn");
    el.refreshBtn = $("launcherRefreshBtn");
    el.instances = $("launcherInstances");
    el.logArea = $("launcherLogArea");
    el.logNote = $("launcherLogNote");
    el.logTools = document.querySelector(".launcher-log-tools");
    el.logFilter = $("launcherLogFilter");
    el.errorOnly = $("launcherErrorOnly");
    el.autoScroll = $("launcherAutoScroll");
    el.pauseBtn = $("launcherPauseBtn");
    el.clearBtn = $("launcherClearBtn");
    el.clearDeadBtn = $("launcherClearDeadBtn");

    bind();
    fetchProjects();
    ensureStream();
  };
})();
