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
  work.then(respond,error=>respond({ok:false,message:error.message}));
  return true;
});
