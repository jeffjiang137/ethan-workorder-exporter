importScripts("batch-collector/advanced_background_v14.js");

const CONTEXT_MENU_ID = 'ethan-id-to-1688-link';
const OFFER_BASE_URL = 'https://detail.1688.com/offer/';

function unique(values) {
  return [...new Set(values)];
}

function extractProductIds(text) {
  const source = String(text || '');
  const ids = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const compactLine = rawLine.replace(/\s+/g, '');
    if (!compactLine) continue;

    if (/^\d{6,20}$/.test(compactLine)) {
      ids.push(compactLine);
      continue;
    }

    const offerMatch = compactLine.match(/detail\.1688\.com\/offer\/(\d{6,20})\.html/i);
    if (offerMatch) {
      ids.push(offerMatch[1]);
      continue;
    }

    const numberMatches = compactLine.match(/\d{6,20}/g) || [];
    ids.push(...numberMatches);
  }

  return unique(ids);
}

function productIdToUrl(id) {
  return `${OFFER_BASE_URL}${id}.html`;
}

function normalizeProductLinks(text) {
  const urls = [];
  const invalid = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const compact = rawLine.trim().replace(/\s+/g, '');
    if (!compact) continue;

    if (/^\d{6,20}$/.test(compact)) {
      urls.push(productIdToUrl(compact));
      continue;
    }

    const idMatch = compact.match(/(?:https?:\/\/)?detail\.1688\.com\/offer\/(\d{6,20})\.html(?:[?#].*)?$/i);
    if (idMatch) {
      urls.push(productIdToUrl(idMatch[1]));
      continue;
    }

    const candidate = /^https?:\/\//i.test(compact) ? compact : `https://${compact}`;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
      urls.push(parsed.href);
    } catch (error) {
      invalid.push(rawLine.trim());
    }
  }

  return { urls: unique(urls), invalid };
}

async function ensureContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
  } catch (error) {
    // 首次安装时可能没有菜单可删除。
  }

  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'ID转1688链接',
    contexts: ['selection']
  });
}

async function openUrlsInBackgroundTabs(urls, sourceTab) {
  if (!urls.length) return 0;
  const windowId = sourceTab?.windowId;
  for (const url of urls) {
    await chrome.tabs.create({
      url,
      active: false,
      ...(Number.isInteger(windowId) ? { windowId } : {})
    });
  }
  return urls.length;
}

async function openUrlsInNewWindow(urls) {
  if (!urls.length) return { count: 0 };

  const createdWindow = await chrome.windows.create({
    url: urls[0],
    focused: true
  });

  const windowId = createdWindow?.id;
  let previousTab = createdWindow?.tabs?.[0];
  let count = 1;
  for (const url of urls.slice(1)) {
    if (previousTab?.id) {
      await waitForTabComplete(previousTab.id);
      await delayMs(3000);
      let blocked = true;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: previousTab.id },
          func: () => {
            const text = document.body?.innerText || '';
            return /请.*(?:拖动|滑动).*滑块|完成验证|安全验证|访问过于频繁/.test(text) ||
              /(?:captcha|punish|verify)/i.test(location.pathname);
          }
        });
        blocked = !result?.length || result[0].result === true;
      } catch (_) {}
      if (blocked) {
        await chrome.tabs.update(previousTab.id, { active: true }).catch(() => {});
        return { count, windowId, paused: true, remaining: urls.slice(count) };
      }
    }
    previousTab = await chrome.tabs.create({
      windowId,
      url,
      active: false
    });
    count += 1;
  }

  return { count: urls.length, windowId };
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
});

// 服务工作线程被浏览器回收后重新启动时，也确保菜单存在。
void ensureContextMenu();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const ids = extractProductIds(info.selectionText || '');
  const urls = ids.map(productIdToUrl);
  void openUrlsInBackgroundTabs(urls, tab);
});

const MATERIAL_JOB_STATE = { running: false, stage: '', current: 0, total: 0, title: '', category: '', productCount: 0, fileCount: 0, skippedCount: 0, failedCount: 0, batchFolder: '', message: '' };
const MATERIAL_PACKAGE_WAITERS = new Map();
const MATERIAL_OFFSCREEN_URL = 'material-packager.html';
let materialProgressTabs = [];
let materialProgressLastUpdate = 0;

function renderMaterialProgress(progress) {
  let host = document.getElementById('ethan-material-progress');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ethan-material-progress';
    host.style.cssText = 'position:fixed!important;left:16px!important;bottom:16px!important;z-index:2147483647!important';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{font-family:system-ui,sans-serif}.box{width:300px;padding:14px;background:#fff;color:#243247;border:1px solid #dce4ef;border-radius:10px;box-shadow:0 4px 24px #0002;font-size:12px}header{display:flex;justify-content:space-between;font-weight:700}button{border:0;background:none;color:#64748b;cursor:pointer}progress{width:100%;height:10px;accent-color:#2563eb;margin:10px 0 6px}.detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;margin-top:4px}</style><div class="box" role="status"><header><span>批量素材下载</span><button aria-label="关闭进度提示">×</button></header><progress max="100" value="0"></progress><div class="status"></div><div class="detail"></div></div>';
    root.querySelector('button').onclick = () => host.remove();
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot;
  if (!root) return;
  const total = Math.max(1, progress.total || progress.productCount || 1);
  const current = progress.current || 0;
  const percent = progress.stage === 'done' ? 100 : progress.stage === 'zip' ? 95 :
    progress.stage === 'pack' ? 30 + 60 * Math.min(1, (progress.processedFiles || 0) / Math.max(1, progress.totalFiles || 1)) :
    30 * Math.max(0, current - 1) / total;
  const bar = root.querySelector('progress');
  bar.value = percent;
  if (progress.stage === 'error') bar.style.accentColor = '#dc2626';
  const labels = {
    scan: '正在采集商品 ' + current + '/' + total,
    pack: '正在打包商品 ' + current + '/' + total + ' · 已保存 ' + (progress.fileCount || 0) + ' 个文件',
    zip: '正在生成 ZIP…',
    done: '已生成下载 · ' + (progress.productCount || 0) + ' 个商品，' + (progress.fileCount || 0) + ' 个文件',
    error: progress.message || '下载失败'
  };
  root.querySelector('.status').textContent = labels[progress.stage] || '正在启动…';
  root.querySelector('.detail').textContent = [progress.title, progress.category,
    progress.failedCount ? '失败文件 ' + progress.failedCount + ' 个' : ''].filter(Boolean).join(' · ');
  clearTimeout(host._ethanDismissTimer);
  if (progress.stage === 'done') {
    host._ethanDismissTimer = setTimeout(() => host.remove(), 1800);
  }
}

function publishMaterialProgress(payload) {
  const now = Date.now();
  if (now - materialProgressLastUpdate < 250 && !['done', 'error', 'zip'].includes(payload.stage)) return;
  materialProgressLastUpdate = now;
  for (const tabId of materialProgressTabs) {
    chrome.scripting.executeScript({
      target: { tabId }, func: renderMaterialProgress, args: [{ ...MATERIAL_JOB_STATE }]
    }).catch(() => {});
  }
}

function is1688ProductDetailUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (['item.taobao.com','detail.tmall.com'].includes(url.hostname) && /^\d+$/.test(url.searchParams.get('id') || '')) return true;
    return /(^|\.)1688\.com$/i.test(url.hostname) && /\/offer\/\d{6,20}\.html/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function formatBatchTimestamp(date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function delayMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function updateMaterialJobState(payload = {}) {
  Object.assign(MATERIAL_JOB_STATE, payload);
  if (payload.stage === 'done' || payload.stage === 'error') MATERIAL_JOB_STATE.running = false;
  publishMaterialProgress(payload);
}

async function notifyMaterialProgress(payload) {
  updateMaterialJobState(payload);
  try {
    await chrome.runtime.sendMessage({ type: 'ETHAN_BATCH_MATERIAL_PROGRESS', ...payload });
  } catch (error) {
    // 插件面板关闭后，后台任务继续执行。
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ETHAN_MATERIAL_KEEPALIVE') return;
  port.onMessage.addListener(() => {
    // 离屏文档每15秒发送一次消息，防止长时间扫描/打包时MV3服务工作线程被回收。
  });
});

async function waitForTabComplete(tabId, timeout = 18000) {
  const initial = await chrome.tabs.get(tabId).catch(() => null);
  if (!initial || initial.status === 'complete') return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// 在页面主世界中运行。只读取商品主图、主图视频、SKU图、描述图、描述视频的
// 结构化数据和明确区域，不再遍历页面全部图片，因此不会把旺旺图标、导航图标、头像等界面素材混入下载。
async function collect1688ProductMaterialsFromPage(descriptionFrame = false) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const data = {
    mainImages: new Set(),
    mainVideos: new Set(),
    skuImages: new Set(),
    displayedDetailImages: new Set(),
    detailImages: new Set(),
    detailVideos: new Set()
  };
  const titleCandidates = [];
  const skuNames = {};
  const retailSkuEntries = new Map();
  const excludedDetailImages = new Set();
  const galleryImages = new Set();
  const offerId = location.href.match(/\/offer\/(\d{6,20})\.html/i)?.[1] || new URL(location.href).searchParams.get('id') || '';
  const retailPage = /(?:taobao|tmall)\.com$/.test(location.hostname);

  const PRODUCT_IMAGE_PATH = /(?:\/img\/ibank\/|\/bao\/uploaded\/|\/imgextra\/|\/product\/|\/offer\/)/i;
  const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|bmp|avif)(?:$|[?#_])/i;
  const VIDEO_EXT = /\.(?:mp4|webm|mov|m3u8)(?:$|[?#])/i;
  const BAD_ASSET = /(?:\/tfs\/|\/tps\/|\/assets?\/|\/static\/|sprite|favicon|captcha|qrcode|qr-code|emoji|loading|placeholder|transparent|wangwang|avatar|shop[-_]?logo|seller[-_]?logo|\/icon(?:s)?\/|(?:^|[._/-])icon(?:[._/-]|$))/i;

  function decodeUrl(raw) {
    return String(raw || '')
      .replace(/\\u002F/gi, '/')
      .replace(/\\u003A/gi, ':')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/^['"]|['"]$/g, '')
      .trim();
  }

  function restoreOriginalImagePath(pathname) {
    let path = pathname.replace(/(\.(?:jpe?g|png|webp))_b\.(?:jpe?g|png|webp)$/i, '$1');
    path = path.replace(/(\.(?:jpe?g|png|gif|bmp|avif))_\.(?:webp|avif)$/i, '$1');
    path = path.replace(/(\.(?:jpe?g|png|webp|gif|bmp|avif))_(?:\d+x\d+|q\d+|Q\d+|sum|search|crop|resize|quality|sharpen)[^/?]*(?:\.(?:jpe?g|png|webp|gif|avif))?$/i, '$1');
    path = path.replace(/(\.(?:jpe?g|png|webp|gif|bmp|avif))_\d+x\d+(?:q\d+)?\.(?:jpe?g|png|webp|gif|avif)$/i, '$1');
    return path;
  }

  function normalizeAssetUrl(raw, kind, confidence = 'structured') {
    let value = decodeUrl(raw);
    if (!value || /^(?:data|blob|javascript):/i.test(value)) return '';
    if (value.startsWith('//')) value = `https:${value}`;
    if (value.startsWith('/')) {
      try { value = new URL(value, location.href).href; } catch (error) { return ''; }
    }
    if (!/^https?:\/\//i.test(value)) return '';

    let parsed;
    try {
      parsed = new URL(value);
      parsed.hash = '';
      if (kind === 'image') {
        parsed.pathname = restoreOriginalImagePath(parsed.pathname);
        // 阿里图片缩放参数只影响展示，下载原图时全部移除。
        parsed.search = '';
      }
      value = parsed.href;
    } catch (error) {
      return '';
    }

    if (BAD_ASSET.test(value)) return '';
    if (kind === 'video') {
      if (/(^|\.)(?:mmstat\.com|log\.mmstat\.com|cnzz\.com|umeng\.com)$/i.test(parsed.hostname)) return '';
      if (!/\.(?:mp4|webm|mov|m3u8)$/i.test(parsed.pathname)) return '';
      return value;
    }

    if (!IMAGE_EXT.test(value) && !PRODUCT_IMAGE_PATH.test(value)) return '';
    // 结构化数据允许 imgextra；低置信度DOM回退只接受典型商品图片路径。
    if (confidence === 'fallback' && !PRODUCT_IMAGE_PATH.test(value)) return '';
    return value;
  }

  function add(bucket, raw, kind = 'image', confidence = 'structured') {
    const url = normalizeAssetUrl(raw, kind, confidence);
    if (url) data[bucket].add(url);
  }

  function imageNodeUrls(node) {
    const values = [
      node.currentSrc,
      node.getAttribute?.('src'),
      node.getAttribute?.('data-src'),
      node.getAttribute?.('data-lazy-src'),
      node.getAttribute?.('data-original'),
      node.getAttribute?.('data-ks-lazyload'),
      node.getAttribute?.('data-actualsrc'),
      node.getAttribute?.('data-lazyload-src'),
      node.getAttribute?.('data-img'),
      node.getAttribute?.('data-image'),
      node.getAttribute?.('data-url')
    ];
    const srcset = node.getAttribute?.('srcset') || node.getAttribute?.('data-srcset') || '';
    if (srcset) srcset.split(',').forEach((part) => values.push(part.trim().split(/\s+/)[0]));
    return values.filter(Boolean);
  }

  function collectBackgroundImages(root, bucket) {
    root.querySelectorAll?.('[style*="background"]').forEach((node) => {
      const value = node.style?.backgroundImage || getComputedStyle(node).backgroundImage || '';
      for (const match of value.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        if ((bucket === 'detailImages' || bucket === 'displayedDetailImages') && !PRODUCT_IMAGE_PATH.test(match[1])) continue;
        add(bucket, match[1], 'image', 'targeted');
      }
    });
  }

  function collectRegion(root, imageBucket, videoBucket) {
    if (!root) return;
    root.querySelectorAll?.('img').forEach((img) => {
      if ((imageBucket === 'detailImages' || imageBucket === 'displayedDetailImages') &&
          img.closest('.sdmap-dynamic-offer-list,.offer-list-wapper,.dynamic-backup-img,a[href*="description.sdmap"]')) {
        imageNodeUrls(img).forEach(source => excludedDetailImages.add(normalizeAssetUrl(source, 'image')));
        return;
      }
      const rect = img.getBoundingClientRect();
      const naturalW = img.naturalWidth || 0;
      const naturalH = img.naturalHeight || 0;
      // 明确区域内仍排除很小的控件图标。
      if (imageBucket !== 'skuImages' && ((naturalW && naturalH && naturalW <= 64 && naturalH <= 64) || (rect.width > 0 && rect.height > 0 && rect.width <= 36 && rect.height <= 36))) return;
      imageNodeUrls(img).forEach((url) => add(imageBucket, url, 'image', 'targeted'));
    });
    collectBackgroundImages(root, imageBucket);
    if (videoBucket) {
      root.querySelectorAll?.('video, video source').forEach((node) => {
        [node.currentSrc, node.src, node.getAttribute?.('src'), node.getAttribute?.('data-src')]
          .filter(Boolean).forEach((url) => add(videoBucket, url, 'video'));
        const poster = node.poster || node.getAttribute?.('poster');
        if (poster && imageBucket === 'mainImages') add('mainImages', poster, 'image', 'targeted');
      });
    }
  }

  function uniqueRegions(selectors) {
    const found = new Set();
    selectors.forEach((selector) => {
      try { document.querySelectorAll(selector).forEach((node) => found.add(node)); } catch (error) {}
    });
    return [...found];
  }

  const mainSelectors = [
    '[class*="thumbnail--"]', '#J_UlThumb',
    '[class*="od-gallery"]', '[class*="main-gallery"]', '[class*="offer-gallery"]',
    '[class*="image-preview"]', '[class*="main-image"]', '[class*="mainImage"]',
    '[class*="image-viewer"]', '[class*="detail-gallery"]', '[data-testid*="gallery"]', '[data-role*="gallery"]',
    '[class*="pic-gallery"]', '[class*="thumbnail-list"]'
  ];
  const skuSelectors = [
    '[class*="valueItem--"]', '[class*="valueItemImgWrap--"]', '[class*="skuItem--"]',
    '[class*="sku" i]', '[class*="prop-item"]', '[class*="propItem"]', '[class*="spec-item"]',
    '[class*="sku-wrapper"]', '[class*="sku-list"]', '[class*="skuList"]', '[class*="offer-sku"]', '[class*="sku-module"]', '[class*="sku-content"]',
    '[class*="sale-prop"]', '[class*="saleProp"]', '[class*="spec-list"]',
    '[class*="specList"]', '[class*="prop-list"]', '[data-testid*="sku"]', '[data-role*="sku"]', '[class*="sku-item"]', '[class*="skuItem"]', '[class*="sku-selector"]', '[data-sku-id]'
  ];
  const detailSelectors = [
    '#imageTextInfo-content', '.desc-root', '#J_DivItemDesc',
    '#desc-lazyload-container', '#detailContent', '#detail-content', '#mod-detail-description',
    '[class*="detail-desc-decorate-richtext"]', '[class*="detail-description"]', '[class*="detail-content"]', '[class*="detail-desc"]',
    '[class*="desc-content"]', '[class*="descContent"]', '[class*="description-content"]',
    '[class*="offer-detail-content"]', '[data-testid*="description"]', '[data-role*="detail"]', '#detail-description', '#description', '[class*="desc-lazyload"]'
  ];

  function collectTargetedDom() {
    if (descriptionFrame) {
      collectRegion(document.body, 'displayedDetailImages', 'detailVideos');
      return;
    }
    uniqueRegions(mainSelectors).forEach((root) => collectRegion(root, 'mainImages', 'mainVideos'));
    uniqueRegions(skuSelectors).filter(root => !root.closest('[class*="wcm-"],#wcm-dialog')).forEach((root) => collectRegion(root, 'skuImages', null));
    document.querySelectorAll('.module-od-sku-selection .sku-filter-button, .module-od-sku-selection .expand-view-item, .module-od-sku-selection [class*="sku-item"], .module-od-sku-selection [class*="prop-item"]').forEach(item => {
      const label = item.querySelector('.label-name,.item-label,[class*="value-name"],[class*="prop-name"]');
      const name = cleanText(label?.getAttribute('title') || label?.textContent ||
        item.getAttribute('title') || item.querySelector('img')?.alt);
      if (!name || name.length > 120) return;
      item.querySelectorAll('img').forEach(img => imageNodeUrls(img).forEach(source => {
        const url = normalizeAssetUrl(source, 'image');
        if (url) {
          data.skuImages.add(url);
          skuNames[url] = name;
        }
      }));
      item.querySelectorAll('[style*="background"]').forEach(node => {
        for (const match of (node.style.backgroundImage || '').matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
          const url = normalizeAssetUrl(match[1], 'image');
          if (url) {
            data.skuImages.add(url);
            skuNames[url] = name;
          }
        }
      });
    });
    if (retailPage) {
      document.querySelectorAll('[class*="valueItemImgWrap--"]').forEach(item => {
        const label = item.parentElement;
        const text = label?.querySelector('[class*="valueItemText--"]');
        const name = cleanText(text?.getAttribute('title') || text?.textContent || label?.getAttribute('title') || label?.textContent);
        item.querySelectorAll('img').forEach(img => imageNodeUrls(img).forEach(source => {
          const url = normalizeAssetUrl(source, 'image');
          if (url && name) {
            data.skuImages.add(url);
            skuNames[url] = name;
            retailSkuEntries.set(name + '|' + url, {url, name});
          }
        }));
      });
    }
    // 1688 的 V-DETAIL 组件在开放式 Shadow DOM 内渲染描述。
    document.querySelectorAll('.html-description').forEach(host => {
      collectRegion(host.shadowRoot, 'displayedDetailImages', 'detailVideos');
    });
    document.querySelectorAll(detailSelectors.join(',')).forEach(root => {
      collectRegion(root, 'displayedDetailImages', 'detailVideos');
    });

    // 同源详情iframe。
    document.querySelectorAll('iframe').forEach((frame) => {
      if (!frame.closest(detailSelectors.join(',')) && !isDescriptionFrameUrl(frame.src)) return;
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        const body = doc.body;
        if (body) collectRegion(body, 'displayedDetailImages', 'detailVideos');
      } catch (error) {}
    });
  }

  function isDescriptionFrameUrl(url) {
    return /(?:description|desc[-_./]|detail[-_./]content)/i.test(url || '');
  }

  function classifyPath(path) {
    const value = String(path || '').toLowerCase();
    const isDetail = /(?:detail|description|desc|richtext|offercontent|detailcontent|图文|描述)/i.test(value);
    const isSku = /(?:sku|saleprop|sale_prop|spec|颜色|款式|规格|prop)/i.test(value);
    const isVideo = /(?:video|media|vod|视频)/i.test(value);
    const isImage = /(?:image|images|img|pic|photo|gallery|thumb|主图|图片)/i.test(value);
    if (isVideo) return isDetail ? 'detailVideos' : 'mainVideos';
    if (isSku && (isImage || /(?:^|\.)(?:url|src)(?:\[\d+\])?$/i.test(value))) return 'skuImages';
    if (isDetail && isImage) return 'detailImages';
    if (isImage && /(?:main|offer|product|gallery|imageinfo|piclist|imagelist|主图)/i.test(value)) return 'mainImages';
    return '';
  }

  function extractUrlsFromString(value) {
    const source = String(value || '');
    const matches = [];
    const regex = /(?:(?:https?:)?\\?\/\\?\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\\-]+?\.(?:jpe?g|png|webp|gif|bmp|avif|mp4|webm|mov|m3u8)(?:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%\\-]*))/gi;
    let match;
    while ((match = regex.exec(source)) && matches.length < 1000) matches.push(match[0]);
    return matches;
  }

  function walkState(value, path = '', depth = 0, seen = new WeakSet(), state = { nodes: 0 }) {
    if (value == null || depth > 10 || state.nodes > 60000) return;
    state.nodes += 1;
    const bucket = classifyPath(path);

    if (typeof value === 'string') {
      if (/(?:^|\.)(?:subject|offerTitle|productName|商品名称)$/i.test(path) && value.length >= 4 && value.length <= 300) titleCandidates.push(cleanText(value));
      if (!bucket) {
        if (/(?:description|detailcontent|offercontent|richtext|descHtml)/i.test(path) && /<(?:img|video)\b/i.test(value)) {
          collectRegion(new DOMParser().parseFromString(value, 'text/html').body, 'detailImages', 'detailVideos');
        }
        return;
      }
      const kind = bucket.endsWith('Videos') ? 'video' : 'image';
      extractUrlsFromString(value).forEach((url) => add(bucket, url, kind, 'structured'));
      // 有些字段直接就是单一URL，没有扩展名但含商品图片路径。
      if (/^(?:https?:)?\/\//i.test(value) || PRODUCT_IMAGE_PATH.test(value)) add(bucket, value, kind, 'structured');
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.slice(0, 800).forEach((item, index) => walkState(item, `${path}[${index}]`, depth + 1, seen, state));
      return;
    }
    Object.keys(value).slice(0, 1000).forEach((key) => {
      let child;
      try { child = value[key]; } catch (error) { return; }
      const nextPath = path ? `${path}.${key}` : key;
      walkState(child, nextPath, depth + 1, seen, state);
    });
  }

  function collectStructuredData() {
    document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"], script[id*="DATA"], script[id*="STATE"]').forEach((script) => {
      const text = script.textContent || '';
      if (!text || text.length > 12_000_000) return;
      try {
        walkState(JSON.parse(text), script.id || script.type || 'json');
      } catch (error) {
        // 不扫描普通脚本；仅在明显包含商品数据关键字的JSON脚本中定向取资源。
        if (/(?:imageList|sku|detail|description|video|offerTitle)/i.test(text)) {
          const pathHint = /(?:detail|description|desc)/i.test(text.slice(0, 3000)) ? 'detail.content' : 'offer.imageList';
          extractUrlsFromString(text).forEach((url) => {
            const isVideo = VIDEO_EXT.test(decodeUrl(url));
            add(isVideo ? (pathHint.startsWith('detail') ? 'detailVideos' : 'mainVideos') : (pathHint.startsWith('detail') ? 'detailImages' : 'mainImages'), url, isVideo ? 'video' : 'image', 'structured');
          });
        }
      }
    });

    const rootNames = [
      '__INIT_DATA__', '__INITIAL_STATE__', '__SSR_DATA__', '__GLOBAL_DATA__', '__PAGE_DATA__',
      '__DATA__', '__NEXT_DATA__', '__NUXT__', 'detailData', 'offerData', 'offerDetailData',
      'pageData', 'renderData', 'skuMap', 'ImageInfo'
    ];
    rootNames.forEach((name) => {
      try { if (window[name]) walkState(window[name], name); } catch (error) {}
    });


  }

  function collectMeta() {
    document.querySelectorAll('meta[property="og:image"], meta[name="og:image"], meta[itemprop="image"]').forEach((meta) => add('mainImages', meta.content, 'image', 'structured'));
    document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]').forEach((meta) => add('mainVideos', meta.content, 'video'));
  }

  function collectVideoResources() {
    try {
      performance.getEntriesByType('resource').forEach((entry) => {
        const url = entry.name || '';
        if (!VIDEO_EXT.test(url) && !/(?:cloud\.video|video\.alicdn|\/vod\/)/i.test(url)) return;
        if (BAD_ASSET.test(url)) return;
        const bucket = /(?:detail|description|desc)/i.test(url) ? 'detailVideos' : 'mainVideos';
        add(bucket, url, 'video');
      });
    } catch (error) {}
  }

  function collectTopGalleryFallback() {
    if (data.mainImages.size >= 2) return;
    const candidates = Array.from(document.querySelectorAll('img')).filter((img) => {
      const rect = img.getBoundingClientRect();
      const source = img.currentSrc || img.src || '';
      if (!PRODUCT_IMAGE_PATH.test(source) || BAD_ASSET.test(source)) return false;
      if (rect.top > 1300 || rect.bottom < -50) return false;
      const w = img.naturalWidth || rect.width || 0;
      const h = img.naturalHeight || rect.height || 0;
      return w >= 180 && h >= 180;
    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    candidates.slice(0, 18).forEach((img) => imageNodeUrls(img).forEach((url) => add('mainImages', url, 'image', 'fallback')));
  }

  if (!descriptionFrame) {
    collectMeta();
    collectStructuredData();
    collectTopGalleryFallback();
  }
  collectTargetedDom();

  // Read real/lazy image addresses directly, including open shadow roots.
  // Only wait when the description component has not populated its addresses yet.
  if (!data.displayedDetailImages.size && !data.detailImages.size) {
    const deadline = performance.now() + 1600;
    while (performance.now() < deadline) {
      await sleep(100);
      collectTargetedDom();
      if (data.displayedDetailImages.size || data.detailImages.size) break;
    }
    if (!descriptionFrame && !data.displayedDetailImages.size) collectStructuredData();
  }
  if (!descriptionFrame) collectVideoResources();

  const heading = document.querySelector('.title-content h1, h1[itemprop="name"], [class*="mainTitle--"]')?.textContent;
  const title = [heading, document.title, ...titleCandidates]
    .map(value => cleanText(value).replace(/\s*[-_|｜]\s*(?:阿里巴巴|1688).*$/i, '').replace(/\s*1688\.com.*$/i, '').replace(/[-_\s]*(?:淘宝网|天猫|tmall\.com).*$/i, '').trim())
    .find(value => value.length >= 2 && value.length <= 300 &&
      !/(?:有限公司|个体工商户|经营部)$/.test(value) &&
      !/^(?:个人中心|我的1688|登录|阿里巴巴|商品信息|商品详情|产品详情|素材下载|旺参谋)(?:$|\s*[-_|｜:：])/i.test(value)) || '';

  // 轮播列表按商品主图顺序排列，视频封面单独排除。
  document.querySelectorAll('.od-picture-gallery-list > li:not(.video-image-cover)').forEach(item => {
    const sources = [
      ...Array.from(item.querySelectorAll('img')).flatMap(imageNodeUrls),
      ...Array.from(item.style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/gi), match => match[1])
    ];
    const url = sources.map(source => normalizeAssetUrl(source, 'image', 'targeted')).find(Boolean);
    if (url) galleryImages.add(url);
  });

  if (retailPage) {
    document.querySelectorAll('[class*="thumbnailItem--"] img,#J_UlThumb img').forEach(img => {
      const url = imageNodeUrls(img).map(source => normalizeAssetUrl(source, 'image')).find(Boolean);
      if (url) galleryImages.add(url);
    });
  }
  const materials = {
    '主图': Array.from(galleryImages.size ? galleryImages : data.mainImages)
      .filter(url => retailPage ? !Array.from(retailSkuEntries.values()).some(item => item.url === url) : !data.skuImages.has(url)).slice(0, 5),
    '主图视频': Array.from(data.mainVideos).slice(0, 12),
    'SKU图': Array.from(retailPage ? new Set(Array.from(retailSkuEntries.values(), item => item.url)) : data.skuImages).slice(0, 160),
    '描述图': Array.from(data.displayedDetailImages.size ? data.displayedDetailImages : data.detailImages)
      .filter(url => !excludedDetailImages.has(url)).slice(0, 600),
    '描述视频': Array.from(data.detailVideos).slice(0, 30)
  };
  return {
    ok: Object.values(materials).some((items) => items.length),
    title,
    offerId,
    sourceUrl: location.href,
    skuNames,
    skuEntries: retailPage ? Array.from(retailSkuEntries.values()) : undefined,
    materials
  };
}

async function collectMaterialsFromTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await waitForTabComplete(tab.id);
  const framesPromise = chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: collect1688ProductMaterialsFromPage
  });
  const product = results?.[0]?.result;
  if (!product) return null;

  const frames = await framesPromise;
  const descriptionFrames = (frames || []).filter(frame => frame.frameId !== 0 &&
    /(?:description|desc[-_./]|detail[-_./]content)/i.test(frame.url || ''));
  const frameResults = await Promise.allSettled(descriptionFrames.map(frame => chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [frame.frameId] },
    world: 'MAIN',
    func: collect1688ProductMaterialsFromPage,
    args: [true]
  })));
  for (const result of frameResults) {
    const materials = result.status === 'fulfilled' ? result.value[0]?.result?.materials : null;
    if (!materials) continue;
    for (const category of ['描述图', '描述视频']) {
      product.materials[category] = [...new Set([...product.materials[category], ...materials[category]])];
    }
  }
  product.ok = Object.values(product.materials).some(items => items.length);
  return product;
}

async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) return chrome.offscreen.hasDocument();
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(MATERIAL_OFFSCREEN_URL)]
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: MATERIAL_OFFSCREEN_URL,
    reasons: ['BLOBS'],
    justification: '将多个1688产品素材按旺参谋PC端文件夹结构打包成单个ZIP，避免产生大量零散下载任务。'
  });
}

async function setOffscreenKeepAlive(active) {
  try {
    await chrome.runtime.sendMessage({ type: active ? 'ETHAN_OFFSCREEN_KEEPALIVE_START' : 'ETHAN_OFFSCREEN_KEEPALIVE_STOP' });
  } catch (error) {
    // 离屏文档刚创建时可能尚未加载完成，启动阶段由调用方重试。
  }
}

function waitForPackageResult(jobId, timeout = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      MATERIAL_PACKAGE_WAITERS.delete(jobId);
      reject(new Error('素材打包超时，请减少标签页数量后重试。'));
    }, timeout);
    MATERIAL_PACKAGE_WAITERS.set(jobId, {
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
  });
}

async function requestOffscreenPackage(message) {
  const jobId = `material_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const resultPromise = waitForPackageResult(jobId);
  let ack;
  try {
    ack = await chrome.runtime.sendMessage({ type: 'ETHAN_OFFSCREEN_PACKAGE_MATERIALS', jobId, ...message });
  } catch (error) {
    MATERIAL_PACKAGE_WAITERS.delete(jobId);
    throw error;
  }
  if (!ack?.ok || !ack.started) {
    MATERIAL_PACKAGE_WAITERS.delete(jobId);
    throw new Error(ack?.message || '离屏打包任务启动失败。');
  }
  return resultPromise;
}

async function runBatchMaterialDownload(windowId) {
  await ensureOffscreenDocument();
  await delayMs(180);
  await setOffscreenKeepAlive(true);
  await delayMs(80);
  await setOffscreenKeepAlive(true);

  const tabs = await chrome.tabs.query(Number.isInteger(windowId) ? { windowId } : { currentWindow: true });
  const productTabs = tabs.filter((tab) => Number.isInteger(tab.id) && is1688ProductDetailUrl(tab.url));
  materialProgressTabs = [...new Set([...productTabs.map(tab => tab.id),
    ...tabs.filter(tab => tab.active && /^https?:/.test(tab.url || '')).map(tab => tab.id)])];
  materialProgressLastUpdate = 0;
  publishMaterialProgress(MATERIAL_JOB_STATE);
  if (!productTabs.length) return { ok: false, message: '当前浏览器窗口中没有识别到1688产品详情页标签。' };

  const originalTab = tabs.find(tab => tab.active);
  const products = [];
  let scanFailedCount = 0;
  try {
    for (let index = 0; index < productTabs.length; index += 1) {
      const tab = productTabs[index];
      await notifyMaterialProgress({ stage: 'scan', current: index + 1, total: productTabs.length, title: tab.title || '' });
      try {
        const product = await collectMaterialsFromTab(tab);
        if (product?.ok) products.push(product);
        else scanFailedCount += 1;
      } catch (error) {
        scanFailedCount += 1;
      }
    }
  } finally {
    if (originalTab?.id) await chrome.tabs.update(originalTab.id, { active: true }).catch(() => {});
  }

  if (!products.length) return { ok: false, message: '已找到1688产品标签页，但没有提取到有效的PC端商品素材。请确认商品页已正常加载。' };

  const batchName = `1688批量素材_${formatBatchTimestamp()}`;
  const response = await requestOffscreenPackage({ batchName, products, scanFailedCount });
  if (!response?.ok) return { ok: false, message: response?.message || '素材打包失败。' };
  return response;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ETHAN_BATCH_MATERIAL_PROGRESS') {
    updateMaterialJobState(message);
    return false;
  }

  if (message?.type === 'ETHAN_OFFSCREEN_PACKAGE_RESULT') {
    const jobId = String(message.jobId || '');
    const waiter = MATERIAL_PACKAGE_WAITERS.get(jobId);
    if (waiter) {
      MATERIAL_PACKAGE_WAITERS.delete(jobId);
      waiter.resolve(message.result || { ok: false, message: '离屏打包未返回结果。' });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'ETHAN_GET_BATCH_MATERIAL_STATUS') {
    sendResponse({ ok: true, ...MATERIAL_JOB_STATE });
    return false;
  }

  if (message?.type === 'ETHAN_BATCH_DOWNLOAD_ALL_TAB_MATERIALS') {
    if (MATERIAL_JOB_STATE.running || linkedProductQueueRunning) {
      sendResponse({ ok: false, message: '批量素材下载正在进行中，请等待当前任务完成。' });
      return false;
    }

    Object.assign(MATERIAL_JOB_STATE, {
      running: true, stage: 'scan', current: 0, total: 0, title: '', category: '',
      productCount: 0, fileCount: 0, skippedCount: 0, failedCount: 0,
      batchFolder: '', message: '任务已启动'
    });

    sendResponse({
      ok: true,
      started: true,
      message: '任务已在后台启动，正在读取产品标签页。关闭插件面板也不会中断。'
    });

    void runBatchMaterialDownload(message.windowId)
      .then(async (result) => {
        if (result?.ok) await notifyMaterialProgress({ stage: 'done', ...result });
        else await notifyMaterialProgress({ stage: 'error', message: result?.message || '批量素材下载失败。' });
      })
      .catch(async (error) => {
        await notifyMaterialProgress({ stage: 'error', message: error?.message || '批量素材下载失败。' });
      })
      .finally(async () => {
        MATERIAL_JOB_STATE.running = false;
        await setOffscreenKeepAlive(false);
      });
    return false;
  }

  if (message?.type !== 'ETHAN_OPEN_PRODUCT_LINKS_NEW_WINDOW') return false;
  const parsed = normalizeProductLinks(message.text || '');
  if (!parsed.urls.length) {
    sendResponse({ ok: false, message: '没有识别到有效的产品链接或产品ID。', invalid: parsed.invalid });
    return false;
  }
  openUrlsInNewWindow(parsed.urls)
    .then((result) => sendResponse({ ok: true, ...result, invalid: parsed.invalid }))
    .catch((error) => sendResponse({ ok: false, message: error?.message || '批量打开失败。', invalid: parsed.invalid }));
  return true;
});

// Read/merge native Vue rows in the page world; retain native row actions.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ETHAN_NATIVE_COMBINED_ROWS') return false;
  if (!sender.tab?.id || !sender.url?.startsWith('https://ethan.hzzichi.com/')) return false;
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id }, world: 'MAIN',
    args: [message.action, message.operator || ''],
    func: async (action, operator) => {
      const root = Array.from(document.querySelectorAll('.el-table')).find(el =>
        el.innerText.includes('工单ID') && el.__vue__?.$parent?.dataList);
      const table = root?.__vue__, owner = table?.$parent;
      if (!owner || !Array.isArray(owner.dataList)) throw new Error('未找到原生工单列表，请刷新页面');
      if (action === 'pageSize') {
        const apply = (target) => {
          if (target.dataForm.limit === 50) return;
          if (typeof target.sizeChangeHandle !== 'function') throw new Error('未找到每页条数切换方法');
          target.sizeChangeHandle(50);
        };
        apply(owner);
        // Apply the default once to each newly mounted workorder component.
        if (!window.__ethanPageSize50Observer) {
          const seen = new WeakSet([owner]);
          let timer;
          window.__ethanPageSize50Observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              document.querySelectorAll('.el-table').forEach(el => {
                const target = el.__vue__?.$parent;
                if (el.innerText.includes('工单ID') && target?.dataForm && !seen.has(target)) {
                  seen.add(target);
                  apply(target);
                }
              });
            }, 150);
          });
          window.__ethanPageSize50Observer.observe(document.body, {childList:true, subtree:true});
        }
        await owner.$nextTick();
        for (let i = 0; owner.dataListLoading && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 100));
        if (owner.dataListLoading) throw new Error('切换每页50条超时，请重试');
        return {ok:true};
      }
      if (!['query', 'month', 'today'].includes(action)) throw new Error('不支持的列表操作');
      if (owner.dataListLoading) throw new Error('工单列表正在查询，请稍后重试');
      const form = owner.dataForm;
      const snapshot = JSON.stringify(form);
      const originalRows = owner.dataList;
      const limit = 50;
      const monthly = action === 'month';
      const todayOnly = action === 'today';
      const singleQuery = monthly || todayOnly;
      const dates = [];
      if (singleQuery) {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        dates.push({ andor: 'and', col: 'cust_service_list-complete_time',
          date: todayOnly ? [`${prefix}-${String(today.getDate()).padStart(2, '0')}`, `${prefix}-${String(today.getDate()).padStart(2, '0')}`] : [`${prefix}-01`, `${prefix}-${lastDay}`], inverted: false });
      }
      const queryStatus = async (status) => {
        const words = status ? [{ andor: 'and', col: 'cust_service_list-opr_status', colType: 'varchar', con: 'eq', word: status }] : [];
        if (operator) words.unshift({ andor: 'and', col: 'cust_service_list-opr_user', colType: 'varchar', con: 'eq', word: operator });
        const response = await owner.$http({
          url: owner.$http.adornUrl('/workorder/search/list'),
          method: 'post',
          data: owner.$http.adornData({ forumName: owner.forumName, data: {
            ...form, searchType: '', sysMenuId: 0, dates, words,
            page: 1, limit, orderBy: 'id', order: 'desc'
          } })
        });
        const result = response.data;
        if (result?.code !== 0 || !Array.isArray(result.page?.list)) {
          throw new Error(result?.msg || `“${status}”查询失败`);
        }
        if ((!singleQuery || todayOnly) && result.page.totalCount > result.page.list.length) {
          throw new Error(`“${status}”超过每页 ${limit} 条，无法完整合并`);
        }
        return { rows: result.page.list, total: result.page.totalCount, words };
      };
      const statuses = todayOnly ? [''] : monthly ? ['等待客户确认'] : ['处理中', '等待处理'];
      const results = await Promise.all(statuses.map(queryStatus));
      if (!root.isConnected || owner.dataListLoading || owner.dataList !== originalRows || JSON.stringify(form) !== snapshot) {
        throw new Error('查询期间工单列表已更新，请重试联合查询');
      }
      // Keep the native filter controls visible, including defaults removed by older versions.
      const fillFilterRows = (existing, active, defaults, valueKey) => {
        const columns = [...new Set([...defaults.map(row => row.col), ...active.map(row => row.col)])];
        const updated = new Set();
        const visibleRows = existing.map((row) => {
          const replacement = !updated.has(row.col) && active.find(item => item.col === row.col);
          updated.add(row.col);
          return replacement ? { ...row, ...replacement } : { ...row, [valueKey]: '' };
        });
        for (const col of columns) {
          if (updated.has(col)) continue;
          visibleRows.push(active.find(row => row.col === col) || defaults.find(row => row.col === col));
        }
        return visibleRows;
      };
      const defaultDates = ['data_check', 'plan_complete'].map(field => ({
        andor: 'and', col: `cust_service_list-${field}`, date: '', inverted: false
      }));
      const defaultWords = [
        { andor: 'and', col: 'cust_user-cust_name', colType: 'varchar', con: 'ai', word: '' },
        ...['opr_user', 'opr_status', 'service_item'].map(field => ({
          andor: 'and', col: `cust_service_list-${field}`, colType: 'varchar', con: 'eq', word: ''
        }))
      ];
      if (singleQuery) {
        const { rows, total, words } = results[0];
        table.clearSelection?.();
        Object.assign(form, {
          searchType: '', sysMenuId: 0, page: 1, limit, total, orderBy: 'id', order: 'desc',
          dates: fillFilterRows(form.dates, dates, defaultDates, 'date'),
          words: fillFilterRows(form.words, words, defaultWords, 'word')
        });
        owner.dataList = rows;
        await owner.$nextTick();
        table.doLayout?.();
        return { ok: true, rowCount: rows.length };
      }
      const rows = results.flatMap((result) => result.rows);
      // Keep 1970 dates first in chronological order; empty/invalid dates stay last.
      const planTime = (row) => {
        const value = String(row['cust_service_list-plan_complete'] ?? '').trim();
        if (!value) return Infinity;
        const time = Date.parse(value.replace(' ', 'T'));
        return Number.isFinite(time) ? time : Infinity;
      };
      const unique = new Map();
      for (const row of rows) {
        const id = row['cust_service_list-id'];
        if (id == null) throw new Error('工单缺少ID，无法安全合并');
        unique.set(String(id), row);
      }
      owner.dataListSelections = [];
      table.clearSelection?.();
      table.clearSort?.();
      owner.dataList = Array.from(unique.values()).sort((a, b) => {
        const left = planTime(a), right = planTime(b);
        return left === right ? 0 : left < right ? -1 : 1;
      });
      // The native status control accepts one value. Clear it so it cannot show a stale status.
      const operatorWords = results[0].words.filter(row => row.col === 'cust_service_list-opr_user');
      Object.assign(form, {
        searchType: '', sysMenuId: 0, page: 1, limit, total: owner.dataList.length,
        dates: fillFilterRows(form.dates, dates, defaultDates, 'date'),
        words: fillFilterRows(form.words, operatorWords, defaultWords, 'word')
      });
      const sortState = {
        rows: owner.dataList,
        defaultOrder: owner.dataList.slice()
      };
      // Element emits sort-change for remote columns. Keep that event local while
      // this table still displays the combined result.
      if (!table.__ethanCombinedSort) {
        const emit = table.$emit;
        const collator = new Intl.Collator('zh-CN', { numeric: true });
        table.$emit = function (event, ...args) {
          const state = this.__ethanCombinedSort;
          if (event !== 'sort-change' || !state || owner.dataList !== state.rows
              || owner.dataListLoading) {
            return emit.call(this, event, ...args);
          }
          const { prop, order } = args[0] || {};
          const sorted = state.defaultOrder.slice();
          if (prop && order) {
            const direction = order === 'descending' ? -1 : 1;
            sorted.sort((a, b) => direction * collator.compare(String(a[prop] ?? ''), String(b[prop] ?? '')));
          }
          owner.dataList = sorted;
          state.rows = owner.dataList;
          return this;
        };
      }
      table.__ethanCombinedSort = sortState;
      await owner.$nextTick();
      window.dispatchEvent(new Event('ethan-combined-results'));
      table.doLayout?.();
      document.getElementById('ethan-inline-panel')?.remove();
      return { ok: true, rowCount: owner.dataList.length };
    }
  }).then(results => sendResponse(results[0]?.result || {ok:false,message:'列表更新失败'}))
    .catch(error => sendResponse({ok:false,message:error.message}));
  return true;
});

importScripts("linked-product-queue.js");

importScripts("shop-link-collector.js");

importScripts("product-page-download.js");

importScripts("image-word-check-background.js");
