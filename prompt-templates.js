(() => {
  const key = 'ethanPromptTemplates';
  const panel = document.getElementById('promptPanel');
  panel.innerHTML = `<label for="promptText">提示词模板</label><textarea id="promptText" rows="4" placeholder="输入提示词"></textarea><div class="prompt-actions"><button id="promptSave">保存模板</button><button id="promptCopy">复制</button><button id="promptClear">清除</button></div><div id="promptTags" class="prompt-tags"></div><div class="prompt-transfer"><select id="promptImportMode"><option value="append">追加导入</option><option value="replace">覆盖导入</option></select><button id="promptImport">导入</button><select id="promptFormat"><option>JSON</option><option>TXT</option><option>CSV</option></select><button id="promptExport">导出</button></div><input id="promptFile" type="file" accept=".json,.txt,.csv" hidden><div id="promptStatus" role="status"></div><div id="promptMenu" hidden style="position:fixed;background:white;border:1px solid #ccd7e8;padding:5px;z-index:9999"><button id="promptRename">重命名</button><button id="promptDelete">删除</button></div>`;
  const el = id => document.getElementById(id);
  let templates = [], selected = null;
  const report = text => { el('promptStatus').textContent = text; };
  async function persist(next) {
    await chrome.storage.local.set({ [key]: next });
    templates = next; render();
  }
  function render() {
    el('promptTags').replaceChildren();
    for (const item of templates) {
      const button = document.createElement('button');
      button.textContent = item.name;
      button.className = 'prompt-tag';
      button.title = '点击使用 · 右键重命名或删除';
      button.dataset.templateId = item.id;
      button.addEventListener('click', async () => {
        el('promptText').value = item.text;
        try { await navigator.clipboard.writeText(item.text); report('已填入并复制'); } catch { report('已填入，请点击复制'); }
      });
      button.addEventListener('contextmenu', event => {
        event.preventDefault(); selected = item.id;
        const menu = el('promptMenu'); menu.hidden = false;
        menu.style.left = Math.min(event.clientX, window.innerWidth-110)+'px';
        menu.style.top = Math.min(event.clientY, window.innerHeight-90)+'px';
      });
      el('promptTags').appendChild(button);
    }
  }
  function action(id, fn) {
    el(id).addEventListener('click', async () => {
      try { await fn(); } catch (error) { report(error.message || '操作失败'); }
    });
  }
  action('openPrompts', () => {
    document.querySelector('.link-tools').hidden = true;
    el('imageToolPanel').hidden = true; panel.hidden = false;
    document.querySelectorAll('.workspace-tabs button').forEach(button => button.setAttribute('aria-pressed', String(button.id==='openPrompts')));
  });
  action('promptSave', async () => {
    const text = el('promptText').value;
    if (!text.trim()) throw new Error('请先输入提示词');
    const name = prompt('模板名称');
    if (!name?.trim()) return;
    await persist([...templates, {id:crypto.randomUUID(),name:name.trim(),text}]); report('模板已保存');
  });
  action('promptCopy', async () => { await navigator.clipboard.writeText(el('promptText').value); report('已复制'); });
  action('promptClear', () => { el('promptText').value=''; });
  action('promptRename', async () => {
    const item = templates.find(item=>item.id===selected); if (!item) return;
    const button = [...el('promptTags').children].find(tag => tag.dataset.templateId === item.id);
    if (!button) return;
    const input = document.createElement('input');
    input.className = 'prompt-tag-editor'; input.value = item.name;
    input.setAttribute('aria-label', '模板名称');
    input.style.width = Math.min(260, Math.max(64, item.name.length * 13 + 24)) + 'px';
    button.replaceWith(input); input.focus(); input.select();
    let finished = false;
    const finish = async cancel => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (cancel || !name || name === item.name) { render(); return; }
      try {
        await persist(templates.map(entry => entry.id === item.id ? {...entry, name} : entry));
        report('名称已更新');
      } catch (error) { render(); report(error.message || '重命名失败'); }
    };
    input.addEventListener('blur', () => finish(false));
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault(); finish(event.key === 'Escape');
      }
    });
  });
  action('promptDelete', async () => { await persist(templates.filter(item=>item.id!==selected)); });
  document.addEventListener('click', () => { el('promptMenu').hidden=true; });
  const quote = text => '"'+text.replace(/"/g,'""')+'"';
  function parseDelimited(text, separator) {
    const rows=[]; let row=[], cell='', quoted=false;
    for(let i=0;i<text.length;i++) {
      const c=text[i];
      if(c==='"') { if(quoted&&text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted; }
      else if(!quoted&&c===separator){row.push(cell);cell='';}
      else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(quoted) throw new Error('导入文件引号不完整');
    if(cell||row.length){row.push(cell);rows.push(row);}
    return rows.filter(row=>row.some(Boolean));
  }
  action('promptExport', async () => {
    const format=el('promptFormat').value;
    const data=format==='JSON'?JSON.stringify(templates.map(({name,text})=>({name,text})),null,2):[['name','text'],...templates.map(item=>[item.name,item.text])].map(row=>row.map(quote).join(format==='CSV'?',':'\t')).join('\r\n');
    await chrome.downloads.download({url:'data:text/plain;charset=utf-8,'+encodeURIComponent('\uFEFF'+data),filename:'提示词模板.'+format.toLowerCase(),saveAs:false});report('已导出');
  });
  function normalizePromptImport(data) {
    const rows = Array.isArray(data) ? data : data?.presets;
    if (!Array.isArray(rows)) throw new Error('JSON 需要模板数组或 presets 数组');
    const entries = rows.map(item => ({ name: item?.name ?? item?.label, text: item?.text ?? item?.content }));
    if (entries.some(item => typeof item.name !== 'string' || !item.name.trim()
        || typeof item.text !== 'string' || !item.text.trim())) {
      throw new Error('模板需要 name/text 或 label/content 字段，且不能为空');
    }
    const draft = !Array.isArray(data) && typeof data.templateText === 'string' ? data.templateText : null;
    return { entries, draft };
  }
  action('promptImport', () => el('promptFile').click());
  el('promptFile').addEventListener('change',async () => {
    try {
      const file=el('promptFile').files[0]; if(!file)return;
      const text=(await file.text()).replace(/^\uFEFF/,'');
      let entries, draft = null;
      if(file.name.toLowerCase().endsWith('.json')) ({ entries, draft } = normalizePromptImport(JSON.parse(text)));
      else { const rows=parseDelimited(text,file.name.toLowerCase().endsWith('.csv')?',':'\t'); if(rows[0]?.[0]==='name')rows.shift(); entries=rows.map(row=>({name:row[0],text:row[1]})); }
      if(!Array.isArray(entries)||entries.some(item=>typeof item.name!=='string'||!item.name.trim()||typeof item.text!=='string'||!item.text.trim()))throw new Error('格式无效，需要 name、text 两列');
      if(el('promptImportMode').value==='replace'&&!confirm('覆盖全部已有模板？'))return;
      const next=entries.map(item=>({id:crypto.randomUUID(),name:item.name.trim(),text:item.text}));
      await persist(el('promptImportMode').value==='replace'?next:[...templates,...next]);
      if (draft !== null) el('promptText').value = draft;
      report(`已导入 ${next.length} 个模板`);
    }catch(error){report(error.message);}finally{el('promptFile').value='';}
  });
  chrome.storage.local.get(key).then(stored=>{templates=stored[key]||[];render();}).catch(error=>report(error.message));
})();
