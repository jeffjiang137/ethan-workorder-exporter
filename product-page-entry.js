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
      } catch (error) { button.textContent = error.message; }
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
