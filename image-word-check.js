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

let wordOcrQueue = Promise.resolve();
const wordOcrCache = new Map();
const wordOcrPending = new Map();
let wordOcrHealthUntil = 0;
let defaultWordDictionary;
async function recognizeWordImage(url) {
  const cached=wordOcrCache.get(url);
  if(cached && Date.now()-cached.time<20*60*1000) return cached.result;
  if(wordOcrPending.has(url)) return wordOcrPending.get(url);
  const pending=(async()=>{
    // Fetch the next image while the local engine handles the current image.
    const response=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw new Error('图片读取失败 HTTP '+response.status);
    const blob=await response.blob();
    const work=wordOcrQueue.then(async()=>{
      if(Date.now()>wordOcrHealthUntil){
        let health;
        try{health=await(await fetch('http://127.0.0.1:8866/health',{signal:AbortSignal.timeout(3000)})).json();}
        catch(_){throw new Error('请启动鑫洋设计助手中的本地 OCR 服务（8866）');}
        if(!health.ok||!health.paddleAvailable)throw new Error('本地服务的 PaddleOCR 尚未就绪');
        wordOcrHealthUntil=Date.now()+15000;
      }
      const form=new FormData();form.append('image',blob,'product-image.'+(blob.type.includes('png')?'png':blob.type.includes('webp')?'webp':'jpg'));
      const result=await(await fetch('http://127.0.0.1:8866/ocr',{method:'POST',body:form,signal:AbortSignal.timeout(150000)})).json();
      if(!result.ok)throw new Error(result.error||result.message||'PaddleOCR 识别失败');
      return {text:result.text||(result.words||[]).map(word=>word.text).join('\n'),engine:result.engine||'PaddleOCR-json'};
    });
    wordOcrQueue=work.catch(()=>{});
    const result=await work;wordOcrCache.set(url,{time:Date.now(),result});
    while(wordOcrCache.size>80)wordOcrCache.delete(wordOcrCache.keys().next().value);
    return result;
  })();
  wordOcrPending.set(url,pending);
  try{return await pending;}finally{wordOcrPending.delete(url);}
}
async function checkImageWords(url, customDictionary) {
  const base = chrome.runtime.getURL('vendor/ocr/');
  const {text,engine}=await recognizeWordImage(url);
  const dictionary = customDictionary || await (defaultWordDictionary ||= fetch(base+'words.json').then(response=>response.json()).catch(error=>{defaultWordDictionary=null;throw error;}));
  const compact = text.replace(/\s+/g,'');
  const matches = [];
  for (const [category, words] of Object.entries(dictionary)) {
    if (!Array.isArray(words)) continue;
    for (const word of words) if (typeof word === 'string' && word && compact.includes(word.replace(/\s+/g,''))) matches.push({category,word});
  }
  return {ok:true,text,matches,engine};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='ETHAN_OCR_EXECUTE') return false;
  const work=checkImageWords(message.url, message.dictionary);
  work.then(respond,error=>respond({ok:false,message:ethanChineseError(error.message)}));
  return true;
});
