(() => {
  if (window.__ethanReferenceTables) return;
  window.__ethanReferenceTables = true;
  const timing = [
    ['诚信通首页装修','5个工作日（下单当天算时间）'],
    ['二级页面、模板设计','3个工作日（其他下单当天不算时间）'],
    ['海报','≤4张：3个工作日；≥5张：5个工作日'],
    ['主图设计','1–3张：1个工作日；+4=7张：2个；8张以上：3个'],
    ['信息新增、信息替换、极限词、方正字体修改等','1–3条：1个工作日；+7=10条：2个；+10=20条：3个；+20=40条：4个；+20=60条：5个'],
    ['图片处理','1–10张：当天；+40=50张：1个工作日；+50=100张：2个；+200=300张：3个'],
    ['手机端装修（重新设计并上传）','5个工作日'],['手机端装修（与PC端同步）','2个工作日'],
    ['店招/优惠券/关联营销/在线旺旺/悬浮窗/侧边导航','2个工作日', true],
    ['说明','如有加急、特殊情况，提前与运营及客户沟通。方正字体修改：①重新发布按信息替换来算积分；②不需要重新套版修改，按照极限词修改的类目算积分。', true]
  ];
  const ratios = [
    ['1∶1','诚信通店铺设计'],['1∶1','海报设计/自定义设计'],['1∶1（模板或首页）','二级页面952px宽/1920px宽'],
    ['不扣除','店招/优惠券/悬浮窗/侧边导航/节日海报/物流通知海报'],['不扣除','关联营销'],
    ['1∶1','模板设计发布（含五张主图）'],['1∶1','套版发布（含五张主图）'],['1∶1扣信息','模板设计（已确认）新增版块'],
    ['1∶1','重新设计的手机端页面并上传'],['不扣除','修改PC端整体尺寸上传'],['5∶1','按客户需求处理，但不需抠图'],['1∶1','按客户需求处理，但需要抠图'],
    ['3∶1扣信息','懒人图/数据包/随美软件/代码'],['1∶1扣图片','非我们发的信息详情页优化等'],['不扣除','信息修改（我们）'],
    ['扣图片（三处以上：1扣信息）','信息修改（客户）'],['不扣图片（三处以上：1扣图片）','信息修改（客户）'],['不扣除','方正字体修改-首页'],['不扣除','方正字体修改-信息'],
    ['5∶1扣信息','极限词修改-信息'],['特殊情况询问主管','没有在规定时间内完成任务'],['1∶5扣图片','简易主图'],['1∶20扣图片','主图']
  ];
  const style = document.createElement('style');
  style.textContent = `.ethan-reference{position:fixed;box-sizing:border-box;padding:10px;border:1px solid #dbe9e52e;border-radius:9px;background:rgba(0,0,0,.55);backdrop-filter:blur(10px);color:#edf3f4;box-shadow:0 8px 28px #0002;overflow:hidden;font:12px/1.4 Arial,sans-serif;pointer-events:auto}.ethan-reference h3{margin:0 0 7px;font-size:14px;color:#bde8d7}.ethan-reference table{width:100%;border-collapse:collapse;table-layout:fixed}.ethan-reference td,.ethan-reference th{padding:4px 6px;border:1px solid #d6e6e526;text-align:left;vertical-align:top;overflow-wrap:anywhere}.ethan-reference th{background:transparent;color:#c9e7dd}.ethan-reference tbody tr:nth-child(even){background:rgba(255,255,255,.05)}.ethan-reference th:first-child{width:32%}`;
  document.head.append(style);
  const timingStyle = document.createElement('style');
  timingStyle.textContent = `.ethan-timing-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ethan-timing-item{min-width:0;padding:7px 9px;border:1px solid #ffffff20;border-radius:5px;background:#ffffff0b}.ethan-timing-item h4{margin:0 0 6px;color:#edf3f4;font-size:1em;line-height:1.5}.ethan-timing-item p{margin:3px 0;color:#edf3f4;line-height:1.55;overflow-wrap:anywhere}.ethan-timing-item-wide{grid-column:1/-1}.ethan-reference.ethan-timing h3{margin-bottom:10px}`;
  document.head.append(timingStyle);
  function timingPanel() {
    const box = document.createElement('aside');
    box.className = 'ethan-reference ethan-timing';
    box.setAttribute('aria-label', '任务制作时间规范');
    const title = document.createElement('h3');
    title.textContent = '任务制作时间规范';
    const grid = document.createElement('div');
    grid.className = 'ethan-timing-grid';
    for (const [name, content, fullWidth] of timing) {
      const item = document.createElement('section');
      item.className = 'ethan-timing-item';
      if (fullWidth) item.classList.add('ethan-timing-item-wide');
      const heading = document.createElement('h4');
      heading.textContent = name;
      item.append(heading);
      for (const line of content.split(/[；;]/).filter(Boolean)) {
        const text = document.createElement('p');
        text.textContent = line;
        item.append(text);
      }
      grid.append(item);
    }
    box.append(title, grid);
    return box;
  }
  function panel(title, headers, rows) {
    const box=document.createElement('aside');box.className='ethan-reference';box.setAttribute('aria-label',title);
    const heading=document.createElement('h3');heading.textContent=title;box.append(heading);
    const table=document.createElement('table');
    const head=table.createTHead().insertRow();headers.forEach(text=>{const th=document.createElement('th');th.textContent=text;head.append(th);});
    const body=table.createTBody();rows.forEach(values=>{const tr=body.insertRow();values.forEach(text=>tr.insertCell().textContent=text);});box.append(table);return box;
  }
  let active=null,left=null,right=null;
  function update(){
    const dialog=[...document.querySelectorAll('.el-dialog')].find(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&node.querySelector('.el-dialog__title')?.textContent.trim()==='编辑');
    if(!dialog){left?.remove();right?.remove();active=left=right=null;return;}
    if(active!==dialog){left?.remove();right?.remove();active=dialog;left=panel('扣除数量比例',['比例','项目'],ratios);right=timingPanel();dialog.parentElement.append(left,right);}
    const rect=dialog.getBoundingClientRect(),gap=48,edge=16;
    const widths=[Math.min(510,rect.left-gap-edge),Math.min(470,innerWidth-rect.right-gap-edge)];
    for(const [index,box] of [left,right].entries()){
      const width=widths[index];box.hidden=width<180;
      if(!box.hidden){
        const top=30,availableHeight=Math.max(100,innerHeight-top-16);
        Object.assign(box.style,{left:(index===0?edge:innerWidth-edge-width)+'px',top:top+'px',width:width+'px',maxHeight:'none',fontSize:'12px'});
        // Fit the whole table at the current viewport without an internal scrollbar.
        box.querySelectorAll('td,th').forEach(cell=>cell.style.padding='4px 6px');
        if(box.scrollHeight>availableHeight){
          box.querySelectorAll('td,th').forEach(cell=>cell.style.padding='2px 5px');
        }
        for(let size=11.5;box.scrollHeight>availableHeight&&size>=9;size-=.5)box.style.fontSize=size+'px';
      }
    }

  }
  let pending=false;
  function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;update();});}
  // Observe page changes but ignore our own table insertion/style updates.
  new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.ethan-reference')))schedule();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
  window.addEventListener('resize',schedule);update();
})();
