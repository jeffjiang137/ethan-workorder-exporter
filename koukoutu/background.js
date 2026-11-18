(()=>{
'use strict';

const ARM_TTL_MS = 30_000;
const arms = new Map();
const downloadToNonce = new Map();
const uiSuppressingTabs = new Set();

function safeFilename(filename) {
  const fallback = `抠图结果_${Date.now()}.png`;
  if (!filename || typeof filename !== 'string') return fallback;
  const parts = filename
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part
      .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 160))
    .map((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ? `_${part}` : part)
    .filter(Boolean);
  return parts.join('/') || fallback;
}


async function persistUiSuppressions() {
  await chrome.storage.session.set({ kktUiSuppressingTabs: [...uiSuppressingTabs] });
}

async function applyDownloadUiState() {
  if (typeof chrome.downloads.setUiOptions !== 'function') {
    throw new Error('当前 Chrome 版本不支持隐藏下载面板');
  }
  await chrome.downloads.setUiOptions({ enabled: uiSuppressingTabs.size === 0 });
}

async function restoreUiSuppressions() {
  const { kktUiSuppressingTabs = [] } = await chrome.storage.session.get('kktUiSuppressingTabs');
  for (const tabId of kktUiSuppressingTabs) {
    if (Number.isInteger(tabId)) uiSuppressingTabs.add(tabId);
  }
  try {
    await applyDownloadUiState();
  } catch (_) {
    // Permission/API issues are reported when the content script requests suppression.
  }
}

async function persistArms() {
  const serializable = [...arms.values()].map(({ nonce, tabId, filename, armedAt, downloadId, state, error }) => ({
    nonce,
    tabId,
    filename,
    armedAt,
    downloadId: downloadId ?? null,
    state: state || 'armed',
    error: error || ''
  }));
  await chrome.storage.session.set({ kktDownloadArms: serializable });
}

async function restoreArms() {
  const { kktDownloadArms = [] } = await chrome.storage.session.get('kktDownloadArms');
  const now = Date.now();
  for (const arm of kktDownloadArms) {
    if (!arm?.nonce || !Number.isInteger(arm.tabId)) continue;
    if (now - Number(arm.armedAt || 0) > ARM_TTL_MS * 4) continue;
    arms.set(arm.nonce, arm);
    if (Number.isInteger(arm.downloadId)) downloadToNonce.set(arm.downloadId, arm.nonce);
  }
}

const restorePromise = Promise.all([
  restoreArms(),
  restoreUiSuppressions()
]).catch(() => {});

async function notifyTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {
    // The tab may have navigated or closed.
  }
}

async function findDownload(downloadId) {
  const items = await chrome.downloads.search({ id: downloadId });
  return items[0] || null;
}

async function directDownload({ url, filename }) {
  if (typeof url !== 'string' || !/^(https?:|data:)/i.test(url)) {
    throw new Error('资源地址不是可直接下载的 HTTP(S) 或 data URL');
  }
  const downloadId = await chrome.downloads.download({
    url,
    filename: safeFilename(filename),
    conflictAction: 'uniquify',
    saveAs: false
  });
  return { downloadId };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!String(message?.type || '').startsWith('KKT_')) return false;
  (async () => {
    await restorePromise;
    const type = message?.type;

    if (type === 'KKT_SET_DOWNLOAD_UI') {
      const tabId = sender.tab?.id ?? (sender.url?.startsWith('https://www.koukoutu.com/removebgtool/') ? -1 : undefined);
      if (!Number.isInteger(tabId)) throw new Error('无法识别抠抠图页面');
      if (message.enabled === false) uiSuppressingTabs.add(tabId);
      else uiSuppressingTabs.delete(tabId);
      await persistUiSuppressions();
      await applyDownloadUiState();
      sendResponse({ ok: true, enabled: uiSuppressingTabs.size === 0, suppressingTabs: uiSuppressingTabs.size });
      return;
    }

    if (type === 'KKT_DIRECT_DOWNLOAD') {
      const result = await directDownload(message);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === 'KKT_CHECK_DOWNLOAD') {
      const item = await findDownload(Number(message.downloadId));
      sendResponse({
        ok: Boolean(item),
        state: item?.state || 'unknown',
        filename: item?.filename || '',
        error: item?.error || ''
      });
      return;
    }

    if (type === 'KKT_ARM_DOWNLOAD') {
      const tabId = sender.tab?.id ?? (sender.url?.startsWith('https://www.koukoutu.com/removebgtool/') ? -1 : undefined);
      if (!Number.isInteger(tabId)) throw new Error('无法识别抠抠图页面');
      const arm = {
        nonce: String(message.nonce),
        tabId,
        filename: safeFilename(message.filename),
        armedAt: Date.now(),
        downloadId: null,
        state: 'armed',
        error: ''
      };
      arms.set(arm.nonce, arm);
      await persistArms();
      sendResponse({ ok: true });
      return;
    }

    if (type === 'KKT_GET_ARM_STATUS') {
      const arm = arms.get(String(message.nonce));
      sendResponse({ ok: Boolean(arm), arm: arm || null });
      return;
    }

    if (type === 'KKT_DISARM_DOWNLOAD') {
      const nonce = String(message.nonce);
      const arm = arms.get(nonce);
      if (arm?.downloadId) downloadToNonce.delete(arm.downloadId);
      arms.delete(nonce);
      await persistArms();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'unknown_message' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});

chrome.downloads.onCreated.addListener(async (item) => {
  await restorePromise;
  const now = Date.now();
  const candidates = [...arms.values()]
    .filter((arm) => !arm.downloadId && now - arm.armedAt >= 0 && now - arm.armedAt <= ARM_TTL_MS)
    .sort((a, b) => b.armedAt - a.armedAt);
  if (!candidates.length) return;

  const siteRelated = /koukoutu\.com/i.test(`${item.url || ''} ${item.finalUrl || ''} ${item.referrer || ''}`);
  const arm = candidates.find((candidate) => siteRelated || candidates.length === 1);
  if (!arm) return;

  arm.downloadId = item.id;
  arm.state = item.state || 'in_progress';
  downloadToNonce.set(item.id, arm.nonce);
  await persistArms();
  await notifyTab(arm.tabId, {
    type: 'KKT_DOWNLOAD_STARTED',
    nonce: arm.nonce,
    downloadId: item.id,
    filename: item.filename || ''
  });
});

globalThis.ethanKktDownloadFilename = item => {
  const nonce = downloadToNonce.get(item.id);
  const arm = nonce ? arms.get(nonce) : null;
  return arm?.filename ? {filename:arm.filename,conflictAction:'uniquify'} : null;
};

chrome.downloads.onChanged.addListener(async (delta) => {
  await restorePromise;
  const nonce = downloadToNonce.get(delta.id);
  if (!nonce) return;
  const arm = arms.get(nonce);
  if (!arm) return;

  if (delta.state?.current) arm.state = delta.state.current;
  if (delta.error?.current) arm.error = delta.error.current;
  await persistArms();

  if (delta.state?.current === 'complete') {
    const item = await findDownload(delta.id);
    await notifyTab(arm.tabId, {
      type: 'KKT_DOWNLOAD_COMPLETE',
      nonce,
      downloadId: delta.id,
      filename: item?.filename || arm.filename
    });
  } else if (delta.state?.current === 'interrupted') {
    await notifyTab(arm.tabId, {
      type: 'KKT_DOWNLOAD_FAILED',
      nonce,
      downloadId: delta.id,
      error: arm.error || '下载被中断'
    });
  }
});

async function togglePanel(tab) {
  if (!tab?.id || !/^https:\/\/(www\.)?koukoutu\.com\/removebgtool\//i.test(tab.url || '')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'KKT_TOGGLE_PANEL' });
  } catch (_) {}
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await restorePromise;
  if (!uiSuppressingTabs.delete(tabId)) return;
  try {
    await persistUiSuppressions();
    await applyDownloadUiState();
  } catch (_) {}
});

})();