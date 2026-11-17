const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install-ps-native.ps1 -ExtensionId ${chrome.runtime.id}`;
document.getElementById('command').textContent=command;
const status=document.getElementById('status');
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(command);status.textContent='已复制，请在插件文件夹的 PowerShell 中执行。';}catch{status.textContent='复制失败，请选中上方命令手动复制。';}};
document.getElementById('check').onclick=()=>{
 const button=document.getElementById('check');button.disabled=true;status.textContent='正在检测本机组件…';
 let done=false;const port=chrome.runtime.connectNative('com.codex.browser.photoshop');
 const finish=text=>{if(done)return;done=true;clearTimeout(timer);status.textContent=text;button.disabled=false;port.disconnect();};
 const timer=setTimeout(()=>finish('连接超时，请确认已执行安装命令。'),8000);
 port.onMessage.addListener(m=>{if(m.type==='ready')finish('连接成功，可以返回网页使用图片置入 PS。');else if(m.type==='result'&&!m.ok)finish(m.error);});
 port.onDisconnect.addListener(()=>{const err=chrome.runtime.lastError;finish('尚未连接：'+(err?.message||'本机组件已关闭'));});
 port.postMessage({type:'start'});
};
