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

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='ETHAN_CHECK_IMAGE_WORDS'||!sender.tab) return false;
  (async()=>{
    await ensureOffscreenDocument();
    const saved = await chrome.storage.local.get('ethanWordDictionary');
    return chrome.runtime.sendMessage({type:'ETHAN_OCR_EXECUTE',url:message.url,dictionary:saved.ethanWordDictionary});
  })().then(respond,error=>respond({ok:false,message:ethanChineseError(error.message)}));
  return true;
});

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='ETHAN_OPEN_WORD_LIBRARY'||!sender.tab) return false;
  chrome.tabs.create({url:chrome.runtime.getURL('word-library.html')})
    .then(()=>respond({ok:true}),error=>respond({ok:false,message:ethanChineseError(error.message)}));
  return true;
});
