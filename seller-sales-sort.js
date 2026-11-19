(() => {
  if (window.__ethanAnnualSalesSort) return;
  window.__ethanAnnualSalesSort = true;
  let mode = 0, button, currentBody, original = [], scheduled = false;
  const labels = ['↕ 按年销量排序', '↑ 年销量：小到大', '↓ 年销量：大到小'];
  function sales(row) {
    const match = row.textContent.match(/年销量\s*[:：]\s*([\d,.]+)\s*(万|千|亿)?/);
    if (!match) return null;
    return Number(match[1].replace(/,/g, '')) * ({万:10000,千:1000,亿:100000000}[match[2]] || 1);
  }
  function locate() {
    const bodies = [...document.querySelectorAll('tbody')];
    return bodies.find(body => [...body.children].some(row => sales(row) !== null)) || bodies.find(body => {
      const header = body.closest('table')?.querySelector('thead')?.textContent || '';
      return header.includes('商品名称') && header.includes('成交数据');
    });
  }
  function paint() {
    button.textContent = labels[mode];
    button.title = ['点击：年销量小的靠前（当前页）','点击：年销量大的靠前（当前页）','点击：恢复原始顺序'][mode];
    button.dataset.sort = ['none','ascending','descending'][mode];
    button.setAttribute('aria-label', labels[mode] + '，' + button.title);
    button.style.background = mode ? '#eaf3ff' : '#fff';
  }
  function reorder() {
    if (!currentBody) return;
    const index = new Map(original.map((row,i)=>[row,i]));
    const sorted = [...original].sort((a,b) => {
      if (!mode) return index.get(a)-index.get(b);
      const left=sales(a),right=sales(b);
      if(left===null||right===null) return left===right?index.get(a)-index.get(b):left===null?1:-1;
      return (mode===1?left-right:right-left)||index.get(a)-index.get(b);
    });
    if(sorted.some((row,i)=>currentBody.children[i]!==row)) sorted.forEach(row=>currentBody.appendChild(row));
  }
  function scan() {
    const body=locate();
    // Badges such as 必做 are included in textContent. Some toolbar controls
    // are rendered as spans rather than native buttons.
    const controls=[...document.querySelectorAll('button,[role="button"],a,span')];
    const compact = element => element.textContent.replace(/\s+/g,'');
    const findControl = label => {
      const candidates = controls.filter(element => compact(element).includes(label) && compact(element).length <= label.length + 8);
      const element = candidates.sort((a,b)=>compact(a).length-compact(b).length)[0];
      return element?.closest('button,[role="button"],a,.next-btn,.ant-btn') || element;
    };
    const publish = findControl('新发商品');
    const anchor=publish || findControl('更多操作') || findControl('迁移为仅供跨境商品') || findControl('下架');
    if(!body && !anchor){button?.remove();button=null;currentBody=null;original=[];mode=0;return;}
    const rows=body ? [...body.children] : [];
    if(currentBody!==body || rows.length!==original.length || rows.some(row=>!original.includes(row))){
      currentBody=body;original=rows;mode=0;
    }
    if(!button?.isConnected){
      if(!anchor)return;
      button=document.createElement('button');button.type='button';button.id='ethan-annual-sales-sort';
      button.style.cssText='display:inline-flex;align-items:center;justify-content:center;margin:0 12px 0 0;padding:0 12px;height:30px;border:1px solid #91baff;border-radius:5px;color:#1677ff;font:13px sans-serif;cursor:pointer;vertical-align:middle';
      button.onclick=event=>{event.preventDefault();event.stopPropagation();mode=(mode+1)%3;reorder();paint();};
      if (publish) publish.before(button);
      else anchor.after(button);
    }
    if (publish && button.nextSibling !== publish) publish.before(button);
    paint();
    // Reapply when live sales values update, while preserving stable ties.
    if(mode)reorder();
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;scan();});}
  new MutationObserver(records=>{
    if(records.some(record=>!record.target.closest?.('#ethan-annual-sales-sort')))schedule();
  }).observe(document.body,{childList:true,subtree:true,characterData:true});
  scan();
})();
