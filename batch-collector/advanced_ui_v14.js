(() => {
  "use strict";

  if (globalThis.__BFV14UIInstalled) return;
  globalThis.__BFV14UIInstalled = true;

  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  if (!runtime || window.top !== window) return;

  const state = {
    host: null,
    root: null,
    items: [],
    filtered: [],
    open: false,
    scanning: false,
    autoScrolling: false,
    boardMode: false,
    stitch: false,
    saving: false,
    dragKey: null,
    selectionAnchor: null,
    manualOrder: false,
    destination: "billfish",
    filters: { category: "all", search: "", type: "all", format: "all", minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0 },
    folderMeta: {},
    importProgress: null,
    previewLoading: new Set()
  };

  function send(message, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("操作超时，请重试")), timeoutMs);
      try {
        runtime.sendMessage(message, (response) => {
          clearTimeout(timer);
          const error = runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function keyFor(item) {
    const api = globalThis.__BillfishCaptureCompat;
    if (api?.resourceKey) return api.resourceKey(item);
    return `${item.type || item.contentType || "image"}|${item.identitySrc || item.src || item.originalSrc || item.data || ""}`;
  }

  function normalizeItem(raw) {
    const item = { ...raw };
    item.type = item.type || item.contentType || "image";
    item.contentType = item.type;
    item.originalSrc = item.originalSrc || item.src || "";
    item.src = item.src || item.data || item.originalSrc;
    item.candidates = Array.from(new Set([...(item.candidates || []), item.src, item.originalSrc].filter(Boolean)));
    const categoryName = item.category === "详情图" ? "描述图" : item.category;
    const generatedName = ["主图", "描述图"].includes(categoryName) && item.categoryOrder
      ? categoryName + "_" + String(item.categoryOrder).padStart(3, "0")
      : item.category === "SKU图" ? item.skuName : "";
    item.title = String(item.titleEdited ? item.title : generatedName || item.title || item.pageTitle || "未命名素材").trim();
    item.width = Number(item.width || 0);
    item.height = Number(item.height || 0);
    item.key = keyFor(item) + "|" + (item.category || "其他");
    item.selected = false;
    item.tags = Array.isArray(item.tags) ? item.tags : [];
    return item;
  }

  function prioritizeLargeImages(items) {
    if (state.manualOrder) return items;
    const content = [], smallAssets = [];
    for (const item of items) {
      // Stable partition only: page sections and banners retain their document order.
      // A small CSS container is not evidence of a small source image.
      const small = item.type === "image" && !item.dimensionsFromLayout
        && Number.isFinite(item.width) && Number.isFinite(item.height)
        && item.width > 0 && item.height > 0 && item.width <= 256 && item.height <= 256;
      (small ? smallAssets : content).push(item);
    }
    return content.concat(smallAssets);
  }

  function mergeItems(rawItems, replace = true) {
    const old = new Map(state.items.map((item) => [item.key, item]));
    const merged = replace ? [] : [...state.items];
    const seen = new Map(merged.map((item) => [item.key, item]));
    for (const raw of rawItems || []) {
      const normalized = normalizeItem(raw);
      const previous = old.get(normalized.key);
      if (previous) {
        normalized.selected = previous.selected;
        normalized.title = previous.titleEdited ? previous.title : normalized.title;
        normalized.titleEdited = previous.titleEdited || false;
        normalized.detected = previous.detected || normalized.detected;
        normalized.previewData = previous.previewData || normalized.previewData;
        if (previous.dimensionsResolved) {
          normalized.width = previous.width;
          normalized.height = previous.height;
          normalized.dimensionsResolved = true;
        }
      }
      const duplicate = seen.get(normalized.key);
      if (duplicate && normalized.category && normalized.category !== "其他") duplicate.category = normalized.category;
      if (duplicate) {
        if (normalized.dimensionsResolved && (!duplicate.dimensionsResolved || normalized.width * normalized.height > duplicate.width * duplicate.height)) {
          duplicate.width = normalized.width;
          duplicate.height = normalized.height;
          duplicate.dimensionsResolved = true;
          duplicate.dimensionsFromLayout = false;
        }
        duplicate.candidates = Array.from(new Set([...duplicate.candidates, ...normalized.candidates]));
      } else {
        seen.set(normalized.key, normalized);
        merged.push(normalized);
      }
    }
    state.items = prioritizeLargeImages(merged);
    applyFilters();
  }

  function ensureUI() {
    if (state.host?.isConnected) return;
    const host = document.createElement("div");
    host.id = "bf-v14-collector-host";
    host.setAttribute("data-bf-v14", "collector");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}button,input,select,textarea{font:inherit}
        .mask{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.58);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:Inter,"Source Han Sans CN","思源黑体 CN",system-ui,sans-serif;color:#1f2937}
        .panel{width:min(1480px,96vw);height:min(940px,94vh);background:#f7f9fc;border:1px solid rgba(255,255,255,.6);border-radius:16px;box-shadow:0 26px 90px rgba(0,0,0,.28);display:grid;grid-template-rows:auto auto 1fr auto;overflow:hidden}
        .top{display:flex;align-items:center;gap:12px;padding:13px 16px;background:#fff;border-bottom:1px solid #e5e7eb}.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#2563eb,#06b6d4);display:grid;place-items:center;color:#fff;font-weight:800}.title{font-size:17px;font-weight:750}.sub{font-size:12px;color:#6b7280}.spacer{flex:1}
        .btn{border:1px solid #d7dce5;background:#fff;color:#273244;border-radius:8px;padding:7px 11px;cursor:pointer;white-space:nowrap}.btn:hover{border-color:#7aa2ff;background:#f4f7ff}.btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}.btn.danger{color:#b42318}.btn:disabled{opacity:.5;cursor:not-allowed}.close{font-size:19px;width:34px;height:34px;padding:0}
        .tools{padding:10px 14px;background:#fff;border-bottom:1px solid #e5e7eb;display:grid;grid-template-columns:minmax(180px,1.4fr) 110px 110px repeat(4,82px) auto auto auto;gap:8px;align-items:center}.field{height:34px;border:1px solid #d7dce5;border-radius:8px;background:#fff;padding:0 9px;min-width:0}.toggle{display:flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap}.count{font-size:13px;color:#475569;white-space:nowrap}
        .body{min-height:0;display:grid;grid-template-columns:1fr 292px}.grid-wrap{position:relative;min-width:0;overflow:auto;padding:12px;background:#eef2f7}.grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;align-content:start;min-height:100%}
        .card{position:relative;border:2px solid transparent;background:#fff;border-radius:11px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08);cursor:pointer;user-select:none}.card.selected{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.12)}.card.filtered-out{display:none}.thumb{height:150px;background:#e9edf3;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}.thumb img,.thumb video{width:100%;height:100%;object-fit:contain;display:block}.thumb audio{width:92%}.media-icon{font-size:40px;color:#64748b}.check{position:absolute;left:8px;top:8px;width:22px;height:22px;border-radius:6px;background:rgba(255,255,255,.94);border:1px solid #cbd5e1;display:grid;place-items:center;font-weight:900;color:#2563eb;z-index:3}.badge{position:absolute;right:7px;top:7px;background:rgba(15,23,42,.78);color:#fff;border-radius:5px;padding:3px 6px;font-size:10px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.info{padding:8px}.name{width:100%;border:0;border-bottom:1px solid transparent;padding:2px 0;font-size:12px;font-weight:650;color:#1f2937;outline:none;background:transparent}.name:focus{border-bottom-color:#2563eb}.meta{display:flex;gap:6px;margin-top:5px;color:#64748b;font-size:10px;white-space:nowrap;overflow:hidden}.source{display:block;margin-top:5px;font-size:10px;color:#2563eb;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source:hover{text-decoration:underline}
        .side{border-left:1px solid #e5e7eb;background:#fff;padding:13px;overflow:auto}.section{margin-bottom:14px}.section h3{font-size:13px;margin:0 0 8px}.label{display:block;font-size:11px;color:#64748b;margin:7px 0 4px}.side input,.side select,.side textarea{width:100%;border:1px solid #d7dce5;border-radius:7px;padding:7px 8px;background:#fff;color:#1f2937}.side textarea{height:72px;resize:vertical}.hint{font-size:10px;color:#7c8798;line-height:1.5;margin-top:6px}.folder-row{display:flex;gap:6px}.folder-row select{min-width:0}.folder-row button{padding:6px 8px}
        .footer{display:flex;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid #e5e7eb;background:#fff}.status{font-size:12px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.progress{height:6px;width:170px;background:#e5e7eb;border-radius:99px;overflow:hidden}.progress>i{display:block;height:100%;background:#2563eb;width:0}.select-rect{position:fixed;border:1px solid #2563eb;background:rgba(37,99,235,.13);pointer-events:none;z-index:2147483647}.toast{position:fixed;right:22px;top:22px;z-index:2147483647;background:#111827;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;box-shadow:0 10px 35px rgba(0,0,0,.25);max-width:380px}.empty{grid-column:1/-1;padding:80px 20px;text-align:center;color:#64748b}.loading{animation:pulse 1.2s infinite}@keyframes pulse{50%{opacity:.45}}
        @media(max-width:980px){.body{grid-template-columns:1fr}.side{padding:8px}.body{grid-template-columns:minmax(0,1fr) 220px}.tools{grid-template-columns:1fr 110px repeat(2,84px);}.tools .optional{display:none}}

        /* V14.28: calm workspace, clear selection and responsive controls. */
        .mask{background:rgba(18,28,46,.46);backdrop-filter:blur(6px);font-size:13px;line-height:1.5}
        .panel{width:min(1560px,96vw);height:min(980px,94vh);border-radius:20px;border:1px solid #ffffffb3;box-shadow:0 32px 100px #0f172a38;background:#f6f8fc}
        .top{padding:18px 22px;gap:12px}.logo{width:38px;height:38px;border-radius:12px;background:#2563eb;box-shadow:0 4px 12px #2563eb26;font-size:19px}.logo{background:transparent;box-shadow:none;border-radius:0;object-fit:contain}.title{font-size:18px;letter-spacing:.3px;font-weight:700;color:#172338}.sub{font-size:11px;color:#8793a5;margin-top:2px}
        .btn{min-height:34px;padding:7px 12px;border:1px solid #e0e6ef;border-radius:9px;font-size:12px;font-weight:500;transition:background .15s,border-color .15s,box-shadow .15s}.btn:hover{background:#eff5ff;border-color:#a9c3f8}.btn.primary{background:#2563eb;border-color:#2563eb;box-shadow:0 4px 10px #2563eb25}.btn.primary:hover{background:#1d4ed8}.btn:disabled{box-shadow:none;opacity:.45}.btn:focus-visible,.field:focus-visible,.side input:focus-visible,.side textarea:focus-visible,.side select:focus-visible{outline:2px solid #83aefa;outline-offset:2px}.btn.close{display:inline-flex;align-items:center;justify-content:center;flex:0 0 34px;box-sizing:border-box;width:34px;height:34px;min-width:34px;padding:0;line-height:1;font-size:19px;color:#8793a5;background:#f6f8fb}.btn.danger{color:#bd3544;background:#fff8f8;border-color:#f3dfe2}
        .tools{display:flex;flex-wrap:wrap;gap:8px;padding:12px 20px;background:#fbfcfe;border-color:#e7ecf3}.field{height:35px;border-color:#e1e7f0;border-radius:8px;font-size:12px;color:#334155;background:#fff}.field::placeholder{color:#99a3b4}.tools [data-filter="search"]{flex:1 1 200px;max-width:480px}.tools select{width:116px}.tools .optional{width:78px}.tools .count{margin-left:auto;font-size:11px;color:#63738c;background:#edf2fa;border-radius:7px;padding:6px 9px}.toggle{font-size:12px;gap:7px;color:#53647c}.toggle input{accent-color:#2563eb;width:15px;height:15px;flex:0 0 15px;cursor:pointer}
        .body{grid-template-columns:minmax(0,1fr) 280px}.grid-wrap{padding:18px;background:#f1f4f9}.grid{grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:14px}.card{border:1px solid #e0e6ef;border-radius:12px;box-shadow:0 2px 4px #17233805;transition:border-color .15s,box-shadow .15s}.card:hover{border-color:#a8bfe4;box-shadow:0 5px 15px #20385812}.card.selected{border-color:#3978f4;box-shadow:0 0 0 2px #3978f426}.thumb{height:164px;background:#edf1f6}.check{width:23px;height:23px;left:9px;top:9px;border-radius:7px;font-size:12px;box-shadow:0 1px 4px #16243b14;background:#fffffff0}.selected .check{color:white;background:#2563eb;border-color:#2563eb}.badge{top:10px;right:9px;border-radius:5px;padding:2px 6px;background:#23324bc9;font-size:9px;letter-spacing:.2px}.info{padding:11px 10px 12px}.name{font-size:12px;font-weight:600;line-height:20px;text-overflow:ellipsis;color:#26354c}.meta{font-size:10px;color:#8a96a8;margin-top:6px;gap:7px}.source{font-size:10px;color:#6884b4;margin-top:7px}.source:hover{color:#2563eb}
        .side{background:#fff;padding:18px 16px;border-color:#e4eaf2}.section{margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid #eef1f6}.section:last-child{border-bottom:0}.section h3{font-size:12px;font-weight:650;color:#27374e;margin-bottom:12px}.label{font-size:11px;color:#7c899b;margin:10px 0 5px}.side input:not([type="checkbox"]),.side select,.side textarea{border-color:#e1e7f0;border-radius:8px;font-size:12px;padding:8px 10px}.side input[type="checkbox"]{width:15px;padding:0}.side textarea{height:66px}.hint{font-size:10px;line-height:1.8;color:#95a0b1;overflow-wrap:anywhere}.folder-row{align-items:center}.folder-row select{flex:1}.side [data-role="frames"]{max-height:130px;overflow:auto}
        .footer{padding:14px 20px;gap:14px;border-color:#e4eaf2;box-shadow:0 -4px 16px #20385804}.footer .primary{min-width:140px;min-height:38px;font-size:13px;border-radius:10px}.footer .toggle{padding:8px 11px;border-radius:8px;background:#f3f6fb}.status{font-size:11px;color:#7b899c;max-width:48%;min-width:0}.progress{width:110px;height:4px;background:#edf1f7}.progress>i{transition:width .2s}.grid-wrap,.side{scrollbar-width:thin;scrollbar-color:#c9d3e2 transparent}.toast{font-family:"Source Han Sans CN","思源黑体 CN",system-ui,sans-serif}
        @media(max-width:1100px){.top{flex-wrap:wrap;padding:14px 16px}.top .sub{display:none}.body{grid-template-columns:minmax(0,1fr) 240px}.grid-wrap{padding:12px}.grid{gap:10px;grid-template-columns:repeat(auto-fill,minmax(155px,1fr))}.thumb{height:145px}.tools{padding:10px 14px}.tools .optional{display:block}.side{padding:14px 12px}.footer{gap:8px;padding:12px 14px}.progress{width:60px}}
        @media(max-width:720px){.panel{width:98vw;height:97vh;border-radius:12px}.body{grid-template-columns:minmax(0,1fr) 210px}.top .btn:not(.close){padding:5px 8px;font-size:11px}.top{gap:7px}.tools .optional{width:70px}.tools [data-filter="search"]{max-width:none;flex-basis:100%}.grid{grid-template-columns:repeat(auto-fill,minmax(135px,1fr))}.footer{flex-wrap:wrap}.status{max-width:100%;flex-basis:100%}.thumb{height:130px}}
        @media(prefers-reduced-motion:reduce){.btn,.card,.progress>i{transition:none}.loading{animation:none}}
        .card .check,.card .badge{visibility:hidden;pointer-events:none}
        .card:hover .check,.card:hover .badge,.card:focus-within .check,.card:focus-within .badge{visibility:visible}
        .card.selected .check{visibility:visible}
        [data-order-key][data-drop-edge]::after{content:"";position:absolute;left:0;right:0;height:3px;background:#2563eb;box-shadow:0 0 0 1px #fff,0 0 8px #2563eb55;pointer-events:none;z-index:5;border-radius:2px}
        [data-order-key][data-drop-edge="before"]::after{top:0}
        [data-order-key][data-drop-edge="after"]::after{bottom:0}
      </style>
      <div class="mask">
        <div class="panel">
          <div class="top">
            <img class="logo" src="../icons/icon128.png" alt=""><div><div class="title">图片批量采集</div><div class="sub">发现素材 · 选取原图 · 有序保存</div></div>
            <div class="spacer"></div>
            <button class="btn" data-action="rescan">重新扫描</button>
            <button class="btn" data-action="autoscroll">瀑布流自动滚动</button>
            <button class="btn" data-action="detect">检测真实类型</button>
            <button class="btn close" data-action="close">×</button>
          </div>
          <div class="tools">
            <select class="field" data-filter="category"><option value="all">全部分类</option><option value="selected">已选图片</option><option>主图</option><option>详情图</option><option>SKU图</option><option>其他</option></select><button class="btn" data-action="selectMain">全选主图</button><button class="btn" data-action="selectDetail">全选详情图</button><button class="btn" data-action="selectSku">全选SKU图</button><input class="field" data-filter="search" placeholder="搜索标题、来源、网址、站点规则">
            <select class="field" data-filter="type"><option value="all">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select>
            <select class="field" data-filter="format" aria-label="图片格式"><option value="all">全部图片格式</option><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option><option value="gif">GIF</option><option value="svg">SVG</option><option value="avif">AVIF</option><option value="bmp">BMP</option><option value="ico">ICO</option><option value="tiff">TIFF</option><option value="unknown">未知格式</option></select>
            <input class="field optional" data-filter="minWidth" type="number" min="0" placeholder="最小宽">
            <input class="field optional" data-filter="minHeight" type="number" min="0" placeholder="最小高">
            <input class="field optional" data-filter="maxWidth" type="number" min="0" placeholder="最大宽">
            <input class="field optional" data-filter="maxHeight" type="number" min="0" placeholder="最大高">
            <label class="toggle"><input type="checkbox" data-setting="boardMode"> 画板模式</label>
            <button class="btn" data-action="selectVisible">选择筛选结果</button>
            <span class="count" data-role="count">0 项</span>
          </div>
          <div class="body">
            <div class="grid-wrap"><div class="grid" data-role="grid"></div></div>
            <aside class="side">
              <div class="section"><h3>导入信息</h3>
                <label class="label">公共标签（逗号分隔）</label><input data-meta="tags" placeholder="电商, 参考图, 灵感">
                <label class="label">注释 / 备注</label><textarea data-meta="notes" placeholder="为这批素材添加备注"></textarea>
                <label class="label">素材库 / 文件夹</label><div class="folder-row"><select data-meta="folder"><option value="">Billfish 当前文件夹</option><option value="browser">浏览器按分类下载</option></select><button class="btn" data-action="folders">刷新</button></div>
                <label class="toggle" style="margin-top:10px"><input type="checkbox" data-meta="antiHotlink" checked> 图片加载失败时自动重试</label>
                <div class="hint">自动保留素材标题和来源链接，同名文件自动编号。</div>
              </div>
              <div class="section"><h3>选择操作</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><button class="btn" data-action="selectAll">全选当前结果</button><button class="btn" data-action="selectNone">全不选</button><button class="btn" data-action="invert">反选</button><button class="btn danger" data-action="removeUnselected">移除未选</button></div>
                <div class="hint">点击图片选择；按住 Shift 点击另一张，可连续选中两张之间的图片。也可在空白处拖出矩形框选。视频缩略图悬停时自动静音预览。</div>
              </div>
              <div class="section" data-role="stitch-section" hidden><h3>长图预览 · 拖动调整顺序</h3><div class="hint">按序号上下拼接，等比统一宽度，无间距。仅支持图片。</div><div data-role="stitch-preview" style="margin-top:8px"></div></div><div class="section"><h3>扫描范围</h3><div class="hint" data-role="frames">尚未扫描</div></div>
            </aside>
          </div>
          <div class="footer">
            <span class="status" data-role="status">准备就绪</span><div class="spacer"></div><div class="progress"><i data-role="progress"></i></div>
            <label class="toggle"><input type="checkbox" data-setting="stitch"> 拼成长图</label><button class="btn primary" data-action="import" disabled>请先选择素材</button>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    state.host = host;
    state.root = root;
    bindUI();
  }

  function closeUI() {
    state.host?.remove();
    state.host = null;
    state.root = null;
    state.open = false;
    state.selectionAnchor = null;
    state.manualOrder = false;
  }

  function toast(message, duration = 2600) {
    // A save notification must never initialize or reopen the collector panel.
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = String(message || "");
    let standaloneHost = null;
    if (state.host?.isConnected && state.root) {
      state.root.appendChild(node);
    } else {
      standaloneHost = document.createElement("div");
      standaloneHost.setAttribute("data-bf-v14", "notification");
      const root = standaloneHost.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = ':host{all:initial;position:fixed;right:22px;top:22px;z-index:2147483647;pointer-events:none}.toast{box-sizing:border-box;max-width:380px;padding:10px 14px;border-radius:8px;background:#111827;color:#fff;font:13px/1.5 "Source Han Sans CN","思源黑体 CN",system-ui,sans-serif;box-shadow:0 10px 35px rgba(0,0,0,.25);overflow-wrap:anywhere}';
      root.appendChild(style);
      root.appendChild(node);
      document.documentElement.appendChild(standaloneHost);
    }
    setTimeout(() => { node.remove(); standaloneHost?.remove(); }, duration);
  }

  function setStatus(message) {
    const node = state.root?.querySelector('[data-role="status"]');
    if (node) node.textContent = String(message || "");
  }

  function setProgress(done, total) {
    const bar = state.root?.querySelector('[data-role="progress"]');
    if (bar) bar.style.width = total ? `${Math.min(100, (done / total) * 100)}%` : "0%";
  }

  function imageFormat(item) {
    const normalize = value => {
      const name = String(value || "").toLowerCase().replace(/^image\//, "").replace(/^\./, "");
      return ({ jpeg: "jpg", pjpeg: "jpg", "svg+xml": "svg", tif: "tiff", "x-icon": "ico", "vnd.microsoft.icon": "ico" })[name] || name;
    };
    const detected = normalize(item.detected?.ext || item.detected?.mime);
    if (detected) return detected;
    const src = item.src || item.originalSrc || "";
    if (/^data:image\//i.test(src)) return normalize(src.match(/^data:([^;,]+)/i)?.[1]);
    try {
      const url = new URL(src);
      const extension = url.pathname.match(/\.(jpg|jpeg|png|webp|gif|svg|avif|bmp|ico|tiff|tif)$/i)?.[1];
      return normalize(extension || url.searchParams.get("format") || "unknown");
    } catch (_) { return "unknown"; }
  }

  function applyFilters() {
    const f = state.filters;
    const query = f.search.toLowerCase();
    state.filtered = state.items.filter((item) => {
      if (f.category === "selected") return item.selected;
      if (f.category !== "all" && (item.category || "其他") !== f.category) return false;
      if (f.type !== "all" && item.type !== f.type) return false;
      if (f.format && f.format !== "all" && (item.type !== "image" || imageFormat(item) !== f.format)) return false;
      if (f.minWidth && item.width < f.minWidth) return false;
      if (f.minHeight && item.height < f.minHeight) return false;
      if (f.maxWidth && item.width > f.maxWidth) return false;
      if (f.maxHeight && item.height > f.maxHeight) return false;
      if (query) {
        const haystack = [item.title, item.sourceLink, item.pageUrl, item.frameUrl, item.adapter, item.enhanceRule, ...(item.tags || [])].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    const cards = state.root?.querySelectorAll('[data-role="grid"] .card');
    const itemsByKey = new Map(state.items.map(item => [item.key, item]));
    if (productDownloadMode && cards?.length === state.items.length &&
        [...cards].every(card => itemsByKey.has(card.dataset.key))) {
      const visibleKeys = new Set(state.filtered.map(item => item.key));
      cards.forEach(card => {
        const item = itemsByKey.get(card.dataset.key);
        card.classList.toggle('selected', item.selected);
        card.classList.toggle('filtered-out', !visibleKeys.has(item.key));
      });
      updateCountOnly();
    } else {
      renderGrid();
    }
  }

  function displaySource(item) {
    const value = item.sourceLink || item.pageUrl || item.frameUrl || "";
    try { return new URL(value).hostname; } catch (_) { return value || "未知来源"; }
  }

  function renderMedia(item) {
    const src = item.previewData || item.src || item.originalSrc;
    if (item.type === "video") {
      return `<video muted loop playsinline preload="metadata" data-preview-key="${escapeHtml(item.key)}" src="${escapeHtml(src)}"></video>`;
    }
    if (item.type === "audio") {
      return `<div class="media-icon">♫</div><audio controls preload="none" src="${escapeHtml(src)}"></audio>`;
    }
    return `<img loading="lazy" referrerpolicy="no-referrer" data-preview-key="${escapeHtml(item.key)}" src="${escapeHtml(src)}" alt="">`;
  }

  function renderGrid() {
    if (!state.root) return;
    const grid = state.root.querySelector('[data-role="grid"]');
    if (!grid) return;
    const visibleKeys = new Set(state.filtered.map((item) => item.key));
    const selectedCount = state.items.filter((item) => item.selected).length;
    const countNode = state.root.querySelector('[data-role="count"]');
    if (countNode) countNode.textContent = `${state.filtered.length}/${state.items.length} 项 · 已选 ${selectedCount}`;
    updateCountOnly();
    if (!state.items.length) {
      grid.innerHTML = `<div class="empty ${state.scanning ? "loading" : ""}">${state.scanning ? "正在扫描当前页面及各个 frame…" : "没有发现可采集资源"}</div>`;
      return;
    }
    let previousCategory = null;
    const displayItems = productDownloadMode
      ? [...state.items].sort((a,b) => ['主图','视频','SKU图','详情图'].indexOf(a.category) - ['主图','视频','SKU图','详情图'].indexOf(b.category))
      : state.items;
    grid.innerHTML = displayItems.map((item) => {
      let heading = '';
      if (productDownloadMode && visibleKeys.has(item.key) && previousCategory !== item.category) {
        previousCategory = item.category;
        heading = '<div style="grid-column:1 / -1;font-size:14px;font-weight:700;padding:12px 0 2px">' + escapeHtml(item.category) + '</div>';
      }
      const classes = ["card", item.selected ? "selected" : "", visibleKeys.has(item.key) ? "" : "filtered-out"].filter(Boolean).join(" ");
      const dimension = item.width || item.height ? `${item.width || "?"}×${item.height || "?"}` : "尺寸未知";
      const rule = item.enhanceRule || item.adapter || item.type;
      return heading + `<article class="${classes}" data-key="${escapeHtml(item.key)}">
        <div class="thumb">${renderMedia(item)}<span class="check">${item.selected ? "✓" : ""}</span><span class="badge">${escapeHtml(rule)}</span></div>
        <div class="info"><input class="name" data-title-key="${escapeHtml(item.key)}" value="${escapeHtml(item.title)}" title="编辑素材标题">
          <div class="meta"><span>${escapeHtml(item.type)}</span><span>${escapeHtml(dimension)}</span><span>${escapeHtml(displaySource(item))}</span>${item.detected?.ext ? `<span>${escapeHtml(item.detected.ext)}</span>` : ""}</div>
          <a class="source" href="${escapeHtml(item.sourceLink || item.pageUrl || item.src)}" target="_blank" rel="noopener" title="${escapeHtml(item.sourceLink || item.pageUrl || item.src)}">${escapeHtml(item.sourceLink || item.pageUrl || item.src)}</a>
        </div></article>`;
    }).join("");
    bindCardEvents(grid);
    updateCountOnly();
  }

  function findItem(key) {
    return state.items.find((item) => item.key === key);
  }

  function selectCard(item, shiftKey) {
    const anchorIndex = state.filtered.findIndex(value => value.key === state.selectionAnchor);
    const targetIndex = state.filtered.findIndex(value => value.key === item.key);
    if (shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      state.filtered.slice(start, end + 1).forEach(value => { value.selected = true; });
    } else {
      item.selected = !item.selected;
      state.selectionAnchor = item.key;
    }
  }

  function bindCardEvents(grid) {
    grid.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("input,a,video,audio")) return;
        const item = findItem(card.dataset.key);
        if (!item) return;
        selectCard(item, event.shiftKey);
        if (event.shiftKey) return renderGrid();
        card.classList.toggle("selected", item.selected);
        card.querySelector(".check").textContent = item.selected ? "✓" : "";
        updateCountOnly();
      });
    });
    grid.querySelectorAll("input[data-title-key]").forEach((input) => {
      input.addEventListener("input", () => {
        const item = findItem(input.dataset.titleKey);
        if (item) { item.title = input.value.trim() || "未命名素材"; item.titleEdited = true; }
      });
    });
    grid.querySelectorAll("video").forEach((video) => {
      video.addEventListener("mouseenter", () => video.play().catch(() => {}));
      video.addEventListener("mouseleave", () => { video.pause(); try { video.currentTime = 0; } catch (_) {} });
      video.addEventListener("error", () => loadPreview(video));
    });
    grid.querySelectorAll("img[data-preview-key]").forEach((image) => {
      const updateDimensions = () => {
        const item = findItem(image.dataset.previewKey);
        if (!item || !image.naturalWidth || !image.naturalHeight) return;
        item.width = image.naturalWidth;
        item.height = image.naturalHeight;
        item.dimensionsResolved = true;
        const dimensions = image.closest(".card")?.querySelector(".meta span:nth-child(2)");
        if (dimensions) dimensions.textContent = `${item.width}×${item.height}`;
      };
      image.addEventListener("load", updateDimensions);
      if (image.complete) updateDimensions();
      image.addEventListener("error", () => loadPreview(image), { once: true });
    });
  }

  async function loadPreview(node) {
    const key = node.dataset.previewKey;
    const item = findItem(key);
    if (!item || state.previewLoading.has(key) || item.previewData || !/^https?:/i.test(item.originalSrc || item.src)) return;
    state.previewLoading.add(key);
    node.classList.add("loading");
    try {
      const response = await send({ type: "BFV14_PREVIEW", url: item.src || item.originalSrc, pageUrl: item.pageUrl || item.sourceLink, antiHotlink: true });
      if (response?.dataUrl) {
        item.previewData = response.dataUrl;
        node.src = response.dataUrl;
      }
    } catch (_) {
    } finally {
      state.previewLoading.delete(key);
      node.classList.remove("loading");
    }
  }

  function updateCountOnly() {
    if (productDownloadMode) syncProductChoices?.();
    for (const [action, category] of Object.entries({selectMain:"主图", selectDetail:"详情图", selectSku:"SKU图"})) {
      const items = state.items.filter(item => item.type === "image" && item.category === category);
      const count = items.filter(item => item.selected).length;
      const toggle = state.root?.querySelector('[data-action="' + action + '"]');
      if (toggle) {
        toggle.setAttribute("aria-pressed", String(items.length > 0 && count === items.length));
        toggle.style.background = count ? "#dbeafe" : "";
        toggle.style.borderColor = count ? "#2563eb" : "";
        toggle.style.color = count ? "#1d4ed8" : "";
        toggle.disabled = !items.length;
        toggle.textContent = (count === items.length && count ? "✓ " : count ? "− " : "") + "全选" + category;
      }
    }
    const selected = state.items.filter((item) => item.selected);
    const countNode = state.root?.querySelector('[data-role="count"]');
    if (countNode) countNode.textContent = `${state.filtered.length}/${state.items.length} 项 · 已选 ${selected.length}`;
    const button = state.root?.querySelector('[data-action="import"]');
    if (button) {
      button.disabled = state.saving || !selected.length || (state.stitch && selected.some(item => item.type !== "image"));
      button.textContent = state.saving ? "正在保存…" : !selected.length ? "请先选择素材" : state.stitch ? "保存 1 张长图" : `保存 ${selected.length} 个素材`;
    }
    state.root?.querySelector('[data-role="stitch-section"]')?.toggleAttribute("hidden", !state.stitch);
    const preview = state.root?.querySelector('[data-role="stitch-preview"]');
    if (preview) {
      preview.innerHTML = state.stitch ? selected.map((item, index) => `<div draggable="true" data-order-key="${escapeHtml(item.key)}" style="cursor:grab;position:relative"><span style="position:absolute;background:#2563eb;color:white;padding:2px 6px">${index + 1}</span><img draggable="false" src="${escapeHtml(item.previewData || item.src)}" style="width:100%;display:block" alt="${escapeHtml(item.title)}"></div>`).join("") : "";
      const clearDrop = () => preview.querySelectorAll('[data-order-key]').forEach(element => element.removeAttribute("data-drop-edge"));
      preview.querySelectorAll('[data-order-key]').forEach(node => {
        node.addEventListener("dragstart", event => {
          if (state.saving) { event.preventDefault(); return; }
          state.dragKey = node.dataset.orderKey;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", state.dragKey);
        });
        node.addEventListener("dragover", event => {
          if (!state.dragKey || state.saving) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          clearDrop();
          if (node.dataset.orderKey === state.dragKey) return;
          const rect = node.getBoundingClientRect();
          node.dataset.dropEdge = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        });
        node.addEventListener("dragleave", event => {
          if (!node.contains(event.relatedTarget)) node.removeAttribute("data-drop-edge");
        });
        node.addEventListener("dragend", () => { clearDrop(); state.dragKey = null; });
        node.addEventListener("drop", event => {
          event.preventDefault();
          const edge = node.dataset.dropEdge;
          clearDrop();
          const key = state.dragKey;
          state.dragKey = null;
          if (state.saving || !edge || key === node.dataset.orderKey) return;
          const from = state.items.findIndex(item => item.key === key);
          const target = state.items.findIndex(item => item.key === node.dataset.orderKey);
          if (from < 0 || target < 0) return;
          const moved = state.items.splice(from, 1)[0];
          const to = state.items.findIndex(item => item.key === node.dataset.orderKey) + (edge === "after" ? 1 : 0);
          state.items.splice(to, 0, moved);
          state.manualOrder = true;
          applyFilters();
        });
      });
    }
    state.root?.querySelectorAll('.card').forEach(card => {
      const index = selected.findIndex(item => item.key === card.dataset.key);
      card.querySelector('.check').textContent = index < 0 ? "" : state.stitch ? String(index + 1) : "✓";
    });
  }

  function bindSelectionRectangle(grid) {
    let start = null;
    let rectNode = null;
    grid.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".card")) return;
      start = { x: event.clientX, y: event.clientY, additive: event.ctrlKey || event.metaKey || event.shiftKey };
      rectNode = document.createElement("div");
      rectNode.className = "select-rect";
      state.root.appendChild(rectNode);
      grid.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    grid.addEventListener("pointermove", (event) => {
      if (!start || !rectNode) return;
      const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
      const width = Math.abs(event.clientX - start.x), height = Math.abs(event.clientY - start.y);
      Object.assign(rectNode.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    });
    const finish = (event) => {
      if (!start || !rectNode) return;
      if (event.type === "pointercancel" || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) {
        rectNode.remove(); rectNode = null; start = null;
        try { grid.releasePointerCapture?.(event.pointerId); } catch (_) {}
        return;
      }
      const selection = rectNode.getBoundingClientRect();
      if (!start.additive) state.items.forEach((item) => { if (state.filtered.includes(item)) item.selected = false; });
      grid.querySelectorAll(".card:not(.filtered-out)").forEach((card) => {
        const r = card.getBoundingClientRect();
        const intersects = !(r.right < selection.left || r.left > selection.right || r.bottom < selection.top || r.top > selection.bottom);
        if (intersects) {
          const item = findItem(card.dataset.key);
          if (item) item.selected = true;
        }
      });
      rectNode.remove();
      rectNode = null;
      start = null;
      applyFilters();
      try { grid.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };
    grid.addEventListener("pointerup", finish);
    grid.addEventListener("pointercancel", finish);
  }

  function bindUI() {
    const root = state.root;
    root.querySelectorAll("[data-filter]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.filter;
        state.filters[key] = key === "category" || key === "search" || key === "type" || key === "format" ? input.value : Math.max(0, Number(input.value || 0));
        applyFilters();
      });
    });
    root.querySelector('[data-setting="boardMode"]').addEventListener("change", (event) => { state.boardMode = event.target.checked; });
    root.querySelector('[data-setting="stitch"]').checked = state.stitch;
    root.querySelector('[data-setting="stitch"]').addEventListener("change", event => {
      state.stitch = event.target.checked;
      if (state.stitch && state.items.some(item => item.selected && item.type !== "image")) toast("长图仅支持图片，请取消选择视频或音频");
      updateCountOnly();
    });
    root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
    bindSelectionRectangle(root.querySelector('[data-role="grid"]'));
  }

  async function handleAction(action) {
    if (action === "close") return closeUI();
    if (action === "rescan") return scan(false);
    if (action === "autoscroll") return autoScrollScan();
    if (action === "detect") return detectTypes();
    if (action === "folders") return loadFolders();
    if (action === "import") return importSelected();
    if (["selectMain", "selectDetail", "selectSku"].includes(action)) {
      const category = {selectMain:"主图", selectDetail:"详情图", selectSku:"SKU图"}[action];
      const items = state.items.filter(item => item.type === "image" && item.category === category);
      const selected = items.length > 0 && items.every(item => item.selected);
      items.forEach(item => { item.selected = !selected; });
      state.filters.category = "selected";
      state.root.querySelector('[data-filter="category"]').value = "selected";
      return applyFilters();
    }
    if (action === "selectAll") { state.filtered.forEach((item) => item.selected = true); return renderGrid(); }
    if (action === "selectNone") { state.selectionAnchor = null; state.items.forEach((item) => item.selected = false); return applyFilters(); }
    if (action === "invert") { state.items.forEach((item) => item.selected = !item.selected); return renderGrid(); }
    if (action === "selectVisible") { state.filtered.forEach((item) => item.selected = true); return renderGrid(); }
    if (action === "removeUnselected") { state.items = state.items.filter((item) => item.selected); return applyFilters(); }
  }

  async function scan(keepExisting = false) {
    if (state.scanning || state.autoScrolling) return;
    state.scanning = true;
    setStatus("正在扫描顶层页面、跨域/同域 frame 与开放式 Shadow DOM…");
    renderGrid();
    try {
      const response = await send({ type: "BFV14_SCAN_ALL", options: { boardMode: state.boardMode, minWidth: 24, minHeight: 24 } });
      if (response?.error) throw new Error(response.error);
      mergeItems(response.items || [], !keepExisting);
      const frames = response.frames || [];
      const frameNode = state.root.querySelector('[data-role="frames"]');
      if (frameNode) frameNode.innerHTML = frames.map((frame) => `${escapeHtml(frame.url || `frame ${frame.frameId}`)}：${frame.count || 0}${frame.error ? "（未注入）" : ""}`).join("<br>") || "仅顶层页面";
      setStatus(`扫描完成：发现 ${state.items.length} 个资源，来自 ${frames.length || 1} 个 frame`);
    } catch (error) {
      setStatus(`扫描失败：${error.message}`);
      toast(error.message);
    } finally {
      state.scanning = false;
      renderGrid();
    }
  }

  async function autoScrollScan(initial = false) {
    const button = state.root.querySelector('[data-action="autoscroll"]');
    if (state.autoScrolling) {
      if (button) button.disabled = true;
      setStatus("正在停止自动滚动…");
      await send({ type: "BFV14_STOP_AUTOSCROLL" }).catch(() => {});
      return;
    }
    if (state.scanning) return;
    state.autoScrolling = true;
    if (button) button.textContent = "停止自动滚动";
    setStatus("正在自动滚动瀑布流并持续收集新资源…");
    let canContinue = false;
    try {
      const response = await send({ type: "BFV14_AUTOSCROLL_TOP", options: { initial, boardMode: state.boardMode, delay: 450, stableRounds: 5, maxRounds: 100 } }, 120000);
      if (response?.error) throw new Error(response.error);
      mergeItems(response.items || [], initial);
      canContinue = !response.autoScroll?.complete;
      setStatus(canContinue
        ? `扫描已暂停，已发现 ${state.items.length} 个资源。可点击「继续扫描」。`
        : `自动滚动完成：共发现 ${state.items.length} 个资源`);
    } catch (error) {
      setStatus(`自动滚动失败：${error.message}`);
      toast(error.message);
    } finally {
      state.autoScrolling = false;
      const currentButton = state.root?.querySelector('[data-action="autoscroll"]');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = canContinue ? "继续扫描" : "瀑布流自动滚动";
      }
    }
  }

  async function detectTypes() {
    const targets = state.filtered.slice(0, 300);
    if (!targets.length) return toast("当前筛选结果为空");
    setStatus(`正在检测 ${targets.length} 个资源的真实文件类型…`);
    try {
      const response = await send({ type: "BFV14_DETECT_TYPES", items: targets.map((item) => ({ key: item.key, src: item.src, originalSrc: item.originalSrc, candidates: item.candidates, type: item.type, pageUrl: item.pageUrl, sourceLink: item.sourceLink })) });
      if (response?.error) throw new Error(response.error);
      for (const result of response || []) {
        const item = findItem(result.key);
        if (!item) continue;
        item.detected = result.detected;
        if (result.detected?.type) item.type = result.detected.type;
        if (result.url) item.src = result.url;
      }
      applyFilters();
      setStatus("真实类型检测完成");
    } catch (error) {
      setStatus(`类型检测失败：${error.message}`);
    }
  }

  function flattenFolders(data) {
    const output = [];
    const visited = new WeakSet();
    function walk(value, path = [], library = {}) {
      if (!value || typeof value !== "object") return;
      if (visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, path, library));
        return;
      }
      const name = value.name || value.title || value.folderName || value.libraryName || value.label || "";
      const id = value.id ?? value.folderId ?? value.uuid ?? value.key ?? "";
      const isLibrary = Boolean(value.libraryId || value.libId || /library|素材库/i.test(String(value.type || ""))) || Boolean(value.folders && !value.folderId);
      const nextLibrary = isLibrary ? { library: name || library.library || "", libraryId: value.libraryId || value.libId || id || library.libraryId || "", libId: value.libId || value.libraryId || id || library.libId || "" } : library;
      const childrenKeys = ["children", "folders", "items", "data", "list", "nodes", "libraries"];
      const hasChildren = childrenKeys.some((key) => Array.isArray(value[key]) && value[key].length);
      if (name && id !== "" && !isLibrary) {
        output.push({ label: [...path, name].filter(Boolean).join(" / "), folder: name, folderId: String(id), ...nextLibrary });
      }
      const nextPath = name ? [...path, name] : path;
      for (const key of childrenKeys) if (value[key] && typeof value[key] === "object") walk(value[key], nextPath, nextLibrary);
      if (!hasChildren) {
        for (const [key, child] of Object.entries(value)) {
          if (childrenKeys.includes(key)) continue;
          if (child && typeof child === "object") walk(child, nextPath, nextLibrary);
        }
      }
    }
    walk(data);
    return output.filter((item, index, array) => array.findIndex((x) => `${x.libraryId}|${x.folderId}` === `${item.libraryId}|${item.folderId}`) === index);
  }

  async function loadFolders() {
    setStatus("正在读取 Billfish 素材库与文件夹…");
    try {
      const response = await send({ type: "BFV14_GET_FOLDERS" });
      if (response?.error) throw new Error(response.error);
      if (response.destination === "browser") { await refreshCurrentFolder(); setStatus("未检测到 Billfish，将下载到浏览器默认下载文件夹"); return; }
      const folders = flattenFolders(response.folders);
      const select = state.root.querySelector('[data-meta="folder"]');
      select.innerHTML = `<option value="">Billfish 当前文件夹</option><option value="browser">浏览器按分类下载</option>` + folders.map((folder, index) => `<option value="${index}">${escapeHtml(folder.label || folder.folder)}</option>`).join("");
      state.folderMeta = Object.fromEntries(folders.map((folder, index) => [String(index), folder]));
      refreshCurrentFolder();
      setStatus(`已读取 ${folders.length} 个文件夹`);
    } catch (error) {
      setStatus(`读取文件夹失败：${error.message}`);
      toast(error.message);
    }
  }

  async function refreshCurrentFolder() {
    const response = await send({ type: "BFV14_GET_CURRENT_FOLDER" }, 3500).catch(() => null);
    const current = response?.currentFolder || null;
    state.destination = response?.destination || "billfish";
    const option = state.root?.querySelector('[data-meta="folder"] option[value=""]');
    if (option) option.textContent = state.destination === "browser" ? "浏览器默认下载文件夹" : current ? `当前文件夹：${[current.library, current.folder].filter(Boolean).join(" / ")}` : "默认位置（沿用原保存方式）";
    const folderSelect = state.root?.querySelector('[data-meta="folder"]');
    if (folderSelect) folderSelect.disabled = false;
    return current || {};
  }

  async function encodeLongImage(canvas, mime, quality) {
    const limit = 48000000;
    if (!canvas.toBlob) {
      const value = canvas.toDataURL(mime, quality);
      return value.startsWith(`data:${mime}`) && value.length <= limit ? value : "";
    }
    const blob = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("长图编码超时，请重试")), 30000);
      try { canvas.toBlob(value => { clearTimeout(timer); resolve(value); }, mime, quality); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
    // Check encoded byte size before allocating the much larger Base64 string.
    if (!blob || blob.type !== mime || 4 * Math.ceil(blob.size / 3) + 32 > limit) return "";
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("长图编码读取失败，请重试"));
      reader.readAsDataURL(blob);
    });
  }

  async function stitchImages(items) {
    const images = [];
    let canvas;
    try {
      for (let index = 0; index < items.length; index++) {
        setStatus(`正在读取拼接图片 ${index + 1}/${items.length}…`);
        const item = items[index];
        const response = await send({ type: "BFV14_STITCH_SOURCE", item: { src: item.src, originalSrc: item.originalSrc, candidates: item.candidates, type: item.type, pageUrl: item.pageUrl, sourceLink: item.sourceLink } });
        if (!response?.dataUrl) throw new Error(`第 ${index + 1} 张读取失败，请重试：${response?.error || item.title}`);
        const image = new Image();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { image.src = ""; reject(new Error(`第 ${index + 1} 张解码超时`)); }, 20000);
          image.onload = () => { clearTimeout(timer); resolve(); };
          image.onerror = () => { clearTimeout(timer); reject(new Error(`第 ${index + 1} 张无法拼接，请重试`)); };
          image.src = response.dataUrl;
        });
        images.push(image);
      }
      const originalWidth = images.reduce((min, image) => Math.min(min, image.naturalWidth), Infinity);
      const originalHeight = images.reduce((sum, image) => sum + image.naturalHeight * originalWidth / image.naturalWidth, 0);
      if (!originalWidth || !Number.isFinite(originalHeight) || images.length > 32760) throw new Error("图片数量或尺寸异常，无法生成长图");
      const scale = Math.min(1, 32760 / originalWidth, 32760 / originalHeight, Math.sqrt(64000000 / (originalWidth * originalHeight)));
      let width = Math.max(1, Math.floor(originalWidth * scale));
      canvas = document.createElement("canvas");
      for (let attempt = 0; attempt < 5; attempt++) {
        let heights = images.map(image => Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth)));
        let height = heights.reduce((sum, value) => sum + value, 0);
        while (height > 32767 || width * height > 64000000) {
          if (width <= 1) throw new Error("长图超出浏览器尺寸限制，请分批拼接");
          width = Math.max(1, Math.floor(width * .95));
          heights = images.map(image => Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth)));
          height = heights.reduce((sum, value) => sum + value, 0);
        }
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建长图，请减少图片后重试");
        let y = 0;
        images.forEach((image, index) => { context.drawImage(image, 0, y, width, heights[index]); y += heights[index]; });
        setStatus(attempt ? "正在自动缩小长图以适配保存…" : "图片读取完成，正在生成长图…");
        await new Promise(resolve => setTimeout(resolve, 0));
        let src = attempt === 0 ? await encodeLongImage(canvas, "image/png") : "";
        if (!src) {
          setStatus("长图较大，正在自动压缩为 JPG…");
          context.globalCompositeOperation = "destination-over";
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);
          context.globalCompositeOperation = "source-over";
          for (const quality of [.94, .88, .80]) {
            src = await encodeLongImage(canvas, "image/jpeg", quality);
            if (src) break;
          }
        }
        if (src) {
          const optimization = [src.startsWith("data:image/jpeg") ? "已自动压缩为 JPG" : "", width < originalWidth ? `已等比缩小至 ${width} 像素宽` : ""].filter(Boolean).join("，");
          return { type: "image", src, width, height, optimization, title: `${items[0].title || document.title}_长图`, sourceLink: items[0].sourceLink || location.href, pageUrl: location.href };
        }
        if (width <= 1) break;
        width = Math.max(1, Math.floor(width * .8));
      }
      throw new Error("长图自动压缩后仍超出浏览器限制，请分批拼接");
    } finally {
      images.forEach(image => { image.src = ""; });
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }

  async function importSelected() {
    const selected = state.items.filter((item) => item.selected);
    if (state.saving) return;
    if (state.stitch && selected.some(item => item.type !== "image")) return toast("长图仅支持图片，请取消选择视频或音频");
    if (!selected.length) return toast("请先选择要导入的素材");
    const tags = state.root.querySelector('[data-meta="tags"]').value;
    const notes = state.root.querySelector('[data-meta="notes"]').value;
    const folderValue = state.root.querySelector('[data-meta="folder"]').value;
    const folder = state.folderMeta[folderValue] || {};
    const antiHotlink = state.root.querySelector('[data-meta="antiHotlink"]').checked;
    setStatus("正在准备保存…");
    setProgress(0, selected.length);
    state.saving = true;
    updateCountOnly();
    try {
      let output = selected;
      if (state.stitch) output = [await stitchImages(selected)];
      setStatus(state.stitch ? "长图已生成，正在确认保存位置…" : "正在确认保存位置…");
      let targetFolder = folder;
      if (!folderValue) targetFolder = await refreshCurrentFolder();
      state.destination = folderValue === "browser" ? "browser" : "billfish";
      let response;
      const meta = { downloadByCategory: true, destination: state.destination, tags, notes, antiHotlink, ...targetFolder };
      if (state.stitch) {
        // Keep every runtime message small; never serialize a full long image three times.
        const image = output[0];
        const token = `stitch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const chunkSize = 512 * 1024;
        try {
          for (let offset = 0; offset < image.src.length; offset += chunkSize) {
            setStatus(`正在传送长图 ${Math.min(100, Math.round((offset + chunkSize) / image.src.length * 100))}%…`);
            const ack = await send({ type: "BFV14_STITCH_CHUNK", token, offset, total: image.src.length, chunk: image.src.slice(offset, offset + chunkSize) }, 10000);
            if (!ack?.ok) throw new Error(ack?.error || "长图传送失败，请重试");
          }
          const { src, ...info } = image;
          setStatus(state.destination === "browser" ? "正在下载 1 张长图…" : "正在提交 1 张长图到 Billfish…");
          response = await send({ type: "BFV14_IMPORT_STITCH", token, item: info, meta }, 60000);
        } finally {
          send({ type: "BFV14_STITCH_DISCARD", token }, 3000).catch(() => {});
        }
      } else {
        setStatus(state.destination === "browser" ? `正在下载 ${output.length} 个素材…` : `正在提交 ${output.length} 个素材到 Billfish…`);
        response = await send({ type: "BFV14_IMPORT", items: output.map(item => ({ ...item, previewData: undefined })), meta }, Math.max(60000, Math.ceil(output.length / 4) * 45000));
      }
      if (response?.error) throw new Error(response.error);
      if (response?.failed) throw new Error(response.failures?.[0]?.error || `保存失败 ${response.failed} 个素材`);
      setProgress(selected.length, selected.length);
      const optimization = output[0]?.optimization ? `（${output[0].optimization}）` : "";
      if (response.destination === "browser") {
        setStatus(`已开始下载 ${response.downloaded || 0} 个文件到浏览器默认下载文件夹${optimization}，请在下载记录中查看进度`);
        toast(`已开始下载 ${response.downloaded || 0} 个文件`);
      } else {
        setStatus(`导入任务完成：成功 ${response.imported || 0}，失败 ${response.failed || 0}${optimization}`);
        toast(`已提交 ${response.imported || 0} 个素材到 Billfish`);
      }
    } catch (error) {
      setStatus(`保存失败：${error.message}`);
      toast(error.message, 4200);
    } finally {
      state.saving = false;
      updateCountOnly();
    }
  }

  async function openUI() {
    if (productDownloadMode && state.host) closeUI();
    productDownloadMode = null;
    syncProductChoices = null;
    ensureUI();
    state.open = true;
    refreshCurrentFolder();
    if (state.autoScrolling) {
      const button = state.root.querySelector('[data-action="autoscroll"]');
      if (button) button.textContent = "停止自动滚动";
      setStatus("正在自动滚动并收集资源…");
      return;
    }
    if (state.scanning) return;
    state.items.forEach(item => item.selected = false);
    // Acknowledge the popup immediately so the user can interact with the collector.
    void autoScrollScan(true);
  }

  let productDownloadMode = null;
  let syncProductChoices = null;
  async function openProductDownload(product) {
    if (state.host) closeUI();
    ensureUI();
    state.open = true;
    productDownloadMode = product;
    state.root.querySelector('.title').textContent = '商品图片下载';
    state.root.querySelectorAll('[data-action="rescan"],[data-action="autoscroll"],[data-action="detect"]').forEach(button=>button.hidden=true);
    const groups = {'主图':'主图','主图视频':'视频','描述视频':'视频','SKU图':'SKU图','描述图':'详情图'};
    const items = [];
    for (const [source, category] of Object.entries(groups)) {
      (product.materials[source] || []).forEach((src,index) => items.push({src,type:category === '视频'?'video':'image',category,
        categoryOrder:index+1,skuName:product.skuNames?.[src],title:category === 'SKU图'?product.skuNames?.[src]:category+'_'+String(index+1).padStart(3,'0'),pageUrl:product.sourceUrl}));
    }
    mergeItems(items,true);
    state.items.forEach(item=>item.selected=true);
    state.filters.category='all';
    const tools = state.root.querySelector('.tools');
    tools.innerHTML='';
    state.root.querySelector('.side').style.display='none';
    state.root.querySelector('.body').style.gridTemplateColumns='minmax(0,1fr)';
    const choices = new Map();
    for (const [key,label] of Object.entries({main:'主图',video:'视频',sku:'SKU图片',detail:'详情图',stitch:'长图'})) {
      const wrapper=document.createElement('label');wrapper.className='btn';
      wrapper.style.cssText='display:inline-flex;align-items:center;justify-content:center;gap:6px;line-height:1;height:36px;box-sizing:border-box';
      const input=document.createElement('input');input.type='checkbox';input.checked=true;
      input.style.cssText='margin:0;width:14px;height:14px;flex:0 0 14px;vertical-align:middle';
      choices.set(key,input);wrapper.append(input,document.createTextNode(' '+label));tools.append(wrapper);
      input.onchange=()=>{
        const category={main:'主图',video:'视频',sku:'SKU图',detail:'详情图'}[key];
        if(category) state.items.filter(item=>item.category===category).forEach(item=>item.selected=input.checked);
        applyFilters();
      };
    }
    syncProductChoices=()=>{
      for(const [key,input] of choices) {
        const category={main:'主图',video:'视频',sku:'SKU图',detail:'详情图',stitch:'详情图'}[key];
        const items=state.items.filter(item=>item.category===category);
        input.disabled=!items.length;
        if(key==='stitch') {if(!items.length) input.checked=false;input.indeterminate=false;continue;}
        const count=items.filter(item=>item.selected).length;
        input.checked=items.length>0&&count===items.length;
        input.indeterminate=count>0&&count<items.length;
      }
    };
    for (const [checked,label] of [[true,'全选'],[false,'全不选']]) {
      const button=document.createElement('button');
      button.className='btn';button.textContent=label;
      button.onclick=()=>{
        choices.forEach(input=>{input.checked=checked&&!input.disabled;input.indeterminate=false;});
        state.items.forEach(item=>item.selected=checked);
        applyFilters();
      };
      tools.append(button);
    }
    const checkWords=document.createElement('button');
    checkWords.className='btn';checkWords.textContent='极限词查询';checkWords.style.marginLeft='auto';tools.append(checkWords);
    const wordResults=document.createElement('div');
    wordResults.style.cssText='display:none;padding:16px;width:340px;min-width:280px;max-width:40vw;overflow:auto;background:#fff;border-left:1px solid #dbe3ef;white-space:pre-wrap;font-size:13px;line-height:1.8;min-height:0';
    state.root.querySelector('.body').append(wordResults);
    checkWords.onclick=async()=>{
      const images=state.items.filter(item=>item.selected&&item.type==='image');
      if(!images.length)return toast('请先勾选需要检测的图片');
      checkWords.disabled=true;wordResults.style.display='block';state.root.querySelector('.body').style.gridTemplateColumns='minmax(0,1fr) minmax(280px,340px)';wordResults.textContent='图片文字与极限词检测\n正在识别…';
      const lines=[];
      const requestCheck=item=>send({type:'ETHAN_CHECK_IMAGE_WORDS',url:item.originalSrc||item.src},180000).catch(error=>({ok:false,message:error.message}));
      const pendingChecks=new Map();
      images.slice(0,2).forEach((item,index)=>pendingChecks.set(index,requestCheck(item)));
      try {
        for(let index=0;index<images.length;index++) {
          const item=images[index];checkWords.textContent='检测 '+(index+1)+'/'+images.length;
          const result=await pendingChecks.get(index);
          pendingChecks.delete(index);
          if(index+2<images.length)pendingChecks.set(index+2,requestCheck(images[index+2]));
          const words=result?.matches?.map(match=>match.word)||[];
          const entry=document.createElement('section');entry.style.cssText='margin-bottom:22px;overflow-wrap:anywhere';
          const title=document.createElement('div');title.style.cssText='font-weight:700;color:'+(!result?.ok?'#b45309':words.length?'#dc2626':'#15803d');title.textContent=item.title+'：'+(!result?.ok?'识别失败 '+(result?.message||'未知错误'):words.length?'命中 '+[...new Set(words)].join('、'):'未命中词库');entry.append(title);
          if(result?.text){
            const text=document.createElement('div');
            const raw=result.text,positions=[];let compact='',offsets=[];
            for(let i=0;i<raw.length;i++)if(!/\s/.test(raw[i])){compact+=raw[i];offsets.push(i);}
            for(const word of words){const needle=word.replace(/\s+/g,'');if(!needle)continue;let from=0,index;while((index=compact.indexOf(needle,from))>=0){positions.push([offsets[index],offsets[index+needle.length-1]+1]);from=index+1;}}
            const marked=new Set();positions.forEach(([a,b])=>{for(let i=a;i<b;i++)marked.add(i);});
            for(let i=0;i<raw.length;){const hit=marked.has(i);let end=i+1;while(end<raw.length&&marked.has(end)===hit)end++;const span=document.createElement('span');span.textContent=raw.slice(i,end);if(hit)span.style.cssText='color:#dc2626;font-weight:700;background:#fff1f2';text.append(span);i=end;}
            entry.append(text);
          }
          if(!lines.length)wordResults.replaceChildren();lines.push(entry);wordResults.append(entry);
          const card=state.root?.querySelector('[data-key="'+CSS.escape(item.key)+'"]');
          if(card){card.style.boxShadow=words.length?'0 0 0 2px #ef4444':'';card.title=result?.text||result?.message||'';}
        }
        setStatus('词库检测完成，命中项请结合图片语境核对');
      } finally {checkWords.disabled=false;checkWords.textContent='极限词查询';}
    };
    const previewStyle=document.createElement('style');previewStyle.textContent='.thumb{position:relative}.product-zoom{position:absolute;right:8px;bottom:8px;z-index:3;border:0;border-radius:6px;background:#ffffffed;font-size:22px;cursor:zoom-in;opacity:0}.thumb:hover .product-zoom,.product-zoom:focus{opacity:1}';state.root.append(previewStyle);
    const grid=state.root.querySelector('[data-role="grid"]');
    const addZoomButtons=()=>grid.querySelectorAll('.card').forEach(card=>{
      const item=findItem(card.dataset.key);if(item?.type!=='image'||card.querySelector('.product-zoom'))return;
      const button=document.createElement('button');button.className='product-zoom';button.textContent='⌕';button.title='查看原图';button.setAttribute('aria-label','查看原图');
      button.onclick=event=>{
        event.stopPropagation();const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;background:#000c;z-index:2147483647;display:flex;align-items:center;justify-content:center;cursor:zoom-out';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','原图预览');
        const image=document.createElement('img');image.src=item.originalSrc||item.src;image.style.cssText='max-width:96vw;max-height:96vh;object-fit:contain;cursor:default';image.onclick=event=>event.stopPropagation();overlay.append(image);
        const close=()=>{overlay.remove();document.removeEventListener('keydown',key);};const key=event=>{if(event.key==='Escape'){event.stopPropagation();close();}};overlay.onclick=close;document.addEventListener('keydown',key);state.root.append(overlay);
      };card.querySelector('.thumb').append(button);
    });
    const zoomObserver=new MutationObserver(addZoomButtons);zoomObserver.observe(grid,{childList:true});
    const footer=state.root.querySelector('.footer');
    const existing=state.root.querySelector('[data-action="import"]');
    existing.hidden=true;
    state.root.querySelector('[data-setting="stitch"]').parentElement.style.display='none';
    async function save(zip) {
      syncProductChoices();
      const kinds=Object.fromEntries([...choices].map(([key,input])=>[key,!input.disabled&&(input.checked||input.indeterminate)]));
      if (!Object.values(kinds).some(Boolean)) return toast('请勾选素材分类');
      const categoryMap={'主图':'主图','SKU图':'SKU图','详情图':'描述图','视频':null};
      const output={...product,materials:Object.fromEntries(Object.keys(product.materials).map(key=>[key,[]]))};
      for (const item of state.items.filter(item=>item.selected)) {
        const category=item.category==='视频'?(product.materials['主图视频'].includes(item.src)?'主图视频':'描述视频'):categoryMap[item.category];
        if(category) output.materials[category].push(item.src);
      }
      if(kinds.stitch && !kinds.detail) output.materials['描述图']=product.materials['描述图'];
      if(!zip && Object.values(kinds).filter(Boolean).length===1) {
        if(kinds.stitch){state.items.forEach(item=>item.selected=item.category==='详情图');state.stitch=true;}
        await importSelected();state.stitch=false;return;
      }
      setStatus('正在下载商品素材…');
      const result=await send({type:'ETHAN_PRODUCT_PACKAGE',product:output,downloadKinds:kinds,zip},1200000);
      setStatus(result?.ok?'下载完成':result?.message||'下载失败');
    }
    for(const [zip,label] of [[true,'下载为压缩包'],[false,'直接下载']]) {
      const old=footer.querySelector('[data-product-download="'+zip+'"]');old?.remove();
      const button=document.createElement('button');button.className='btn primary';button.dataset.productDownload=String(zip);button.textContent=label;
      button.onclick=async()=>{button.disabled=true;try{await save(zip);}catch(error){toast(error.message);}finally{button.disabled=false;}};
      footer.append(button);
    }
    applyFilters();
    addZoomButtons();
  }

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;
    if (message.type === 'ETHAN_PRODUCT_MODE') {
      openProductDownload(message.product).then(()=>sendResponse({ok:true}),error=>sendResponse({error:error.message}));
      return true;
    }
    if (message.type === "BFV14_OPEN_COLLECTOR") {
      openUI().then(() => sendResponse?.({ ok: true }), error => sendResponse?.({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === "BFV14_IMPORT_PROGRESS") {
      state.importProgress = message;
      setProgress(message.done || 0, message.total || 0);
      setStatus(`${message.destination === "browser" ? "下载任务" : "导入中"} ${message.done || 0}/${message.total || 0} · 成功 ${message.imported || 0} · 失败 ${message.failed || 0}${message.title ? ` · ${message.title}` : ""}`);
      sendResponse?.({ ok: true });
      return false;
    }
    if (message.type === "BFV14_AUTOSCROLL_PROGRESS") {
      setStatus(`自动滚动第 ${message.round || 0} 轮，已发现 ${message.count || 0} 个资源…`);
      sendResponse?.({ ok: true });
      return false;
    }
    if (message.type === "BFV14_TOAST") {
      toast(message.message || "");
      sendResponse?.({ ok: true });
      return false;
    }
    return undefined;
  });
})();
