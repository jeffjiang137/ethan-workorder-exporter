function ethanDoubaoPngFilename(pageTitle) {
  let name = String(pageTitle || '').replace(/\s*[-–—|｜]\s*豆包\s*$/u, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/, '');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  if (!name || /^(豆包|下载)$/.test(name)) name = '豆包原图';
  return name + '.png';
}

async function ethanDownloadDoubaoImage(value, candidates, pageTitle) {
  const url = new URL(value);
  const allowed = input => {
    try {
      const candidate = new URL(input);
      return candidate.protocol === 'https:' &&
        /(^|\.)(doubao\.com|byteimg\.com|byteimg\.cn|ibytedtos\.com|volces\.com|volccdn\.com)$/i.test(candidate.hostname) &&
        !/watermark|[-_]lwm\d*(?:[._-]|$)/i.test(candidate.pathname);
    } catch { return false; }
  };
  const sources = [...new Set([url.href, ...(Array.isArray(candidates) ? candidates.slice(0, 3) : [])])].filter(allowed);
  if (!sources.length) throw new Error('豆包原图地址无效');
  const bytes = await fetchDoubaoPhotoshopBytes(sources, { png: true });
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const filename = ethanDoubaoPngFilename(pageTitle);
  const downloadUrl = `data:image/png;request=${crypto.randomUUID()};base64,${btoa(binary)}`;
  // Filename determination also runs for data URLs.
  linkedDownloadPaths.set(downloadUrl, filename);
  try {
    return await chrome.downloads.download({ url: downloadUrl, filename, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => linkedDownloadPaths.delete(downloadUrl), 30000);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'ethan-doubao-save-original' || !sender.tab ||
      !/^https:\/\/(?:[\w-]+\.)*doubao\.com\//i.test(sender.url || '')) return;
  chrome.storage.local.get({ doubaoOriginalEnabled: true }).then(settings => {
    if (!settings.doubaoOriginalEnabled) throw new Error('豆包无水印开关已关闭');
    return ethanDownloadDoubaoImage(message.url, message.candidates, sender.tab.title);
  }).then(
    () => respond({ ok: true }),
    error => respond({ ok: false, error: error.message })
  );
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ethan-doubao-save-original' || !tab?.id) return;
  void (async () => {
    try {
      const { doubaoOriginalEnabled } = await chrome.storage.local.get({ doubaoOriginalEnabled: true });
      if (!doubaoOriginalEnabled) throw new Error('请先开启豆包无水印开关');
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId || 0] },
        func: value => globalThis.ethanDoubaoContextOriginal?.(value),
        args: [info.srcUrl || '']
      });
      if (!result?.url) throw new Error(result?.error || '请刷新豆包页面后重试');
      await ethanDownloadDoubaoImage(result.url, result.candidates, tab.title);
    } catch (error) {
      await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '豆包图片下载失败', message: error.message });
    }
  })();
});

// Reuse the collector's Billfish discovery, source detection and download fallback.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ethan-save-image') return;
  void (async () => {
    try {
      if (!tab?.id) throw new Error('无法访问当前网页');
      let src = info.srcUrl;
      const targets = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId || 0] },
        func: () => {
          const image = globalThis.__ethanContextImage;
          return image && Date.now() - image.time < 120000 ? image : null;
        }
      });
      let context = targets[0]?.result;
      src = src || context?.src;
      if (/^https?:\/\/offer\.1688\.com\/offer\/post\//i.test(info.frameUrl || tab.url || '')) {
        const titles = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [info.frameId || 0] },
          func: ethanReadPublishTitle
        });
        const title = titles[0]?.result;
        if (title) context = { ...context, title };
      }

      if (!src) throw new Error('当前位置未找到图片，请在商品图片上右键；插件更新后请先刷新网页');
      // Shop cards carry their real title, offer ID and original image in React
      // props in the MAIN world; their clickable DOM need not contain a link.
      if (globalThis.__BFV14ReadProductCards) {
        const cards = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [info.frameId || 0] },
          world: 'MAIN', func: globalThis.__BFV14ReadProductCards
        });
        const canonical = value => {
          try { const url = new URL(ethanOriginalImageUrl(value)); return url.origin + url.pathname; }
          catch { return value; }
        };
        const matches = (cards[0]?.result || []).filter(card => card.sources.some(value => canonical(value) === canonical(src)));
        if (matches.length && new Set(matches.map(card => card.url)).size === 1) {
          const card = matches[0];
          context = { ...context, title: card.title, sourceLink: card.url };
          src = card.original || src;
        }
      }
      if (src.startsWith('blob:')) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [info.frameId || 0] },
          func: async url => {
            const blob = await (await fetch(url)).blob();
            if (!blob.type.startsWith('image/') || blob.size > 24 * 1024 * 1024) throw new Error('图片格式无效或超过24MB');
            return await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('读取图片失败'));
              reader.readAsDataURL(blob);
            });
          },
          args: [src]
        });
        src = results[0]?.result;
        if (!src) throw new Error('无法读取网页图片');
      }
      const originalSrc = ethanOriginalImageUrl(src);
      const result = await globalThis.ethanCollectContextImage(tab, {
        src: originalSrc, originalSrc, candidates: [...new Set([originalSrc, src])], type: 'image', title: context?.title || tab.title || '采集图片',
        sourceLink: context?.sourceLink || '',
        pageUrl: info.frameUrl || info.pageUrl || tab.url,
        pageTitle: tab.title
      });
      if (!result.imported || result.failed) throw new Error(result.failures?.[0]?.error || '保存图片失败');
      await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '保存图片',
        message: result.destination === 'browser' ? '已提交到默认下载目录' : '已保存到 Billfish' });
    } catch (error) {
      console.error('保存图片失败', error);
      await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '保存图片失败', message: ethanChineseError(error.message) });
    }
  })();
});

// Alibaba CDN appends resizing/encoding instructions after the real extension.
function ethanOriginalImageUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)alicdn\.com$/i.test(url.hostname)) return value;
    url.pathname = url.pathname.replace(/\.\d+x\d+(?:xz)?(?:q\d+)?\./ig, '.').replace(/(\.(?:jpe?g|png|webp))_(?:\d|q\d|sum|b\.)[^/]*$/i, '$1');
    url.searchParams.delete('x-oss-process');
    return url.href;
  } catch { return value; }
}

function ethanReadPublishTitle() {
  const value = element => String(element?.value || '').trim();
  for (const selector of ['input[name="subject"]', 'input[name="title"]', 'input[name="offerTitle"]', '#subject', '#offerTitle', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]']) {
    const title = value(document.querySelector(selector));
    if (title) return title;
  }
  // Match the visible form label when the publishing UI uses generated IDs.
  for (const label of document.querySelectorAll('label,span,div,th,td')) {
    if (!/^\*?\s*信息标题\s*[:：]?$/.test(label.textContent.trim())) continue;
    if (label.htmlFor) {
      const title = value(document.getElementById(label.htmlFor));
      if (title) return title;
    }
    for (let row = label.parentElement, depth = 0; row && depth < 3; row = row.parentElement, depth++) {
      const inputs = row.querySelectorAll('input:not([type="hidden"]),textarea');
      if (inputs.length > 1) break;
      if (inputs.length === 1 && value(inputs[0])) return value(inputs[0]);
    }
  }
  return '';
}
