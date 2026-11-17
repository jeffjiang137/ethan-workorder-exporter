(() => {
  "use strict";

  function result(kind, fullPageMandatory, loadedPageOverlay, defer, reason) {
    return Object.freeze({ kind, fullPageMandatory, loadedPageOverlay, defer, reason });
  }

  function classifyVerificationContext({
    isTopFrame = true,
    urlLooksVerification = false,
    loadedEvidence = 0,
    rootAreaRatio = 0,
    rootIsDocument = false,
    documentAgeMs = 0,
    contentLoadProtection = true,
    contentReady = false,
    contentStableMs = 0,
    requiredStableMs = 1200,
    headerOnly = false,
    skeletonDominant = false
  } = {}) {
    if (!isTopFrame) {
      return result("child-frame", false, false, true, "child-frame");
    }

    if (urlLooksVerification) {
      return result("full-page", true, false, false, "verification-url");
    }

    const evidence = Math.max(0, Number(loadedEvidence || 0));
    const ratio = Math.max(0, Number(rootAreaRatio || 0));
    const age = Math.max(0, Number(documentAgeMs || 0));
    const stableMs = Math.max(0, Number(contentStableMs || 0));
    const stableNeed = Math.max(500, Number(requiredStableMs || 1200));

    if (contentLoadProtection) {
      // 只有商品卡片、产品图片或主内容真实出现，并持续稳定一段时间后，才允许关闭弹窗。
      if (contentReady && stableMs >= stableNeed) {
        return result("loaded-page-overlay", false, true, false, "content-stable");
      }

      // 主体已出现但还没有稳定到阈值时继续等待。
      if (contentReady) {
        return result("loading-content", false, false, true, "waiting-stability");
      }

      // 页头、导航、空白框架或骨架屏不等于主体内容已经加载。
      if (headerOnly || skeletonDominant) {
        if (age < 10000) {
          return result("loading-content", false, false, true, "header-or-skeleton");
        }
        if (rootIsDocument || ratio >= 0.82) {
          return result("full-page", true, false, false, "content-never-loaded");
        }
        return result("unknown-incomplete", false, false, true, "content-incomplete");
      }

      // 页面刚进入时继续等待，不在加载阶段点击关闭控件。
      if (age < 10000) {
        return result("loading", false, false, true, "document-loading");
      }

      // 长时间没有主体内容，且验证层占据主体区域时，按纯验证页处理，不自动关闭。
      if (rootIsDocument || ratio >= 0.82) {
        return result("full-page", true, false, false, "content-never-loaded");
      }

      return result("unknown-incomplete", false, false, true, "content-incomplete");
    }

    // 关闭内容加载保护时，保留旧版的宽松判断逻辑。
    if (evidence >= 5 || (evidence >= 3 && ratio < 0.97) || (evidence >= 2 && ratio < 0.72)) {
      return result("loaded-page-overlay", false, true, false, "legacy-evidence");
    }

    if (age < 2600) {
      return result("loading", false, false, true, "legacy-loading");
    }

    if (rootIsDocument || ratio >= 0.76) {
      return result("full-page", true, false, false, "legacy-full-page");
    }

    return result("unknown-overlay", false, false, true, "legacy-unknown");
  }

  globalThis.VPHPageContext = Object.freeze({ classifyVerificationContext });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.VPHPageContext;
  }
})();
