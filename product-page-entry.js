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
    button.onclick = async () => {
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
      target.before(row);
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
