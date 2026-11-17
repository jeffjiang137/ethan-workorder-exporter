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

chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (!sender.tab?.id) return false;
  if (message.type === 'ETHAN_PAGE_SHOP_LINKS') {
    if (shopLinkCollectionRunning) { respond({error:'正在获取链接'}); return false; }
    shopLinkCollectionRunning = true;
    void collectShopLinks(sender.tab.id).then(async () => {
      try { await chrome.action.openPopup(); }
      catch (_) { await chrome.windows.create({url:chrome.runtime.getURL('popup.html'),type:'popup',width:380,height:650}); }
    }).catch(error => chrome.storage.local.set({shopLinkProgress:ethanChineseError(error.message)}));
    respond({ok:true});
    return false;
  }
  if (message.type === 'ETHAN_PAGE_PRODUCT_DOWNLOAD') {
    (async () => {
      const product = await collectMaterialsFromTab(sender.tab);
      await chrome.scripting.executeScript({target:{tabId:sender.tab.id},files:[
        'batch-collector/product-categories.js','batch-collector/capture_compat.js',
        'batch-collector/advanced_frame_v14.js','batch-collector/advanced_ui_v14.js']});
      return chrome.tabs.sendMessage(sender.tab.id,{type:'ETHAN_PRODUCT_MODE',product},{frameId:0});
    })().then(respond,error=>respond({error:ethanChineseError(error.message)}));
    return true;
  }
  if (message.type === 'ETHAN_PRODUCT_PACKAGE') {
    ensureOffscreenDocument().then(()=>requestOffscreenPackage({
      batchName:message.product.title,products:[message.product],downloadKinds:message.downloadKinds,
      directFolderDownload:!message.zip
    })).then(respond,error=>respond({ok:false,message:ethanChineseError(error.message)}));
    return true;
  }
  return false;
});
