chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (!sender.tab?.id) return false;
  if (message.type === 'ETHAN_PAGE_SHOP_LINKS') {
    if (shopLinkCollectionRunning) { respond({error:'正在获取链接'}); return false; }
    shopLinkCollectionRunning = true;
    void collectShopLinks(sender.tab.id).then(async () => {
      try { await chrome.action.openPopup(); }
      catch (_) { await chrome.windows.create({url:chrome.runtime.getURL('popup.html'),type:'popup',width:380,height:650}); }
    }).catch(error => chrome.storage.local.set({shopLinkProgress:error.message}));
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
    })().then(respond,error=>respond({error:error.message}));
    return true;
  }
  if (message.type === 'ETHAN_PRODUCT_PACKAGE') {
    ensureOffscreenDocument().then(()=>requestOffscreenPackage({
      batchName:message.product.title,products:[message.product],downloadKinds:message.downloadKinds,
      directFolderDownload:!message.zip
    })).then(respond,error=>respond({ok:false,message:error.message}));
    return true;
  }
  return false;
});
