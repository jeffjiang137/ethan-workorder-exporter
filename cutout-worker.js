(() => {
 let running=false;
 function validateCutoutCapability(health,mode){
  if(!health?.ok)throw Error('抠图服务尚未就绪');
  if(mode==='high'){
   if(!Array.isArray(health.modes)||!health.modes.includes('high'))throw Error('当前抠图服务版本不支持精细抠图，请更新鑫洋设计助手；未切换为快速模式');
   if(health.vitmatteAvailable!==true)throw Error('精细抠图模型未安装或尚未就绪，请在鑫洋设计助手中检查 ViTMatte 模型；未切换为快速模式');
  }
  if(!health.modelAvailable)throw Error('抠图模型未就绪');
 }
 function cutoutHttpError(status,detail,mode){
  const prefix=mode==='high'?'精细抠图失败，未降级：':'快速抠图失败：';
  if(status===429)return prefix+'本地服务繁忙，请稍后重试';
  return prefix+(detail||'服务返回错误（HTTP '+status+'）');
 }

 async function run(jobId,mode){
  const qualityMode=mode==='high'?'high':'fast';
  let db,files=[];let done=0,failed=0;const errors=[];let originalPreview='',resultPreview='',outcome='running';
  async function thumbnail(blob){const image=await createImageBitmap(blob);try{const canvas=document.createElement('canvas');const ratio=Math.min(1,260/image.width,180/image.height);canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');}finally{image.close();}}

  const progress=async message=>{const result=await chrome.runtime.sendMessage({type:'ETHAN_CUTOUT_PROGRESS',progress:{running,total:files.length,done,failed,message,originalPreview,resultPreview,outcome}});if(!result?.ok)throw Error('后台进度保存失败');};
  const keepalive=setInterval(()=>chrome.runtime.sendMessage({type:'ETHAN_CUTOUT_PING'}).catch(()=>{}),20000);
  try{
   db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ethan-cutout',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   files=await new Promise((resolve,reject)=>{const r=db.transaction('jobs').objectStore('jobs').get(jobId);r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
   if(!files.length)throw Error('后台没有找到待处理图片');
   let health;try{health=await(await fetch('http://127.0.0.1:8868/health',{signal:AbortSignal.timeout(5000)})).json();}catch(_){throw Error('请启动鑫洋设计助手抠图服务（8868）');}
   validateCutoutCapability(health,qualityMode);
   let cursor=0;
   async function worker(){while(cursor<files.length){const index=cursor++;const {file,path}=files[index];
    try{
     try{originalPreview=await thumbnail(file);resultPreview='';await progress('正在抠图：'+path);}catch(_){}
     const form=new FormData();form.append('image',file,file.name);form.append('mode',qualityMode);
     let r;
     for(let attempt=0;attempt<7;attempt++){
       r=await fetch('http://127.0.0.1:8868/remove-background',{method:'POST',body:form,signal:AbortSignal.timeout(180000)});
       if(r.status!==429)break;
       if(attempt===6)break;
       const wait=Math.min(15000,2000*(attempt+1));
       await progress('本地服务繁忙，'+Math.round(wait/1000)+'秒后重试：'+path+'（'+(attempt+1)+'/6）');
       await new Promise(resolve=>setTimeout(resolve,wait));
     }
     if(!r.ok){let detail='';try{const data=await r.json();detail=data.error||data.message||'';}catch(_){}throw Error(cutoutHttpError(r.status,detail,qualityMode));}
     const blob=await r.blob();if(!blob.type.startsWith('image/'))throw Error(qualityMode==='high'?'精细抠图未返回有效图片，未降级':'返回图片无效');
     try{const pair=await Promise.all([thumbnail(file),thumbnail(blob)]);[originalPreview,resultPreview]=pair;}catch(_){}
     const safe=path.split('/').filter(x=>x&&x!=='.'&&x!=='..').map(x=>x.replace(/[<>:"\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'')||'_').join('/').replace(/\.[^/.]+$/,'')+'.png';
     const url=URL.createObjectURL(blob);try{const saved=await chrome.runtime.sendMessage({type:'ETHAN_CUTOUT_SAVE',url,filename:'抠图/'+safe});if(!saved?.ok)throw Error(saved?.message||'保存失败');}finally{URL.revokeObjectURL(url);}done++;
    }catch(error){failed++;errors.push(path+'：'+error.message);}
    await progress('后台抠图 '+(done+failed)+'/'+files.length+'，成功 '+done+'，失败 '+failed);
   }}
   await progress('后台抠图已启动，逐张处理；服务繁忙时自动等待重试，可以关闭面板');await worker();running=false;outcome=failed?(done?'partial':'failed'):'success';
   await progress(failed?'抠图结束，成功 '+done+' 张，失败 '+failed+' 张。'+errors.join('；'):'抠图完成 已保存到默认下载目录（抠图文件夹）');
  }catch(error){running=false;outcome='failed';await progress('后台抠图失败：'+error.message);}
  finally{clearInterval(keepalive);running=false;if(db){const tx=db.transaction('jobs','readwrite');tx.objectStore('jobs').delete(jobId);db.close();}}
 }
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message?.type==='ETHAN_CUTOUT_READY'){reply({ok:true});return false;}
  if(message?.type!=='ETHAN_RUN_CUTOUT')return false;
  if(running){reply({ok:false,message:'已有抠图任务在后台执行，请等待完成'});return false;}
  running=true;reply({ok:true});void run(message.jobId,message.mode);return false;
 });
})();
