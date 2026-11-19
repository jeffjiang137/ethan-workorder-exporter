(() => {
  "use strict";

  const VERSION = "3.1.5";
  const INSTANCE_KEY = "__VPH1688_PREVENTION_V315__";
  const LEGACY_INSTANCE_KEYS = [
    "__VPH1688_PREVENTION_V31__",
    "__VPH1688_PREVENTION_V313__",
    "__VPH1688_PREVENTION_V314__",
    "__VPH1688_PREVENTION_V315__"
  ];

  const AUTH_HOST_RE = /(^|\.)(login\.taobao\.com|login\.1688\.com|passport\.taobao\.com|passport\.1688\.com|passport\.alibaba\.com)$/i;
  const AUTH_PATH_RE = /(?:^|\/)(?:login|signin|sign-in|sign_in|member\/(?:jump|marketSigninJump))(?:[\/.?_-]|$)/i;

  function parseEarlyUrl(value) {
    try { return new URL(value, location.href); } catch { return null; }
  }

  function isProtectedAuthUrl(value) {
    const url = parseEarlyUrl(value);
    if (!url) return false;
    // Seller publishing/editing dialogs must remain under the user's control.
    // Origin-level protection also covers embedded frames in the editor.
    if (/^offer-new\.1688\.com$/i.test(url.hostname)) return true;
    if (AUTH_HOST_RE.test(url.hostname)) return true;
    if (!/(^|\.)(1688\.com|taobao\.com|alibaba\.com)$/i.test(url.hostname)) return false;
    return AUTH_PATH_RE.test(url.pathname);
  }

  function earlyAncestorOrigins() {
    try { return Array.from(location.ancestorOrigins || []); } catch { return []; }
  }

  function isProtectedAuthContext() {
    if (isProtectedAuthUrl(location.href)) return true;
    return earlyAncestorOrigins().some(isProtectedAuthUrl);
  }

  function stopLegacyInstancesForAuthPage() {
    for (const key of LEGACY_INSTANCE_KEYS) {
      const legacy = globalThis[key];
      if (!legacy || typeof legacy !== "object") continue;
      try { legacy.alive = false; } catch { /* ignored */ }
      try { if (legacy.settings) legacy.settings.enabled = false; } catch { /* ignored */ }
      try { if (legacy.intervalId) clearInterval(legacy.intervalId); } catch { /* ignored */ }
      try { if (legacy.scanTimer) clearTimeout(legacy.scanTimer); } catch { /* ignored */ }
      try { legacy.queuedRoots?.clear?.(); } catch { /* ignored */ }
    }
  }

  if (isProtectedAuthContext()) {
    stopLegacyInstancesForAuthPage();
    try {
      if (document.documentElement) document.documentElement.dataset.vph1688AuthProtected = VERSION;
    } catch { /* ignored */ }
    return;
  }

  if (globalThis[INSTANCE_KEY]?.alive) {
    globalThis[INSTANCE_KEY].scan?.("reinjected");
    return;
  }

  const Rules = globalThis.VPHRules;
  const PageContext = globalThis.VPHPageContext;
  if (!Rules || !PageContext) {
    console.warn("[1688验证弹窗助手] 规则或页面判定模块未加载");
    return;
  }

  const EXT_PREFIX = "__1688_vph31_";
  const DEFAULTS = Object.freeze({
    enabled: false,
    enhancedHeuristics: true,
    strictLoadedPageClosing: true,
    contentLoadProtection: true,
    contentStableDelayMs: 1200,
    pacePreset: "strict",
    debug: false
  });

  const ALIBABA_HOST_RE = /(^|\.)(1688\.com|alibaba\.com|taobao\.com|tmall\.com|alicdn\.com|aliyun\.com|aliyuncs\.com|alipay\.com)$/i;
  const VERIFY_URL_RE = /(captcha|verify|verification|nocaptcha|baxia|x5sec|punish|risk|security|challenge|human)/i;

  const ROOT_SELECTOR = [
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-modal="true"]',
    'dialog',
    '[class*="dialog" i]',
    '[class*="modal" i]',
    '[class*="popup" i]',
    '[class*="pop-up" i]',
    '[class*="overlay" i]',
    '[class*="mask" i]',
    '[class*="layer" i]',
    '[class*="captcha" i]',
    '[class*="verify" i]',
    '[class*="baxia" i]',
    '[class*="x5sec" i]',
    '[class*="security" i]',
    '[id*="dialog" i]',
    '[id*="modal" i]',
    '[id*="popup" i]',
    '[id*="overlay" i]',
    '[id*="captcha" i]',
    '[id*="verify" i]',
    '[id*="baxia" i]',
    '[id*="x5sec" i]'
  ].join(",");

  const EXPLICIT_CANDIDATE_SELECTOR = [
    "button",
    "a",
    'input[type="button"]',
    'input[type="reset"]',
    '[role="button"]',
    '[aria-label]',
    '[title]',
    '[data-role]',
    '[data-action]',
    '[class*="close" i]',
    '[id*="close" i]',
    '[class*="dismiss" i]',
    '[class*="cancel" i]',
    '[class*="skip" i]',
    '[style*="cursor" i]'
  ].join(",");

  const state = {
    alive: true,
    allowed: false,
    settings: { ...DEFAULTS },
    observers: new WeakMap(),
    shadowRoots: new WeakSet(),
    signaledFrames: new WeakSet(),
    domRoots: [document],
    lastShadowDiscoveryAt: 0,
    attemptedAt: new WeakMap(),
    spatialCandidates: new WeakSet(),
    queuedRoots: new Set(),
    scanTimer: null,
    intervalId: null,
    lastClickAt: 0,
    childCloseAuthorizedUntil: 0,
    childCloseAuthorizationReason: "",
    startedAt: Date.now(),
    mandatoryNotifiedKeys: new Set(),
    unresolvedAt: new WeakMap(),
    escapeAttemptedAt: new WeakMap(),
    contentReadiness: {
      url: location.href,
      readySince: 0,
      last: null,
      postCloseIssueAt: 0
    },
    diagnostics: {
      scans: 0,
      rootsInspected: 0,
      verificationRoots: 0,
      closeCandidates: 0,
      shadowRoots: 0,
      framesSeen: 0,
      lastScanReason: "",
      lastScanAt: "",
      lastAction: "等待扫描",
      loadedOverlayDetections: 0,
      fullPageDetections: 0,
      aggressiveCandidates: 0,
      escapeAttempts: 0,
      contentDeferrals: 0,
      postCloseChecks: 0,
      postCloseIncomplete: 0,
      visualContentReadyDetections: 0,
      childVerificationSignals: 0,
      childCloseAuthorizations: 0,
      childCloseAttempts: 0,
      childCloseSuccesses: 0,
      lastContentState: null,
      recentRoots: []
    }
  };

  globalThis[INSTANCE_KEY] = state;

  function debug(...args) {
    if (state.settings.debug) {
      console.debug("[1688验证弹窗助手]", ...args);
    }
  }

  function purgeLegacyFloatingUi() {
    for (const id of [
      "__1688_vph_notice",
      "__1688_vph3_notice",
      "__1688_vph3_pace_toast",
      "__1688_vph31_notice",
      "__1688_vph31_pace_toast"
    ]) {
      try { document.getElementById(id)?.remove(); } catch { /* ignored */ }
    }
  }

  function strictLoadedPageMode() {
    return Boolean(
      state.settings.enhancedHeuristics &&
      state.settings.strictLoadedPageClosing &&
      state.settings.pacePreset === "strict"
    );
  }

  function safeUrl(value) {
    try {
      return new URL(value, location.href);
    } catch {
      return null;
    }
  }

  function is1688Origin(value) {
    const url = safeUrl(value);
    return Boolean(url && /(^|\.)1688\.com$/i.test(url.hostname));
  }

  function isAlibabaHost(value) {
    const url = safeUrl(value);
    return Boolean(url && ALIBABA_HOST_RE.test(url.hostname));
  }

  function getAncestorOrigins() {
    try {
      return Array.from(location.ancestorOrigins || []);
    } catch {
      return [];
    }
  }

  function allowedContext() {
    if (isProtectedAuthContext()) return false;
    if (!isAlibabaHost(location.href)) return false;
    if (is1688Origin(location.href)) return true;
    if (is1688Origin(document.referrer) && !isProtectedAuthUrl(document.referrer)) return true;
    return getAncestorOrigins().some((origin) => is1688Origin(origin) && !isProtectedAuthUrl(origin));
  }

  state.allowed = allowedContext();
  if (!state.allowed) {
    state.alive = false;
    return;
  }

  function isExtensionUi(el) {
    return Boolean(el?.closest?.('[id^="__1688_vph"]'));
  }

  function isVisible(el) {
    if (!(el instanceof Element) || !el.isConnected || isExtensionUi(el)) return false;
    let style;
    try {
      style = getComputedStyle(el);
    } catch {
      return false;
    }
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.contentVisibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") < 0.03
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 6 && rect.height >= 6 && rect.bottom >= -4 && rect.right >= -4;
  }

  function elementAttrs(el) {
    if (!(el instanceof Element)) return "";
    const values = [
      el.id,
      typeof el.className === "string" ? el.className : el.getAttribute("class"),
      el.getAttribute("role"),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("name"),
      el.getAttribute("data-role"),
      el.getAttribute("data-action"),
      el.getAttribute("data-testid"),
      el.getAttribute("data-spm"),
      el.getAttribute("src"),
      el.getAttribute("href")
    ];
    return values.filter(Boolean).join(" ").slice(0, 1600);
  }

  function elementText(el, max = 1800) {
    if (!(el instanceof Element)) return "";
    return Rules.normalizeText(el.innerText || el.textContent || "").slice(0, max);
  }

  function describeElement(el) {
    if (!(el instanceof Element)) return null;
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      className: String(typeof el.className === "string" ? el.className : el.getAttribute("class") || "").slice(0, 180),
      text: elementText(el, 160),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    };
  }

  function rootVerificationScore(root) {
    if (!(root instanceof Element) || !isVisible(root)) return 0;
    const frame = root.matches("iframe[src]") ? root : root.querySelector?.("iframe[src]");
    const frameSrc = frame?.getAttribute("src") || "";
    const ownUrl = root === document.body || root === document.documentElement ? location.href : "";
    let score = Rules.verificationScore({
      text: elementText(root),
      attrs: elementAttrs(root),
      url: ownUrl,
      frameSrc
    });

    if (root.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog')) score += 1;
    if (frameSrc && VERIFY_URL_RE.test(frameSrc)) score += 2;
    if (frame && state.signaledFrames.has(frame)) score += 8;
    return score;
  }

  function viewportArea() {
    return Math.max(1, window.innerWidth * window.innerHeight);
  }

  function rootAreaRatio(root) {
    if (!(root instanceof Element)) return 0;
    const rect = root.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return Math.min(1.5, (visibleWidth * visibleHeight) / viewportArea());
  }

  const OFFER_LINK_SELECTOR = [
    'a[href*="/offer/" i]',
    'a[href*="detail.1688.com" i]',
    'a[href*="offer.1688.com" i]'
  ].join(",");

  const PRODUCT_CARD_SELECTOR = [
    '[data-offer-id]', '[data-offerid]', '[data-offerId]',
    '[class*="offer-card" i]', '[class*="product-card" i]',
    '[class*="offer-item" i]', '[class*="product-item" i]',
    '[class*="search-result" i]', '[class*="sm-offer" i]'
  ].join(",");

  const CONTENT_CONTAINER_SELECTOR = [
    'main', '[role="main"]', '[data-spm*="content" i]',
    '[class*="offer-list" i]', '[class*="product-list" i]',
    '[class*="search-list" i]', '[class*="result-list" i]',
    '[class*="detail-content" i]', '[id*="content" i]'
  ].join(",");

  const SKELETON_SELECTOR = [
    '[aria-busy="true"]', '[class*="skeleton" i]',
    '[class*="placeholder" i]', '[class*="loading" i]',
    '[class*="shimmer" i]'
  ].join(",");

  function outsideVerificationRoot(el, root) {
    if (!(el instanceof Element) || !isVisible(el) || isExtensionUi(el)) return false;
    const rootIsDocument = root === document.body || root === document.documentElement;
    if (!rootIsDocument && root instanceof Element && root.contains(el)) return false;
    if (el.closest('header, nav, [role="banner"], [class*="header" i], [class*="topbar" i], [class*="toolbar" i]')) return false;
    return true;
  }

  function realLoadedImage(img, root) {
    if (!(img instanceof HTMLImageElement) || !outsideVerificationRoot(img, root)) return false;
    const src = String(img.currentSrc || img.src || img.getAttribute("data-src") || "");
    if (!src || /(?:^data:image\/(?:gif|svg\+xml);base64,R0lGOD|transparent|loading|placeholder|spacer)/i.test(src)) return false;
    const rect = img.getBoundingClientRect();
    return Boolean(img.complete && img.naturalWidth >= 70 && img.naturalHeight >= 50 && rect.width * rect.height >= 2200);
  }

  function clusterCount(values, minimumGap = 86) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    let count = 1;
    let anchor = sorted[0];
    for (const value of sorted.slice(1)) {
      if (Math.abs(value - anchor) >= minimumGap) {
        count += 1;
        anchor = value;
      }
    }
    return count;
  }

  function imageGridMetrics(images) {
    const productLike = [];
    for (const img of images) {
      if (!(img instanceof HTMLImageElement) || !isVisible(img)) continue;
      const rect = img.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      if (rect.width < 86 || rect.height < 86 || rect.width * rect.height < 9000) continue;
      if (centerY < 92) continue;
      productLike.push({ rect, centerX, centerY, area: rect.width * rect.height });
    }
    const columns = clusterCount(productLike.map((item) => item.centerX), 92);
    const rows = clusterCount(productLike.map((item) => item.centerY), 92);
    const totalArea = productLike.reduce((sum, item) => sum + item.area, 0);
    const yValues = productLike.map((item) => item.centerY);
    const ySpan = yValues.length ? Math.max(...yValues) - Math.min(...yValues) : 0;
    return {
      count: productLike.length,
      columns,
      rows,
      totalArea: Math.round(totalArea),
      ySpan: Math.round(ySpan)
    };
  }

  function measureContentReadiness(root = null) {
    if (window !== window.top || !document.body || VERIFY_URL_RE.test(location.href)) {
      return {
        rawReady: false, stableReady: false, stableMs: 0, headerOnly: true,
        skeletonDominant: false, offerLinks: 0, productCards: 0,
        loadedImages: 0, skeletons: 0, textChars: 0, maxContentHeight: 0,
        imageGridCount: 0, imageGridColumns: 0, imageGridRows: 0,
        imageGridArea: 0, shopOfferListReady: false, visualGridReady: false
      };
    }

    const now = Date.now();
    if (state.contentReadiness.url !== location.href) {
      state.contentReadiness.url = location.href;
      state.contentReadiness.readySince = 0;
      state.contentReadiness.last = null;
    }

    // 1688 店铺商品列表会把卡片放进开放式 Shadow DOM；普通 querySelectorAll
    // 只能看到页头和验证层，因此这里递归查询所有已发现的 DOM 根。
    const query = (selector, limit = 1200) => {
      const results = [];
      const seen = new Set();
      for (const domRoot of allDomRoots()) {
        let nodes = [];
        try { nodes = domRoot.querySelectorAll?.(selector) || []; }
        catch { nodes = []; }
        for (const node of nodes) {
          if (seen.has(node)) continue;
          seen.add(node);
          results.push(node);
          if (results.length >= limit) return results;
        }
      }
      return results;
    };

    const offerLinks = query(OFFER_LINK_SELECTOR, 1400).filter((el) => outsideVerificationRoot(el, root)).length;
    const productCards = query(PRODUCT_CARD_SELECTOR, 1400).filter((el) => outsideVerificationRoot(el, root)).length;
    const loadedImageElements = query("img", 2200).filter((img) => realLoadedImage(img, root));
    const loadedImages = loadedImageElements.length;
    const imageGrid = imageGridMetrics(loadedImageElements);
    const skeletons = query(SKELETON_SELECTOR, 1400).filter((el) => outsideVerificationRoot(el, root)).length;

    let textChars = 0;
    let maxContentHeight = 0;
    const containers = query(CONTENT_CONTAINER_SELECTOR, 900).filter((el) => outsideVerificationRoot(el, root));
    const textSources = containers.length
      ? containers
      : query('section, article, [class*="content" i], [class*="result" i], [class*="list" i], [class*="offer" i], [class*="product" i]', 1200)
          .filter((el) => outsideVerificationRoot(el, root));

    for (const el of textSources.slice(0, 180)) {
      const rect = el.getBoundingClientRect();
      maxContentHeight = Math.max(maxContentHeight, rect.height);
      if (textChars < 900) textChars += elementText(el, 220).length;
      if (textChars >= 900 && maxContentHeight >= 600) break;
    }

    const isDetailPage = /(^|\.)(detail|offer)\.1688\.com$/i.test(location.hostname) || /\/offer\//i.test(location.pathname);
    const isShopOfferListPage = /(^|\.)1688\.com$/i.test(location.hostname) && /\/page\/offerlist\.htm$/i.test(location.pathname);
    const visualGridReady = imageGrid.count >= 6 && imageGrid.columns >= 3 && imageGrid.totalArea >= 150000;
    const shopOfferListReady = Boolean(
      isShopOfferListPage &&
      imageGrid.count >= 4 &&
      (imageGrid.columns >= 3 || imageGrid.rows >= 2 || imageGrid.ySpan >= 180) &&
      imageGrid.totalArea >= 90000
    );
    const listReady = offerLinks >= 3 && (loadedImages >= 2 || productCards >= 3);
    const cardReady = productCards >= 4 && (textChars >= 70 || loadedImages >= 4);
    const detailReady = isDetailPage && loadedImages >= 1 && textChars >= 70 && maxContentHeight >= 260;
    const genericReady = loadedImages >= 4 && textChars >= 140 && maxContentHeight >= 380;
    const rawReady = Boolean(listReady || cardReady || detailReady || genericReady || shopOfferListReady || visualGridReady);
    const skeletonDominant = skeletons >= 3 && offerLinks < 2 && productCards < 2 && loadedImages < 2;
    const headerOnly = !rawReady && offerLinks === 0 && productCards < 2 && imageGrid.count < 3 && loadedImages <= 2 && textChars < 120 && maxContentHeight < 380;

    if (rawReady) {
      if (!state.contentReadiness.readySince) state.contentReadiness.readySince = now;
    } else {
      state.contentReadiness.readySince = 0;
    }

    const stableMs = rawReady ? now - state.contentReadiness.readySince : 0;
    const requiredStableMs = Math.max(500, Number(state.settings.contentStableDelayMs || 1200));
    const result = {
      rawReady,
      stableReady: rawReady && stableMs >= requiredStableMs,
      stableMs,
      requiredStableMs,
      headerOnly,
      skeletonDominant,
      offerLinks,
      productCards,
      loadedImages,
      skeletons,
      textChars,
      maxContentHeight: Math.round(maxContentHeight),
      imageGridCount: imageGrid.count,
      imageGridColumns: imageGrid.columns,
      imageGridRows: imageGrid.rows,
      imageGridArea: imageGrid.totalArea,
      imageGridYSpan: imageGrid.ySpan,
      shopOfferListReady,
      visualGridReady
    };
    if (shopOfferListReady || visualGridReady) state.diagnostics.visualContentReadyDetections += 1;
    state.contentReadiness.last = result;
    state.diagnostics.lastContentState = result;
    return result;
  }

  function loadedPageEvidence(root, contentState = measureContentReadiness(root)) {
    let evidence = 0;
    if (contentState.offerLinks >= 3) evidence += 3;
    if (contentState.productCards >= 3) evidence += 2;
    if (contentState.loadedImages >= 2) evidence += 2;
    if (contentState.imageGridCount >= 4) evidence += 2;
    if (contentState.shopOfferListReady || contentState.visualGridReady) evidence += 4;
    if (contentState.textChars >= 120) evidence += 1;
    if (contentState.maxContentHeight >= 380) evidence += 1;
    if (contentState.stableReady) evidence += 2;
    return evidence;
  }

  function verificationContext(root) {
    const rootIsDocument = root === document.body || root === document.documentElement;
    const contentState = measureContentReadiness(root);
    const context = PageContext.classifyVerificationContext({
      isTopFrame: window === window.top,
      urlLooksVerification: VERIFY_URL_RE.test(location.href),
      loadedEvidence: loadedPageEvidence(root, contentState),
      rootAreaRatio: rootAreaRatio(root),
      rootIsDocument,
      documentAgeMs: Date.now() - state.startedAt,
      contentLoadProtection: Boolean(state.settings.contentLoadProtection),
      contentReady: contentState.rawReady,
      contentStableMs: contentState.stableMs,
      requiredStableMs: contentState.requiredStableMs,
      headerOnly: contentState.headerOnly,
      skeletonDominant: contentState.skeletonDominant
    });
    return { ...context, rootAreaRatio: rootAreaRatio(root), contentState };
  }

  function isOverlayLike(el) {
    if (!isVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 12000) return false;
    const style = getComputedStyle(el);
    const z = Number.parseInt(style.zIndex, 10) || 0;
    const positionOk = style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
    return positionOk && (z >= 100 || area >= viewportArea() * 0.22);
  }

  function addAncestorCandidates(el, roots) {
    let current = el;
    let depth = 0;
    while (current instanceof Element && current !== document.documentElement && depth < 8) {
      if (current.matches?.(ROOT_SELECTOR) || isOverlayLike(current)) roots.add(current);
      current = current.parentElement;
      depth += 1;
    }
  }

  function addFrameWrapperCandidates(frame, roots) {
    let current = frame;
    let depth = 0;
    while (current instanceof Element && current !== document.documentElement && depth < 7) {
      if (isVisible(current)) {
        const rect = current.getBoundingClientRect();
        if (rect.width * rect.height >= 3600) roots.add(current);
      }
      current = current.parentElement;
      depth += 1;
    }
  }

  function collectPointRoots(roots) {
    if (window !== window.top && window.innerWidth < 20) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const points = [
      [w * 0.5, h * 0.5],
      [w * 0.5, h * 0.28],
      [w * 0.72, h * 0.22],
      [w * 0.85, h * 0.12],
      [w * 0.2, h * 0.2],
      [w * 0.35, h * 0.15],
      [w * 0.65, h * 0.15],
      [w * 0.35, h * 0.72],
      [w * 0.65, h * 0.72]
    ];

    for (const [x, y] of points) {
      let stack = [];
      try {
        stack = document.elementsFromPoint(x, y) || [];
      } catch {
        continue;
      }
      for (const el of stack.slice(0, 12)) addAncestorCandidates(el, roots);
    }
  }

  function collectHighZRoots(roots) {
    if (!strictLoadedPageMode() || !document.body) return;
    let elements = [];
    try {
      elements = Array.from(document.body.querySelectorAll([
        '[style*="position: fixed" i]',
        '[style*="position:fixed" i]',
        '[style*="z-index" i]',
        '[class*="fixed" i]',
        '[class*="dialog" i]',
        '[class*="modal" i]',
        '[class*="popup" i]',
        '[class*="mask" i]',
        '[class*="layer" i]'
      ].join(","))).slice(0, 2600);
    } catch { elements = []; }

    for (const el of elements) {
      if (!isVisible(el) || isExtensionUi(el)) continue;
      let style;
      try { style = getComputedStyle(el); } catch { continue; }
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      const z = Number.parseInt(style.zIndex, 10) || 0;
      if (area >= 4000 && (style.position === "fixed" || z >= 80)) {
        if (rootVerificationScore(el) >= 5) roots.add(el);
      }
    }
  }

  function registerShadowRoot(shadowRoot) {
    if (!shadowRoot || state.shadowRoots.has(shadowRoot)) return false;
    state.shadowRoots.add(shadowRoot);
    state.domRoots.push(shadowRoot);
    state.diagnostics.shadowRoots = state.domRoots.length - 1;
    observeRoot(shadowRoot);
    return true;
  }

  function discoverOpenShadowRoots() {
    const rootsSnapshot = [...state.domRoots];
    let checked = 0;
    for (const root of rootsSnapshot) {
      let elements = [];
      try {
        elements = root.querySelectorAll?.("*") || [];
      } catch {
        continue;
      }
      for (const el of elements) {
        checked += 1;
        if (el.shadowRoot) registerShadowRoot(el.shadowRoot);
        if (checked >= 9000) return;
      }
    }
  }

  function allDomRoots() {
    return [...state.domRoots];
  }

  function collectRootsFromDomRoot(domRoot) {
    const roots = new Set();
    try {
      domRoot.querySelectorAll(ROOT_SELECTOR).forEach((el) => roots.add(el));
      domRoot.querySelectorAll("iframe[src]").forEach((frame) => {
        const src = frame.getAttribute("src") || "";
        if (VERIFY_URL_RE.test(src) || state.signaledFrames.has(frame)) {
          roots.add(frame);
          addAncestorCandidates(frame, roots);
          if (state.signaledFrames.has(frame)) addFrameWrapperCandidates(frame, roots);
        }
      });
    } catch (error) {
      debug("候选弹窗扫描失败", error);
    }
    return roots;
  }

  function collectRoots() {
    const roots = new Set();
    const domRoots = allDomRoots();
    for (const domRoot of domRoots) {
      collectRootsFromDomRoot(domRoot).forEach((el) => roots.add(el));
      observeRoot(domRoot);
    }
    collectPointRoots(roots);
    collectHighZRoots(roots);

    if (document.body && (VERIFY_URL_RE.test(location.href) || rootVerificationScore(document.body) >= 5)) {
      roots.add(document.body);
    }
    return roots;
  }

  function clickableBySemantics(el) {
    if (!(el instanceof Element) || !isVisible(el)) return false;
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const attrs = elementAttrs(el);
    let style;
    try {
      style = getComputedStyle(el);
    } catch {
      return false;
    }
    return (
      ["button", "a", "input", "summary"].includes(tag) ||
      role === "button" ||
      typeof el.onclick === "function" ||
      el.hasAttribute("tabindex") ||
      style.cursor === "pointer" ||
      Rules.CLOSE_ATTR_RE.test(attrs)
    );
  }

  function resolveClickable(el, root) {
    let current = el;
    let depth = 0;
    while (current instanceof Element && depth <= 4) {
      if (clickableBySemantics(current)) return current;
      if (current === root) break;
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function closeCandidateData(el) {
    const text = Rules.normalizeText(el.innerText || el.textContent || el.getAttribute("value") || "").slice(0, 120);
    const aria = Rules.normalizeText(el.getAttribute("aria-label") || "");
    const title = Rules.normalizeText(el.getAttribute("title") || "");
    const attrs = elementAttrs(el);
    let html = "";
    try {
      html = el.outerHTML.slice(0, 900);
    } catch {
      html = "";
    }
    return { text, aria, title, attrs, html };
  }

  function isNearTopRightOfRect(elRect, panelRect) {
    if (panelRect.width < 80 || panelRect.height < 50) return false;
    const cx = elRect.left + elRect.width / 2;
    const cy = elRect.top + elRect.height / 2;
    const rightGap = panelRect.right - cx;
    const topGap = cy - panelRect.top;
    const insideX = cx >= panelRect.left + panelRect.width * 0.55 && cx <= panelRect.right + 22;
    const insideY = cy >= panelRect.top - 22 && cy <= panelRect.top + Math.max(88, panelRect.height * 0.30);
    return insideX && insideY && rightGap >= -22 && rightGap <= Math.max(62, panelRect.width * 0.18) && topGap >= -22;
  }

  function findVerificationPanels(root) {
    const panels = new Set();
    if (!(root instanceof Element)) return [];
    const add = (el) => {
      if (!(el instanceof Element) || !isVisible(el) || isExtensionUi(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 48) return;
      if (rect.width * rect.height > viewportArea() * 1.05 && el !== root) return;
      if (rootVerificationScore(el) >= 5 || el.matches?.('iframe[src*="verify" i],iframe[src*="captcha" i],iframe[src*="x5sec" i]')) {
        panels.add(el);
      }
    };

    if (root !== document.body && root !== document.documentElement) add(root);
    let nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll([
        '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog',
        'section', 'article', 'aside', 'div', 'iframe[src]'
      ].join(","))).slice(0, 2800);
    } catch { nodes = []; }
    for (const el of nodes) add(el);

    const sorted = Array.from(panels).sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    });
    return (sorted.length ? sorted : [root]).slice(0, 18);
  }

  function positionalSignals(el, root, panels) {
    const rect = el.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    let nearPanelTopRight = false;

    for (const panel of panels || []) {
      if (!(panel instanceof Element) || !panel.isConnected) continue;
      if (isNearTopRightOfRect(rect, panel.getBoundingClientRect())) {
        nearPanelTopRight = true;
        break;
      }
    }

    let ancestor = el.parentElement;
    let depth = 0;
    while (!nearPanelTopRight && ancestor && depth < 8) {
      if (ancestor === root || root.contains(ancestor)) {
        const aRect = ancestor.getBoundingClientRect();
        if (aRect.width >= 140 && aRect.height >= 70 && aRect.width * aRect.height < viewportArea() * 0.97) {
          nearPanelTopRight = isNearTopRightOfRect(rect, aRect);
        }
      }
      if (ancestor === root) break;
      ancestor = ancestor.parentElement;
      depth += 1;
    }

    const inTopRight = isNearTopRightOfRect(rect, rootRect);
    return { rect, inTopRight, nearPanelTopRight };
  }

  function pseudoCloseIcon(el) {
    for (const pseudo of ["::before", "::after"]) {
      try {
        const style = getComputedStyle(el, pseudo);
        const content = String(style.content || "").replace(/^['"]|['"]$/g, "");
        if (/^(×|✕|✖|╳|x)$/i.test(content)) return true;
        if (style.backgroundImage && style.backgroundImage !== "none") return true;
      } catch {
        // ignored
      }
    }
    return false;
  }

  function iconOnly(el, data) {
    if (Rules.normalizeText(data.text).length > 2) return false;
    let style;
    try { style = getComputedStyle(el); } catch { style = null; }
    return Boolean(
      el.matches("svg,use,path,img,i") ||
      el.querySelector?.("svg,use,path,img,canvas") ||
      /icon.{0,8}(close|x)|close.{0,8}icon|times-circle|cross/i.test(`${data.attrs} ${data.html}`) ||
      pseudoCloseIcon(el) ||
      (style && style.backgroundImage && style.backgroundImage !== "none")
    );
  }

  function addSpatialCandidates(root, panels, candidates) {
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      const offsets = [8, 14, 22, 32, 44];
      for (const xGap of offsets) {
        for (const yGap of [8, 14, 22, 32]) {
          const x = Math.max(1, Math.min(window.innerWidth - 1, rect.right - xGap));
          const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + yGap));
          let stack = [];
          try { stack = document.elementsFromPoint(x, y) || []; } catch { stack = []; }
          for (const node of stack.slice(0, 10)) {
            if (!(node instanceof Element)) continue;
            const clickable = resolveClickable(node, root);
            if (clickable && (clickable === root || root.contains(clickable))) {
              candidates.add(clickable);
              state.spatialCandidates.add(clickable);
              continue;
            }
            // 严格模式兜底：真实关闭控件有时只是绑定 addEventListener 的普通 div，
            // 没有 role/cursor/class。只在验证面板右上角收集小尺寸节点，危险文字仍由规则层拦截。
            let current = node;
            let depth = 0;
            while (current instanceof Element && depth < 3 && (current === root || root.contains(current))) {
              const currentRect = current.getBoundingClientRect();
              if (currentRect.width >= 6 && currentRect.height >= 6 && currentRect.width <= 96 && currentRect.height <= 96) {
                candidates.add(current);
                state.spatialCandidates.add(current);
              }
              if (current === root) break;
              current = current.parentElement;
              depth += 1;
            }
          }
        }
      }
    }
  }

  function candidateScore(el, root, panels, context) {
    if (!isVisible(el)) return -Infinity;
    const lastAttempt = state.attemptedAt.get(el) || 0;
    if (Date.now() - lastAttempt < 5000) return -Infinity;

    const data = closeCandidateData(el);
    const signals = Rules.closeSignals(data);
    const { rect, inTopRight, nearPanelTopRight } = positionalSignals(el, root, panels);
    let style;
    try { style = getComputedStyle(el); } catch { style = null; }

    const small = rect.width <= 96 && rect.height <= 96;
    const disabled = el.matches?.(":disabled") || el.getAttribute("aria-disabled") === "true";
    const aggressiveLoadedPage = Boolean(
      strictLoadedPageMode() && context?.loadedPageOverlay && nearPanelTopRight
    );
    const score = Rules.scoreCloseCandidate({
      signals,
      inTopRight,
      nearPanelTopRight,
      small,
      iconOnly: state.settings.enhancedHeuristics && iconOnly(el, data),
      hasPointerCursor: style?.cursor === "pointer" || typeof el.onclick === "function" || el.hasAttribute("tabindex"),
      clickable: clickableBySemantics(el) || (aggressiveLoadedPage && state.spatialCandidates.has(el)),
      disabled,
      textLength: data.text.length,
      aggressiveLoadedPage,
      aggressiveSpatialCandidate: state.spatialCandidates.has(el)
    });
    if (aggressiveLoadedPage && Number.isFinite(score)) state.diagnostics.aggressiveCandidates += 1;
    return score;
  }

  function findSafeClose(root, context) {
    const candidates = new Set();
    const panels = findVerificationPanels(root);
    let raw = [];
    try {
      raw.push(...Array.from(root.querySelectorAll(EXPLICIT_CANDIDATE_SELECTOR)).slice(0, 2600));
      raw.push(...Array.from(root.querySelectorAll("svg,use,path,img,i")).slice(0, 1100));
      const shortSpans = Array.from(root.querySelectorAll("span,div,em")).slice(0, 4200).filter((el) => {
        const text = Rules.normalizeText(el.textContent || "");
        if (text.length <= 10 && (Rules.CLOSE_GLYPH_RE.test(text) || Rules.CLOSE_X_RE.test(text) || Rules.CLOSE_WORD_RE.test(text) || Rules.OPTIONAL_EXIT_RE.test(text))) return true;
        if (!strictLoadedPageMode() || !context?.loadedPageOverlay || text.length > 2) return false;
        const click = resolveClickable(el, root);
        if (!click) return false;
        const signals = positionalSignals(click, root, panels);
        return signals.nearPanelTopRight;
      });
      raw.push(...shortSpans);
    } catch { raw = []; }

    if (root.matches?.(EXPLICIT_CANDIDATE_SELECTOR)) raw.unshift(root);
    for (const node of raw) {
      const clickable = resolveClickable(node, root);
      if (clickable && (clickable === root || root.contains(clickable))) candidates.add(clickable);
    }
    if (strictLoadedPageMode() && context?.loadedPageOverlay) addSpatialCandidates(root, panels, candidates);

    state.diagnostics.closeCandidates += candidates.size;
    let best = null;
    let bestScore = -Infinity;
    for (const el of candidates) {
      const score = candidateScore(el, root, panels, context);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best && bestScore >= 9 ? { element: best, score: bestScore } : null;
  }

  async function mutateStats(mutator) {
    try {
      const current = await chrome.storage.local.get({
        stats: {
          closedCount: 0,
          mandatoryCount: 0,
          lastAction: "",
          lastUrl: "",
          recentActions: []
        }
      });
      const next = mutator({ ...current.stats });
      next.updatedAt = new Date().toISOString();
      next.lastUrl = location.href;
      next.recentActions = Array.isArray(next.recentActions) ? next.recentActions.slice(-12) : [];
      await chrome.storage.local.set({ stats: next });
    } catch (error) {
      debug("统计写入失败", error);
    }
  }

  function recordClosed(el, score, context) {
    const desc = describeElement(el);
    state.diagnostics.lastAction = `已点击关闭按钮（评分 ${score}）`;
    mutateStats((stats) => ({
      ...stats,
      closedCount: Number(stats.closedCount || 0) + 1,
      lastAction: "已关闭可选验证弹窗",
      recentActions: [...(stats.recentActions || []), {
        type: "closed",
        at: new Date().toISOString(),
        host: location.hostname,
        element: desc
      }]
    }));
    try {
      chrome.runtime.sendMessage({
        type: "VPH_RISK_EVENT",
        kind: context?.loadedPageOverlay ? "optional-loaded" : "optional",
        source: "popup-closer"
      });
    } catch {
      // ignored
    }
  }

  function recordMandatory(key) {
    state.diagnostics.lastAction = "检测到必须验证或未知验证弹窗";
    mutateStats((stats) => ({
      ...stats,
      mandatoryCount: Number(stats.mandatoryCount || 0) + 1,
      lastAction: "检测到必须手动验证",
      recentActions: [...(stats.recentActions || []), {
        type: "mandatory",
        at: new Date().toISOString(),
        host: location.hostname,
        key
      }]
    }));
    try {
      chrome.runtime.sendMessage({ type: "VPH_RISK_EVENT", kind: "mandatory", source: "popup-closer" });
    } catch {
      // ignored
    }
  }

  function nativeClick(el) {
    const view = el.ownerDocument?.defaultView || window;
    // 只触发一次 click，避免 pointer/mouse/click 多套事件导致站点处理器重复执行。
    try {
      const click = view.HTMLElement?.prototype?.click;
      if (typeof click === "function") {
        click.call(el);
        return true;
      }
    } catch {
      // SVG 或非 HTMLElement 控件改用单次 click 事件。
    }
    try {
      el.dispatchEvent(new view.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view
      }));
      return true;
    } catch (error) {
      debug("关闭按钮点击失败", error);
      return false;
    }
  }

  function hasVisibleModal() {
    try {
      return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog'))
        .some((el) => isVisible(el));
    } catch {
      return true;
    }
  }

  function releaseStalePageLocks() {
    if (window !== window.top || hasVisibleModal()) return;
    for (const el of [document.documentElement, document.body]) {
      if (!(el instanceof HTMLElement)) continue;
      const inlineOverflow = String(el.style.overflow || "").toLowerCase();
      const inlinePointer = String(el.style.pointerEvents || "").toLowerCase();
      if ((inlineOverflow === "hidden" || inlineOverflow === "clip") && document.documentElement.scrollHeight > window.innerHeight + 120) {
        el.style.removeProperty("overflow");
      }
      if (inlinePointer === "none") el.style.removeProperty("pointer-events");
    }
    try {
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch { /* ignored */ }
  }

  function monitorAfterClose(beforeState) {
    if (window !== window.top) return;
    const checkpoints = [500, 1400, 3200, 6500];
    for (const delay of checkpoints) {
      window.setTimeout(() => {
        state.diagnostics.postCloseChecks += 1;
        const current = measureContentReadiness(null);
        if (current.rawReady) {
          releaseStalePageLocks();
          return;
        }
        if (delay === checkpoints[checkpoints.length - 1] && (current.headerOnly || current.skeletonDominant)) {
          const now = Date.now();
          if (now - state.contentReadiness.postCloseIssueAt > 15000) {
            state.contentReadiness.postCloseIssueAt = now;
            state.diagnostics.postCloseIncomplete += 1;
            state.diagnostics.lastAction = "关闭后主体内容仍未恢复；已停止继续自动关闭";
            mutateStats((stats) => ({
              ...stats,
              lastAction: "关闭后检测到页面内容未恢复，请刷新当前页面",
              recentActions: [...(stats.recentActions || []), {
                type: "content-incomplete-after-close",
                at: new Date().toISOString(),
                host: location.hostname,
                before: beforeState,
                after: current
              }]
            }));
          }
        }
      }, delay);
    }
  }

  function clickClose(root, candidate, context) {
    const now = Date.now();
    if (now - state.lastClickAt < 500) {
      queueRoot(root, 560);
      return;
    }
    const el = candidate.element;
    if (!el?.isConnected || !root?.isConnected || !isVisible(el)) return;

    // 点击前再次确认主体内容仍然稳定，避免刚进入骨架屏时误关验证层。
    const freshContext = verificationContext(root);
    if (state.settings.contentLoadProtection && !freshContext.loadedPageOverlay) {
      state.diagnostics.contentDeferrals += 1;
      deferRoot(root, 500);
      return;
    }

    state.lastClickAt = now;
    state.attemptedAt.set(el, now);
    debug("尝试关闭可选验证弹窗", candidate.score, describeElement(el));

    if (nativeClick(el)) {
      recordClosed(el, candidate.score, freshContext);
      monitorAfterClose(freshContext.contentState || context?.contentState || null);
      window.setTimeout(() => scanAll("after-close"), 650);
      window.setTimeout(() => scanAll("after-close-fallback"), 1600);
    }
  }

  function rootKey(root) {
    const desc = describeElement(root);
    return [
      location.hostname,
      desc?.tag,
      desc?.id,
      desc?.className,
      desc?.text?.slice(0, 80),
      desc?.rect?.x,
      desc?.rect?.y,
      desc?.rect?.w,
      desc?.rect?.h
    ].join("|").slice(0, 600);
  }

  function notifyTopChildVerification(key, candidate = null) {
    if (window === window.top) return;
    state.diagnostics.childVerificationSignals += 1;
    try {
      window.top.postMessage({
        __vph1688: true,
        type: "child-verification",
        key,
        host: location.hostname,
        frameUrl: location.href,
        candidateFound: Boolean(candidate),
        candidateScore: Number(candidate?.score || 0)
      }, "*");
    } catch {
      // ignored
    }
  }

  function signaledFramesInside(root) {
    const frames = [];
    if (!(root instanceof Element)) return frames;
    if (root.matches?.("iframe") && state.signaledFrames.has(root)) frames.push(root);
    try {
      root.querySelectorAll?.("iframe").forEach((frame) => {
        if (state.signaledFrames.has(frame) && !frames.includes(frame)) frames.push(frame);
      });
    } catch {
      // ignored
    }
    return frames;
  }

  function authorizeChildFrames(root, context) {
    if (window !== window.top || !context?.loadedPageOverlay || !context?.contentState?.stableReady) return false;
    const validUntil = Date.now() + 5000;
    let sent = false;
    for (const frame of signaledFramesInside(root)) {
      try {
        frame.contentWindow?.postMessage({
          __vph1688: true,
          type: "allow-child-close",
          validUntil,
          parentUrl: location.href,
          reason: "parent-product-content-stable"
        }, "*");
        state.diagnostics.childCloseAuthorizations += 1;
        sent = true;
      } catch {
        // ignored
      }
    }
    if (sent) state.diagnostics.lastAction = "商品内容已加载，已授权验证 iframe 关闭弹窗";
    return sent;
  }

  function clickAuthorizedChildClose(root, candidate) {
    if (window === window.top || Date.now() > state.childCloseAuthorizedUntil) return false;
    const now = Date.now();
    if (now - state.lastClickAt < 500) {
      queueRoot(root, 560);
      return false;
    }
    const el = candidate?.element;
    if (!el?.isConnected || !root?.isConnected || !isVisible(el)) return false;
    state.lastClickAt = now;
    state.attemptedAt.set(el, now);
    state.diagnostics.childCloseAttempts += 1;
    if (!nativeClick(el)) return false;
    state.diagnostics.childCloseSuccesses += 1;
    recordClosed(el, candidate.score, { loadedPageOverlay: true, kind: "authorized-child-overlay" });
    try {
      window.top.postMessage({
        __vph1688: true,
        type: "child-closed",
        host: location.hostname,
        frameUrl: location.href
      }, "*");
    } catch {
      // ignored
    }
    window.setTimeout(() => scanAll("child-after-close"), 650);
    return true;
  }

  function recordEscapeClose(root) {
    const desc = describeElement(root);
    state.diagnostics.lastAction = "已用 Esc 关闭正常页面上的验证弹窗";
    mutateStats((stats) => ({
      ...stats,
      closedCount: Number(stats.closedCount || 0) + 1,
      lastAction: "已关闭可选验证弹窗（Esc）",
      recentActions: [...(stats.recentActions || []), {
        type: "closed-escape",
        at: new Date().toISOString(),
        host: location.hostname,
        root: desc
      }]
    }));
    try {
      chrome.runtime.sendMessage({ type: "VPH_RISK_EVENT", kind: "optional-loaded", source: "escape-closer" });
    } catch {
      // ignored
    }
  }

  function tryEscapeClose(root, context) {
    if (!strictLoadedPageMode() || !context?.loadedPageOverlay || window !== window.top) return false;
    const now = Date.now();
    const last = state.escapeAttemptedAt.get(root) || 0;
    if (now - last < 3600) return false;
    state.escapeAttemptedAt.set(root, now);
    state.diagnostics.escapeAttempts += 1;

    const options = {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    const target = document.activeElement instanceof Element ? document.activeElement : document;
    try {
      target.dispatchEvent(new KeyboardEvent("keydown", options));
      document.dispatchEvent(new KeyboardEvent("keydown", options));
      window.dispatchEvent(new KeyboardEvent("keydown", options));
      target.dispatchEvent(new KeyboardEvent("keyup", options));
    } catch {
      return false;
    }

    window.setTimeout(() => {
      if (!root.isConnected || !isVisible(root) || rootVerificationScore(root) < 5) {
        recordEscapeClose(root);
      } else {
        queueRoot(root, 240);
      }
    }, 320);
    return true;
  }

  function deferRoot(root, delay = 320) {
    const now = Date.now();
    const current = state.unresolvedAt.get(root) || { firstAt: now, attempts: 0 };
    current.attempts += 1;
    state.unresolvedAt.set(root, current);
    if (current.attempts <= 8 || now - current.firstAt < 5200) {
      queueRoot(root, Math.min(900, delay + current.attempts * 70));
      return true;
    }
    return false;
  }

  function inspectRoot(root) {
    if (!state.settings.enabled || !(root instanceof Element) || !isVisible(root)) return;
    state.diagnostics.rootsInspected += 1;
    const verificationScore = rootVerificationScore(root);
    if (verificationScore < 5) return;

    const context = verificationContext(root);
    state.diagnostics.verificationRoots += 1;
    if (context.loadedPageOverlay) state.diagnostics.loadedOverlayDetections += 1;
    if (context.fullPageMandatory) state.diagnostics.fullPageDetections += 1;
    const desc = describeElement(root);
    state.diagnostics.recentRoots.push({ score: verificationScore, context: context.kind, reason: context.reason, ...desc });
    state.diagnostics.recentRoots = state.diagnostics.recentRoots.slice(-10);

    const key = rootKey(root);

    // 跨域验证 iframe 自己能看见关闭按钮，但顶层页面看不见。
    // 子 frame 先上报；只有顶层确认商品内容已经稳定加载后，才会短时授权子 frame 点击关闭。
    if (context.kind === "child-frame") {
      const authorized = Date.now() <= state.childCloseAuthorizedUntil;
      const childContext = authorized
        ? { ...context, loadedPageOverlay: true, kind: "authorized-child-overlay" }
        : context;
      const candidate = findSafeClose(root, childContext);
      notifyTopChildVerification(key, candidate);
      if (authorized && candidate) {
        clickAuthorizedChildClose(root, candidate);
      } else {
        deferRoot(root, authorized ? 260 : 620);
      }
      return;
    }

    // 页头、骨架屏、列表未渲染完成时绝不点击任何关闭控件。
    if (context.defer || !context.loadedPageOverlay) {
      if (context.fullPageMandatory && !state.mandatoryNotifiedKeys.has(key)) {
        state.mandatoryNotifiedKeys.add(key);
        recordMandatory(key);
        return;
      }
      state.diagnostics.contentDeferrals += 1;
      deferRoot(root, context.contentState?.rawReady ? 420 : 700);
      return;
    }

    const childAuthorized = authorizeChildFrames(root, context);
    const candidate = findSafeClose(root, context);
    if (candidate) {
      clickClose(root, candidate, context);
      return;
    }
    if (childAuthorized) {
      deferRoot(root, 320);
      return;
    }

    // 内容加载保护开启时不再使用 Esc，避免 Esc 被页面框架解释为取消加载或终止弹层流程。
    state.diagnostics.lastAction = "主体内容已稳定，正在继续查找明确关闭控件";
    if (!state.settings.contentLoadProtection) tryEscapeClose(root, context);
    deferRoot(root, 520);
  }

  function flushRoots() {
    state.scanTimer = null;
    const roots = Array.from(state.queuedRoots);
    state.queuedRoots.clear();
    roots
      .filter((el) => el?.isConnected && isVisible(el))
      .sort((a, b) => {
        const za = Number.parseInt(getComputedStyle(a).zIndex, 10) || 0;
        const zb = Number.parseInt(getComputedStyle(b).zIndex, 10) || 0;
        return zb - za;
      })
      .forEach(inspectRoot);
  }

  function queueRoot(root, delay = 90) {
    if (!(root instanceof Element) || isExtensionUi(root)) return;
    state.queuedRoots.add(root);
    if (!state.scanTimer) state.scanTimer = window.setTimeout(flushRoots, delay);
  }

  function scanAll(reason = "periodic") {
    purgeLegacyFloatingUi();
    if (!state.settings.enabled || !state.allowed || !document.documentElement) return;
    state.diagnostics.scans += 1;
    state.diagnostics.lastScanReason = reason;
    state.diagnostics.lastScanAt = new Date().toISOString();
    state.diagnostics.framesSeen = document.querySelectorAll?.("iframe").length || 0;
    const now = Date.now();
    if (now - state.lastShadowDiscoveryAt >= 5000) {
      state.lastShadowDiscoveryAt = now;
      discoverOpenShadowRoots();
    }
    for (const root of collectRoots()) queueRoot(root);
  }

  state.scan = scanAll;

  function observeRoot(root) {
    if (!root || state.observers.has(root)) return;
    const observer = new MutationObserver((mutations) => {
      if (!state.settings.enabled) return;
      for (const mutation of mutations) {
        if (mutation.target instanceof Element) addAncestorCandidates(mutation.target, state.queuedRoots);
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element) || isExtensionUi(node)) continue;
          if (node.shadowRoot) registerShadowRoot(node.shadowRoot);
          if (node.matches?.(ROOT_SELECTOR) || isOverlayLike(node)) queueRoot(node);
          try {
            node.querySelectorAll?.(ROOT_SELECTOR).forEach((el) => queueRoot(el));
            node.querySelectorAll?.("iframe[src]").forEach((frame) => {
              if (VERIFY_URL_RE.test(frame.getAttribute("src") || "")) {
                queueRoot(frame);
                addAncestorCandidates(frame, state.queuedRoots);
              }
            });
          } catch {
            // ignored
          }
        }
      }
      if (!state.scanTimer && state.queuedRoots.size) state.scanTimer = window.setTimeout(flushRoots, 90);
    });
    try {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-modal", "aria-label", "title", "src"]
      });
      state.observers.set(root, observer);
    } catch (error) {
      debug("MutationObserver 初始化失败", error);
    }
  }

  function diagnosticReport() {
    const iframeOrigins = [];
    try {
      document.querySelectorAll("iframe[src]").forEach((frame) => {
        const url = safeUrl(frame.getAttribute("src"));
        const value = url ? `${url.origin}${url.pathname.slice(0, 120)}` : frame.getAttribute("src");
        if (value && !iframeOrigins.includes(value)) iframeOrigins.push(value);
      });
    } catch {
      // ignored
    }
    return {
      extension: "1688 验证弹窗助手（防触发版）",
      version: VERSION,
      injected: true,
      enabled: state.settings.enabled,
      allowedContext: state.allowed,
      url: location.href,
      frame: window === window.top ? "top" : "child",
      ancestorOrigins: getAncestorOrigins(),
      diagnostics: state.diagnostics,
      iframeOrigins: iframeOrigins.slice(0, 30),
      generatedAt: new Date().toISOString()
    };
  }

  window.addEventListener("message", (event) => {
    if (!event.data?.__vph1688) return;

    // 子验证 frame 只接受来自顶层页面的短时关闭授权。
    if (window !== window.top) {
      if (event.source !== window.top || event.data.type !== "allow-child-close") return;
      const validUntil = Math.min(Date.now() + 8000, Number(event.data.validUntil || 0));
      if (validUntil <= Date.now()) return;
      state.childCloseAuthorizedUntil = validUntil;
      state.childCloseAuthorizationReason = String(event.data.reason || "parent-authorized");
      state.diagnostics.lastAction = "顶层商品内容已稳定，正在关闭验证 iframe";
      scanAll("child-close-authorized");
      window.setTimeout(() => scanAll("child-close-authorized-fallback"), 180);
      return;
    }

    if (event.data.type === "child-closed") {
      state.diagnostics.lastAction = "验证 iframe 已关闭，正在恢复商品页面";
      releaseStalePageLocks();
      window.setTimeout(() => scanAll("child-closed"), 300);
      window.setTimeout(() => releaseStalePageLocks(), 900);
      return;
    }

    if (event.data.type !== "child-verification") return;
    try {
      document.querySelectorAll("iframe").forEach((frame) => {
        if (frame.contentWindow === event.source) {
          state.signaledFrames.add(frame);
          queueRoot(frame, 40);
          addAncestorCandidates(frame, state.queuedRoots);
          addFrameWrapperCandidates(frame, state.queuedRoots);

          // 若商品列表此时已经稳定，立即回传关闭授权；否则等待后续扫描确认。
          const frameContext = verificationContext(frame);
          if (frameContext.loadedPageOverlay && frameContext.contentState?.stableReady) {
            authorizeChildFrames(frame, frameContext);
          }
        }
      });
    } catch {
      // ignored
    }
    scanAll("child-verification");
  });


  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "VPH_PING") {
      sendResponse({
        ok: true,
        version: VERSION,
        enabled: state.settings.enabled,
        allowedContext: state.allowed,
        frame: window === window.top ? "top" : "child",
        lastAction: state.diagnostics.lastAction,
        scans: state.diagnostics.scans,
        contentState: state.contentReadiness.last
      });
      return false;
    }
    if (message.type === "VPH_SCAN") {
      scanAll("manual");
      sendResponse({ ok: true, message: "已执行扫描", diagnostics: state.diagnostics });
      return false;
    }
    if (message.type === "VPH_DIAGNOSTIC") {
      sendResponse({ ok: true, report: diagnosticReport() });
      return false;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(DEFAULTS)) {
      const storageKey = key === "enabled" ? "ethan1688PopupCloseEnabled" : key;
      if (changes[storageKey]) state.settings[key] = changes[storageKey].newValue ?? DEFAULTS[key];
    }
    if (state.settings.enabled) scanAll("settings-changed");
  });

  async function loadSettings() {
    try {
      const saved = await chrome.storage.sync.get({ ethan1688PopupCloseEnabled: false });
      state.settings = { ...DEFAULTS, enabled: saved.ethan1688PopupCloseEnabled === true };
    } catch (error) {
      debug("读取设置失败", error);
    }
  }

  function start() {
    purgeLegacyFloatingUi();
    if (document.documentElement) {
      document.documentElement.dataset.vph1688 = VERSION;
    }
    observeRoot(document);
    scanAll("startup");
    window.setTimeout(() => scanAll("startup-500ms"), 500);
    window.setTimeout(() => scanAll("startup-1500ms"), 1500);
    state.intervalId = window.setInterval(() => scanAll("periodic"), 2200);
  }

  loadSettings().finally(() => {
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
})();
