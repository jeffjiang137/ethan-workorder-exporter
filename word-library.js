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

'use strict';
const $=id=>document.getElementById(id);
let dictionary,defaults;
const clean=data=>{if(Array.isArray(data))data={'极限词':data};if(!data||typeof data!=='object')throw Error('词库格式无效');const result={};for(const [key,words] of Object.entries(data)){if(!Array.isArray(words))throw Error('分类内容必须是词语数组');result[key]=[...new Set(words.filter(w=>typeof w==='string').map(w=>w.trim()).filter(Boolean))];}if(!Object.keys(result).length)throw Error('词库不能为空');return result;};
async function persist(){await chrome.storage.local.set({ethanWordDictionary:dictionary});$('status').textContent='已保存，共 '+Object.values(dictionary).flat().length+' 个词语';}
function categories(){const old=$('category').value;$('category').replaceChildren(...Object.keys(dictionary).map(key=>{const option=document.createElement('option');option.value=option.textContent=key;return option;}));if(dictionary[old])$('category').value=old;}
function render(){const query=$('search').value.trim().toLowerCase();$('list').replaceChildren();for(const [category,words] of Object.entries(dictionary)){const matches=words.map((word,index)=>({word,index})).filter(({word})=>!query||(category+' '+word).toLowerCase().includes(query));if(!matches.length)continue;const title=document.createElement('h3');title.textContent=category;$('list').append(title);for(const {word,index} of matches){const row=document.createElement('div');row.className='row';const input=document.createElement('input');input.value=word;const save=document.createElement('button');save.textContent='保存';save.onclick=async()=>{const value=input.value.trim();if(!value)return $('status').textContent='词语不能为空';if(words.includes(value)&&value!==word)return $('status').textContent='该分类已有此词';words[index]=value;await persist();render();};const remove=document.createElement('button');remove.textContent='删除';remove.onclick=async()=>{words.splice(index,1);await persist();render();};row.append(input,save,remove);$('list').append(row);}}}
$('search').oninput=render;
$('add').onclick=async()=>{const word=$('newWord').value.trim(),category=$('category').value;if(!word)return;if(dictionary[category].includes(word))return $('status').textContent='该分类已有此词';dictionary[category].push(word);$('newWord').value='';await persist();render();};
$('import').onclick=()=>$('file').click();
$('file').onchange=async()=>{try{const file=$('file').files[0];if(!file)return;const text=await file.text();const incoming=clean(file.name.toLowerCase().endsWith('.json')?JSON.parse(text):{[$('category').value]:text.split(/\r?\n/)});if($('mode').value==='replace')dictionary=incoming;else for(const [category,words] of Object.entries(incoming))dictionary[category]=[...new Set([...(dictionary[category]||[]),...words])];await persist();categories();render();}catch(error){$('status').textContent=ethanChineseError(error.message);}finally{$('file').value='';}};
$('export').onclick=()=>{const json=$('format').value==='JSON';const blob=new Blob([json?JSON.stringify(dictionary,null,2):[...new Set(Object.values(dictionary).flat())].join('\n')],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='极限词库.'+(json?'json':'txt');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('reset').onclick=async()=>{if(!confirm('恢复默认词库？当前自定义修改将被替换。'))return;dictionary=structuredClone(defaults);await persist();categories();render();};
function closeWordLibrary(){
  if(window.parent!==window)window.parent.postMessage({type:'ETHAN_WORD_LIBRARY_CLOSE'},'*');
  else window.close();
}
$('done').onclick=closeWordLibrary;
$('closeLibrary').onclick=closeWordLibrary;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&window.parent!==window)closeWordLibrary();});
(async()=>{defaults=clean(await(await fetch('vendor/ocr/words.json')).json());const saved=await chrome.storage.local.get('ethanWordDictionary');dictionary=clean(saved.ethanWordDictionary||defaults);categories();render();})().catch(error=>$('status').textContent=ethanChineseError(error.message));
