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

const OPERATOR_STORAGE_KEY = 'ethanOperatorName';
const OPERATOR_HISTORY_KEY = 'ethanOperatorNames';

let operatorTagBusy = false;
let operatorUndoTimer;

function renderOperatorTags(names, active) {
  settingStatusNode.replaceChildren();
  for (const name of names) {
    const tag = document.createElement('span');
    tag.className = 'operator-tag';
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'operator-tag-name';
    select.textContent = name;
    select.setAttribute('aria-pressed', String(name === active));
    select.addEventListener('click', () => {
      if (operatorTagBusy) return;
      operatorNameInput.value = name;
      void saveOperatorSetting();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'operator-tag-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除姓名 ${name}`);
    remove.addEventListener('click', () => { void deleteOperatorTag(name); });
    tag.append(select, remove);
    settingStatusNode.appendChild(tag);
  }
}

async function deleteOperatorTag(name) {
  if (operatorTagBusy) return;
  operatorTagBusy = true;
  const notice = document.getElementById('operatorUndo');
  try {
    const stored = await chrome.storage.local.get([OPERATOR_STORAGE_KEY, OPERATOR_HISTORY_KEY]);
    const names = stored[OPERATOR_HISTORY_KEY] || [];
    const index = names.indexOf(name);
    await chrome.storage.local.set({ [OPERATOR_HISTORY_KEY]: names.filter(item => item !== name) });
    renderOperatorTags(names.filter(item => item !== name), stored[OPERATOR_STORAGE_KEY]);
    clearTimeout(operatorUndoTimer);
    notice.replaceChildren(document.createTextNode(`已删除 ${name} · `));
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = '撤销';
    undo.addEventListener('click', async () => {
      if (operatorTagBusy) return;
      operatorTagBusy = true;
      try {
        const current = await chrome.storage.local.get([OPERATOR_STORAGE_KEY, OPERATOR_HISTORY_KEY]);
        const restored = [...(current[OPERATOR_HISTORY_KEY] || [])];
        if (!restored.includes(name)) restored.splice(Math.max(0, index), 0, name);
        await chrome.storage.local.set({ [OPERATOR_HISTORY_KEY]: restored });
        renderOperatorTags(restored, current[OPERATOR_STORAGE_KEY]);
        clearTimeout(operatorUndoTimer);
        notice.replaceChildren();
      } catch (error) {
        notice.textContent = '恢复失败，请重试保存姓名';
      } finally {
        operatorTagBusy = false;
      }
    });
    notice.appendChild(undo);
    operatorUndoTimer = setTimeout(() => notice.replaceChildren(), 6000);
  } catch (error) {
    notice.textContent = '删除失败，请重试';
  } finally {
    operatorTagBusy = false;
  }
}

const extractButton = document.getElementById('extract');
const statsButton = document.getElementById('stats');
const todayStatsButton = document.getElementById('todayStats');
const copyStatsButton = document.getElementById('copyStats');
const saveOperatorButton = document.getElementById('saveOperator');
const operatorNameInput = document.getElementById('operatorName');
const settingStatusNode = document.getElementById('settingStatus');
const statusNode = document.getElementById('status');
const resultBox = document.getElementById('resultBox');
const statsText = document.getElementById('statsText');
const productLinksInput = document.getElementById('productLinks');
const PRODUCT_LINKS_STORAGE_KEY = 'ethanProductLinksDraft';
let productLinksChanged = false;
function saveProductLinksDraft() {
  productLinksChanged = true;
  return chrome.storage.local.set({[PRODUCT_LINKS_STORAGE_KEY]: productLinksInput.value})
    .catch(() => { linkStatusNode.textContent = '链接保存失败，请稍后重试'; });
}
const productLinksReady = chrome.storage.local.get(PRODUCT_LINKS_STORAGE_KEY).then(stored => {
  if (!productLinksChanged) {
    productLinksInput.value = stored[PRODUCT_LINKS_STORAGE_KEY] || '';
    const count = new Set(productLinksInput.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)).size;
    if (count) linkStatusNode.textContent = `已恢复链接 · 总计 ${count} 个`;
  }
}).catch(() => {});
productLinksInput.addEventListener('input', saveProductLinksDraft);

const openProductLinksButton = document.getElementById('openProductLinks');
const linkStatusNode = document.getElementById('linkStatus');
const downloadAllTabMaterialsButton = document.getElementById('downloadAllTabMaterials');
const materialStatusNode = document.getElementById('materialStatus');

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

async function getSavedOperatorName() {
  const stored = await chrome.storage.local.get([OPERATOR_STORAGE_KEY, OPERATOR_HISTORY_KEY]);
  return normalizeName(stored?.[OPERATOR_STORAGE_KEY]);
}

async function loadOperatorSetting() {
  try {
    const stored = await chrome.storage.local.get([OPERATOR_STORAGE_KEY, OPERATOR_HISTORY_KEY]);
    const name = normalizeName(stored?.[OPERATOR_STORAGE_KEY]);
    operatorNameInput.value = name;
    const names = stored[OPERATOR_HISTORY_KEY] || (name ? [name] : []);
    if (!stored[OPERATOR_HISTORY_KEY]) await chrome.storage.local.set({ [OPERATOR_HISTORY_KEY]: names });
    renderOperatorTags(names, name);
  } catch (error) {
    settingStatusNode.textContent = '读取设置失败';
  }
}

async function saveOperatorSetting() {
  if (operatorTagBusy) return;
  operatorTagBusy = true;
  const name = normalizeName(operatorNameInput.value);
  saveOperatorButton.disabled = true;
  saveOperatorButton.textContent = '保存中';
  try {
    if (name) {
      const stored = await chrome.storage.local.get(OPERATOR_HISTORY_KEY);
      const names = [...new Set([...(stored[OPERATOR_HISTORY_KEY] || []), name])];
      await chrome.storage.local.set({ [OPERATOR_STORAGE_KEY]: name, [OPERATOR_HISTORY_KEY]: names });
      operatorNameInput.value = name;
      renderOperatorTags(names, name);
    } else {
      await chrome.storage.local.remove(OPERATOR_STORAGE_KEY);
      settingStatusNode.textContent = '已清除操作人员设置';
    }
  } catch (error) {
    settingStatusNode.textContent = '保存失败，请重试';
  } finally {
    operatorTagBusy = false;
    saveOperatorButton.disabled = false;
    saveOperatorButton.textContent = '保存';
  }
}

async function getActiveEthanTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !String(tab.url || '').startsWith('https://ethan.hzzichi.com/')) {
    throw new Error('请先打开 ethan.hzzichi.com');
  }
  return tab;
}

function isMissingReceiverError(error) {
  const message = String(ethanChineseError(error?.message) || error || '');
  return /Could not establish connection|Receiving end does not exist|message port closed/i.test(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendMessageWithRecovery(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw error;

    statusNode.textContent = '正在重新连接页面…';
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    await delay(320);
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

function setBusy(activeButton, busy) {
  extractButton.disabled = busy;
  statsButton.disabled = busy;
  todayStatsButton.disabled = busy;
  const labels = new Map([
    [extractButton, '本月待确认工单'],
    [statsButton, '待处理+处理中'],
    [todayStatsButton, '今日完成工单']
  ]);
  activeButton.textContent = busy
    ? (activeButton === extractButton ? '正在提取…' : '正在统计…')
    : labels.get(activeButton);
}

saveOperatorButton.addEventListener('click', saveOperatorSetting);
operatorNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveOperatorSetting();
  }
});

extractButton?.addEventListener('click', async () => {
  statusNode.textContent = '正在设置筛选条件并提取…';
  resultBox.classList.remove('show');
  setBusy(extractButton, true);

  try {
    const tab = await getActiveEthanTab();
    const operatorName = await getSavedOperatorName();
    const response = await sendMessageWithRecovery(tab.id, { type: 'ETHAN_EXTRACT_NOW', operatorName });
    if (response?.ok) {
      statusNode.textContent = '已生成表格预览';
      setTimeout(() => window.close(), 250);
    } else {
      statusNode.textContent = response?.message || '提取失败';
    }
  } catch (error) {
    statusNode.textContent = isMissingReceiverError(error) ? '页面连接恢复失败，请刷新网站后重试' : (ethanChineseError(error?.message) || '页面未就绪，请刷新网站后重试');
  } finally {
    setBusy(extractButton, false);
  }
});

statsButton?.addEventListener('click', async () => {
  statusNode.textContent = '正在筛选“处理中”“等待处理”…';
  resultBox.classList.remove('show');
  statsText.value = '';
  setBusy(statsButton, true);

  try {
    const tab = await getActiveEthanTab();
    const operatorName = await getSavedOperatorName();
    const response = await sendMessageWithRecovery(tab.id, { type: 'ETHAN_STATS_MULTI_NOW', operatorName });
    if (response?.ok) {
      if (response.copied) {
        statusNode.textContent = '已显示工单并复制统计结果';
        setTimeout(() => window.close(), 900);
      } else if (response.text) {
        statsText.value = response.text;
        resultBox.classList.add('show');
        statusNode.textContent = '已显示工单，请点击复制统计结果';
      } else {
        statusNode.textContent = response.statsMessage || '已显示工单，未生成统计结果';
      }
    } else {
      statusNode.textContent = response?.message || '筛选失败';
    }
  } catch (error) {
    statusNode.textContent = isMissingReceiverError(error) ? '页面连接恢复失败，请刷新网站后重试' : (ethanChineseError(error?.message) || '页面未就绪，请刷新网站后重试');
  } finally {
    setBusy(statsButton, false);
  }
});

todayStatsButton?.addEventListener('click', async () => {
  statusNode.textContent = '正在清除筛选、设置今天并统计…';
  resultBox.classList.remove('show');
  statsText.value = '';
  setBusy(todayStatsButton, true);

  try {
    const tab = await getActiveEthanTab();
    const operatorName = await getSavedOperatorName();
    const response = await sendMessageWithRecovery(tab.id, { type: 'ETHAN_TODAY_COMPLETED_STATS_NOW', operatorName });
    if (response?.ok) {
      statsText.value = response.text || '';
      resultBox.classList.add('show');
      statusNode.textContent = response.copied === false ? '今日统计完成，请在弹窗中复制' : '今日统计完成，表格已复制';
      statsText.focus();
      statsText.select();
    } else {
      statusNode.textContent = response?.message || '统计失败';
    }
  } catch (error) {
    statusNode.textContent = isMissingReceiverError(error) ? '页面连接恢复失败，请刷新网站后重试' : (ethanChineseError(error?.message) || '页面未就绪，请刷新网站后重试');
  } finally {
    setBusy(todayStatsButton, false);
  }
});

copyStatsButton.addEventListener('click', async () => {
  const text = statsText.value.trim();
  if (!text) {
    statusNode.textContent = '没有可复制的统计结果';
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    statusNode.textContent = '统计结果已复制';
    statsText.focus();
    statsText.select();
  } catch (error) {
    statsText.focus();
    statsText.select();
    document.execCommand('copy');
    statusNode.textContent = '统计结果已复制';
  }
});


openProductLinksButton.addEventListener('click', async () => {
  const text = productLinksInput.value.trim();
  if (!text) {
    linkStatusNode.textContent = '请先输入或粘贴产品链接。';
    productLinksInput.focus();
    return;
  }

  openProductLinksButton.disabled = true;
  openProductLinksButton.textContent = '正在打开…';
  linkStatusNode.textContent = '正在新建窗口并打开标签页…';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ETHAN_OPEN_PRODUCT_LINKS_NEW_WINDOW',
      text
    });

    if (response?.ok) {
      const invalidText = response.invalid?.length ? `，另有 ${response.invalid.length} 行未识别` : '';
      linkStatusNode.textContent = `已打开 ${response.count} 个产品链接${invalidText}`;
      if (response.paused) {
        productLinksInput.value = (response.remaining || []).join('\n');
        await saveProductLinksDraft();
        linkStatusNode.textContent = `已打开 ${response.count} 个，检测到验证或页面未就绪，已暂停。请手动完成验证后再次点击打开，输入框已保留剩余链接。`;
      }
    } else {
      linkStatusNode.textContent = response?.message || '批量打开失败。';
    }
  } catch (error) {
    linkStatusNode.textContent = ethanChineseError(error?.message) || '批量打开失败。';
  } finally {
    openProductLinksButton.disabled = false;
    openProductLinksButton.textContent = '新窗口批量打开';
  }
});


function formatMaterialProgress(message) {
  const parts = [];
  if (message.stage === 'scan') {
    parts.push(`正在读取第 ${message.current || 0}/${message.total || 0} 个产品页`);
  } else if (message.stage === 'pack') {
    parts.push(`正在打包第 ${message.current || 0}/${message.total || 0} 个产品`);
    if (message.category) parts.push(`分类：${message.category}`);
  } else if (message.stage === 'zip') {
    parts.push('正在生成单个ZIP文件…');
  } else if (message.stage === 'done') {
    parts.push(`完成：${message.productCount || 0} 个产品，ZIP内有效素材 ${message.fileCount || 0} 个`);
  } else if (message.stage === 'error') {
    parts.push(message.message || '批量素材下载失败');
  }
  if (message.title) parts.push(message.title);
  if (message.skippedCount) parts.push(`已过滤无效/界面素材 ${message.skippedCount} 个`);
  if (message.failedCount) parts.push(`失败 ${message.failedCount} 个`);
  return parts.join('\n');
}
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'ETHAN_BATCH_MATERIAL_PROGRESS') return false;
  materialStatusNode.textContent = formatMaterialProgress(message);
  if (message.running === false || message.stage === 'done' || message.stage === 'error') {
    downloadAllTabMaterialsButton.disabled = false;
    downloadAllTabMaterialsButton.textContent = '下载所有标签页';
  }
  return false;
});

function setMaterialDownloadRunning(running) {
  downloadAllTabMaterialsButton.disabled = Boolean(running);
  downloadAllTabMaterialsButton.textContent = running ? '正在批量下载…' : '下载所有标签页';
}

async function syncMaterialJobStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'ETHAN_GET_BATCH_MATERIAL_STATUS' });
    if (!status?.ok) return;
    if (status.running) {
      setMaterialDownloadRunning(true);
      materialStatusNode.textContent = formatMaterialProgress(status) || '批量素材任务正在后台执行…';
    } else {
      setMaterialDownloadRunning(false);
      materialStatusNode.textContent = formatMaterialProgress(status);
    }
  } catch (error) {
    // 服务工作线程尚未启动时保持默认状态即可。
  }
}

downloadAllTabMaterialsButton.addEventListener('click', async () => {
  setMaterialDownloadRunning(true);
  materialStatusNode.textContent = '正在启动后台任务并检查当前窗口中的1688产品标签页…';

  try {
    const currentWindow = await chrome.windows.getCurrent();
    const response = await chrome.runtime.sendMessage({
      type: 'ETHAN_BATCH_DOWNLOAD_ALL_TAB_MATERIALS',
      windowId: currentWindow?.id
    });

    if (response?.ok && response.started) {
      materialStatusNode.textContent = response.message || '任务已启动，可保持面板打开查看进度；关闭面板后任务也会继续。';
      return;
    }

    setMaterialDownloadRunning(false);
    materialStatusNode.textContent = response?.message || '批量素材下载启动失败。';
  } catch (error) {
    setMaterialDownloadRunning(false);
    materialStatusNode.textContent = ethanChineseError(error?.message) || '批量素材下载启动失败。';
  }
});

loadOperatorSetting();
syncMaterialJobStatus();

const batchCollectorButton = document.getElementById('openBatchCollector');
batchCollectorButton.addEventListener('click', async () => {
  const status = document.getElementById('batchCollectorStatus');
  batchCollectorButton.disabled = true;
  status.textContent = '正在打开采集窗口…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('找不到当前页面');
    const result = await chrome.runtime.sendMessage({ type: 'ETHAN_OPEN_BATCH_COLLECTOR', tabId: tab.id });
    if (!result?.ok) throw new Error(result?.error || '无法打开批量采集窗口');
    window.close();
  } catch (error) {
    status.textContent = ethanChineseError(error.message);
  } finally {
    batchCollectorButton.disabled = false;
  }
});

const getPageProductLinksButton = document.getElementById('getPageProductLinks');
getPageProductLinksButton.addEventListener('click', async () => {
  getPageProductLinksButton.disabled = true;
  linkStatusNode.textContent = '正在获取产品链接…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('找不到当前页面');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: () => {
        const recommendationRoots = Array.from(document.querySelectorAll('div,h2,h3,section')).filter(node =>
          node.textContent.trim().startsWith('为你推荐') && node.textContent.trim().length < 80 &&
          !Array.from(node.children).some(child => child.textContent.trim().startsWith('为你推荐'))
        ).map(header => {
          let root = header;
          for (let depth = 0; depth < 4 && root.parentElement; depth += 1) {
            if (root.querySelectorAll('img').length) break;
            root = root.parentElement;
          }
          return root;
        });
        const isRecommendation = node => recommendationRoots.some(root => root.contains(node)) ||
          !!node.closest('[class*="recommend-offer"],[class*="recommendOffer"]');
        const links = new Set();
        for (const anchor of document.querySelectorAll('a[href]')) {
          if (isRecommendation(anchor)) continue;
          let url;
          try { url = new URL(anchor.getAttribute('href'), document.baseURI); } catch { continue; }
          const offer = url.hostname === 'detail.1688.com' && url.pathname.match(/^\/offer\/(\d+)\.html$/);
          if (offer) {
            links.add(`https://detail.1688.com/offer/${offer[1]}.html`);
          } else if (url.hostname.endsWith('.alibaba.com') && /^\/product-detail\/.+\.html$/.test(url.pathname)) {
            links.add(`https://${url.hostname}${url.pathname}`);
          } else if (['item.taobao.com', 'detail.tmall.com'].includes(url.hostname)
              && url.pathname === '/item.htm' && /^\d+$/.test(url.searchParams.get('id') || '')) {
            links.add(`https://${url.hostname}/item.htm?id=${url.searchParams.get('id')}`);
          }
        }
        // Modern 1688 shop cards navigate through React events, without anchor URLs.
        if (location.hostname === '1688.com' || location.hostname.endsWith('.1688.com')) {
          const visited = new Set();
          for (const element of document.querySelectorAll('p[title], [data-offer-id], [data-offerid]')) {
            if (isRecommendation(element)) continue;
            const attributeId = element.getAttribute('data-offer-id') || element.getAttribute('data-offerid');
            if (/^\d{6,20}$/.test(attributeId || '')) links.add(`https://detail.1688.com/offer/${attributeId}.html`);
            const key = Object.keys(element).find(key => /^__react(?:InternalInstance|Fiber)\$/.test(key));
            let fiber = key && element[key];
            for (let depth = 0; fiber && depth < 12 && !visited.has(fiber); depth++, fiber = fiber.return) {
              visited.add(fiber);
              const props = fiber.memoizedProps;
              const data = props?.data;
              if (data && typeof data === 'object' && typeof data.title === 'string'
                  && data.imgUrl && /^\d{6,20}$/.test(String(data.id))) {
                links.add(`https://detail.1688.com/offer/${data.id}.html`);
              }
            }
          }
        }
        return [...links];
      }
    });
    const links = [...new Set(results.flatMap(result => result.result || []))];
    await productLinksReady;
    const linkIdentity = value => value.match(/\/offer\/(\d+)\.html/i)?.[1] || (/^\d{6,20}$/.test(value) ? value : value);
    const existing = new Set(productLinksInput.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(linkIdentity));
    const duplicates = links.filter(link => existing.has(linkIdentity(link)));
    const added = links.filter(link => !existing.has(linkIdentity(link)));
    if (added.length) productLinksInput.value = [productLinksInput.value.trimEnd(), ...added].filter(Boolean).join('\n');
    await saveProductLinksDraft();
    productLinksInput.scrollTop = productLinksInput.scrollHeight;
    const total = new Set(productLinksInput.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(linkIdentity)).size;
    linkStatusNode.textContent = links.length ? `本页 ${links.length} 个，新增 ${added.length} 个，重复 ${duplicates.length} 个 · 总计 ${total} 个` : `当前页面未找到产品详情链接 · 总计 ${total} 个`;
    linkStatusNode.title = duplicates.length ? '已在列表中的商品\n' + duplicates.join('\n') : '';
  } catch (error) {
    linkStatusNode.textContent = `获取失败：${ethanChineseError(error.message)}`;
  } finally {
    getPageProductLinksButton.disabled = false;
  }
});

document.getElementById('saveProductLinksTxt').addEventListener('click', async () => {
  if (!productLinksInput.value.trim()) {
    linkStatusNode.textContent = '请先输入或获取产品链接';
    return;
  }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent('\uFEFF' + productLinksInput.value);
    await chrome.downloads.download({ url, filename: `产品链接-${stamp}.txt`, saveAs: false });
    linkStatusNode.textContent = '已开始下载 TXT 文件';
  } catch (error) {
    linkStatusNode.textContent = `保存失败：${ethanChineseError(error.message)}`;
  }
});

document.getElementById('clearProductLinks').addEventListener('click', async () => {
  productLinksInput.value = '';
  void saveProductLinksDraft();
  linkStatusNode.textContent = '';
  productLinksInput.focus();
  const response = await chrome.runtime.sendMessage({type:'ETHAN_CLEAR_LINK_QUEUE'}).catch(error => ({ok:false,message:ethanChineseError(error.message)}));
  if (!response?.ok) linkStatusNode.textContent = response?.message || '任务清除失败';
  else {
    linkStatusNode.textContent = '';
    materialStatusNode.textContent = '';
    document.getElementById('batchCollectorStatus').textContent = '';
  }
});

const downloadLinkedProducts = document.getElementById('downloadLinkedProducts');
downloadLinkedProducts.addEventListener('click', async () => {
  downloadLinkedProducts.disabled = true;
  try {
    const downloadKinds = Object.fromEntries(Array.from(document.querySelectorAll('[data-download-kind]'), input => [input.dataset.downloadKind, input.checked]));
    if (!Object.values(downloadKinds).some(Boolean)) throw new Error('请至少选择一种素材');
    const response = await chrome.runtime.sendMessage({type:'ETHAN_DOWNLOAD_LINKED_PRODUCTS', text:productLinksInput.value, outputMode:(await chrome.storage.local.get('linkedOutputMode')).linkedOutputMode || 'zip', downloadKinds});
    linkStatusNode.textContent = response?.message || '队列已启动，可关闭面板。';
  } catch (error) { linkStatusNode.textContent = ethanChineseError(error.message); }
  finally { downloadLinkedProducts.disabled = false; }
});

document.getElementById('getShopProductLinks').addEventListener('click', async () => {
  await productLinksReady;
  await saveProductLinksDraft();
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const response = await chrome.runtime.sendMessage({type:'ETHAN_COLLECT_SHOP_LINKS',tabId:tab?.id});
    linkStatusNode.textContent = response.message;
  } catch (error) { linkStatusNode.textContent = ethanChineseError(error.message); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.ethanProductLinksDraft) productLinksInput.value = changes.ethanProductLinksDraft.newValue || '';
  if (changes.shopLinkProgress) linkStatusNode.textContent = changes.shopLinkProgress.newValue || '';
});

const linkedDownloadToggle = document.getElementById('toggleLinkedDownload');
function showLinkedQueueStatus(status) {
  linkedDownloadToggle.hidden = !status?.running;
  linkedDownloadToggle.textContent = status?.paused ? '继续' : status?.pauseRequested ? '完成本款后暂停' : '停止下载';
  downloadLinkedProducts.disabled = !!status?.running;
}
chrome.storage.local.get('linkedQueueStatus').then(value => showLinkedQueueStatus(value.linkedQueueStatus));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.linkedQueueStatus) showLinkedQueueStatus(changes.linkedQueueStatus.newValue);
});
linkedDownloadToggle.addEventListener('click', async () => {
  linkedDownloadToggle.disabled = true;
  try { await chrome.runtime.sendMessage({type:'ETHAN_LINK_QUEUE_TOGGLE'}); }
  finally { linkedDownloadToggle.disabled = false; }
});

const unfinishedCount = document.getElementById('unfinishedProductCount');
const retryUnfinished = document.getElementById('retryUnfinishedProducts');
function showUnfinishedProducts(items) {
  const count = Array.isArray(items) ? items.length : 0;
  unfinishedCount.textContent = count ? `累计未完成商品 ${count} 款` : '';
  retryUnfinished.hidden = !count;
}
chrome.storage.local.get('linkedProductQueueFailures').then(value => showUnfinishedProducts(value.linkedProductQueueFailures));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.linkedProductQueueFailures) showUnfinishedProducts(changes.linkedProductQueueFailures.newValue);
});
retryUnfinished.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get('linkedProductRemainingUrls');
  const downloadKinds = Object.fromEntries(Array.from(document.querySelectorAll('[data-download-kind]'), input => [input.dataset.downloadKind,input.checked]));
  if (!Object.values(downloadKinds).some(Boolean)) { linkStatusNode.textContent = '请至少选择一种素材'; return; }
  const response = await chrome.runtime.sendMessage({type:'ETHAN_DOWNLOAD_LINKED_PRODUCTS',text:(stored.linkedProductRemainingUrls || []).join('\n'),outputMode:(await chrome.storage.local.get('linkedOutputMode')).linkedOutputMode || 'zip',downloadKinds});
  linkStatusNode.textContent = response?.message || '';
});

const endLinkedTask = document.getElementById('endLinkedTask');
async function refreshEndTaskButton() {
  const stored = await chrome.storage.local.get(['linkedQueueStatus','linkedProductQueueFailures','linkedProductRemainingUrls']);
  endLinkedTask.hidden = !stored.linkedQueueStatus?.running &&
    !(stored.linkedProductQueueFailures?.length || stored.linkedProductRemainingUrls?.length);
}
void refreshEndTaskButton();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.linkedQueueStatus || changes.linkedProductQueueFailures || changes.linkedProductRemainingUrls)) void refreshEndTaskButton();
});
endLinkedTask.addEventListener('click', async () => {
  endLinkedTask.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({type:'ETHAN_END_LINK_QUEUE'});
    if (!response?.ok) throw new Error(response?.message || '结束任务失败');
    showUnfinishedProducts([]);
    showLinkedQueueStatus({running:false});
    linkStatusNode.textContent = '';
    materialStatusNode.textContent = '';
    document.getElementById('batchCollectorStatus').textContent = '';
    endLinkedTask.hidden = true;
  } catch (error) { linkStatusNode.textContent = ethanChineseError(error.message); }
  finally { endLinkedTask.disabled = false; }
});

document.getElementById('manageWordDictionary').onclick=()=>{
  if(document.getElementById('wordLibraryDialog'))return;
  const dialog=document.createElement('dialog');dialog.id='wordLibraryDialog';
  dialog.style.cssText='width:100%;height:580px;max-height:100vh;max-width:none;margin:0;padding:0;border:0;border-radius:0;background:#fff;overflow:hidden';
  const frame=document.createElement('iframe');frame.src=chrome.runtime.getURL('word-library.html')+'?embedded=1';frame.title='极限词库管理';frame.style.cssText='display:block;width:100%;height:100%;border:0';
  const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','关闭词库');close.style.cssText='position:absolute;top:7px;right:8px;width:28px;min-height:28px;padding:0;font-size:20px';
  const dismiss=()=>{dialog.close();};
  const onMessage=event=>{if(event.source===frame.contentWindow&&event.data?.type==='ETHAN_WORD_LIBRARY_CLOSE')dismiss();};
  window.addEventListener('message',onMessage);
  dialog.addEventListener('close',()=>{window.removeEventListener('message',onMessage);dialog.remove();document.getElementById('manageWordDictionary').focus();});
  close.onclick=dismiss;dialog.append(frame);document.body.append(dialog);dialog.showModal();
};

const linkedSpeedModeButton=document.getElementById('linkedSpeedMode');
function renderLinkedSpeedMode(mode){
  const stable=mode==='stable';
  linkedSpeedModeButton.textContent=stable?'稳定':'快速';
  linkedSpeedModeButton.setAttribute('aria-pressed',String(stable));
  linkedSpeedModeButton.setAttribute('aria-label','下载节奏：'+(stable?'稳定':'快速'));
  linkedSpeedModeButton.title=stable?'稳定：每次打开商品前等待3秒；点击切换快速':'快速：保持当前打开速度；点击切换稳定';
}
chrome.storage.local.get('linkedDownloadSpeedMode').then(saved=>renderLinkedSpeedMode(saved.linkedDownloadSpeedMode));
linkedSpeedModeButton.onclick=async()=>{
  linkedSpeedModeButton.disabled=true;
  try{const saved=await chrome.storage.local.get('linkedDownloadSpeedMode');const mode=saved.linkedDownloadSpeedMode==='stable'?'fast':'stable';await chrome.storage.local.set({linkedDownloadSpeedMode:mode});renderLinkedSpeedMode(mode);}
  finally{linkedSpeedModeButton.disabled=false;}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.linkedDownloadSpeedMode)renderLinkedSpeedMode(changes.linkedDownloadSpeedMode.newValue);});

// Optional 1688 popup closing; shared across every injected frame.
(async () => {
  const toggle = document.getElementById('autoClose1688Popups');
  if (!toggle) return;
  toggle.disabled = true;
  try {
    const saved = await chrome.storage.sync.get({ ethan1688PopupCloseEnabled: false });
    toggle.checked = saved.ethan1688PopupCloseEnabled === true;
    toggle.disabled = false;
  } catch (error) {
    console.error('读取1688弹窗关闭设置失败', error);
    toggle.title = '设置读取失败，请重新打开插件';
    return;
  }
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      await chrome.storage.sync.set({ ethan1688PopupCloseEnabled: toggle.checked });
    } catch (error) {
      toggle.checked = !toggle.checked;
      toggle.title = '保存失败，请重试';
      console.error('保存1688弹窗关闭设置失败', error);
    } finally {
      toggle.disabled = false;
    }
  });
})();

const psImageToggle=document.getElementById('psImageEnabled');
chrome.storage.local.get({psImageEnabled:true},v=>{psImageToggle.checked=v.psImageEnabled;});
psImageToggle.addEventListener('change',()=>chrome.storage.local.set({psImageEnabled:psImageToggle.checked}));

const linkedOutputButton=document.getElementById('linkedOutputMode');
function renderLinkedOutput(mode){linkedOutputButton.textContent=mode!=='img'?'ZIP':'IMG';linkedOutputButton.title=mode!=='img'?'ZIP：本次所有链接合并一个压缩包；点击切换 IMG':'IMG：原格式下载；点击切换 ZIP';}
chrome.storage.local.get('linkedOutputMode').then(s=>renderLinkedOutput(s.linkedOutputMode));
linkedOutputButton.onclick=async()=>{linkedOutputButton.disabled=true;try{const s=await chrome.storage.local.get('linkedOutputMode');const mode=s.linkedOutputMode!=='img'?'img':'zip';await chrome.storage.local.set({linkedOutputMode:mode});renderLinkedOutput(mode);}finally{linkedOutputButton.disabled=false;}};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.linkedOutputMode)renderLinkedOutput(changes.linkedOutputMode.newValue);});
