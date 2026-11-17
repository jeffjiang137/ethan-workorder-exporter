chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='ETHAN_CHECK_IMAGE_WORDS'||!sender.tab) return false;
  (async()=>{
    await ensureOffscreenDocument();
    const saved = await chrome.storage.local.get('ethanWordDictionary');
    return chrome.runtime.sendMessage({type:'ETHAN_OCR_EXECUTE',url:message.url,dictionary:saved.ethanWordDictionary});
  })().then(respond,error=>respond({ok:false,message:error.message}));
  return true;
});
