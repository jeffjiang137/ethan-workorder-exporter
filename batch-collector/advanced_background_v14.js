function ethanChineseError(value) {
  const text = String(value || '操作未完成，请重试');
  if (/Only a single offscreen/i.test(text)) return '识别页面正在初始化，请稍后重试';
  if (/Failed to fetch|NetworkError|net::|Load failed/i.test(text)) return '网络连接失败，请检查网络和图片地址后重试';
  if (/timeout|timed out|aborted|AbortError/i.test(text)) return '请求超时或已取消，请稍后重试';
  if (/Extension context invalidated/i.test(text)) return '插件已更新，请刷新网页后重试';
  if (/Receiving end does not exist|Could not establish connection|message port closed|message channel closed/i.test(text)) return '插件页面连接已断开，请刷新网页后重试';
  if (/Cannot access|Missing host permission|permission denied|not allowed/i.test(text)) return '无法访问此页面或资源，请检查插件的网站访问权限';
  if (/QUOTA|quota exceeded/i.test(text)) return '存储空间不足，请清理后重试';
  if (/Download.*failed|SERVER_BAD_CONTENT|NETWORK_FAILED/i.test(text)) return '下载失败，请检查网络后重试';
  if (/^[\x00-\x7f]+$/.test(text)) return '操作失败，请检查网络、页面权限或本地服务后重试';
  return text;
}

(() => {
  "use strict";

  if (globalThis.__BFV14BackgroundInstalled) return;
  globalThis.__BFV14BackgroundInstalled = true;

  const ext = globalThis.chrome || globalThis.browser;
  if (!ext?.runtime) return;

  const bypassRequests = new Map();
  const stitchUploads = new Map();
  const statusBases = [
    "http://127.0.0.1:63236", "http://localhost:63236",
    "http://127.0.0.1:54392", "http://localhost:54392",
    "http://127.0.0.1:49853", "http://localhost:49853",
    "http://127.0.0.1:36725", "http://localhost:36725",
    "http://127.0.0.1:7764", "http://localhost:7764"
  ];
  let cachedBillfishBase = "";

  function callbackPromise(fn) {
    return new Promise((resolve, reject) => {
      try {
        fn((value) => {
          const error = ext.runtime.lastError;
          if (error) reject(new Error(ethanChineseError(error.message)));
          else resolve(value);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function tabsQuery(query) {
    return callbackPromise((callback) => ext.tabs.query(query, callback));
  }

  function getTab(tabId) {
    return callbackPromise((callback) => ext.tabs.get(tabId, callback));
  }

  function sendToTab(tabId, message, frameId) {
    return new Promise((resolve, reject) => {
      const options = Number.isInteger(frameId) ? { frameId } : undefined;
      const callback = (response) => {
        const error = ext.runtime.lastError;
        if (error) reject(new Error(ethanChineseError(error.message)));
        else resolve(response);
      };
      try {
        ext.tabs.sendMessage(tabId, message, options || { frameId: 0 }, callback);
      } catch (error) {
        reject(error);
      }
    });
  }

  function getAllFrames(tabId) {
    if (!ext.webNavigation?.getAllFrames) return Promise.resolve([{ frameId: 0, url: "" }]);
    return callbackPromise((callback) => ext.webNavigation.getAllFrames({ tabId }, callback)).then((frames) => frames || [{ frameId: 0, url: "" }]);
  }

  function uniqueBy(items, keyFn) {
    const seen = new Map();
    const output = [];
    for (const item of items || []) {
      const key = keyFn(item);
      if (!key) continue;
      if (seen.has(key)) {
        const previous = output[seen.get(key)];
        if (item?.productTitle && previous && typeof previous === "object") Object.assign(previous, { title: item.productTitle, productTitle: item.productTitle, sourceLink: item.productUrl, productUrl: item.productUrl });
        if (item && typeof item === "object" && item.dimensionsResolved && (!previous.dimensionsResolved || item.width * item.height > previous.width * previous.height)) {
          output[seen.get(key)] = { ...previous, ...item, candidates: Array.from(new Set([...(previous.candidates || []), ...(item.candidates || [])])) };
        }
        continue;
      }
      seen.set(key, output.length);
      output.push(item);
    }
    return output;
  }

  // V14.1: 不创建额外右键菜单，统一复用 V5 原入口。


  async function activeTab() {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function read1688ProductCards() {
    if (!/(^|\.)1688\.com$/.test(location.hostname) || !/\/page\/offerlist\.htm/.test(location.pathname)) return [];
    const output = [];
    for (const image of Array.from(document.querySelectorAll("img.main-picture")).slice(0, 1000)) {
      const key = Object.keys(image).find(name => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
      let fiber = key && image[key];
      for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
        const data = fiber.memoizedProps?.data;
        if (!data || !/^\d{6,20}$/.test(String(data.id || data.offerId || "")) || typeof data.title !== "string" || !data.imgUrl) continue;
        output.push({ original: typeof data.imgUrl === "string" ? new URL(data.imgUrl, location.href).href : "", sources: [image.currentSrc, image.src, typeof data.imgUrl === "string" ? data.imgUrl : ""].filter(Boolean), title: data.title.slice(0, 240), url: `https://detail.1688.com/offer/${data.id || data.offerId}.html` });
        break;
      }
    }
    return output;
  }
  globalThis.__BFV14ReadProductCards = read1688ProductCards;

  async function enrich1688ProductCards(tabId, frameId, items) {
    if (!ext.scripting?.executeScript || !items.length) return items;
    try {
      const results = await callbackPromise(callback => ext.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: "MAIN", func: read1688ProductCards }, callback));
      const canonical = value => { try { const u = new URL(value); return u.origin + u.pathname.replace(/\.\d+x\d+(?:xz)?(?:q\d+)?\./i, ".").replace(/(\.(?:jpg|png|webp))_(?:\d+x\d+.*|\.webp)$/i, "$1"); } catch (_) { return value; } };
      const products = new Map();
      for (const product of results?.[0]?.result || []) for (const source of product.sources) {
        const key = canonical(source), previous = products.get(key);
        products.set(key, previous && previous.url !== product.url ? { ambiguous: true } : previous?.ambiguous ? previous : product);
      }
      return items.map(item => {
        if ((item.type || item.contentType || "image") !== "image") return item;
        const product = [item.originalSrc, item.src, ...(item.candidates || [])].map(source => products.get(canonical(source))).find(value => value && !value.ambiguous);
        return product ? { ...item, title: product.title, productTitle: product.title, sourceLink: product.url, productUrl: product.url, productImage: product.original } : item;
      });
    } catch (_) { return items; }
  }

  const frameScripts = ["batch-collector/product-categories.js", "batch-collector/capture_compat.js", "batch-collector/advanced_frame_v14.js"];

  async function openCollector(tabId) {
    const tab = await getTab(tabId);
    if (!/^(https?:|file:)/i.test(tab.url || "")) throw new Error("请在普通网页中使用批量采集");
    await ext.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: [...frameScripts, "batch-collector/advanced_ui_v14.js"]
    });
    return sendToTab(tabId, { type: "BFV14_OPEN_COLLECTOR" }, 0);
  }

  async function scanAllFrames(tabId, options = {}) {
    const frames = await getAllFrames(tabId);
    const responses = await Promise.all(frames.map(async (frame) => {
      try {
        await ext.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files: frameScripts });
        const response = await sendToTab(tabId, { type: "BFV14_SCAN_FRAME", options }, frame.frameId);
        if (!response || response.error) throw new Error(response?.error || "采集脚本未响应");
        return { frameId: frame.frameId, frameUrl: frame.url, ...response, items: await enrich1688ProductCards(tabId, frame.frameId, response?.items || []) };
      } catch (error) {
        return { frameId: frame.frameId, frameUrl: frame.url, items: [], error: ethanChineseError(error.message) };
      }
    }));
    if (responses.find(frame => frame.frameId === 0)?.error) throw new Error("无法扫描当前页面，请刷新后重试");
    const merged = [];
    for (const response of responses) {
      for (const item of response.items || []) {
        merged.push({ ...item, frameId: response.frameId, frameUrl: item.frameUrl || response.frameUrl || response.frame?.url || "" });
      }
    }
    return {
      items: uniqueBy(merged, (item) => `${item.type || item.contentType}|${item.identitySrc || item.src || item.originalSrc}`),
      frames: responses.map((response) => ({ frameId: response.frameId, url: response.frame?.url || response.frameUrl, count: response.items?.length || 0, error: response.error || "" }))
    };
  }

  function extensionFromUrl(url) {
    if (/^data:/i.test(url || "")) return (String(url).match(/^data:([^;,]+)/i) || [])[1]?.split("/")[1] || "";
    try {
      const path = new URL(url).pathname;
      const extName = (path.match(/\.([a-z0-9]{2,8})$/i) || [])[1]?.toLowerCase() || "";
      return ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "ico", "mp4", "webm", "mov", "m4v", "mp3", "wav", "ogg", "m4a", "flac"].includes(extName) ? extName : "";
    } catch (_) {
      return "";
    }
  }

  function typeFromMime(mime, fallback = "") {
    const value = String(mime || "").split(";")[0].trim().toLowerCase();
    if (value.startsWith("image/")) return { type: "image", mime: value, ext: value.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg") };
    if (value.startsWith("video/")) return { type: "video", mime: value, ext: value.split("/")[1] };
    if (value.startsWith("audio/")) return { type: "audio", mime: value, ext: value.split("/")[1] };
    return { type: fallback || "", mime: value, ext: "" };
  }

  function magicType(bytes) {
    const b = bytes || new Uint8Array();
    const ascii = (start, length) => String.fromCharCode(...b.subarray(start, start + length));
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image", mime: "image/jpeg", ext: "jpg" };
    if (b[0] === 0x89 && ascii(1, 3) === "PNG") return { type: "image", mime: "image/png", ext: "png" };
    if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return { type: "image", mime: "image/gif", ext: "gif" };
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { type: "image", mime: "image/webp", ext: "webp" };
    if (ascii(4, 8).includes("ftypavif") || ascii(4, 12).includes("ftypavis")) return { type: "image", mime: "image/avif", ext: "avif" };
    if (ascii(0, 2) === "BM") return { type: "image", mime: "image/bmp", ext: "bmp" };
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { type: "image", mime: "image/x-icon", ext: "ico" };
    if (ascii(0, 5).toLowerCase() === "<svg " || ascii(0, 4).toLowerCase() === "<svg") return { type: "image", mime: "image/svg+xml", ext: "svg" };
    if (ascii(4, 4) === "ftyp") return { type: "video", mime: "video/mp4", ext: "mp4" };
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: "video", mime: "video/webm", ext: "webm" };
    if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { type: "audio", mime: "audio/mpeg", ext: "mp3" };
    if (ascii(0, 4) === "OggS") return { type: "audio", mime: "audio/ogg", ext: "ogg" };
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return { type: "audio", mime: "audio/wav", ext: "wav" };
    if (ascii(0, 4) === "fLaC") return { type: "audio", mime: "audio/flac", ext: "flac" };
    return { type: "", mime: "", ext: "" };
  }

  async function firstBytes(response, maxBytes = 96) {
    if (!response.body?.getReader) {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer).subarray(0, maxBytes);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (total < maxBytes) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }
    } finally {
      try { await reader.cancel(); } catch (_) {}
    }
    const output = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const chunk of chunks) {
      const slice = chunk.subarray(0, Math.min(chunk.length, output.length - offset));
      output.set(slice, offset);
      offset += slice.length;
      if (offset >= output.length) break;
    }
    return output;
  }

  async function detectType(url, pageUrl = "", hint = "") {
    if (!url) return { type: hint || "", mime: "", ext: "", valid: false };
    if (/^data:/i.test(url)) {
      const mime = (url.match(/^data:([^;,]+)/i) || [])[1] || "";
      return { ...typeFromMime(mime, hint), valid: true, url };
    }
    if (/^blob:/i.test(url)) return { type: hint || "video", mime: "", ext: "", valid: true, url, blob: true };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      let response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: { Range: "bytes=0-127", Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8" },
          credentials: "include",
          cache: "no-store",
          referrer: /^https?:/i.test(pageUrl || "") ? pageUrl : undefined,
          signal: controller.signal
        });
      } catch (error) {
        return { type: hint || "", mime: "", ext: extensionFromUrl(url), valid: false, error: ethanChineseError(error.message), url };
      }
      if (!response.ok && response.status !== 206) return { type: hint || "", mime: response.headers.get("content-type") || "", ext: extensionFromUrl(url), valid: false, status: response.status, url };
      const headerType = typeFromMime(response.headers.get("content-type"), hint);
      const bytes = await firstBytes(response, 128);
      const magic = magicType(bytes);
      const extName = magic.ext || headerType.ext || extensionFromUrl(url);
      const type = magic.type || headerType.type || hint || (["mp4", "webm", "mov", "m4v"].includes(extName) ? "video" : ["mp3", "wav", "ogg", "m4a", "flac"].includes(extName) ? "audio" : "image");
      return { type, mime: magic.mime || headerType.mime || "", ext: extName, valid: true, status: response.status, url, contentLength: Number(response.headers.get("content-length") || 0) };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readResponseLimited(response, maxBytes) {
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > maxBytes) throw new Error(`resource exceeds ${Math.round(maxBytes / 1024 / 1024)}MB preview limit`);
    if (!response.body?.getReader) {
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error("resource too large");
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (_) {}
          throw new Error("resource too large");
        }
        chunks.push(value);
      }
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function bytesToDataUrl(bytes, mime) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
    return `data:${mime || "application/octet-stream"};base64,${btoa(binary)}`;
  }

  async function fetchDataUrl(url, pageUrl, maxBytes = 12 * 1024 * 1024) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        referrer: /^https?:/i.test(pageUrl || "") ? pageUrl : undefined,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await readResponseLimited(response, maxBytes);
      let mime = (response.headers.get("content-type") || "").split(";")[0];
      if (!mime || mime === "application/octet-stream") mime = magicType(bytes).mime || "application/octet-stream";
      return { dataUrl: bytesToDataUrl(bytes, mime), mime, size: bytes.length, url: response.url || url };
    } finally {
      clearTimeout(timeout);
    }
  }

  function requestBypass(tabId, url) {
    const token = `bfv14-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        bypassRequests.delete(token);
        sendToTab(tabId, { type: "BFV14_REMOVE_BYPASS_IFRAME", token }).catch(() => {});
        reject(new Error("iframe fallback timeout"));
      }, 25000);
      bypassRequests.set(token, { tabId, url, resolve, reject, timeout });
      try {
        await sendToTab(tabId, { type: "BFV14_CREATE_BYPASS_IFRAME", token, url });
      } catch (error) {
        clearTimeout(timeout);
        bypassRequests.delete(token);
        reject(error);
      }
    });
  }

  async function findBillfishBase() {
    // Probe once per call: cached non-OK responses and concurrent probes must settle too.
    const bases = [...new Set([cachedBillfishBase, ...statusBases].filter(Boolean))];
    const controllers = bases.map(() => new AbortController());
    try {
      const base = await Promise.any(bases.map(async (base, index) => {
        const timer = setTimeout(() => controllers[index].abort(), 2000);
        try {
          const response = await fetch(`${base}/status?version=4.0.1`, { signal: controllers[index].signal, cache: "no-store" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          const data = JSON.parse(text.replace(/^\uFEFF/, ""));
          if (!/(?:mid|machineId|deviceId|version|appVersion|clientVersion|status|data)/i.test(JSON.stringify(data))) throw new Error("not Billfish");
          return base;
        } finally { clearTimeout(timer); }
      }));
      cachedBillfishBase = base;
      return base;
    } catch (_) { cachedBillfishBase = ""; return ""; }
    finally { controllers.forEach(controller => controller.abort()); }
  }

  // Only explicit current-folder metadata counts; recent folders are not current.
  async function getCurrentFolder() {
    const base = await findBillfishBase();
    if (!base) return null;
    try {
      const response = await fetch(`${base}/status?version=4.0.1`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (!response.ok) return null;
      const status = await response.json();
      const data = status.data || status;
      const current = data.currentFolder || status.currentFolder;
      if (!current || typeof current !== "object" || !(current.folderId || current.id)) return null;
      const library = data.currentLibrary || status.currentLibrary || {};
      const libraryId = current.libraryId || current.libId || library.libraryId || library.libId || library.id;
      if (!libraryId) return null;
      return normalizedFolder({ ...current, folderId: current.folderId || current.id, folder: current.folder || current.name || "", libraryId, library: current.library || library.name || "" });
    } catch (_) { return null; }
  }

  async function getFolders() {
    const base = await findBillfishBase();
    if (!base) return { folders: [], recent: [], destination: "browser" };
    const [folders, recent] = await Promise.all([
      fetch(`${base}/library/folders?version=4.0.1`, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error(`folders HTTP ${response.status}`))),
      fetch(`${base}/library/recentlyFolders?version=4.0.1`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null)
    ]);
    return { folders, recent, base };
  }

  async function chooseCandidate(item) {
    const candidates = uniqueBy((item.candidates || []).concat(item.src || [], item.originalSrc || []), (value) => String(value));
    if (!candidates.length) return { url: "", detected: { type: item.type || "image", valid: false } };
    for (const candidate of candidates) {
      if (/^(?:data:|blob:)/i.test(candidate)) return { url: candidate, detected: await detectType(candidate, item.pageUrl || item.sourceLink, item.type) };
      const detected = await detectType(candidate, item.pageUrl || item.sourceLink, item.type);
      if (detected.valid) return { url: candidate, detected };
    }
    return { url: candidates[0], detected: { type: item.type || "image", ext: extensionFromUrl(candidates[0]), valid: false } };
  }

  function normalizedFolder(meta = {}) {
    return {
      libId: meta.libId || meta.libraryId || "",
      libraryId: meta.libraryId || meta.libId || "",
      library: meta.library || "",
      folderId: meta.folderId || "",
      folder: meta.folder || ""
    };
  }

  function downloadFilename(item, extName = "") {
    const category = item.category === "详情图" ? "描述图" : item.category;
    const numbered = item.downloadNumber && ["主图", "描述图"].includes(category)
      ? category + "_" + String(item.downloadNumber).padStart(3, "0") : "";
    const title = numbered || (category === "SKU图" ? item.skuName : "") || item.title;
    let name = String(title || "采集图片").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120).trim() || "采集图片";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const suffix = String(extName || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
    return name.toLowerCase().endsWith(`.${suffix}`) ? name : `${name}.${suffix}`;
  }

  async function browserDownload(tab, item, meta = {}) {
    if (!ext.downloads?.download) throw new Error("浏览器下载权限尚未生效，请重新加载插件");
    const chosen = await chooseCandidate(item);
    let url = chosen.url;
    let format = chosen.detected?.ext || extensionFromUrl(url) || "png";
    if (!url) throw new Error("图片地址为空");
    if ((item.type || item.contentType || "image") === "image" && /^https?:/i.test(url)) {
      try {
        const result = await fetchDataUrl(url, item.pageUrl || item.sourceLink || tab.url, 24 * 1024 * 1024);
        url = result.dataUrl;
        format = typeFromMime(result.mime, "image").ext || format;
      } catch (_) {
        if (meta.antiHotlink !== false && tab.id) {
          try { const fallback = await requestBypass(tab.id, url); if (fallback?.dataUrl) url = fallback.dataUrl; } catch (_) {}
        }
      }
    }
    const id = await callbackPromise(callback => ext.downloads.download({
      url, filename: (meta.downloadByCategory ? "图片采集/" + (["主图", "详情图", "SKU图"].includes(item.category) ? item.category : "其他") + "/" : "") + downloadFilename(item, format), saveAs: false, conflictAction: "uniquify"
    }, callback));
    if (!Number.isInteger(id)) throw new Error("浏览器未接受下载任务");
    return id;
  }

  async function downloadItems(tab, items, meta = {}) {
    let downloaded = 0;
    const failures = [];
    const counters = {};
    const categories = ["主图", "详情图", "SKU图"];
    const ordered = [...items].sort((a, b) =>
      (categories.indexOf(a.category) - categories.indexOf(b.category)) ||
      ((a.categoryOrder || 0) - (b.categoryOrder || 0)));
    // Sequential dispatch preserves the list order and browser duplicate-name numbering.
    for (const item of ordered) {
      const number = (counters[item.category] || 0) + 1;
      try {
        await browserDownload(tab, { ...item, downloadNumber: meta.downloadByCategory ? number : undefined }, meta);
        counters[item.category] = number;
        downloaded++;
      }
      catch (error) { failures.push({ title: item.title, error: String(ethanChineseError(error?.message) || error) }); }
      sendToTab(tab.id, { type: "BFV14_IMPORT_PROGRESS", destination: "browser", done: downloaded + failures.length, imported: downloaded, failed: failures.length, total: items.length }).catch(() => {});
    }
    return { imported: downloaded, downloaded, failed: failures.length, failures, destination: "browser" };
  }

  async function importStitchedImage(tab, item, meta = {}) {
    if (meta.destination === "browser") return downloadItems(tab, [item], meta);
    const base = await findBillfishBase();
    if (!base) return downloadItems(tab, [item], meta);
    const data = String(item.src || "");
    if (!/^data:image\/(?:png|jpeg);base64,/.test(data)) throw new Error("长图格式无效");
    const binary = atob(data.slice(data.indexOf(",") + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const pageUrl = item.sourceLink || item.pageUrl || tab.url;
    const query = new URLSearchParams({
      version: "4.0.1", uuid: crypto.randomUUID(), collectType: "BatchCollect", contentType: "image",
      format: data.startsWith("data:image/jpeg") ? "jpg" : "png", title: String(item.title || "拼接长图"), pageUrl, pageTitle: tab.title || "",
      sourceHost: new URL(pageUrl).host, downloadUrl: pageUrl, isDownloaded: "1",
      width: String(item.width), height: String(item.height), size: String(bytes.length),
      tabId: String(tab.id), windowId: String(tab.windowId || 0),
      ...normalizedFolder(meta), tags: Array.isArray(meta.tags) ? meta.tags.join(",") : String(meta.tags || ""),
      annotation: String(meta.notes || ""), notes: String(meta.notes || "")
    });
    // PNG bytes belong in the body, never in downloadUrl/query parameters.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`${base}/library/import?${query}`, {
        method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes, signal: controller.signal
      });
      if (!response.ok) throw new Error(`Billfish 保存失败：HTTP ${response.status}`);
      const result = await response.json();
      const success = result.status == null || ["success", "ok", "200", "0"].includes(String(result.status).toLowerCase());
      if (!success || !(result.data?.uuid || result.uuid)) throw new Error(result.message || result.msg || "Billfish 未确认保存成功，请检查客户端");
      return { imported: 1, failed: 0, uuid: result.data?.uuid || result.uuid };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Billfish 保存响应超时，请先检查软件中是否已收到长图");
      throw error;
    } finally { clearTimeout(timer); }
  }

  globalThis.ethanCollectContextImage = (tab, item) => importItems(tab, [item], { antiHotlink: true });

  async function importItems(tab, items, meta = {}) {
    if (meta.destination === "browser") return downloadItems(tab, items, meta);
    const base = await findBillfishBase();
    if (!base) return downloadItems(tab, items, meta);
    const folder = normalizedFolder(meta);
    const tags = Array.isArray(meta.tags) ? meta.tags : String(meta.tags || "").split(/[,，;；\n]+/).map((value) => value.trim()).filter(Boolean);
    const notes = String(meta.notes || meta.annotation || "").trim();
    const failures = [];
    let imported = 0;
    const queue = [...items];
    const workers = Array.from({ length: Math.min(4, Math.max(1, queue.length)) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const chosen = await chooseCandidate(item);
          let src = chosen.url;
          let detected = chosen.detected || {};
          const original = item.originalSrc || item.src || src;
          if (!src) throw new Error("资源地址为空");
          if (!detected.valid && meta.antiHotlink !== false && detected.type !== "audio" && detected.type !== "video" && /^https?:/i.test(original)) {
            try {
              const fallback = await requestBypass(tab.id, original);
              if (fallback?.dataUrl) {
                src = fallback.dataUrl;
                detected = { ...detected, type: "image", mime: fallback.contentType || detected.mime, valid: true };
              }
            } catch (_) {}
          }
          const contentType = detected.type || item.type || item.contentType || "image";
          const payload = {
            tabId: tab.id,
            windowId: tab.windowId,
            collectType: "BatchCollect",
            contentType,
            collectReffer: "content",
            title: String(item.title || tab.title || "未命名素材").trim(),
            pageUrl: item.sourceLink || item.pageUrl || tab.url,
            pageTitle: item.pageTitle || tab.title,
            sourceHost: (() => { try { return new URL(item.sourceLink || item.pageUrl || tab.url).host; } catch (_) { return ""; } })(),
            format: detected.ext || extensionFromUrl(src),
            src,
            downloadUrl: original,
            width: Number(item.width || 0),
            height: Number(item.height || 0),
            tags: uniqueBy([...(item.tags || []), ...tags], (value) => String(value)),
            annotation: item.annotation || notes,
            notes,
            category: meta.category || "",
            copyright: meta.copyright || "",
            owners: meta.owners || "",
            ...folder
          };
          let data = /^data:/i.test(src) ? src : "";
          if (!data && /^https?:/i.test(src)) {
            try { data = (await fetchDataUrl(src, payload.pageUrl, 24 * 1024 * 1024)).dataUrl; }
            catch (_) {
              if (meta.antiHotlink !== false) {
                try { data = (await requestBypass(tab.id, src)).dataUrl; } catch (_) {}
              }
            }
          }
          if (!data && !/^https?:/i.test(src)) throw new Error("无法读取该资源");
          delete payload.src;
          const query = new URLSearchParams({
            ...payload, version: "4.0.1", uuid: crypto.randomUUID(),
            downloadUrl: /^https?:/i.test(src) ? src : (/^https?:/i.test(original) ? original : payload.pageUrl),
            isDownloaded: data ? "1" : "0"
          });
          let body;
          if (data) {
            const blob = await (await fetch(data)).blob();
            query.set("size", String(blob.size));
            const format = typeFromMime(blob.type, contentType).ext;
            if (format) query.set("format", format);
            body = blob;
          }
          const response = await fetch(`${base}/library/import?${query}`, {
            method: "POST", body, headers: body ? { "content-type": "application/octet-stream" } : {},
            signal: AbortSignal.timeout(25000)
          });
          if (!response.ok) throw new Error(`Billfish 保存失败：HTTP ${response.status}`);
          const result = await response.json();
          if (!(result.data?.uuid || result.uuid)) throw new Error(result.message || result.msg || "Billfish 未确认保存成功");
          imported += 1;
          sendToTab(tab.id, { type: "BFV14_IMPORT_PROGRESS", done: imported + failures.length, imported, failed: failures.length, total: items.length, title: payload.title }).catch(() => {});
        } catch (error) {
          failures.push({ title: item?.title || "", src: item?.src || "", error: String(ethanChineseError(error?.message) || error) });
          sendToTab(tab.id, { type: "BFV14_IMPORT_PROGRESS", done: imported + failures.length, imported, failed: failures.length, total: items.length, error: String(ethanChineseError(error?.message) || error) }).catch(() => {});
        }
      }
    });
    await Promise.all(workers);
    return { imported, failed: failures.length, failures };
  }


  // Some direct image/media documents do not execute normal content scripts.
  // This webNavigation fallback injects the extractor into the hidden iframe frame itself.
  ext.webNavigation?.onCompleted?.addListener((details) => {
    if (!details || details.frameId === 0 || !details.url || !details.url.includes("bfv14=")) return;
    let token = "";
    try { token = decodeURIComponent((details.url.match(/(?:#|&)bfv14=([^&]+)/i) || [])[1] || ""); } catch (_) {}
    const pending = bypassRequests.get(token);
    if (!pending || pending.tabId !== details.tabId || !ext.scripting?.executeScript) return;
    ext.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      func: async () => {
        const cleanUrl = String(location.href).replace(/#(?:[^#]*&)?bfv14=[^&]*/i, "").replace(/[?#&]$/, "");
        const response = await fetch(cleanUrl, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (blob.size > 18 * 1024 * 1024) throw new Error("resource too large for iframe fallback");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 32768)));
        const image = document.querySelector("body > img, img");
        const video = document.querySelector("body > video, video");
        return {
          dataUrl: `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`,
          contentType: blob.type,
          size: blob.size,
          width: image?.naturalWidth || video?.videoWidth || 0,
          height: image?.naturalHeight || video?.videoHeight || 0,
          url: cleanUrl
        };
      }
    }).then((results) => {
      const current = bypassRequests.get(token);
      if (!current) return;
      const result = results?.[0]?.result;
      if (!result?.dataUrl) throw new Error("iframe extractor returned no data");
      current.resolve(result);
      clearTimeout(current.timeout);
      bypassRequests.delete(token);
      sendToTab(current.tabId, { type: "BFV14_REMOVE_BYPASS_IFRAME", token }).catch(() => {});
    }).catch((error) => {
      const current = bypassRequests.get(token);
      if (!current) return;
      current.reject(error);
      clearTimeout(current.timeout);
      bypassRequests.delete(token);
      sendToTab(current.tabId, { type: "BFV14_REMOVE_BYPASS_IFRAME", token }).catch(() => {});
    });
  });

  // V14.1: 高级能力由原“批量采集”和原右键采集链路调用，不增加菜单项。


  ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === "ETHAN_OPEN_BATCH_COLLECTOR" && sender.url === ext.runtime.getURL("popup.html")) {
      openCollector(message.tabId).then(sendResponse, error => sendResponse({ ok: false, error: ethanChineseError(error.message) }));
      return true;
    }
    if (message.type === "BFV14_SCAN_ALL") {
      (async () => {
        const tab = sender.tab || await activeTab();
        if (!tab?.id) throw new Error("没有活动网页");
        return scanAllFrames(tab.id, message.options || {});
      })().then(sendResponse, (error) => sendResponse({ items: [], frames: [], error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_AUTOSCROLL_TOP") {
      (async () => {
        const tab = sender.tab || await activeTab();
        if (!tab?.id) throw new Error("没有活动网页");
        const result = await sendToTab(tab.id, { type: "BFV14_AUTOSCROLL", options: message.options || {} }, 0);
        const all = await scanAllFrames(tab.id, message.options || {});
        const merged = uniqueBy([...(result?.items || []), ...(all.items || [])], (item) => `${item.type}|${item.identitySrc || item.src || item.originalSrc}`);
        return { ...all, items: merged, autoScroll: result };
      })().then(sendResponse, (error) => sendResponse({ items: [], frames: [], error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_STOP_AUTOSCROLL") {
      (async () => {
        const tab = sender.tab || await activeTab();
        if (tab?.id) await sendToTab(tab.id, { type: "BFV14_STOP_AUTOSCROLL" }, 0).catch(() => {});
        return { ok: true };
      })().then(sendResponse);
      return true;
    }
    if (["BFV14_STITCH_CHUNK", "BFV14_STITCH_DISCARD", "BFV14_IMPORT_STITCH"].includes(message.type)) {
      const tab = sender.tab;
      const key = `${tab?.id}|${message.token}`;
      for (const [id, upload] of stitchUploads) if (Date.now() - upload.updated > 120000) stitchUploads.delete(id);
      if (!tab?.id) { sendResponse({ error: "没有活动网页" }); return; }
      if (message.type === "BFV14_STITCH_DISCARD") { stitchUploads.delete(key); sendResponse({ ok: true }); return; }
      if (message.type === "BFV14_STITCH_CHUNK") {
        if (!Number.isInteger(message.total) || message.total < 1 || message.total > 48000000 || typeof message.chunk !== "string" || message.chunk.length > 512 * 1024) { sendResponse({ error: "长图数据过大或无效" }); return; }
        if (message.offset === 0) {
          for (const id of stitchUploads.keys()) if (id.startsWith(`${tab.id}|`)) stitchUploads.delete(id);
          stitchUploads.set(key, { chunks: [], length: 0, total: message.total, updated: Date.now() });
        }
        const upload = stitchUploads.get(key);
        if (!upload || message.offset !== upload.length || message.total !== upload.total || upload.length + message.chunk.length > upload.total) { sendResponse({ error: "长图传送中断，请重试" }); return; }
        upload.chunks.push(message.chunk);
        upload.length += message.chunk.length;
        upload.updated = Date.now();
        sendResponse({ ok: true });
        return;
      }
      const upload = stitchUploads.get(key);
      stitchUploads.delete(key);
      if (!upload || upload.length !== upload.total) { sendResponse({ error: "长图数据已失效，请重新保存" }); return; }
      const src = upload.chunks.join("");
      if (!/^data:image\/(?:png|jpeg);base64,/.test(src)) { sendResponse({ error: "长图格式无效" }); return; }
      importStitchedImage(tab, { ...message.item, src, type: "image" }, message.meta || {}).then(sendResponse, error => sendResponse({ error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_GET_CURRENT_FOLDER") {
      (async () => { const base = await findBillfishBase(); return { currentFolder: base ? await getCurrentFolder() : null, destination: base ? "billfish" : "browser" }; })().then(sendResponse, () => sendResponse({ currentFolder: null, destination: "browser" }));
      return true;
    }
    if (message.type === "BFV14_STITCH_SOURCE") {
      (async () => {
        const item = message.item || {};
        const chosen = await chooseCandidate(item);
        if (!chosen.url) throw new Error("图片地址为空");
        if (/^data:image\//i.test(chosen.url)) return { dataUrl: chosen.url };
        try {
          return await fetchDataUrl(chosen.url, item.pageUrl || item.sourceLink, 24 * 1024 * 1024);
        } catch (error) {
          if (!sender.tab?.id) throw error;
          return requestBypass(sender.tab.id, chosen.url);
        }
      })().then(sendResponse, error => sendResponse({ error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_PREVIEW") {
      (async () => {
        const pageUrl = message.pageUrl || sender.tab?.url || "";
        try {
          return await fetchDataUrl(message.url, pageUrl, 10 * 1024 * 1024);
        } catch (firstError) {
          if (sender.tab?.id && message.antiHotlink !== false) {
            const result = await requestBypass(sender.tab.id, message.url);
            return { ...result, via: "iframe" };
          }
          throw firstError;
        }
      })().then(sendResponse, (error) => sendResponse({ error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_DETECT_TYPES") {
      Promise.all((message.items || []).slice(0, 300).map(async (item) => ({ key: item.key, ...(await chooseCandidate(item)) }))).then(sendResponse, (error) => sendResponse({ error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_GET_FOLDERS") {
      getFolders().then(sendResponse, (error) => sendResponse({ error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_IMPORT") {
      (async () => {
        const tab = sender.tab || await activeTab();
        if (!tab?.id) throw new Error("没有活动网页");
        return importItems(tab, message.items || [], message.meta || {});
      })().then(sendResponse, (error) => sendResponse({ imported: 0, failed: (message.items || []).length, error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    return undefined;
  });
})();
