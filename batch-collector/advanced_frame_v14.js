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

  if (globalThis.__BFV14FrameInstalled) return;
  globalThis.__BFV14FrameInstalled = true;

  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  if (!runtime) return;

  let autoScrollState = null;

  function send(message) {
    try {
      const result = runtime.sendMessage(message);
      if (result && typeof result.catch === "function") result.catch(() => {});
      return result;
    } catch (_) {
      return Promise.resolve();
    }
  }

  function frameInfo() {
    return {
      url: location.href,
      title: document.title,
      isTop: window.top === window,
      referrer: document.referrer || ""
    };
  }

  function cleanResource(resource) {
    if (!resource) return null;
    const item = { ...resource };
    delete item.element;
    if (item.data && item.data.length > 8 * 1024 * 1024) {
      item.dataTooLarge = true;
      item.data = "";
    }
    return item;
  }

  async function scan(options = {}) {
    const api = globalThis.__BillfishCaptureCompat;
    if (!api) return { items: [], frame: frameInfo(), error: "capture api unavailable" };
    const items = await api.scanDocument(document, options);
    return { items: (globalThis.__ethanProductCategories?.(items) || items).map(cleanResource).filter(Boolean), frame: frameInfo() };
  }

  function currentScrollPosition(target) {
    if (target === document.documentElement || target === document.body || target === document.scrollingElement) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return target.scrollTop || 0;
  }

  function maxScrollPosition(target) {
    if (target === document.documentElement || target === document.body || target === document.scrollingElement) {
      return Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - window.innerHeight;
    }
    return target.scrollHeight - target.clientHeight;
  }

  function scrollToPosition(target, top) {
    if (target === document.documentElement || target === document.body || target === document.scrollingElement) {
      window.scrollTo({ top, behavior: "auto" });
    } else {
      target.scrollTop = top;
    }
  }

  async function autoScroll(options = {}) {
    if (window.top !== window) return { items: [], skipped: "not-top-frame", frame: frameInfo() };
    if (autoScrollState) autoScrollState.cancelled = true;
    const state = { cancelled: false };
    autoScrollState = state;

    const api = globalThis.__BillfishCaptureCompat;
    const target = api?.findScrollable(document) || document.scrollingElement || document.documentElement;
    const delay = Math.max(120, Math.min(Number(options.delay) || 450, 3000));
    const deadline = options.initial ? performance.now() + 2000 : Infinity;
    const maxRounds = Math.max(1, Math.min(Number(options.maxRounds) || 80, 300));
    const stableLimit = Math.max(2, Math.min(Number(options.stableRounds) || 5, 20));
    const step = Math.max(200, Number(options.step) || Math.floor((target.clientHeight || window.innerHeight) * 0.82));
    const map = new Map();
    let stable = 0;
    let previousCount = 0;
    let complete = false;

    for (let round = 0; round < maxRounds && !state.cancelled && performance.now() < deadline; round += 1) {
      const batch = await api.scanDocument(document, { boardMode: !!options.boardMode, limit: 7000 });
      for (const raw of (globalThis.__ethanProductCategories?.(batch) || batch)) {
        const item = cleanResource(raw);
        if (!item?.src) continue;
        const key = `${item.type}|${item.identitySrc || item.src || item.originalSrc}`;
        map.set(key, item);
      }
      if (map.size === previousCount) stable += 1;
      else stable = 0;
      previousCount = map.size;

      send({ type: "BFV14_AUTOSCROLL_PROGRESS", count: map.size, round: round + 1, frame: frameInfo() });

      const current = currentScrollPosition(target);
      const max = Math.max(0, maxScrollPosition(target));
      if (current >= max - 3 && stable >= 2) {
        complete = true;
        break;
      }
      if (state.cancelled || performance.now() >= deadline || stable >= stableLimit || round + 1 >= maxRounds) break;
      scrollToPosition(target, Math.min(max, current + step));
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - performance.now()))));
    }

    autoScrollState = null;
    return { items: Array.from(map.values()), frame: frameInfo(), cancelled: state.cancelled, complete };
  }

  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === "BFV14_SCAN_FRAME") {
      scan(message.options || {}).then(sendResponse, (error) => sendResponse({ items: [], frame: frameInfo(), error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_AUTOSCROLL") {
      autoScroll(message.options || {}).then(sendResponse, (error) => sendResponse({ items: [], frame: frameInfo(), error: String(ethanChineseError(error?.message) || error) }));
      return true;
    }
    if (message.type === "BFV14_STOP_AUTOSCROLL") {
      if (autoScrollState) autoScrollState.cancelled = true;
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "BFV14_CREATE_BYPASS_IFRAME" && window.top === window) {
      try {
        const old = document.querySelector(`iframe[data-bfv14-token="${CSS.escape(message.token)}"]`);
        if (old) old.remove();
        const iframe = document.createElement("iframe");
        iframe.setAttribute("data-bfv14-token", message.token);
        iframe.style.cssText = "position:fixed!important;left:-10000px!important;top:-10000px!important;width:640px!important;height:640px!important;opacity:0!important;pointer-events:none!important;border:0!important;z-index:-1!important";
        const separator = String(message.url).includes("#") ? "&" : "#";
        iframe.src = `${message.url}${separator}bfv14=${encodeURIComponent(message.token)}`;
        (document.body || document.documentElement).appendChild(iframe);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(ethanChineseError(error?.message) || error) });
      }
      return false;
    }
    if (message.type === "BFV14_REMOVE_BYPASS_IFRAME" && window.top === window) {
      try {
        document.querySelector(`iframe[data-bfv14-token="${CSS.escape(message.token)}"]`)?.remove();
      } catch (_) {}
      sendResponse({ ok: true });
      return false;
    }
    return undefined;
  });

})();
