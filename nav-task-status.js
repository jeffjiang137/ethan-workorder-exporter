(() => {
 const tasks={download:false,cutout:false,stitch:false},transient={},stored={};
 function render(){tasks.download=!!(stored.ethanDownloadRunning||stored.linkedQueueStatus?.running);tasks.cutout=!!(stored.cutoutProgress?.running||stored.ethanKktRunning);for(const [mode,id] of [['download','openDownload'],['cutout','openCutout'],['stitch','openStitch']]){const button=document.getElementById(id),running=!!(tasks[mode]||transient[mode]);button.classList.toggle('task-running',running);button.setAttribute('aria-busy',String(running));}}
 const keys=['ethanDownloadRunning','linkedQueueStatus','cutoutProgress','ethanKktRunning'];
 chrome.storage.local.get(keys).then(s=>{Object.assign(stored,s);render();});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;for(const key of keys)if(changes[key])stored[key]=changes[key].newValue;render();});
 window.addEventListener('ethan-tool-busy',event=>{transient[event.detail.mode]=event.detail.running;render();});
 chrome.runtime.sendMessage({type:'ETHAN_GET_BATCH_MATERIAL_STATUS'}).then(s=>{if(s?.ok){stored.ethanDownloadRunning=s.running;render();}}).catch(()=>{});
})();
