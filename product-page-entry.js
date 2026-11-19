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

(() => {
  function install() {
    if (document.getElementById('ethan-page-entry')) return;
    const shop = /\/page\/offerlist\.htm/.test(location.pathname);
    const target = shop
      ? [...document.querySelectorAll('div,span')].filter(e => /共\s*\d+\s*件相关产品/.test(e.textContent) && e.textContent.trim().length < 60)
        .sort((a,b) => a.textContent.length - b.textContent.length)[0]
      : document.querySelector('.module-od-picture-gallery,[class*="thumbnail--"]');
    if (!target) return;
    const row = document.createElement('div');
    row.id = 'ethan-page-entry';
    row.style.cssText = 'padding:6px 0;text-align:right';
    const button = document.createElement('button');
    button.textContent = shop ? '获取全店链接' : '商品图片下载';
    button.style.cssText = 'border:1px solid #93b4ef;border-radius:5px;padding:6px 12px;color:#2563eb;background:#eff6ff;cursor:pointer';
    button.type = 'button';
    button.onclick = async event => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      if (shop) button.textContent='正在获取…';
      try {
        const result = await chrome.runtime.sendMessage({type:shop?'ETHAN_PAGE_SHOP_LINKS':'ETHAN_PAGE_PRODUCT_DOWNLOAD'});
        if (result?.error) throw new Error(result.error);
      } catch (error) { button.textContent = ethanChineseError(error.message); }
      finally { button.disabled = false; }
    };
    row.append(button);
    if (shop) {
      row.style.cssText='display:inline-block;margin-right:8px;vertical-align:middle;line-height:22px';
      button.style.padding='2px 8px';
      button.style.fontSize='12px';
      button.style.height='22px';
      button.style.lineHeight='16px';
      button.style.boxSizing='border-box';
      row.style.verticalAlign='top';
      row.style.height='22px';
      target.prepend(row);
    } else {
      const shortcuts = [];
      let activeRequest = '', activeButton = null;
      chrome.runtime.onMessage.addListener(message => {
        if(message.type !== 'ETHAN_PAGE_PACKAGE_PROGRESS' || message.requestId !== activeRequest || !activeButton) return;
        if(message.stage === 'pack') activeButton.textContent = '下载 ' + (message.processedFiles || 0) + '/' + (message.totalFiles || 0);
        if(message.stage === 'zip') activeButton.textContent = '正在打包…';
        if(message.stage === 'done') activeButton.textContent = '已提交下载';
      });
      for (const [kind, label] of [['main','主图'],['detail','详情图'],['stitch','长图'],['sku','SKU图'],['all','全部']]) {
        const quick = document.createElement('button');
        quick.type = 'button';
        quick.textContent = label;
        quick.title = kind === 'stitch' ? '直接下载拼接长图图片' : '下载' + label + '压缩包';
        quick.style.cssText = button.style.cssText;
        quick.style.marginRight = '6px';
        quick.onclick = async event => {
          event.preventDefault();
          event.stopPropagation();
          shortcuts.forEach(control => control.disabled = true);
          activeRequest = Date.now() + '_' + Math.random().toString(36).slice(2);
          activeButton = quick;
          quick.textContent = '正在采集…';
          try {
            const result = await chrome.runtime.sendMessage({ type:'ETHAN_PAGE_QUICK_PACKAGE', kind, requestId:activeRequest });
            if (!result?.ok) throw new Error(result?.message || result?.error || '下载失败');
            quick.textContent = result.failedCount ? '完成，失败' + result.failedCount + '张' : '已提交下载';
            setTimeout(() => { if (quick.isConnected && !quick.disabled) quick.textContent = label; }, 4000);
          } catch (error) {
            quick.textContent = label;
            quick.title = ethanChineseError(error.message);
            alert(quick.title);
          } finally { activeRequest = ''; activeButton = null; shortcuts.forEach(control => control.disabled = false); }
        };
        shortcuts.push(quick);
        row.insertBefore(quick, button);
      }
      // Keep the toolbar INSIDE the gallery. Adding a full-width sibling to
      // a horizontal flex container can push the entire product off-screen.
      const card = target;
      const computed = getComputedStyle(card);
      const originalPadding = parseFloat(computed.paddingTop) || 0;
      if (computed.position === 'static') card.style.position = 'relative';
      row.style.cssText = 'position:absolute;top:0;left:0;z-index:10;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:6px;box-sizing:border-box;width:100%;padding:8px 12px;margin:0;pointer-events:auto';
      shortcuts.forEach(control => control.style.marginRight = '0');
      card.prepend(row);
      const reserveSpace = () => {
        const padding = originalPadding + row.getBoundingClientRect().height;
        const value = padding + 'px';
        if (card.style.paddingTop !== value) card.style.paddingTop = value;
      };
      reserveSpace();
      new ResizeObserver(reserveSpace).observe(row);


    }
  }
  install();
  const observer = new MutationObserver(install);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local'||!changes.shopLinkProgress) return;
    const button=document.querySelector('#ethan-page-entry button');
    if(button && /\/page\/offerlist\.htm/.test(location.pathname)) {
      button.textContent='获取全店链接';
      button.title=changes.shopLinkProgress.newValue || '';
    }
  });
})();
