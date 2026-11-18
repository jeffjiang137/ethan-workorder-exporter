(() => {
  const panel=document.getElementById('imageToolPanel'),zone=document.getElementById('imageDropZone'),status=document.getElementById('imageToolStatus'),picker=document.getElementById('imageToolFiles');
  let mode='stitch',busy=false,cutoutState=null;
  const cutoutPreview=document.createElement('div');cutoutPreview.id='cutoutPreview';cutoutPreview.hidden=true;cutoutPreview.tabIndex=0;cutoutPreview.setAttribute('aria-label','抠图预览，可继续拖入或粘贴图片');
  cutoutPreview.innerHTML='<div><div class="cutout-caption">原图</div><img data-cutout-original alt="原图"></div><div><div class="cutout-caption" data-cutout-title>抠图中…</div><div class="cutout-result"><img data-cutout-result alt="抠图结果"><span class="cutout-spinner" aria-label="正在抠图"></span></div></div>';
  zone.after(cutoutPreview);
  function renderCutoutPreview(){
    const visible=mode==='cutout'&&!!cutoutState?.original;
    cutoutPreview.hidden=!visible;
    if(mode==='cutout')zone.hidden=visible;
    if(!visible)return;
    cutoutPreview.querySelector('[data-cutout-original]').src=cutoutState.original;
    const result=cutoutPreview.querySelector('[data-cutout-result]');result.src=cutoutState.result||cutoutState.original;
    result.style.opacity=cutoutState.result?'1':'.35';
    cutoutPreview.querySelector('.cutout-spinner').hidden=!cutoutState.running;
    cutoutPreview.querySelector('[data-cutout-title]').textContent=cutoutState.running?'抠图中…':cutoutState.outcome==='success'?(cutoutState.result?'抠图完成':'已保存，预览不可用'):cutoutState.outcome==='partial'?'部分完成':cutoutState.outcome==='failed'?'抠图失败':'等待后台状态';
  }

  const stitchQueue=[];
  const list=document.createElement('div');list.id='stitchQueue';
  const exportButton=document.createElement('button');exportButton.type='button';exportButton.textContent='导出拼图';exportButton.id='exportStitch';
  const exportRow=document.createElement('div');exportRow.id='stitchExportRow';
  const widthSelect=document.createElement('select');widthSelect.id='stitchWidth';widthSelect.setAttribute('aria-label','拼图宽度');
  widthSelect.innerHTML='<option value="750">750px</option><option value="790">790px</option><option value="800">800px</option><option value="1920">1920px</option><option value="custom">自定义</option>';
  const customWidth=document.createElement('input');customWidth.type='number';customWidth.min='1';customWidth.max='32767';customWidth.value='790';customWidth.hidden=true;customWidth.setAttribute('aria-label','自定义拼图宽度');
  let widthManual=false;widthSelect.value='790';
  function matchWidth(){if(widthManual)return;const source=Math.max(...stitchQueue.map(item=>item.previewWidth||0),0);if(!source)return;const presets=[750,790,800,1920];widthSelect.value=String(presets.reduce((best,value)=>Math.abs(value-source)<Math.abs(best-source)?value:best));}
  widthSelect.onchange=()=>{widthManual=true;customWidth.hidden=widthSelect.value!=='custom';};
  customWidth.oninput=()=>{widthManual=true;};
  exportRow.append(widthSelect,customWidth,exportButton);zone.after(list,exportRow);
  function renderQueue(){
    list.hidden=exportRow.hidden=mode!=='stitch';exportButton.disabled=busy||stitchQueue.length<2;widthSelect.disabled=customWidth.disabled=busy;if(!stitchQueue.length)widthManual=false;matchWidth();
    zone.hidden=mode==='stitch'&&stitchQueue.length>0;
    list.replaceChildren();
    stitchQueue.forEach((entry,index)=>{
      const row=document.createElement('div');row.className='stitch-row';row.draggable=!busy;row.dataset.index=index;
      const image=document.createElement('img');image.src=entry.preview;image.alt='';
      image.draggable=false;
      image.onload=()=>{
        entry.previewWidth=image.naturalWidth;
        matchWidth();
      };
      image.style.width='100%';
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','移除 '+entry.file.name);remove.disabled=busy;
      remove.onclick=()=>{URL.revokeObjectURL(entry.preview);stitchQueue.splice(index,1);renderQueue();};
      row.ondragstart=event=>{if(busy){event.preventDefault();return;}event.dataTransfer.setData('application/x-ethan-stitch',String(index));event.dataTransfer.effectAllowed='move';};
      row.ondragover=event=>{if(!event.dataTransfer.types.includes('application/x-ethan-stitch'))return;event.preventDefault();event.stopPropagation();list.querySelectorAll('.stitch-row').forEach(r=>r.classList.remove('drop-before','drop-after'));row.classList.add(event.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'drop-before':'drop-after');};
      row.ondragleave=()=>row.classList.remove('drop-before','drop-after');
      row.ondragend=()=>list.querySelectorAll('.stitch-row').forEach(r=>r.classList.remove('drop-before','drop-after'));
      row.ondrop=event=>{const raw=event.dataTransfer.getData('application/x-ethan-stitch');if(raw==='')return;event.preventDefault();event.stopPropagation();if(busy)return;const from=Number(raw);let target=index+(row.classList.contains('drop-after')?1:0);if(!Number.isInteger(from)||!stitchQueue[from])return;const [item]=stitchQueue.splice(from,1);if(from<target)target--;stitchQueue.splice(target,0,item);renderQueue();};
      row.append(image,remove);list.append(row);
    });
  }
  exportButton.onclick=()=>{if(stitchQueue.length>=2&&!busy)process(stitchQueue.slice(),true);};
  renderQueue();

  const cutoutMode=document.getElementById('cutoutMode'),modeRow=document.getElementById('cutoutModeRow');
  const webWrap=document.createElement('div');webWrap.id='kktEmbedded';webWrap.hidden=true;
  const webFrame=document.createElement('iframe');webFrame.title='抠抠图在线抠图';webFrame.style.cssText='display:block;width:100%;height:160px;border:0;border-radius:7px;background:#fff';
  const full=document.createElement('a');full.href='https://www.koukoutu.com/removebgtool/all';full.target='_blank';full.rel='noopener';full.textContent='打开完整网页';full.style.cssText='display:block;margin-top:6px;font-size:10px;text-align:right;color:#7285a0';webWrap.append(webFrame,full);zone.after(webWrap);
  const picwish=document.createElement('div');picwish.hidden=true;picwish.id='picwishEntry';
  picwish.innerHTML='<p style="margin:8px 0 12px;font-size:11px;line-height:1.6;color:#8190a6">佐糖不支持嵌入，请在网页中上传图片抠图。</p><a href="https://picwish.cn/remove-background" target="_blank" rel="noopener" style="display:flex;justify-content:center;padding:9px;background:#edf4ff;border:1px solid #cbdcf7;border-radius:7px;color:#2563eb;text-decoration:none;font-size:12px">打开佐糖抠图 ↗</a>';
  zone.after(picwish);
  function syncEmbedded(){if(mode==='cutout'&&provider==='local'){renderCutoutPreview();zone.hidden=!!cutoutState?.original;}picwish.hidden=!(mode==='cutout'&&provider==='picwish');if(!picwish.hidden){zone.hidden=true;cutoutPreview.hidden=true;}const show=mode==='cutout'&&provider==='koukoutu';webWrap.hidden=!show;if(show&&!webFrame.src)webFrame.src='https://www.koukoutu.com/removebgtool/all?ethanEmbedded=1';if(show){zone.hidden=true;cutoutPreview.hidden=true;}}
  function sendEmbedded(files){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('嵌入页面未就绪，请打开完整网页重试'));},30000);const receive=event=>{if(event.source!==webFrame.contentWindow||event.origin!=='https://www.koukoutu.com'||event.data?.requestId!==id)return;clearTimeout(timer);window.removeEventListener('message',receive);resolve(event.data);};window.addEventListener('message',receive);webFrame.contentWindow.postMessage({type:'ETHAN_KKT_EMBED_IMPORT',requestId:id,files},'https://www.koukoutu.com');});}
  let provider='local';const providerButton=document.getElementById('cutoutProvider');
  function renderProvider(){providerButton.textContent=({local:'本地抠图',koukoutu:'抠抠图',picwish:'佐糖'})[provider]+' ⇄';modeRow.classList.toggle('website-mode',provider!=='local');document.getElementById('cutoutInstallHint').textContent=provider==='koukoutu'?'图片将上传至抠抠图，请保持面板打开':provider==='picwish'?'佐糖需在完整网页中使用':'需安装 相关工具－鑫洋助手桌面版';syncEmbedded();}
  const providerReady=chrome.storage.local.get('ethanCutoutProvider').then(s=>{provider=['koukoutu','picwish'].includes(s.ethanCutoutProvider)?s.ethanCutoutProvider:'local';renderProvider();});
  providerButton.onclick=async()=>{if(busy)return;providerButton.disabled=true;try{await providerReady;provider=({local:'koukoutu',koukoutu:'picwish',picwish:'local'})[provider];await chrome.storage.local.set({ethanCutoutProvider:provider});renderProvider();}finally{providerButton.disabled=false;}};
  const qualityButtons=[...cutoutMode.querySelectorAll('[data-cutout-mode]')];
  function disableQuality(disabled){qualityButtons.forEach(button=>button.disabled=disabled);}
  function renderCutoutMode(value){
    cutoutMode.value=value==='high'?'high':'fast';
    cutoutMode.dataset.mode=cutoutMode.value;
    qualityButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cutoutMode===cutoutMode.value)));
  }
  disableQuality(true);
  const modeReady=chrome.storage.local.get('ethanCutoutQualityMode').then(s=>renderCutoutMode(s.ethanCutoutQualityMode)).catch(()=>{renderCutoutMode('fast');status.textContent='模式读取失败，暂用快速抠图';}).finally(()=>disableQuality(false));
  qualityButtons.forEach(button=>button.onclick=async()=>{
    if(busy||button.dataset.cutoutMode===cutoutMode.value)return;
    disableQuality(true);
    try{await chrome.storage.local.set({ethanCutoutQualityMode:button.dataset.cutoutMode});renderCutoutMode(button.dataset.cutoutMode);}
    catch(_){status.textContent='模式保存失败，请重试';}
    finally{disableQuality(false);}
  });
  const downloadPanel=document.querySelector('.link-tools');
  for(const [id,value] of [['openDownload','download'],['openStitch','stitch'],['openCutout','cutout']]) document.getElementById(id).onclick=()=>{
    if(busy)return;
    mode=value;document.getElementById('promptPanel').hidden=true;downloadPanel.hidden=value!=='download';panel.hidden=value==='download';document.getElementById('openPrompts').setAttribute('aria-pressed','false');modeRow.hidden=value!=='cutout';document.getElementById('cutoutInstallHint').hidden=value!=='cutout';
    zone.textContent=value==='stitch'?'拖放或粘贴图片，可继续添加':'拖放或粘贴图片，也可拖入文件夹';status.textContent='';renderQueue();renderCutoutPreview();syncEmbedded();
    for(const [key,val] of [['openDownload','download'],['openStitch','stitch'],['openCutout','cutout']])document.getElementById(key).setAttribute('aria-pressed',String(value===val));
  };
  mode='download';renderQueue();
  async function walk(entry,prefix='') {
    if(entry.isFile)return new Promise((resolve,reject)=>entry.file(file=>resolve([{file,path:prefix+file.name}]),reject));
    const reader=entry.createReader();let children=[];
    while(true){const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!batch.length)break;children.push(...batch);}
    const out=[];for(const child of children)out.push(...await walk(child,prefix+entry.name+'/'));return out;
  }
  function save(blob,name){return new Promise(async(resolve,reject)=>{
    const url=URL.createObjectURL(blob);let id;
    const cleanup=()=>{chrome.downloads.onChanged.removeListener(changed);URL.revokeObjectURL(url);};
    const changed=delta=>{if(delta.id!==id)return;if(delta.state?.current==='complete'){cleanup();resolve();}else if(delta.state?.current==='interrupted'){cleanup();reject(Error('下载中断，请在下载列表重试'));}};
    chrome.downloads.onChanged.addListener(changed);
    try{id=await chrome.downloads.download({url,filename:name,saveAs:false});const [item]=await chrome.downloads.search({id});if(item?.state==='complete'){cleanup();resolve();}else if(item?.state==='interrupted'){cleanup();reject(Error('下载中断'));}}catch(error){cleanup();reject(error);}
  });}
  async function process(entries,exporting=false){
    if(busy)return;busy=true;window.dispatchEvent(new CustomEvent('ethan-tool-busy',{detail:{mode,running:true}}));
    try{
      const files=entries.filter(x=>x.file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(x.file.name));
      if(!files.length)throw Error('没有找到可处理的图片');
      if(!exporting)files.sort((a,b)=>a.file.name.localeCompare(b.file.name,'zh-CN',{numeric:true})||a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
      if(mode==='cutout'){
        await providerReady;
        if(provider==='picwish'){window.open('https://picwish.cn/remove-background','_blank','noopener');throw Error('请在佐糖网页上传图片；该网站禁止嵌入，未自动传入图片');}
        if(provider==='koukoutu'){
          if(files.some(item=>!(/\.(jpe?g|png|webp)$/i.test(item.file.name)||/^image\/(jpeg|png|webp)$/.test(item.file.type))))throw Error('抠抠图仅支持 JPG、PNG、WebP 图片');
          status.textContent='正在传入抠抠图，请保持面板打开…';
          const uploads=[];for(const {file,path} of files){const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);});uploads.push({data,path,name:file.name});}
          const response=await sendEmbedded(uploads);if(!response?.ok)throw Error(response?.message||'传入抠抠图失败');
          status.textContent='已传入抠抠图，逐张处理及下载进度请在嵌入页面查看；处理时请保持插件面板打开。';return;
        }

        cutoutState={original:URL.createObjectURL(files[0].file),running:true};renderCutoutPreview();
        await modeReady;
        const qualityMode=cutoutMode.value==='high'?'high':'fast';
        status.textContent='正在移交后台，请暂时保持面板打开…';
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ethan-cutout',1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const jobId='cutout_'+Date.now();
        try{await new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readwrite');tx.objectStore('jobs').put(files,jobId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
        const result=await chrome.runtime.sendMessage({type:'ETHAN_START_CUTOUT',jobId,mode:qualityMode});
        if(!result?.ok)throw Error(result?.message||'后台任务启动失败');
        const current=await chrome.storage.local.get('cutoutProgress');
        status.textContent=current.cutoutProgress?.message||'后台抠图已启动，可以关闭面板；重新打开可查看进度。';
        return;
      }
      if(!exporting){
        stitchQueue.push(...files.map(entry=>({...entry,preview:URL.createObjectURL(entry.file)})));
        status.textContent='已添加 '+stitchQueue.length+' 张图片，可继续添加或拖动排序；至少两张后点击导出。';
        return;
      }
      exportButton.disabled=true;
      status.textContent='正在拼图，请保持面板打开…';
      const images=[];
      try{
        for(const {file} of files)images.push(await createImageBitmap(file));
        const width=Number(widthSelect.value==='custom'?customWidth.value:widthSelect.value);
        if(!Number.isInteger(width)||width<1||width>32767)throw Error('请输入 1–32767 之间的整数宽度');
        const heights=images.map(image=>Math.max(1,Math.round(image.height*width/image.width)));
        const height=heights.reduce((sum,value)=>sum+value,0);
        if(width>32767||height>32767||width*height>100000000)throw Error('拼图尺寸过大，请减少图片后重试');
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建拼图画布');
        let top=0;images.forEach((image,index)=>{ctx.drawImage(image,0,top,width,heights[index]);top+=heights[index];});
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('拼图生成失败，请减少图片后重试');
        status.textContent='正在保存拼图，请保持面板打开…';await save(blob,'拼图_'+Date.now()+'.png');
        status.textContent='拼图完成 已保存到默认下载目录';
      }finally{images.forEach(image=>image.close());}
    }catch(error){if(mode==='cutout'&&cutoutState){cutoutState.running=false;cutoutState.outcome='failed';}status.textContent=error.message||'处理失败，请重试';}finally{busy=false;window.dispatchEvent(new CustomEvent('ethan-tool-busy',{detail:{mode,running:false}}));picker.value='';renderQueue();renderCutoutPreview();syncEmbedded();}
  }
  function showCutoutProgress(progress){if(!progress)return;if(progress.originalPreview)cutoutState={original:progress.originalPreview,result:progress.resultPreview,running:progress.running,outcome:progress.outcome||(progress.running?'running':progress.done>0&&!progress.failed?'success':'failed')};else if(cutoutState){cutoutState.running=progress.running;cutoutState.outcome=progress.outcome||(progress.running?'running':progress.done>0&&!progress.failed?'success':'failed');}if(mode==='cutout')status.textContent=progress.message;renderCutoutPreview();}
  chrome.storage.local.get('cutoutProgress').then(s=>showCutoutProgress(s.cutoutProgress));
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.cutoutProgress)showCutoutProgress(changes.cutoutProgress.newValue);});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.ethanKktProgress&&mode==='cutout'&&provider==='koukoutu')status.textContent=changes.ethanKktProgress.newValue?.message||'';});
  document.addEventListener('paste',event=>{
    if(panel.hidden||busy||event.target.closest('input,textarea,[contenteditable="true"]'))return;
    const files=[...event.clipboardData.items].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);
    if(!files.length)return;event.preventDefault();process(files.map(file=>({file,path:file.name})));
  });
  zone.onclick=()=>{if(!busy)picker.click();};zone.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();zone.click();}};
  picker.onchange=()=>process([...picker.files].map(file=>({file,path:file.webkitRelativePath||file.name})));
  zone.ondragover=event=>{event.preventDefault();zone.classList.add('dragging');};zone.ondragleave=()=>zone.classList.remove('dragging');
  const importDrop=async event=>{event.preventDefault();zone.classList.remove('dragging');if(busy)return;const items=[...event.dataTransfer.items];const entries=items.map(i=>i.webkitGetAsEntry?.()).filter(Boolean);const fallback=[...event.dataTransfer.files];try{const files=[];for(const entry of entries)files.push(...await walk(entry));await process(entries.length?files:fallback.map(file=>({file,path:file.name})));}catch(error){status.textContent='读取文件失败：'+error.message;}};
  zone.ondrop=importDrop;
  cutoutPreview.querySelectorAll('img').forEach(image=>image.draggable=false);
  cutoutPreview.onclick=()=>cutoutPreview.focus({preventScroll:true});
  cutoutPreview.ondragover=event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();cutoutPreview.classList.add('dragging');}};
  cutoutPreview.ondragleave=()=>cutoutPreview.classList.remove('dragging');
  cutoutPreview.ondrop=event=>{cutoutPreview.classList.remove('dragging');if(event.dataTransfer.types.includes('Files'))importDrop(event);};

  list.ondragover=event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();};
  list.ondrop=event=>{if(event.dataTransfer.types.includes('Files'))importDrop(event);};
})();
