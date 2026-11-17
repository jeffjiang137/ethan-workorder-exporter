// Only tabs created by this queue are closed after a completed download.
let linkedProductQueueRunning = false;
let linkedProductQueuePaused = false;
let linkedProductPauseRequested = false;
let linkedProductQueueCancelled = false;
const linkedPauseWaiters = [];
const linkedActiveDownloads = new Set();
function waitForLinkedResume() {
  if (linkedProductQueueCancelled && linkedProductQueueRunning) return Promise.reject(new Error('任务已清除'));
  return linkedProductQueuePaused ? new Promise(resolve => linkedPauseWaiters.push(resolve)) : Promise.resolve();
}
async function publishLinkedQueueStatus() {
  await chrome.storage.local.set({linkedQueueStatus:{running:linkedProductQueueRunning,paused:linkedProductQueuePaused,pauseRequested:linkedProductPauseRequested}});
}
const linkedDownloadPaths = new Map();

chrome.downloads.onDeterminingFilename.addListener((download, suggest) => {
  const filename = linkedDownloadPaths.get(download.url) || linkedDownloadPaths.get(download.finalUrl);
  if (filename && download.byExtensionId === chrome.runtime.id) {
    suggest({ filename, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

async function waitForLinkedPageOpen() {
  const saved=await chrome.storage.local.get('linkedDownloadSpeedMode');
  if(saved.linkedDownloadSpeedMode==='stable'){
    const deadline=Date.now()+3000;
    while(Date.now()<deadline){
      if(linkedProductQueueCancelled)throw new Error('任务已结束');
      await delayMs(Math.min(150,deadline-Date.now()));
    }
  }
  if(linkedProductQueueCancelled)throw new Error('任务已结束');
}

async function runLinkedProductQueue(urls, downloadKinds) {
  await ensureOffscreenDocument();
  await delayMs(180);
  await setOffscreenKeepAlive(true);
  const window = await chrome.windows.create({ url: 'about:blank', focused: true });
  let tab = window.tabs[0];
  let completed = 0;
  let processed = 0;
  const failures = [];
  await chrome.storage.local.set({linkedProductQueueFailures: []});
  try { await chrome.downloads.setUiOptions({enabled:false}); } catch (_) {}
  try {
    for (let index = 0; index < urls.length; index += 1) {
      if (linkedProductQueueCancelled) break;
      if (linkedProductPauseRequested) {
        linkedProductQueuePaused = true;
        await publishLinkedQueueStatus();
      }
      await waitForLinkedResume();
      let next = null;
      let currentFailedFiles = 0;
      try {
      if (index === 0 || !tab) await waitForLinkedPageOpen();
      if (!tab) tab = await chrome.tabs.create({ windowId: window.id, url: urls[index], active: true });
      await chrome.tabs.update(tab.id, index === 0 ? { url: urls[index], active: true } : { active: true });
      materialProgressTabs = [tab.id];
      await waitForTabComplete(tab.id);
      // Verification pages stay open until the user completes them.
      let readyDeadline = Date.now() + 15000;
      while (true) {
        await waitForLinkedResume();
        const [check] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            blocked: /请.*(?:拖动|滑动).*滑块|完成验证|安全验证|访问过于频繁/.test(document.body?.innerText || ''),
            ready: !!document.querySelector('.module-od-picture-gallery,.title-content h1,[class*="mainTitle--"],#J_Title')
          })
        });
        if (check?.result?.ready && !check.result.blocked) break;
        if (check?.result?.blocked) {
          await notifyMaterialProgress({stage:'scan',current:index+1,total:urls.length,failedCount:0,
            title:'等待手动验证，完成后自动继续本款'});
          readyDeadline = Date.now() + 15000;
          await delayMs(2000);
          continue;
        }
        if (Date.now() >= readyDeadline) throw new Error('页面未就绪，已保留标签页并继续下一款');
        await delayMs(250);
      }
      await notifyMaterialProgress({ stage: 'scan', current: index + 1, total: urls.length, title: urls[index], failedCount:0 });
      const product = await collectMaterialsFromTab(tab);
      await waitForLinkedResume();
      if (!product?.ok) throw new Error('未采集到商品素材，已保留当前标签页');
      // Start loading the next page while this product is being downloaded.
      if (index + 1 < urls.length) {
        await waitForLinkedPageOpen();
        next = await chrome.tabs.create({ windowId: window.id, url: urls[index + 1], active: false });
      }
      const result = await requestOffscreenPackage({
        batchName: product.title || product.offerId, products: [product], directFolderDownload: true, downloadKinds
      });
      if (linkedProductQueueCancelled) break;
      currentFailedFiles = result?.failedCount || 0;
      if (!result?.ok) throw new Error(result?.message || '商品下载失败，已保留标签页');
      MATERIAL_JOB_STATE.running = true;
      completed += 1;
      await chrome.tabs.remove(tab.id).catch(() => {});
      } catch (error) {
        if (linkedProductQueueCancelled) break;
        failures.push({url: urls[index], message: error.message});
        await chrome.storage.local.set({
          linkedProductRemainingUrls: [...failures.map(item => item.url), ...urls.slice(index + 1)],
          linkedProductQueueFailures: failures
        });
        await notifyMaterialProgress({stage:'scan', current:index + 1, total:urls.length,
          title:'本款未完成，继续处理后续链接', failedCount:currentFailedFiles});
      } finally {
        processed = index + 1;
        MATERIAL_JOB_STATE.running = !linkedProductQueueCancelled;
        tab = next;
      }
    }
    if (linkedProductQueueCancelled) return;
    await notifyMaterialProgress({
      stage: failures.length ? 'error' : 'done',
      productCount: completed, failedCount: 0,
      title: '链接队列处理完成',
      message: failures.length ? '队列已处理完毕，未完成商品请在插件面板查看或重试。' : ''
    });
    await chrome.storage.local.set({linkedProductRemainingUrls: failures.map(item => item.url)});
    await chrome.notifications.create({type:'basic',iconUrl:'icons/icon128.png',title: failures.length ? '部分商品未完成' : '下载完成',
      message: '队列处理完成，成功 ' + completed + ' 款，未完成 ' + failures.length + ' 款。未完成商品标签页已保留。'});
  } catch (error) {
    if (linkedProductQueueCancelled) return;
    await chrome.storage.local.set({ linkedProductRemainingUrls: [...failures.map(item => item.url), ...urls.slice(processed)] });
    await notifyMaterialProgress({ stage: 'error', message: error.message + '。剩余链接已保存，可重新打开面板重试。' });
  } finally {
    try { await chrome.downloads.setUiOptions({enabled:true}); } catch (_) {}
    linkedProductQueueRunning = false;
    linkedProductQueuePaused = false;
    linkedProductPauseRequested = false;
    linkedPauseWaiters.splice(0).forEach(resolve => resolve());
    await publishLinkedQueueStatus();
    MATERIAL_JOB_STATE.running = false;
    await setOffscreenKeepAlive(false);
    if (linkedProductQueueCancelled) {
      await notifyMaterialProgress({running:false,stage:'',title:'',message:'',failedCount:0});
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['ETHAN_CLEAR_LINK_QUEUE','ETHAN_END_LINK_QUEUE'].includes(message?.type)) {
    (async () => {
      linkedProductQueueCancelled = true;
      linkedProductPauseRequested = false;
      linkedProductQueuePaused = false;
      linkedPauseWaiters.splice(0).forEach(resolve => resolve());
      await Promise.allSettled([...linkedActiveDownloads].map(id => chrome.downloads.cancel(id)));
      if (!linkedProductQueueRunning) MATERIAL_JOB_STATE.running = false;
      Object.assign(MATERIAL_JOB_STATE, {stage:'',title:'',message:'',failedCount:0});
      await Promise.allSettled(materialProgressTabs.map(tabId => chrome.scripting.executeScript({
        target:{tabId}, func:() => document.getElementById('ethan-material-progress')?.remove()
      })));
      await chrome.storage.local.set({
        ...(message.type === 'ETHAN_CLEAR_LINK_QUEUE' ? {ethanProductLinksDraft:''} : {}), linkedProductRemainingUrls:[], linkedProductQueueFailures:[],
        linkedQueueStatus:{running:false,paused:false,pauseRequested:false},
        lastMaterialDownloadFailures:[], shopLinkProgress:''
      });
      if (!linkedProductQueueRunning) {
        await notifyMaterialProgress({running:false,stage:'',title:'',message:'',failedCount:0});
      }
      return {ok:true};
    })().then(respond, error => respond({ok:false,message:error.message}));
    return true;
  }
  if (message?.type === 'ETHAN_LINK_QUEUE_GATE') {
    waitForLinkedResume().then(() => respond({ok:!(linkedProductQueueCancelled && linkedProductQueueRunning)}),
      () => respond({ok:false}));
    return true;
  }
  if (message?.type === 'ETHAN_LINK_QUEUE_TOGGLE') {
    (async () => {
      if (!linkedProductQueueRunning) return {ok:false};
      if (linkedProductPauseRequested || linkedProductQueuePaused) {
        linkedProductPauseRequested = false;
        linkedProductQueuePaused = false;
        linkedPauseWaiters.splice(0).forEach(resolve => resolve());
      } else {
        linkedProductPauseRequested = true;
      }
      await publishLinkedQueueStatus();
      return {ok:true};
    })().then(respond, error => respond({ok:false,message:error.message}));
    return true;
  }
  if (message?.type === 'ETHAN_MATERIAL_FAILURE_LOG' &&
      sender.url === chrome.runtime.getURL(MATERIAL_OFFSCREEN_URL)) {
    if (linkedProductQueueCancelled) { respond({ok:true}); return false; }
    chrome.storage.local.set({lastMaterialDownloadFailures:message.failures})
      .then(() => respond({ok:true}), () => respond({ok:false}));
    return true;
  }
  if (message?.type === 'ETHAN_SAVE_QUEUE_ZIP' && sender.url === chrome.runtime.getURL(MATERIAL_OFFSCREEN_URL)) {
    (async () => {
      const filename = String(message.filename || '').replace(/\\/g, '/');
      if (!filename || filename.startsWith('/') || filename.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('下载文件路径无效');
      }
      linkedDownloadPaths.set(message.url, filename);
      let id;
      try {
      await waitForLinkedResume();
      id = await chrome.downloads.download({ url: message.url, filename,
        saveAs: false, conflictAction: 'uniquify' });
      linkedActiveDownloads.add(id);
      await new Promise((resolve, reject) => {
        const finish = error => {
          chrome.downloads.onChanged.removeListener(listener);
          if (error) reject(error); else resolve();
        };
        const listener = delta => {
          if (delta.id !== id) return;
          if (delta.state?.current === 'complete') finish();
          if (delta.state?.current === 'interrupted') finish(new Error(delta.error?.current || '下载已中断'));
        };
        chrome.downloads.onChanged.addListener(listener);
        chrome.downloads.search({ id }).then(([download]) => {
          if (download?.state === 'complete') finish();
          else if (!download || download.state === 'interrupted') finish(new Error(download?.error || '下载已中断'));
        }, finish);
      });
      return { ok: true };
      } finally {
        linkedActiveDownloads.delete(id);
        linkedDownloadPaths.delete(message.url);
      }
    })().then(respond, error => respond({ ok: false, message: error.message }));
    return true;
  }
  if (message?.type !== 'ETHAN_DOWNLOAD_LINKED_PRODUCTS') return false;
  const parsed = normalizeProductLinks(message.text || '');
  if (linkedProductQueueRunning || MATERIAL_JOB_STATE.running || !parsed.urls.length) {
    respond({ ok: false, message: parsed.urls.length ? '已有素材任务正在运行' : '请先输入产品链接' });
    return false;
  }
  linkedProductQueueRunning = true;
  linkedProductQueueCancelled = false;
  linkedProductQueuePaused = false;
  linkedProductPauseRequested = false;
  void publishLinkedQueueStatus();
  MATERIAL_JOB_STATE.running = true;
  respond({ ok: true, message: '链接下载队列已启动，每款下载完成后自动关闭对应标签页。' });
  void runLinkedProductQueue(parsed.urls, message.downloadKinds).catch(async error => {
    linkedProductQueueRunning = false;
    linkedProductQueuePaused = false;
    linkedProductPauseRequested = false;
    linkedPauseWaiters.splice(0).forEach(resolve => resolve());
    await publishLinkedQueueStatus();
    MATERIAL_JOB_STATE.running = false;
    await setOffscreenKeepAlive(false).catch(() => {});
    await notifyMaterialProgress({ stage: 'error', message: error.message });
  });
  return false;
});
