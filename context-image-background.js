// Reuse the collector's Billfish discovery, source detection and download fallback.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'ethan-save-image') return;
  void (async () => {
    try {
      if (!tab?.id || !info.srcUrl) throw new Error('未找到图片，请刷新网页后重试');
      let src = info.srcUrl;
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
      const result = await globalThis.ethanCollectContextImage(tab, {
        src, originalSrc: src, type: 'image', title: tab.title || '采集图片',
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
