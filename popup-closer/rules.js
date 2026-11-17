(() => {
  "use strict";

  const VERIFY_TEXT_RE = /(请.{0,10}(完成|进行)?.{0,6}验证|安全验证|滑动验证|拖动.{0,10}滑块|点击.{0,10}验证|人机验证|身份验证|账号.{0,8}验证|验证后继续|完成验证后|访问过于频繁|操作过于频繁|请求过于频繁|异常访问|风险校验|风险验证|网络.{0,10}风险|设备.{0,10}风险|确认你是真人|证明你不是机器人|机器人验证|验证码)/i;
  const VERIFY_ATTR_RE = /(captcha|verify|verification|nocaptcha|baxia|x5sec|punish|risk[-_]?check|security[-_]?check|sec[-_]?check|human[-_]?check|anti[-_]?bot|challenge)/i;

  const CLOSE_WORD_RE = /^(关闭|关\s*闭|close|关闭弹窗|关闭窗口|收起)$/i;
  const OPTIONAL_EXIT_RE = /^(取消|暂不|暂不验证|暂不校验|暂不认证|暂不处理|稍后|稍后再说|稍后处理|稍后验证|稍后认证|以后再说|跳过|忽略|返回|返回页面|返回商品|退出|关闭并继续|继续浏览|先逛逛|不用了|不再提示|我知道了|知道了|好的)$/i;
  const CLOSE_GLYPH_RE = /^(×|✕|✖|╳|❌)$/;
  const CLOSE_X_RE = /^x$/i;
  const CLOSE_ATTR_RE = /(^|[-_\s])(close|closed|dismiss|cancel|skip|later|dialog-close|modal-close|popup-close|icon-close|btn-close)([-_\s]|$)/i;
  const DANGEROUS_ACTION_RE = /(验证|确认|提交|登录|注册|继续|下一步|完成|刷新|重试|发送|获取|扫码|申诉|解除|解锁|支付|付款|下单|购买)/i;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function verificationScore({ text = "", attrs = "", url = "", frameSrc = "" } = {}) {
    let score = 0;
    const normalizedText = normalizeText(text).slice(0, 2000);
    const normalizedAttrs = normalizeText(attrs).slice(0, 1200);
    if (VERIFY_TEXT_RE.test(normalizedText)) score += 7;
    if (VERIFY_ATTR_RE.test(normalizedAttrs)) score += 6;
    if (VERIFY_ATTR_RE.test(String(url))) score += 5;
    if (VERIFY_ATTR_RE.test(String(frameSrc))) score += 5;
    return score;
  }

  function closeSignals({ text = "", aria = "", title = "", attrs = "", html = "" } = {}) {
    const t = normalizeText(text).slice(0, 120);
    const a = normalizeText(aria).slice(0, 120);
    const ti = normalizeText(title).slice(0, 120);
    const blob = normalizeText(`${attrs} ${html}`).slice(0, 1000);

    const word = CLOSE_WORD_RE.test(t) || CLOSE_WORD_RE.test(a) || CLOSE_WORD_RE.test(ti);
    const optionalExit = OPTIONAL_EXIT_RE.test(t) || OPTIONAL_EXIT_RE.test(a) || OPTIONAL_EXIT_RE.test(ti);
    const glyph = CLOSE_GLYPH_RE.test(t) || CLOSE_GLYPH_RE.test(a) || CLOSE_GLYPH_RE.test(ti);
    const x = CLOSE_X_RE.test(t) || CLOSE_X_RE.test(a) || CLOSE_X_RE.test(ti);
    const attr = CLOSE_ATTR_RE.test(blob);
    const dangerous = DANGEROUS_ACTION_RE.test(t) && !(word || optionalExit || glyph || attr);

    return { word, optionalExit, glyph, x, attr, dangerous };
  }

  function scoreCloseCandidate({
    signals,
    inTopRight = false,
    small = false,
    iconOnly = false,
    nearPanelTopRight = false,
    hasPointerCursor = false,
    clickable = false,
    disabled = false,
    textLength = 0,
    aggressiveLoadedPage = false,
    aggressiveSpatialCandidate = false
  } = {}) {
    if (!signals || !clickable || disabled || signals.dangerous) return -Infinity;

    let score = 0;
    if (signals.word) score += 9;
    if (signals.optionalExit) score += 8;
    if (signals.glyph) score += 9;
    if (signals.attr) score += 8;
    if (signals.x) score += 4;
    if (nearPanelTopRight) score += 4;
    else if (inTopRight) score += 2;
    if (small) score += 1;
    if (hasPointerCursor) score += 1;
    if (iconOnly && (nearPanelTopRight || inTopRight)) score += 6;
    if (aggressiveLoadedPage && nearPanelTopRight && small && textLength <= 2 && (hasPointerCursor || aggressiveSpatialCandidate)) score += 6;
    if (textLength > 50) score -= 4;

    const explicit = signals.word || signals.optionalExit || signals.glyph || signals.attr;
    const aggressiveSpatial = aggressiveLoadedPage && nearPanelTopRight && small && textLength <= 2 && (hasPointerCursor || aggressiveSpatialCandidate);
    if (!explicit && !(signals.x && (nearPanelTopRight || inTopRight)) && !(iconOnly && nearPanelTopRight) && !aggressiveSpatial) {
      return -Infinity;
    }
    return score;
  }

  globalThis.VPHRules = Object.freeze({
    VERIFY_TEXT_RE,
    VERIFY_ATTR_RE,
    CLOSE_WORD_RE,
    OPTIONAL_EXIT_RE,
    CLOSE_GLYPH_RE,
    CLOSE_X_RE,
    CLOSE_ATTR_RE,
    DANGEROUS_ACTION_RE,
    normalizeText,
    verificationScore,
    closeSignals,
    scoreCloseCandidate
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.VPHRules;
  }
})();
