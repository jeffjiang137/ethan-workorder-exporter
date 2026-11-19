'use strict';

(() => {
  if (window.__KKT_AUTO_QUEUE_LOADED__) return;
  window.__KKT_AUTO_QUEUE_LOADED__ = true;

  const ROOT_ID = 'kkt-autoqueue-root';
  const DEFAULTS = {
    autoStart: true,
    preferDirectDownload: true,
    timeoutSeconds: 180,
    retries: 1,
    nextDelayMs: 1200,
    outputFolder: '抠抠图自动抠图',
    preserveFolderStructure: true,
    suppressDownloadUiUntilLast: true,
    autoClearCompletedQueue: true
  };

  const state = {
    items: [],
    running: false,
    paused: false,
    stopRequested: false,
    currentId: null,
    settings: { ...DEFAULTS },
    logs: [],
    lastDownloadMessages: new Map(),
    downloadUiSuppressed: false
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nowText = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const norm = (value) => String(value || '').replace(/\s+/g, '').trim().toLowerCase();
  const baseName = (name) => String(name || 'image').replace(/\.[^.]+$/, '');
  const sanitizePathSegment = (name, fallback = '') => {
    const cleaned = String(name || '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 160);
    if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) return `_${cleaned}`;
    return cleaned;
  };
  const sanitizeBase = (name) => sanitizePathSegment(baseName(name), 'image');
  const normalizeRelativePath = (value) => String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  const sanitizeFolderPath = (value) => normalizeRelativePath(value)
    .split('/')
    .map((part) => sanitizePathSegment(part))
    .filter(Boolean)
    .join('/');
  const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  function log(message, level = 'info') {
    const entry = { time: nowText(), level, message };
    state.logs.push(entry);
    if(new URLSearchParams(location.search).get('ethanEmbedded')==='1')void chrome.storage.local.set({ethanKktProgress:{message,running:state.running,level}});
    if (state.logs.length > 120) state.logs.shift();
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('[抠图队列]', message);
    renderLogTail();
  }

  function isOwnElement(element) {
    if (!element) return false;
    if (element.closest?.('#ethan-kkt-waiting')) return true;
    const root = document.getElementById(ROOT_ID);
    return Boolean(root && (element === root || root.contains(element) || element.getRootNode?.().host === root));
  }

  function visible(element, { allowOffscreen = false } = {}) {
    if (!(element instanceof Element) || isOwnElement(element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return false;
    if (allowOffscreen || new URLSearchParams(location.search).get('ethanEmbedded')==='1') return true;
    return rect.bottom > 0 && rect.top < innerHeight * 1.8;
  }

  function deepQueryAll(selector, root = document) {
    const output = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      for (const element of node.querySelectorAll(selector)) {
        if (!isOwnElement(element)) output.push(element);
      }
      for (const element of node.querySelectorAll('*')) {
        if (element.shadowRoot && element.id !== ROOT_ID) visit(element.shadowRoot);
      }
    };
    visit(root);
    return [...new Set(output)];
  }

  function textOf(element) {
    if (!element) return '';
    return String(
      element.innerText || element.textContent || element.value || element.getAttribute?.('aria-label') || element.getAttribute?.('title') || ''
    ).replace(/\s+/g, ' ').trim();
  }

  function controlSearchText(element) {
    const text = textOf(element);
    if (text) return text;
    return [
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('data-tooltip'),
      element?.getAttribute?.('data-action'),
      element?.getAttribute?.('data-download-url'),
      element?.getAttribute?.('data-url'),
      String(element?.className || '')
    ].filter(Boolean).join(' ');
  }

  function hasDownloadHint(element) {
    return /(download|下载|save|保存|export|导出)/i.test([
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('data-tooltip'),
      element?.getAttribute?.('data-action'),
      element?.getAttribute?.('data-download-url'),
      element?.getAttribute?.('data-url'),
      String(element?.className || '')
    ].filter(Boolean).join(' '));
  }

  function isDownloadControl(element) {
    if (!(element instanceof Element)) return false;
    return isInteractive(element)
      || element.matches('a[href],a[download],[data-url],[data-download-url]')
      || hasDownloadHint(element);
  }

  function downloadPriority(element) {
    const text = norm(textOf(element));
    if (!text) return 0;
    if (/下载设置|downloadsettings|记住下载格式选择|rememberdownloadformat/.test(text)) return -1000;
    if (/下载图片\(png\)|下载图片png|downloadimage\(png\)/.test(text)) return 90;
    if (/下载高清大图|下载高清图|高清下载|downloadhighresolution|highresolutiondownload/.test(text)) return 60;
    if (/免费下载|freedownload|downloadoriginal|下载原图/.test(text)) return 45;
    if (/标清下载|standarddownload/.test(text)) return -35;
    if (/^(download|下载)$/.test(text)) return -80;
    return 0;
  }

  function isInteractive(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches('button,a[href],[role="button"],input[type="button"],input[type="submit"],[onclick],[tabindex]:not([tabindex="-1"])')) return true;
    if (typeof element.onclick === 'function') return true;
    const className = String(element.className || '');
    if (/(^|\s)(cursor-pointer|clickable|download-btn|download-button|action-btn)(\s|$)/i.test(className)) return true;
    try { return getComputedStyle(element).cursor === 'pointer'; } catch (_) { return false; }
  }

  function keywordScore(rawText, keywords) {
    const text = norm(rawText);
    if (!text) return -Infinity;
    let best = -Infinity;
    for (const keyword of keywords) {
      const key = norm(keyword);
      if (!key) continue;
      if (text === key) best = Math.max(best, 150);
      else if (text.startsWith(key) || text.endsWith(key)) best = Math.max(best, 125 - Math.max(0, text.length - key.length));
      else if (text.includes(key)) best = Math.max(best, 100 - Math.max(0, text.length - key.length));
    }
    return best;
  }

  function closestControl(element, type) {
    let current = element;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      if (isOwnElement(current)) break;
      if (isInteractive(current)) return current;
      const className = String(current.className || '');
      if (type === 'download' && /download|save|export/i.test(className)) return current;
      if (depth > 0 && textOf(current).length > 120) break;
    }
    // Vue/React sites sometimes attach the click handler to a plain div without
    // a semantic role. Clicking the matching leaf still bubbles to its parent.
    return type === 'download' && isDownloadControl(element) ? element : null;
  }

  function scoreControl(element, keywords, type = 'button') {
    if (!visible(element, { allowOffscreen: true })) return -Infinity;
    const rawText = textOf(element);
    const searchText = controlSearchText(element);
    if (!searchText || rawText.length > 180) return -Infinity;
    let best = keywordScore(searchText, keywords);
    if (!Number.isFinite(best)) return -Infinity;

    const normalized = norm(rawText);
    if (/客户端下载|下载客户端/.test(rawText)) return -Infinity;
    if (type === 'start') {
      if (!isInteractive(element)) return -Infinity;
      if (rawText.length > 45 || /(点击图片|试试这些图片|自动加载高清原图|教程|功能展示|采用自研|支持强大)/i.test(rawText)) return -Infinity;
    }
    if (type === 'reset' && !isInteractive(element)) return -Infinity;
    if (type === 'download') {
      if (!isDownloadControl(element)) return -Infinity;
      if (/(无需下载|在线操作.*下载|download\s+successful|下载成功|客户端下载|下载客户端)/i.test(rawText)) return -Infinity;
      if (!/(download|下载|save|保存|export|导出)/i.test(searchText)) return -Infinity;
      const priority = downloadPriority(element);
      if (priority <= -1000) return -Infinity;
      best += priority;
    }

    const rect = element.getBoundingClientRect();
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    const area = rect.width * rect.height;
    if (isInteractive(element)) best += 38;
    if (element.matches('button,input[type="button"],input[type="submit"],[role="button"]')) best += 20;
    if (type === 'download' && element.matches('a[download],a[href]')) best += 24;
    if (type === 'download' && /(png|高清|原图|透明)/i.test(rawText)) best += 18;
    if (rawText.length <= 30) best += 18;
    else if (rawText.length <= 60) best += 8;
    if (element.children.length === 0) best += 8;
    if (area > viewportArea * 0.45) best -= 120;
    if (rect.top >= 0 && rect.bottom <= innerHeight) best += 8;
    if (element.closest('[role="dialog"],.modal,.dialog,[class*="result"],[class*="download"],[class*="upload"]')) best += 8;
    if (normalized === '免费下载高清大图(png)' || normalized === '下载高清大图(png)') best += 35;
    return best;
  }

  function semanticCandidates(keywords, type = 'button') {
    const broadSelector = [
      'button', 'a', '[role="button"]', 'input[type="button"]', 'input[type="submit"]',
      '[onclick]', '[tabindex]', '[class*="btn"]', '[class*="button"]', '[class*="download"]',
      '[class*="Download"]', '[class*="cursor"]', '[aria-label]', '[title]', '[data-url]',
      '[data-download-url]', '[download]', 'div', 'span', 'p', 'strong', 'label'
    ].join(',');
    const byElement = new Map();
    for (const leaf of deepQueryAll(broadSelector)) {
      if (!visible(leaf, { allowOffscreen: true })) continue;
      const leafText = textOf(leaf);
      const leafSearchText = controlSearchText(leaf);
      if (!Number.isFinite(keywordScore(leafSearchText, keywords))) continue;
      const control = closestControl(leaf, type);
      if (!control) continue;
      const score = Math.max(
        scoreControl(control, keywords, type),
        scoreControl(leaf, keywords, type) + (control === leaf ? 0 : 12)
      );
      if (!Number.isFinite(score)) continue;
      const prior = byElement.get(control);
      if (!prior || score > prior.score) byElement.set(control, { element: control, score, matchedText: leafText || leafSearchText });
    }
    return [...byElement.values()].sort((a, b) => b.score - a.score);
  }

  function findSemanticControl(keywords, type = 'button') {
    return semanticCandidates(keywords, type)[0]?.element || null;
  }

  function findDirectResourceControl() {
    const selectors = [
      'a[download]', 'a[href*="download"]', 'a[href*="result"]', 'a[href*="output"]',
      '[data-download-url]', '[data-url]', '[class*="download"]', '[class*="Download"]',
      '[class*="save"]', '[class*="export"]'
    ].join(',');
    const candidates = [];
    for (const element of deepQueryAll(selectors)) {
      if (!visible(element, { allowOffscreen: true }) || !isDownloadControl(element)) continue;
      const rawText = textOf(element);
      const hint = `${rawText} ${controlSearchText(element)} ${element.getAttribute?.('href') || ''}`;
      if (!/(download|下载|result|结果|output|输出|save|保存|export|导出|png)/i.test(hint)) continue;
      if (/(download\s+successful|下载成功|客户端下载|下载客户端|无需下载)/i.test(rawText)) continue;
      let score = 20;
      if (getDirectUrl(element)) score += 55;
      if (element.matches('a[download],[data-download-url]')) score += 30;
      if (element.closest('[role="dialog"],.modal,.dialog,[class*="result"],[class*="success"],[class*="output"],[class*="download"]')) score += 25;
      if (element.matches('button,[role="button"],a')) score += 12;
      candidates.push({ element, score });
    }
    return candidates.sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  const START_KEYWORDS = [
    '开始抠图', '开始处理', '开始去背景', '开始去除背景', '一键抠图', '立即抠图'
  ];
  const DOWNLOAD_KEYWORDS = [
    '下载图片(PNG)', '下载图片', '下载高清大图(PNG)', '下载高清大图', '下载高清图',
    '高清下载', '下载原图', '下载透明图', '标清下载', '下载PNG', '下载 png',
    '下载结果', '免费下载', '保存高清图', 'download high resolution',
    'free download', 'download original', 'download result', 'download image',
    'download png', 'download', 'save', 'export', '下载', '保存', '导出'
  ];
  const DOWNLOAD_ENTRY_KEYWORDS = [
    '下载图片(PNG)', '下载图片', '下载高清大图(PNG)', '下载高清大图', '下载高清图',
    'download image', 'download result', 'download png', 'download high resolution'
  ];
  const STANDARD_DOWNLOAD_KEYWORDS = ['标清下载', 'standard download'];
  const RESET_KEYWORDS = [
    '继续抠图', '再抠一张', '重新上传', '上传新图片', '返回上传', '重新选择', '清空图片', '删除图片'
  ];

  const findStartControl = () => findSemanticControl(START_KEYWORDS, 'start');
  const findDownloadEntryControl = () => findSemanticControl(DOWNLOAD_ENTRY_KEYWORDS, 'download') || findDirectResourceControl();
  const findDownloadControl = findDownloadEntryControl;
  const findResetControl = () => findSemanticControl(RESET_KEYWORDS, 'reset');

  // A format dialog must always use the left-side “标清下载” card. Do not use
  // the generic semantic control matcher here: its closest clickable ancestor
  // can be the two-column wrapper, whose handler may resolve to “高清下载”.
  function findDownloadOptionControl() {
    const candidates = deepQueryAll('button,a,[role="button"],[onclick],[tabindex],div,span,p,strong,label')
      .filter((element) => visible(element, { allowOffscreen: true }))
      .map((element) => {
        const text = norm(textOf(element));
        if (!/(标清下载|standarddownload)/.test(text)) return null;
        if (/(高清下载|highresolutiondownload|downloadhighresolution)/.test(text)) return null;
        if (text.length > 70) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return null;
        return { element, text, rect };
      })
      .filter(Boolean);

    return candidates.sort((a, b) => {
      const aInteractive = isInteractive(a.element) ? 0 : 1;
      const bInteractive = isInteractive(b.element) ? 0 : 1;
      if (aInteractive !== bInteractive) return aInteractive - bInteractive;
      if (Math.abs(a.rect.left - b.rect.left) > 3) return a.rect.left - b.rect.left;
      const aArea = a.rect.width * a.rect.height;
      const bArea = b.rect.width * b.rect.height;
      return bArea - aArea;
    })[0]?.element || null;
  }

  function isDirectDownloadEntry(element) {
    const text = norm(controlSearchText(element));
    if (!text) return Boolean(getDirectUrl(element));
    if (/(下载图片\(png\)|下载图片|downloadimage)/i.test(text)) return false;
    return /(下载高清大图(?:\(png\))?|下载高清图|downloadhighresolution)/i.test(text)
      || Boolean(getDirectUrl(element));
  }

  function isDownloadModalContainer(element) {
    if (!element || !visible(element)) return false;
    const text = norm(textOf(element));
    const modalStructure = element.matches?.(
      '[role="dialog"],.modal,.dialog,[class*="modal"],[class*="dialog"],[class*="overlay"],[class*="fixed"][class*="inset"]'
    );
    const modalText = /(抠图成功|下载成功|选择下载格式|下载格式|标清下载|高清下载|记住下载格式选择|download successful)/i.test(text);
    return modalText && (modalStructure || (/标清下载/.test(text) && /高清下载/.test(text)));
  }

  function findDownloadModalContainer(option = findDownloadOptionControl()) {
    if (option) {
      let current = option;
      for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
        if (isOwnElement(current)) break;
        if (isDownloadModalContainer(current)) return current;
      }
    }
    const candidates = deepQueryAll('[role="dialog"],.modal,.dialog,[class*="modal"],[class*="dialog"],[class*="overlay"],[class*="fixed"][class*="inset"],div,section,main,article')
      .filter((element) => isDownloadModalContainer(element));
    return candidates.sort((a, b) => {
      const area = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width * rect.height;
      };
      return area(a) - area(b);
    })[0] || null;
  }

  function closeControlLabel(element) {
    return [
      textOf(element),
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      String(element?.className || '')
    ].filter(Boolean).join(' ');
  }

  function findDownloadModalClose(preferredContainer = null) {
    const container = preferredContainer?.isConnected && visible(preferredContainer, { allowOffscreen: true })
      ? preferredContainer
      : findDownloadModalContainer();
    const elements = container
      ? [...container.querySelectorAll('button,a,[role="button"],[onclick],[tabindex],div,span')]
      : deepQueryAll('button,a,[role="button"],[onclick],[tabindex],div,span');
    const visibleElements = elements.filter((element) => visible(element, { allowOffscreen: true }));
    const close = visibleElements.find((element) => {
      const text = norm(textOf(element));
      const label = closeControlLabel(element);
      return /^(x|×|关闭|close)$/.test(text)
        || /(?:^|[\s_-])(close|关闭|btnpopclose|anticon-close)(?:$|[\s_-])/i.test(label);
    }) || visibleElements.find((element) => {
      if (!isInteractive(element)) return false;
      const rect = element.getBoundingClientRect();
      const scopeRect = container?.getBoundingClientRect();
      if (!scopeRect || rect.width > 64 || rect.height > 64) return false;
      return rect.right >= scopeRect.right - 110 && rect.top <= scopeRect.top + 110;
    });
    if (!close) return null;
    let current = close;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (isInteractive(current)) return current;
    }
    return close;
  }

  function closeDownloadModal(preferredContainer = null) {
    const close = findDownloadModalClose(preferredContainer);
    if (!close) return false;
    syntheticClick(close);
    log('已关闭下载格式弹窗');
    return true;
  }

  function findSuccessMarker() {
    const successRegex = /(抠图成功|去背景成功|处理成功|生成成功|已完成)/i;
    const candidates = deepQueryAll('div,span,p,strong,label,[role="status"],[role="alert"]');
    return candidates.find((element) => {
      if (!visible(element, { allowOffscreen: true })) return false;
      const text = textOf(element);
      return text.length > 0 && text.length <= 80 && successRegex.test(text) && !/(下载成功|download successful)/i.test(text);
    }) || null;
  }

  function findUploadQueueInfo() {
    const counters = [];
    for (const element of deepQueryAll('div,span,p,strong,label')) {
      if (!visible(element, { allowOffscreen: true })) continue;
      const match = norm(textOf(element)).match(/^(\d+)\/(\d+)(?:张|images?)$/i);
      if (!match) continue;
      const rect = element.getBoundingClientRect();
      const parentText = norm(textOf(element.parentElement));
      let score = 0;
      if (Number(match[2]) === 100) score += 30;
      if (rect.top >= 0 && rect.top < 1000) score += 15;
      if (/(添加图片|开始抠图|待处理|上传图片)/.test(parentText)) score += 20;
      counters.push({
        count: Number(match[1]),
        limit: Number(match[2]),
        element,
        score
      });
    }
    return counters.sort((a, b) => b.score - a.score)[0] || null;
  }

  function findUploadQueueCards() {
    const cards = new Set();
    for (const image of deepQueryAll('img')) {
      if (!visible(image, { allowOffscreen: true })) continue;
      let current = image.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        if (isOwnElement(current)) break;
        const text = textOf(current);
        const rect = current.getBoundingClientRect();
        if (!/(待处理|处理中)/.test(text) || !/\d{2,5}\s*[x*×]\s*\d{2,5}/i.test(text)) continue;
        if (rect.width < 140 || rect.width > 650 || rect.height < 120 || rect.height > 700) continue;
        cards.add(current);
        break;
      }
    }
    return [...cards].sort((a, b) => {
      const left = a.getBoundingClientRect().left - b.getBoundingClientRect().left;
      if (Math.abs(left) > 4) return left;
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
  }

  function hoverElement(element) {
    if (!element) return;
    for (const type of ['pointerover', 'mouseover', 'mouseenter']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function armAutoDeleteConfirmation() {
    window.dispatchEvent(new Event('KKT_AUTO_CONFIRM_DELETE'));
  }

  function findUploadCardRemoveControl(card) {
    const controls = [...card.querySelectorAll('button,a,[role="button"],[onclick],[tabindex],div,span,svg,svg *')]
      .filter((element) => visible(element, { allowOffscreen: true }));
    const labelled = controls.find((element) => {
      const text = norm(textOf(element));
      const label = closeControlLabel(element);
      return /^(x|×|删除|移除|remove|delete|close)$/.test(text)
        || /(?:^|[\s_-])(delete|remove|close|删除|移除|anticon-close)(?:$|[\s_-])/i.test(label);
    });
    const cardRect = card.getBoundingClientRect();
    const visualClose = controls
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width <= 56 && rect.height <= 56
          && rect.right >= cardRect.right - 90
          && rect.top <= cardRect.top + 90;
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    const candidate = labelled || visualClose;
    if (!candidate) return null;
    for (let current = candidate; current && current !== card; current = current.parentElement) {
      if (isInteractive(current)) return current;
    }
    return candidate;
  }

  async function keepOnlyCurrentUploadCard(fileName) {
    const expectedName = norm(fileName);
    for (let pass = 0; pass < 12; pass += 1) {
      const queue = findUploadQueueInfo();
      if (!queue) throw new Error('无法读取网页待处理图片数量，未执行删除操作');
      if (queue.count <= 1) return true;

      const cards = findUploadQueueCards();
      if (cards.length < queue.count) {
        throw new Error(`网页显示 ${queue.count} 张待处理图片，但无法完整定位图片卡片，未执行删除操作`);
      }
      const matchingCards = cards.filter((card) => norm(textOf(card)).includes(expectedName));
      const keepCard = matchingCards.at(-1) || cards.at(-1);
      const removeCard = cards.filter((card) => card !== keepCard).at(-1);
      if (!removeCard) throw new Error('无法确定需要删除的多余图片卡片');

      hoverElement(removeCard);
      await sleep(120);
      const removeControl = findUploadCardRemoveControl(removeCard);
      if (!removeControl) throw new Error('无法定位多余图片卡片右上角的删除按钮，未执行删除操作');

      const beforeCount = queue.count;
      armAutoDeleteConfirmation();
      syntheticClick(removeControl);
      await waitUntil(() => {
        const currentQueue = findUploadQueueInfo();
        return currentQueue && currentQueue.count < beforeCount;
      }, { timeoutMs: 4_000, intervalMs: 150 });
      log(`已自动确认并删除多余图片卡片，保留当前图片：${fileName}`);
    }
    throw new Error('删除多余图片次数过多，已停止以避免误操作');
  }

  function findResultContainer(entry = findDownloadEntryControl(), success = findSuccessMarker()) {
    const anchor = entry || success;
    for (let current = anchor; current && current !== document.body; current = current.parentElement) {
      const text = norm(textOf(current));
      const mediaCount = current.querySelectorAll?.('img,canvas').length || 0;
      if (mediaCount > 0 && /(原图|抠图成功|尺寸|下载|复制|original|download)/i.test(text)) return current;
    }
    return null;
  }

  function resultMediaFingerprint(entry = findDownloadEntryControl(), success = findSuccessMarker()) {
    const container = findResultContainer(entry, success);
    if (!container) return '';
    return [...container.querySelectorAll('img,canvas')]
      .filter((element) => visible(element, { allowOffscreen: true }))
      .map((element) => {
        if (element.tagName === 'IMG') {
          return `img:${element.currentSrc || element.src || ''}:${element.naturalWidth || element.width}x${element.naturalHeight || element.height}`;
        }
        return `canvas:${element.width}x${element.height}`;
      })
      .join('|');
  }

  function captureResultState() {
    const entry = findDownloadEntryControl();
    const success = findSuccessMarker();
    return {
      entry,
      success,
      media: resultMediaFingerprint(entry, success)
    };
  }

  function resultStateChanged(previous, current) {
    if (!previous?.entry && !previous?.success) return Boolean(current.entry || current.success);
    if (current.entry && current.entry !== previous.entry) return true;
    if (current.success && current.success !== previous.success) return true;
    return Boolean(current.media && current.media !== previous.media);
  }

  function findFileInput() {
    const inputs = deepQueryAll('input[type="file"]');
    const ranked = inputs.map((input) => {
      const accept = String(input.accept || '').toLowerCase();
      const parentText = norm(input.parentElement?.innerText || '');
      const rect = input.getBoundingClientRect();
      let score = 0;
      if (!accept || /image|png|jpe?g|webp/.test(accept)) score += 40;
      if (input.multiple) score += 10;
      if (/上传|拖拽|图片|ctrl\+v/.test(parentText)) score += 20;
      if (rect.top >= 0 && rect.top < 1200) score += 8;
      return { input, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.input || null;
  }

  function findDropZone() {
    const phrases = ['ctrl+v粘贴图片', '把图片拖拽到这里', '拖拽到这里', '上传图片', '点击上传'];
    const elements = deepQueryAll('div,section,label,main,article');
    const matches = [];
    for (const element of elements) {
      if (!visible(element)) continue;
      const text = norm(textOf(element));
      if (!phrases.some((phrase) => text.includes(norm(phrase)))) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 40) continue;
      let score = 20;
      if (rect.top < 1000) score += 10;
      if (/upload|drop|uploader/i.test(element.className || '')) score += 20;
      score -= Math.min(20, text.length / 20);
      matches.push({ element, score });
    }
    return matches.sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    try { input.value = ''; } catch (_) {}
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) descriptor.set.call(input, dt.files);
    else input.files = dt.files;
    for (const type of ['input', 'change']) {
      input.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    }
  }

  function dispatchDrop(zone, files) {
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      zone.dispatchEvent(event);
    }
  }

  async function injectSingleFile(file) {
    const input = findFileInput();
    if (input) {
      setInputFiles(input, [file]);
      log(`已通过文件输入框放入：${file.name}`);
      return 'input';
    }
    const zone = findDropZone();
    if (zone) {
      dispatchDrop(zone, [file]);
      log(`已通过拖拽区域放入：${file.name}`);
      return 'drop';
    }
    throw new Error('未找到网页的图片上传入口');
  }

  function syntheticClick(element) {
    if (!element) return;
    try { element.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.click();
  }

  function findVisibleError() {
    const errorRegex = /(上传失败|抠图失败|处理失败|下载失败|网络异常|服务异常|图片过大|格式不支持|请重试|余额不足|次数不足)/i;
    const candidates = deepQueryAll('[role="alert"],.error,.message,.toast,[class*="error"],[class*="toast"],div,span,p');
    for (const element of candidates) {
      if (!visible(element)) continue;
      const text = textOf(element);
      if (text.length > 160) continue;
      if (errorRegex.test(text)) return text;
    }
    return '';
  }

  function successToastVisible() {
    const successRegex = /(download successful|下载成功|保存成功)/i;
    return deepQueryAll('[role="alert"],.message,.toast,[class*="toast"],div,span')
      .some((element) => visible(element) && textOf(element).length < 100 && successRegex.test(textOf(element)));
  }

  function closeSuccessModal() {
    const containers = deepQueryAll('[role="dialog"],.modal,.dialog,[class*="modal"],[class*="dialog"]');
    for (const container of containers) {
      if (!visible(container)) continue;
      const text = textOf(container);
      if (!/(say thanks|download successful|下载成功)/i.test(text)) continue;
      const buttons = [...container.querySelectorAll('button,[role="button"],a')];
      const close = buttons.find((button) => /^(x|×|关闭|close)$/i.test(textOf(button).trim()))
        || buttons.find((button) => /(关闭|close)/i.test(`${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`));
      if (close && visible(close)) {
        syntheticClick(close);
        log('已关闭下载完成提示弹窗');
        return true;
      }
    }
    return false;
  }

  async function waitUntil(predicate, { timeoutMs, intervalMs = 500, onTick } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (state.stopRequested) throw new Error('任务已停止');
      while (state.paused && !state.stopRequested) await sleep(250);
      if (state.stopRequested) throw new Error('任务已停止');
      const result = await predicate();
      if (result) return result;
      if (onTick) await onTick(Date.now() - startedAt);
      await sleep(intervalMs);
    }
    throw new Error('等待网页处理超时');
  }

  function getDirectUrl(control) {
    if (!control) return '';
    const candidates = [
      control.getAttribute?.('href'),
      control.getAttribute?.('data-url'),
      control.getAttribute?.('data-download-url'),
      control.dataset?.url,
      control.dataset?.downloadUrl,
      control.querySelector?.('a[href]')?.href
    ].filter(Boolean);
    for (const value of candidates) {
      try {
        const url = new URL(value, location.href).href;
        if (/^(https?:|data:)/i.test(url) && !/^javascript:/i.test(url)) return url;
      } catch (_) {}
    }
    return '';
  }

  async function runtimeMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || '插件后台操作失败');
    return response;
  }

  async function setBrowserDownloadUi(enabled) {
    try {
      await runtimeMessage({ type: 'KKT_SET_DOWNLOAD_UI', enabled: Boolean(enabled) });
      state.downloadUiSuppressed = !enabled;
      return true;
    } catch (error) {
      state.downloadUiSuppressed = false;
      log(`无法调整浏览器下载面板：${error.message}`, 'warn');
      return false;
    }
  }

  async function waitDirectDownload(downloadId, timeoutMs) {
    return waitUntil(async () => {
      const response = await runtimeMessage({ type: 'KKT_CHECK_DOWNLOAD', downloadId });
      if (response.state === 'complete') return response;
      if (response.state === 'interrupted') throw new Error(`下载中断：${response.error || '未知原因'}`);
      return null;
    }, { timeoutMs, intervalMs: 600 });
  }

  async function waitArmedDownload(nonce, timeoutMs) {
    const cached = state.lastDownloadMessages.get(nonce);
    if (cached?.type === 'KKT_DOWNLOAD_COMPLETE') return cached;
    if (cached?.type === 'KKT_DOWNLOAD_FAILED') throw new Error(cached.error || '下载失败');

    return waitUntil(async () => {
      const message = state.lastDownloadMessages.get(nonce);
      if (message?.type === 'KKT_DOWNLOAD_COMPLETE') return message;
      if (message?.type === 'KKT_DOWNLOAD_FAILED') throw new Error(message.error || '下载失败');
      const response = await runtimeMessage({ type: 'KKT_GET_ARM_STATUS', nonce });
      if (response.arm?.state === 'complete') return response.arm;
      if (response.arm?.state === 'interrupted') throw new Error(response.arm.error || '下载被中断');
      return null;
    }, { timeoutMs, intervalMs: 600 });
  }

  function outputFilename(item) {
    const rootFolder = sanitizeFolderPath(state.settings.outputFolder || '');
    const sourcePath = normalizeRelativePath(item.relativePath || item.file.webkitRelativePath || item.file.name);
    const sourceParts = sourcePath.split('/').filter(Boolean);
    const sourceFolders = state.settings.preserveFolderStructure
      ? sourceParts.slice(0, -1).map((part) => sanitizePathSegment(part)).filter(Boolean)
      : [];
    const filename = `${sanitizeBase(item.file.name)}.png`;
    return [rootFolder, ...sourceFolders, filename].filter(Boolean).join('/');
  }

  async function downloadResult(entryControl, item) {
    const timeoutMs = Math.max(30, Number(state.settings.timeoutSeconds) || 180) * 1000;
    const filename = outputFilename(item);

    // The site currently exposes two download flows:
    // 1) “下载图片(PNG)” opens a format dialog, then “标清下载” creates the file;
    // 2) “免费 下载高清大图(PNG)” starts the download directly.
    const entry = entryControl || await waitUntil(() => findDownloadEntryControl(), {
      timeoutMs: Math.min(timeoutMs, 15_000),
      intervalMs: 300
    });
    const directEntry = isDirectDownloadEntry(entry);
    const nonce = uid();
    await runtimeMessage({ type: 'KKT_ARM_DOWNLOAD', nonce, filename });
    try {
      syntheticClick(entry);
      log(`已点击下载入口：${textOf(entry) || '无文字控件'}`);
      const { option, started } = await waitUntil(async () => {
        const response = await runtimeMessage({ type: 'KKT_GET_ARM_STATUS', nonce });
        if (response.arm?.downloadId != null) return { started: true };
        const option = findDownloadOptionControl();
        return option ? { option } : null;
      }, {
        timeoutMs: Math.min(timeoutMs, directEntry ? 30_000 : 15_000),
        intervalMs: 300
      });
      if (started) {
        const result = await waitArmedDownload(nonce, Math.min(timeoutMs, 90_000));
        closeSuccessModal();
        return result;
      }

      // Save the dialog before clicking the option. The site may re-render/remove
      // the option immediately after the download starts.
      const downloadModal = findDownloadModalContainer(option);
      syntheticClick(option);
      log(`已点击左侧“标清下载”按钮：${textOf(option) || '标清下载'}`);
      const result = await waitArmedDownload(nonce, Math.min(timeoutMs, 90_000));
      try {
        await waitUntil(() => !visible(downloadModal, { allowOffscreen: true }) || closeDownloadModal(downloadModal), {
          timeoutMs: Math.min(timeoutMs, 8_000),
          intervalMs: 300
        });
      } catch (error) {
        log(`下载已完成，但未能自动关闭下载弹窗：${error.message}`, 'warn');
      }
      return result;
    } finally {
      await runtimeMessage({ type: 'KKT_DISARM_DOWNLOAD', nonce }).catch(() => {});
      state.lastDownloadMessages.delete(nonce);
    }
  }

  async function prepareWorkspace() {
    closeDownloadModal();
    closeSuccessModal();
    await sleep(150);
    const reset = findResetControl();
    if (reset) {
      syntheticClick(reset);
      await sleep(700);
      return;
    }
    const download = findDownloadControl();
    if (!download) return;
    // Many upload components accept a new file even while the previous result remains visible.
    log('未找到“继续/重新上传”按钮，将直接尝试写入下一张图片', 'warn');
  }

  async function processOne(item, { revealDownloadUi = false } = {}) {
    const timeoutMs = Math.max(30, Number(state.settings.timeoutSeconds) || 180) * 1000;
    const retries = Math.max(0, Math.min(5, Number(state.settings.retries) || 0));
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        item.attempt = attempt + 1;
        item.status = 'uploading';
        item.message = attempt ? `第 ${attempt + 1} 次尝试` : '正在放入网页';
        render();

        await prepareWorkspace();
        // Some page variants keep the previous result on screen while accepting
        // a new file. Capture it so it cannot be downloaded again as this item.
        const previousResult = captureResultState();
        await injectSingleFile(item.file);
        await sleep(500);

        item.status = 'processing';
        item.message = '等待网页自动抠图';
        render();

        let clickedStart = false;
        let successSeen = false;
        let downloadLogged = false;
        let staleResultCleared = !previousResult.entry && !previousResult.success;
        let staleResultIgnored = false;
        let uploadCountNoticeShown = false;
        let uploadCleanupStarted = false;
        const waitStartedAt = Date.now();
        const downloadEntryControl = await waitUntil(async () => {
          const error = findVisibleError();
          if (error) throw new Error(error);

          const downloadEntry = findDownloadEntryControl();
          const success = findSuccessMarker();
          if (!downloadEntry && !success) staleResultCleared = true;
          const currentResult = {
            entry: downloadEntry,
            success,
            media: resultMediaFingerprint(downloadEntry, success)
          };
          const freshResult = staleResultCleared || resultStateChanged(previousResult, currentResult);
          if (!freshResult) {
            if (!staleResultIgnored && (downloadEntry || success)) {
              staleResultIgnored = true;
              log(`检测到上一张图片的结果仍在页面中，等待网页切换到：${item.file.name}`);
            }
          }

          if (freshResult && downloadEntry) {
            if (!downloadLogged) {
              downloadLogged = true;
              log(`已识别下载入口：${textOf(downloadEntry) || '无文字控件'}`);
            }
            return downloadEntry;
          }

          if (freshResult && success && !successSeen) {
            successSeen = true;
            item.message = '网页显示抠图成功，等待下载入口';
            render();
            log(`网页已显示抠图成功：${item.file.name}`);
          }

          // 该页面通常在上传后自动抠图。仅当发现文字短、真实可交互的
          // 开始按钮时才点击，避免误点“点击图片自动开始抠图”等说明文字。
          const start = findStartControl();
          if (start && !clickedStart && !successSeen && Date.now() - waitStartedAt > 700) {
            const uploadQueue = findUploadQueueInfo();
            const uploadCount = uploadQueue?.count ?? findUploadQueueCards().length;
            if (uploadCount !== 1) {
              const detail = uploadQueue
                ? `当前待处理 ${uploadQueue.count}/${uploadQueue.limit} 张`
                : '未识别到当前待处理图片数量';
              if (!uploadCountNoticeShown) {
                uploadCountNoticeShown = true;
                log(`暂不点击“开始抠图”：${detail}`);
              }
              if (uploadQueue?.count > 1) {
                if (!uploadCleanupStarted) {
                  uploadCleanupStarted = true;
                  item.message = `检测到 ${uploadQueue.count} 张待处理图片，正在删除多余图片`;
                  renderSummaryOnly();
                  await keepOnlyCurrentUploadCard(item.file.name);
                  log('网页待处理图片已整理为 1 张，继续开始抠图');
                }
                return null;
              }
              item.message = '等待网页确认仅上传 1 张图片';
              renderSummaryOnly();
              return null;
            }
            syntheticClick(start);
            clickedStart = true;
            item.message = '已点击开始抠图，处理中';
            render();
            log(`已点击真实开始控件：${item.file.name}`);
          }
          return null;
        }, {
          timeoutMs,
          intervalMs: 400,
          onTick: (elapsed) => {
            item.elapsed = elapsed;
            if (!clickedStart && !successSeen && elapsed > 2500) item.message = '网页自动处理中';
            renderSummaryOnly();
          }
        });

        item.status = 'downloading';
        item.message = '抠图完成，准备下载';
        render();
        if (revealDownloadUi && state.downloadUiSuppressed) {
          const restored = await setBrowserDownloadUi(true);
          if (restored) log('已恢复浏览器下载面板，最后一张下载只显示一次');
        }
        await downloadResult(downloadEntryControl, item);

        item.status = 'done';
        item.message = '已完成并下载';
        item.finishedAt = Date.now();
        item.elapsed = 0;
        render();
        log(`完成：${item.file.name}`);
        return;
      } catch (error) {
        lastError = error;
        log(`${item.file.name}：${error.message}`, attempt < retries ? 'warn' : 'error');
        if (state.stopRequested) throw error;
        if (attempt < retries) {
          item.status = 'retrying';
          item.message = `失败，稍后重试：${error.message}`;
          render();
          await sleep(1500);
        }
      }
    }
    throw lastError || new Error('处理失败');
  }

  async function runQueue() {
    if (state.running) return;
    const pending = state.items.some((item) => ['pending', 'failed'].includes(item.status));
    if (!pending) {
      log('队列中没有待处理图片', 'warn');
      return;
    }
    state.running = true;
    window.dispatchEvent(new Event('ethan-kkt-restore-controls'));
    void chrome.storage.local.set({ethanKktRunning:true});
    state.paused = false;
    state.stopRequested = false;
    render();

    const runnableCount = state.items.filter((item) => ['pending', 'failed'].includes(item.status)).length;
    if (state.settings.suppressDownloadUiUntilLast && runnableCount > 1) {
      const hidden = await setBrowserDownloadUi(false);
      if (hidden) log('批量期间已隐藏浏览器下载面板，将在最后一张下载时恢复');
    }

    try {
      for (let index = 0; index < state.items.length; index += 1) {
        const item = state.items[index];
        if (state.stopRequested) break;
        if (!['pending', 'failed'].includes(item.status)) continue;
        while (state.paused && !state.stopRequested) await sleep(250);
        if (state.stopRequested) break;
        state.currentId = item.id;
        const hasLaterRunnable = state.items
          .slice(index + 1)
          .some((candidate) => ['pending', 'failed'].includes(candidate.status));
        try {
          await processOne(item, {
            revealDownloadUi: state.downloadUiSuppressed && !hasLaterRunnable
          });
        } catch (error) {
          item.status = state.stopRequested ? 'pending' : 'failed';
          item.message = error.message || '处理失败';
          render();
        }
        if (!state.stopRequested) await sleep(Math.max(300, Number(state.settings.nextDelayMs) || 1200));
      }
    } finally {
      const wasStopped = state.stopRequested;
      if (state.downloadUiSuppressed) {
        const restored = await setBrowserDownloadUi(true);
        if (restored) log('浏览器下载面板已恢复');
      }
      state.currentId = null;
      state.running = false;
    void chrome.storage.local.set({ethanKktRunning:false});
      state.paused = false;
      state.stopRequested = false;
      render();
      const failed = state.items.filter((item) => item.status === 'failed').length;
      const done = state.items.filter((item) => item.status === 'done').length;
      log(`队列结束：完成 ${done} 张，失败 ${failed} 张`);

      const allCompleted = state.items.length > 0 && state.items.every((item) => item.status === 'done');
      if (state.settings.autoClearCompletedQueue && !wasStopped && allCompleted) {
        const clearedCount = state.items.length;
        state.items = [];
        render();
        log(`全部下载完成，已自动清空队列（${clearedCount} 张）`);
      } else if (state.settings.autoClearCompletedQueue && failed > 0) {
        log('存在失败项，已保留队列以便查看和重试', 'warn');
      }
    }
  }

  function isSupportedImage(file) {
    return Boolean(file && (String(file.type || '').startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name || '')));
  }

  function makeFileRecord(file, relativePath = '') {
    return {
      file,
      relativePath: normalizeRelativePath(relativePath || file.webkitRelativePath || file.name) || file.name
    };
  }

  function fileRecordKey(record) {
    return `${normalizeRelativePath(record.relativePath).toLowerCase()}_${record.file.size}_${record.file.lastModified}`;
  }

  function addFileRecords(records) {
    const supported = records.filter((record) => isSupportedImage(record?.file));
    if (!supported.length) {
      log('没有检测到 JPG、PNG 或 WebP 图片', 'warn');
      return;
    }
    const existing = new Set(state.items.map((item) => fileRecordKey(item)));
    let added = 0;
    for (const record of supported) {
      const normalizedRecord = makeFileRecord(record.file, record.relativePath);
      const key = fileRecordKey(normalizedRecord);
      if (existing.has(key)) continue;
      state.items.push({
        id: uid(),
        file: normalizedRecord.file,
        relativePath: normalizedRecord.relativePath,
        status: 'pending',
        message: '等待处理',
        attempt: 0,
        elapsed: 0
      });
      existing.add(key);
      added += 1;
    }
    render();
    const topFolderCount = new Set(supported
      .map((record) => normalizeRelativePath(record.relativePath).split('/'))
      .filter((parts) => parts.length > 1)
      .map((parts) => parts[0])).size;
    log(topFolderCount ? `加入队列 ${added} 张图片，来自 ${topFolderCount} 个顶层文件夹` : `加入队列 ${added} 张图片`);
    if (state.settings.autoStart && !state.running) runQueue();
  }

  function addFiles(fileList) {
    addFileRecords([...fileList].map((file) => makeFileRecord(file)));
  }

  function readDirectoryBatch(reader) {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  }

  async function readAllDirectoryEntries(reader) {
    const all = [];
    while (true) {
      const batch = await readDirectoryBatch(reader);
      if (!batch.length) return all;
      all.push(...batch);
    }
  }

  function entryFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  async function walkFileSystemEntry(entry, parentPath = '') {
    const relativePath = normalizeRelativePath([parentPath, entry.name].filter(Boolean).join('/'));
    if (entry.isFile) {
      const file = await entryFile(entry);
      return isSupportedImage(file) ? [makeFileRecord(file, relativePath)] : [];
    }
    if (!entry.isDirectory) return [];
    const children = await readAllDirectoryEntries(entry.createReader());
    const nested = await Promise.all(children.map((child) => walkFileSystemEntry(child, relativePath)));
    return nested.flat();
  }

  async function walkFileSystemHandle(handle, parentPath = '') {
    const relativePath = normalizeRelativePath([parentPath, handle.name].filter(Boolean).join('/'));
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      return isSupportedImage(file) ? [makeFileRecord(file, relativePath)] : [];
    }
    if (handle.kind !== 'directory') return [];
    const nested = [];
    for await (const child of handle.values()) {
      nested.push(...await walkFileSystemHandle(child, relativePath));
    }
    return nested;
  }

  async function collectDroppedRecords(dataTransfer) {
    const items = [...(dataTransfer?.items || [])].filter((item) => item.kind === 'file');
    const entries = items
      .map((item) => typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null)
      .filter(Boolean);
    if (entries.length) {
      const nested = await Promise.all(entries.map((entry) => walkFileSystemEntry(entry)));
      return nested.flat();
    }

    if (items.length && items.every((item) => typeof item.getAsFileSystemHandle === 'function')) {
      const handles = (await Promise.all(items.map((item) => item.getAsFileSystemHandle()))).filter(Boolean);
      const nested = await Promise.all(handles.map((handle) => walkFileSystemHandle(handle)));
      return nested.flat();
    }

    return [...(dataTransfer?.files || [])].map((file) => makeFileRecord(file));
  }

  async function addDroppedItems(dataTransfer) {
    try {
      log('正在读取拖入的文件与文件夹…');
      const records = await collectDroppedRecords(dataTransfer);
      addFileRecords(records);
    } catch (error) {
      log(`读取文件夹失败：${error.message || error}`, 'error');
    }
  }

  function removeItem(id) {
    if (state.currentId === id) return;
    state.items = state.items.filter((item) => item.id !== id);
    render();
  }

  function clearQueue() {
    if (state.running) {
      log('运行中不能清空，请先停止', 'warn');
      return;
    }
    state.items = [];
    render();
  }

  function describeControl(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName?.toLowerCase() || '',
      text: textOf(element).slice(0, 180),
      class: String(element.className || '').slice(0, 180),
      role: element.getAttribute?.('role') || '',
      href: element.getAttribute?.('href') || '',
      cursor: (() => { try { return getComputedStyle(element).cursor; } catch (_) { return ''; } })(),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  }

  function copyDiagnostics() {
    const startCandidates = semanticCandidates(START_KEYWORDS, 'start').slice(0, 5);
    const downloadCandidates = semanticCandidates(DOWNLOAD_KEYWORDS, 'download').slice(0, 8);
    const candidates = {
      extensionVersion: '1.5.8',
      url: location.href,
      time: new Date().toISOString(),
      fileInput: Boolean(findFileInput()),
      dropZone: textOf(findDropZone()),
      successMarker: describeControl(findSuccessMarker()),
      startControl: describeControl(findStartControl()),
      uploadQueue: (() => {
        const info = findUploadQueueInfo();
        return info ? { count: info.count, limit: info.limit, control: describeControl(info.element) } : null;
      })(),
      downloadControl: describeControl(findDownloadEntryControl()),
      downloadEntryControl: describeControl(findDownloadEntryControl()),
      downloadOptionControl: describeControl(findDownloadOptionControl()),
      downloadModalClose: describeControl(findDownloadModalClose()),
      resetControl: describeControl(findResetControl()),
      startCandidates: startCandidates.map((item) => ({ score: item.score, matchedText: item.matchedText, control: describeControl(item.element) })),
      downloadCandidates: downloadCandidates.map((item) => ({ score: item.score, matchedText: item.matchedText, control: describeControl(item.element) })),
      queue: state.items.map(({ file, relativePath, status, message, attempt }) => ({ name: file.name, relativePath, status, message, attempt })),
      logs: state.logs.slice(-30)
    };
    navigator.clipboard.writeText(JSON.stringify(candidates, null, 2))
      .then(() => log('诊断信息已复制到剪贴板'))
      .catch(() => log('复制诊断信息失败', 'error'));
  }

  function createPanel() {
    const host = document.createElement('div');
    host.id = ROOT_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel { position: fixed; right: 18px; bottom: 18px; width: 370px; max-height: min(720px, calc(100vh - 36px)); z-index: 2147483647; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; color:#172033; background:rgba(255,255,255,.98); border:1px solid #d9e0ea; border-radius:14px; box-shadow:0 16px 45px rgba(20,34,60,.22); overflow:hidden; font-size:13px; }
        .panel.hidden { display:none; }
        .header { display:flex; align-items:center; gap:9px; padding:11px 12px; background:linear-gradient(135deg,#172033,#31486e); color:#fff; user-select:none; }
        .title { flex:1; font-weight:700; font-size:14px; letter-spacing:.2px; }
        .header button { border:0; background:rgba(255,255,255,.13); color:#fff; width:26px; height:26px; border-radius:7px; cursor:pointer; font-size:15px; }
        .body { padding:11px; overflow:auto; max-height:calc(min(720px, 100vh - 36px) - 48px); }
        .drop { border:1.5px dashed #8ca0bf; border-radius:10px; padding:14px 10px; text-align:center; background:#f6f8fc; cursor:pointer; transition:.15s; }
        .drop.drag { border-color:#2d6cdf; background:#edf4ff; transform:scale(1.01); }
        .drop b { display:block; font-size:14px; margin-bottom:4px; }
        .drop span { color:#6c778b; font-size:12px; }
        .pick-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:7px; }
        .summary { display:flex; align-items:center; justify-content:space-between; margin:10px 1px 8px; color:#596579; }
        .summary strong { color:#172033; }
        .controls { display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:7px; margin-bottom:9px; }
        button.action { border:1px solid #cbd5e1; background:#fff; color:#273449; border-radius:8px; min-height:34px; cursor:pointer; font-weight:600; }
        button.action.primary { border-color:#2d6cdf; background:#2d6cdf; color:#fff; }
        button.action.danger { color:#a12626; }
        button.action:disabled { opacity:.48; cursor:not-allowed; }
        .queue { border:1px solid #e3e8ef; border-radius:9px; overflow:hidden; }
        .empty { padding:18px; color:#8791a1; text-align:center; }
        .item { display:grid; grid-template-columns:25px minmax(0,1fr) 24px; gap:7px; padding:8px; border-bottom:1px solid #edf0f4; align-items:start; background:#fff; }
        .item:last-child { border-bottom:0; }
        .item.current { background:#f1f6ff; }
        .num { width:24px; height:24px; display:grid; place-items:center; border-radius:6px; background:#eef1f5; color:#667085; font-size:11px; }
        .file { min-width:0; }
        .name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; color:#263349; }
        .meta { margin-top:3px; font-size:11px; color:#748094; display:flex; gap:6px; align-items:center; }
        .status { display:inline-flex; align-items:center; border-radius:10px; padding:1px 6px; background:#eef1f5; }
        .status.done { background:#e9f8ee; color:#23733c; }
        .status.failed { background:#fff0f0; color:#ad3030; }
        .status.processing,.status.uploading,.status.downloading,.status.retrying { background:#edf4ff; color:#245eaf; }
        .remove { border:0; background:transparent; color:#9aa4b2; cursor:pointer; padding:1px; font-size:16px; }
        details { margin-top:9px; border-top:1px solid #edf0f4; padding-top:8px; }
        summary { cursor:pointer; color:#536176; user-select:none; }
        .settings { display:grid; grid-template-columns:1fr 112px; gap:7px 10px; margin-top:8px; align-items:center; }
        .settings input[type="number"], .settings input[type="text"] { width:100%; border:1px solid #ccd5e0; border-radius:7px; padding:6px 7px; font:inherit; }
        .settings input[type="checkbox"] { justify-self:end; }
        .settings .wide { grid-column:1 / -1; }
        .mini-actions { display:flex; gap:7px; margin-top:8px; }
        .log { margin-top:8px; padding:7px; border-radius:7px; background:#151b26; color:#cdd6e5; font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; max-height:70px; overflow:auto; white-space:pre-wrap; }
        .hint { margin-top:8px; color:#7c8799; font-size:11px; line-height:1.5; }
      </style>
      <section class="panel">
        <div class="header">
          <div class="title">抠抠图自动队列助手 v1.5.8</div>
          <button id="minimize" title="最小化">—</button>
          <button id="close" title="隐藏">×</button>
        </div>
        <div class="body">
          <div class="drop" id="dropZone">
            <b>拖入多张图片或多个文件夹</b>
            <span>递归读取子文件夹，下载后保留原目录结构</span>
          </div>
          <div class="pick-actions">
            <button class="action" id="pickFiles">选择图片</button>
            <button class="action" id="pickFolder">选择文件夹</button>
          </div>
          <input id="picker" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
          <input id="folderPicker" type="file" accept="image/jpeg,image/png,image/webp" webkitdirectory directory multiple hidden>
          <div class="summary" id="summary"></div>
          <div class="controls">
            <button class="action primary" id="start">开始队列</button>
            <button class="action" id="pause">暂停</button>
            <button class="action danger" id="stop">停止</button>
          </div>
          <div class="queue" id="queue"></div>
          <details>
            <summary>队列设置与诊断</summary>
            <div class="settings">
              <label for="autoStart">拖入后自动开始</label><input id="autoStart" type="checkbox">
              <label for="preferDirect">优先捕获资源直下</label><input id="preferDirect" type="checkbox">
              <label for="suppressDownloadUi">批量时隐藏下载面板</label><input id="suppressDownloadUi" type="checkbox">
              <label for="autoClearQueue">全部成功后清空队列</label><input id="autoClearQueue" type="checkbox">
              <label for="timeout">单张超时（秒）</label><input id="timeout" type="number" min="30" max="600" step="10">
              <label for="retries">失败重试次数</label><input id="retries" type="number" min="0" max="5" step="1">
              <label for="nextDelay">下一张间隔（毫秒）</label><input id="nextDelay" type="number" min="300" max="10000" step="100">
              <label for="folder">下载根文件夹</label><input id="folder" type="text">
              <label for="preserveFolders">保留原文件夹结构</label><input id="preserveFolders" type="checkbox">
            </div>
            <div class="mini-actions">
              <button class="action" id="clear">清空队列</button>
              <button class="action" id="diagnostics">复制诊断</button>
            </div>
            <div class="log" id="log">等待加入图片…</div>
            <div class="hint">拖入多个文件夹时会递归读取其中的图片；下载目录为“下载根文件夹/原文件夹结构/图片名.png”。开启“批量时隐藏下载面板”后，中间图片静默下载，最后一张恢复并显示一次。全部成功后默认自动清空队列；存在失败项或中途停止时会保留。</div>
          </details>
        </div>
      </section>
    `;

    const $ = (selector) => shadow.querySelector(selector);
    const panel = $('.panel');
    const body = $('.body');
    const dropZone = $('#dropZone');
    const picker = $('#picker');
    const folderPicker = $('#folderPicker');

    dropZone.addEventListener('click', () => picker.click());
    $('#pickFiles').addEventListener('click', () => picker.click());
    $('#pickFolder').addEventListener('click', () => folderPicker.click());
    picker.addEventListener('change', () => {
      addFiles(picker.files);
      picker.value = '';
    });
    folderPicker.addEventListener('change', () => {
      addFiles(folderPicker.files);
      folderPicker.value = '';
    });
    for (const type of ['dragenter', 'dragover']) {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.add('drag');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropZone.classList.remove('drag');
      });
    }
    dropZone.addEventListener('drop', (event) => addDroppedItems(event.dataTransfer));

    $('#start').addEventListener('click', runQueue);
    $('#pause').addEventListener('click', () => {
      if (!state.running) return;
      state.paused = !state.paused;
      log(state.paused ? '队列已暂停' : '队列继续运行');
      render();
    });
    $('#stop').addEventListener('click', () => {
      if (!state.running) return;
      state.stopRequested = true;
      state.paused = false;
      log('正在停止当前队列', 'warn');
      render();
    });
    $('#clear').addEventListener('click', clearQueue);
    $('#diagnostics').addEventListener('click', copyDiagnostics);
    $('#close').addEventListener('click', () => panel.classList.add('hidden'));
    $('#minimize').addEventListener('click', () => {
      body.hidden = !body.hidden;
      $('#minimize').textContent = body.hidden ? '+' : '—';
    });

    const settingBindings = [
      ['#autoStart', 'autoStart', 'checked'],
      ['#preferDirect', 'preferDirectDownload', 'checked'],
      ['#suppressDownloadUi', 'suppressDownloadUiUntilLast', 'checked'],
      ['#autoClearQueue', 'autoClearCompletedQueue', 'checked'],
      ['#timeout', 'timeoutSeconds', 'number'],
      ['#retries', 'retries', 'number'],
      ['#nextDelay', 'nextDelayMs', 'number'],
      ['#folder', 'outputFolder', 'value'],
      ['#preserveFolders', 'preserveFolderStructure', 'checked']
    ];
    for (const [selector, key, kind] of settingBindings) {
      const input = $(selector);
      input.addEventListener('change', async () => {
        const value = kind === 'checked' ? input.checked : kind === 'number' ? Number(input.value) : input.value;
        state.settings[key] = value;
        await chrome.storage.local.set({ kktAutoQueueSettings: state.settings });
      });
    }

    shadow.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-id]');
      if (button) removeItem(button.dataset.removeId);
    });

    window.__KKT_UI__ = { host, shadow, panel, $ };
  }

  function statusLabel(status) {
    return ({
      pending: '等待', uploading: '上传', processing: '抠图中', downloading: '下载中', retrying: '重试', done: '完成', failed: '失败'
    })[status] || status;
  }

  function render() {
    const ui = window.__KKT_UI__;
    if (!ui) return;
    const $ = ui.$;
    const done = state.items.filter((item) => item.status === 'done').length;
    const failed = state.items.filter((item) => item.status === 'failed').length;
    const pending = state.items.length - done - failed;
    $('#summary').innerHTML = `<span>共 <strong>${state.items.length}</strong> 张</span><span>完成 ${done} · 待处理 ${pending} · 失败 ${failed}</span>`;
    $('#start').disabled = state.running || !state.items.length;
    $('#start').textContent = state.running ? '运行中…' : '开始队列';
    $('#pause').disabled = !state.running;
    $('#pause').textContent = state.paused ? '继续' : '暂停';
    $('#stop').disabled = !state.running;
    $('#clear').disabled = state.running || !state.items.length;

    const queue = $('#queue');
    if (!state.items.length) {
      queue.innerHTML = '<div class="empty">把图片拖到上方区域</div>';
    } else {
      queue.innerHTML = state.items.map((item, index) => {
        const current = item.id === state.currentId ? ' current' : '';
        const removable = item.id !== state.currentId && !state.running;
        const elapsed = item.elapsed ? ` · ${Math.floor(item.elapsed / 1000)}s` : '';
        const displayPath = item.relativePath || item.file.name;
        return `<div class="item${current}">
          <div class="num">${index + 1}</div>
          <div class="file">
            <div class="name" title="${escapeHtml(displayPath)}">${escapeHtml(displayPath)}</div>
            <div class="meta"><span class="status ${item.status}">${statusLabel(item.status)}</span><span>${escapeHtml(item.message || '')}${elapsed}</span></div>
          </div>
          <button class="remove" data-remove-id="${item.id}" title="移除" ${removable ? '' : 'disabled'}>×</button>
        </div>`;
      }).join('');
    }
    syncSettingsUi();
    renderLogTail();
  }

  function renderSummaryOnly() {
    const ui = window.__KKT_UI__;
    if (!ui) return;
    const current = state.items.find((item) => item.id === state.currentId);
    if (!current) return;
    const statusNodes = ui.shadow.querySelectorAll('.item');
    const index = state.items.indexOf(current);
    const node = statusNodes[index];
    if (!node) return;
    const meta = node.querySelector('.meta span:last-child');
    if (meta) meta.textContent = `${current.message || ''}${current.elapsed ? ` · ${Math.floor(current.elapsed / 1000)}s` : ''}`;
  }

  function renderLogTail() {
    const ui = window.__KKT_UI__;
    if (!ui) return;
    const logNode = ui.$('#log');
    if (!logNode) return;
    logNode.textContent = state.logs.slice(-8).map((entry) => `[${entry.time}] ${entry.message}`).join('\n') || '等待加入图片…';
    logNode.scrollTop = logNode.scrollHeight;
  }

  function syncSettingsUi() {
    const ui = window.__KKT_UI__;
    if (!ui) return;
    ui.$('#autoStart').checked = Boolean(state.settings.autoStart);
    ui.$('#preferDirect').checked = Boolean(state.settings.preferDirectDownload);
    ui.$('#suppressDownloadUi').checked = Boolean(state.settings.suppressDownloadUiUntilLast);
    ui.$('#autoClearQueue').checked = Boolean(state.settings.autoClearCompletedQueue);
    ui.$('#timeout').value = String(state.settings.timeoutSeconds);
    ui.$('#retries').value = String(state.settings.retries);
    ui.$('#nextDelay').value = String(state.settings.nextDelayMs);
    ui.$('#folder').value = String(state.settings.outputFolder || '');
    ui.$('#preserveFolders').checked = Boolean(state.settings.preserveFolderStructure);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'KKT_TOGGLE_PANEL') {
      window.__KKT_UI__?.panel.classList.toggle('hidden');
      return;
    }
    if (['KKT_DOWNLOAD_STARTED', 'KKT_DOWNLOAD_COMPLETE', 'KKT_DOWNLOAD_FAILED'].includes(message?.type)) {
      state.lastDownloadMessages.set(message.nonce, message);
    }
  });

  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=='ETHAN_KKT_IMPORT')return false;
    (async()=>{
      if(!window.__KKT_UI__)throw Error('抠抠图队列尚未就绪，请稍后重试');
      const records=[];
      for(const item of message.files){const blob=await(await fetch(item.data)).blob();const file=new File([blob],item.name,{type:blob.type});records.push(makeFileRecord(file,item.path));}
      state.settings.autoStart=true;state.settings.preserveFolderStructure=true;
      addFileRecords(records);reply({ok:true,count:records.length});
    })().catch(error=>reply({ok:false,message:error.message}));return true;
  });
  if(new URLSearchParams(location.search).get('ethanEmbedded')==='1'){
    function enableEmbeddedQueue(){state.settings.autoStart=true;state.settings.preserveFolderStructure=true;}
    // Handle images already accepted by the site's own uploader as well.
    let embeddedNativeTask=false;const embeddedAttemptedStarts=new WeakSet();
    setInterval(async()=>{
      const processing=state.running||embeddedNativeTask;
      waiting.hidden=!processing;waiting.style.display=processing?'flex':'none';
      if(processing){const current=state.items.find(item=>item.id===state.currentId);const completed=state.items.filter(item=>item.status==='done').length;waiting.querySelector('[data-wait-detail]').textContent=current?(current.message+' · 已完成 '+completed+'/'+state.items.length):'正在处理并自动下载，请保持面板打开';return;}

      const start=findStartControl();
      if(!start||!visible(start)||embeddedAttemptedStarts.has(start))return;
      embeddedAttemptedStarts.add(start);embeddedNativeTask=true;void chrome.storage.local.set({ethanKktRunning:true});
      try{
        syntheticClick(start);
        const entry=await waitUntil(()=>findSuccessMarker()&&findDownloadEntryControl(),{timeoutMs:180000,intervalMs:500});
        const item={file:{name:'抠抠图_'+Date.now()+'.png'},relativePath:'',id:uid()};
        await downloadResult(entry,item);
      }catch(error){log('自动抠图或下载未完成：'+error.message,'error');}
      finally{embeddedNativeTask=false;void chrome.storage.local.set({ethanKktRunning:false});}
    },1500);

    window.addEventListener('dragover',event=>{if([...event.dataTransfer?.types||[]].includes('Files'))event.preventDefault();},true);
    window.addEventListener('drop',event=>{
      if(!event.isTrusted||![...event.dataTransfer?.types||[]].includes('Files'))return;
      event.preventDefault();event.stopImmediatePropagation();enableEmbeddedQueue();void addDroppedItems(event.dataTransfer);
    },true);
    window.addEventListener('paste',event=>{
      if(!event.isTrusted||event.target.closest?.('input:not([type="file"]),textarea,[contenteditable="true"]'))return;
      const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
      if(!files.length)return;event.preventDefault();event.stopImmediatePropagation();enableEmbeddedQueue();addFiles(files);
    },true);
    window.addEventListener('change',event=>{
      if(!event.isTrusted||event.target.type!=='file'||isOwnElement(event.target)||!event.target.files?.length)return;
      const files=[...event.target.files];event.stopImmediatePropagation();enableEmbeddedQueue();addFiles(files);
    },true);

    window.addEventListener('message',async event=>{
      if(event.source!==window.parent||event.origin!==chrome.runtime.getURL('').replace(/\/$/,'')||event.data?.type!=='ETHAN_KKT_EMBED_IMPORT')return;
      try{const records=[];for(const item of event.data.files){const blob=await(await fetch(item.data)).blob();records.push(makeFileRecord(new File([blob],item.name,{type:blob.type}),item.path));}state.settings.autoStart=true;state.settings.preserveFolderStructure=true;addFileRecords(records);event.source.postMessage({requestId:event.data.requestId,ok:true},event.origin);}catch(error){event.source.postMessage({requestId:event.data.requestId,ok:false,message:error.message},event.origin);}
    });
    const style=document.createElement('style');style.textContent='html,body{margin:0!important;min-width:0!important}#kkt-autoqueue-root{display:none!important}.ethan-embed-hidden{display:none!important}';document.documentElement.append(style);
    const waiting=document.createElement('div');waiting.id='ethan-kkt-waiting';waiting.hidden=true;
    waiting.style.cssText='position:fixed;inset:0;z-index:2147483646;background:#fff;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;font:12px system-ui;color:#60718b;pointer-events:none';
    waiting.innerHTML='<span style="width:22px;height:22px;border:2px solid #dce7f7;border-top-color:#2563eb;border-radius:50%;animation:ethan-kkt-spin .8s linear infinite"></span><strong>抠图中，请稍候…</strong><span data-wait-detail style="font-size:10px;color:#8b99ae;max-width:90%;text-align:center"></span>';
    const waitingStyle=document.createElement('style');waitingStyle.textContent='@keyframes ethan-kkt-spin{to{transform:rotate(360deg)}}';document.documentElement.append(waitingStyle,waiting);
    let embeddedArea=null;const embeddedOriginalStyles=new Map();
    const isolateEmbeddedArea=()=>{
      document.querySelectorAll('.ethan-embed-hidden').forEach(node=>node.classList.remove('ethan-embed-hidden'));
      for(const [element,style] of embeddedOriginalStyles){if(style===null)element.removeAttribute('style');else element.setAttribute('style',style);}embeddedOriginalStyles.clear();
      const processing=state.running||embeddedNativeTask;
      waiting.hidden=!processing;waiting.style.display=processing?'flex':'none';
      if(processing){const current=state.items.find(item=>item.id===state.currentId);const completed=state.items.filter(item=>item.status==='done').length;waiting.querySelector('[data-wait-detail]').textContent=current?(current.message+' · 已完成 '+completed+'/'+state.items.length):'正在处理并自动下载，请保持面板打开';return;}


      const success=findSuccessMarker();
      let target=success?findResultContainer(findDownloadEntryControl(),success):null;
      if(!target){
        const upload=Array.from(document.querySelectorAll('button,a,span,div')).filter(node=>!isOwnElement(node)&&node.textContent.trim()==='上传图片').sort((a,b)=>a.childElementCount-b.childElementCount)[0];
        let fallback=null;
        for(let current=upload,depth=0;current&&current!==document.body&&depth<12;current=current.parentElement,depth++){
          const text=current.textContent||'';
          if(text.includes('上传图片')&&(text.includes('Ctrl')||text.includes('拖拽')||text.includes('拖到'))){
            fallback=current;
            if(getComputedStyle(current).borderStyle.includes('dashed')){target=current;break;}
            if(text.includes('通用抠图模型')&&current.querySelector('img')){target=current;break;}
          }
        }
        target=target||fallback;
      }
      if(!target)return;
      const remember=element=>{if(!embeddedOriginalStyles.has(element))embeddedOriginalStyles.set(element,element.getAttribute('style'));};
      target.querySelectorAll('*').forEach(remember);
      for(let ancestor=target;ancestor&&ancestor!==document.body;ancestor=ancestor.parentElement)remember(ancestor);
      let node=target;
      while(node&&node!==document.body){
        for(const sibling of node.parentElement?.children||[]){
          if(sibling!==node&&sibling!==waiting&&!['SCRIPT','STYLE','LINK'].includes(sibling.tagName)&&!sibling.matches('[role="dialog"],.el-dialog__wrapper,.el-message-box__wrapper'))sibling.classList.add('ethan-embed-hidden');
        }
        node.style.setProperty('min-width','0','important');node.style.setProperty('max-width','100%','important');
        node.style.setProperty('margin','0','important');node.style.setProperty('padding','0','important');
        if(!success){node.style.setProperty('height','auto','important');node.style.setProperty('min-height','0','important');node.style.setProperty('justify-content','flex-start','important');node.style.setProperty('overflow','visible','important');}
        node=node.parentElement;
      }
      if(!success){
        target.querySelectorAll('p,button,a,span').forEach(element=>{
          const text=(element.textContent||'').trim();
          if(text.length<200&&/更新时间|通用抠图模型|查看历史记录|试试这些|自动加载高清原图/.test(text))element.classList.add('ethan-embed-hidden');
        });
        target.querySelectorAll('video,picture').forEach(element=>{element.classList.add('ethan-embed-hidden');if(element.parentElement?.className.includes('overflow-hidden'))element.parentElement.classList.add('ethan-embed-hidden');});
        target.querySelectorAll('div').forEach(element=>{
          element.style.setProperty('padding','0','important');element.style.setProperty('margin','0','important');element.style.setProperty('gap','4px','important');
          element.style.setProperty('min-height','0','important');
        });
        target.style.setProperty('border','1px dashed #bfd4fa','important');
        target.style.setProperty('border-radius','9px','important');
        target.style.setProperty('text-align','center','important');
        target.style.setProperty('width','100%','important');
        target.style.setProperty('justify-content','center','important');
        target.querySelectorAll('div').forEach(element=>{
          element.style.setProperty('height','auto','important');
          element.style.setProperty('max-height','none','important');
          element.style.setProperty('justify-content','center','important');
          element.style.setProperty('align-items','center','important');
          if(element.querySelector('img')&&!/上传图片|Ctrl|拖拽|拖到/.test(element.textContent||''))element.classList.add('ethan-embed-hidden');
        });
        target.querySelectorAll('button,[role="presentation"]').forEach(element=>{
          element.style.setProperty('margin-left','auto','important');element.style.setProperty('margin-right','auto','important');
        });
        target.querySelectorAll('*').forEach(element=>{
          const text=(element.textContent||'').trim();
          if(element.children.length===0&&/通用抠图模型|更新时间|改善AI|欢迎加入|没有图片|试试这些|查看历史记录|最多100|点击图片自动/.test(text))element.classList.add('ethan-embed-hidden');
        });
        target.querySelectorAll('img,video').forEach(element=>{if(!element.closest('[role="dialog"]'))element.classList.add('ethan-embed-hidden');});
        target.querySelectorAll('*').forEach(element=>{
          element.style.setProperty('min-height','0','important');
          if(!['BUTTON','INPUT','SVG','PATH'].includes(element.tagName))element.style.setProperty('margin-top','3px','important');
        });
        target.style.setProperty('height','auto','important');
      }
      target.style.setProperty('padding',success?'8px':'14px 8px','important');
      target.style.setProperty('box-sizing','border-box','important');
      if(embeddedArea!==target){document.documentElement.scrollTop=0;document.body.scrollTop=0;embeddedArea=target;}
    };
    window.addEventListener('ethan-kkt-restore-controls',isolateEmbeddedArea);
    setInterval(isolateEmbeddedArea,1000);
    window.addEventListener('load',isolateEmbeddedArea);

  }
  async function init() {
    createPanel();
    const stored = await chrome.storage.local.get('kktAutoQueueSettings');
    state.settings = { ...DEFAULTS, ...(stored.kktAutoQueueSettings || {}) };
    window.__KKT_DEBUG__ = {
      version: '1.5.8',
      findStartControl,
      findUploadQueueInfo,
      findDownloadControl,
      findDownloadEntryControl,
      findDownloadOptionControl,
      findDownloadModalClose,
      findSuccessMarker,
      semanticCandidates,
      addFiles,
      addFileRecords,
      collectDroppedRecords,
      outputFilename,
      runQueue,
      getState: () => state
    };
    render();
    log('插件 v1.5.8 已就绪：删除多余图片时自动确认删除');
  }

  init().catch((error) => console.error('[抠图队列] 初始化失败', error));
})();
