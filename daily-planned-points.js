(() => {
  'use strict';
  if (window.__ethanDailyPoints) return;
  window.__ethanDailyPoints = true;
  const rates = new Map([
    ['首页设计', 4], ['单品模板设计', 2], ['模板设计', 3], ['模板/主图设计', 3.1], ['模版/主图设计', 3.1],
    ['海报设计', .3], ['自定义', .3], ['自定义版块', .3], ['关联营销', .3], ['关联制作', .3], ['详情替换', .3],
    ['版块新增', .15], ['板块新增', .15], ['二级页面', 3], ['手机端设计', 4], ['手机端同步', .2],
    ['主图制作', .1], ['信息新增', .35], ['信息套版', .35], ['新增信息', .35],
    ['信息修改', .03], ['信息修改(客户)', .03], ['信息修改（客户）', .03],
    ['板块新加', .15], ['板块新加(客户)', .15], ['板块新加（客户）', .15],
    ['版块新加', .15], ['版块新加(客户)', .15], ['版块新加（客户）', .15],
    ['图片处理（抠图）', .04], ['图片处理(抠图)', .04], ['图片处理', .04],
    ['图片处理（不抠图）', .02], ['图片处理(不抠图)', .02], ['页面修改', .04],
    ['信息修改-客户', .03], ['信息修改-客自', .03], ['权限词', .04], ['简易发布（极限词）', .04], ['简易发布(极限词)', .04],
    ['新商首页', 4], ['新商模板', 1.5], ['新商主图', .1], ['新商信息', .35], ['其他项目', .1]
  ]);
  let panel;
  let last = '';
  function render() {
    const sidebar = document.querySelector('.site-sidebar');
    const root = Array.from(document.querySelectorAll('.el-table')).find(el =>
      el.getClientRects().length && el.querySelector('thead')?.textContent.includes('工单ID'));
    const table = root?.__vue__;
    const combined = table?.__ethanCombinedSort;
    if (!sidebar || !table || !Array.isArray(table.data) || !combined || table.data !== combined.rows) { panel?.remove(); panel = null; last = ''; return; }
    if (!panel?.isConnected) {
      panel = document.createElement('section');
      panel.style.cssText = 'margin:14px 12px;padding:12px;border:1px solid #52646c;border-radius:6px;color:#e5edef;font:12px/1.8 sans-serif;background:#263238;max-height:300px;overflow:auto';
      (sidebar.querySelector('.site-sidebar__inner') || sidebar).appendChild(panel);
    }
    panel.style.width = `${Math.max(0, sidebar.clientWidth - 24)}px`;
    const days = new Map();
    const unknown = new Set();
    const seen = new Set();
    for (const row of table.data) {
      const id = row['cust_service_list-id'];
      if (seen.has(id)) continue;
      seen.add(id);
      const date = String(row['cust_service_list-plan_complete'] || '').slice(0, 10);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith('1970-') ? date : '未设计划时间';
      const quantity = Number(String(row['cust_service_list-cs_order_quantity'] || '').replace(/[^\d.+-]/g, ''));
      if (!Number.isFinite(quantity) || quantity <= 0) { unknown.add(`工单${id}数量无效`); continue; }
      const services = new Set(['design', 'offer', 'optimize', 'other'].map(field =>
        String(row[`cust_service_list-service_content_${field}`] || '').replace(/\s+/g, '').replace(/／/g, '/')).filter(value => value && value !== '-'));
      let points = 0;
      if (!services.size) unknown.add(`工单${id}无服务类型`);
      for (const service of services) {
        if (rates.has(service)) points += Math.round(rates.get(service) * quantity * 1000);
        else unknown.add(service);
      }
      days.set(day, (days.get(day) || 0) + points);
    }
    const summary = { days: [...days].sort(([a], [b]) => a.localeCompare(b)), unknown: [...unknown], count: table.data.length };
    const signature = JSON.stringify(summary);
    if (signature === last) return;
    last = signature;
    panel.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = '每日预计积分';
    panel.appendChild(title);
    const text = document.createElement('div');
    text.textContent = `按当前列表 ${summary.count} 条工单计算`;
    text.style.cssText = 'font-size:11px;color:#aabdc5';
    panel.appendChild(text);
    for (const [day, points] of summary.days) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;justify-content:space-between;gap:8px';
      const label = document.createElement('span'); label.textContent = day;
      const value = document.createElement('b'); value.textContent = `${Number((points / 1000).toFixed(3))} 分`;
      // Bright pastel blue to coral; clamp values outside the 1-10 point range.
      const progress = Math.max(0, Math.min(1, (points / 1000 - 1) / 9));
      const startColor = [125, 211, 252];
      const endColor = [255, 145, 145];
      const color = startColor.map((channel, index) => Math.round(channel + (endColor[index] - channel) * progress));
      value.style.color = `rgb(${color.join(',')})`;
      line.append(label, value); panel.appendChild(line);
    }
    const details = document.createElement('details');
    const caption = document.createElement('summary'); caption.textContent = '计算口径';
    const note = document.createElement('div');
    note.textContent = '服务单价×下单数量；新增/套版信息0.35；页面修改和图片处理按抠图；二级页按1920px。';
    details.append(caption, note); panel.appendChild(details);
    if (summary.unknown.length) {
      const warning = document.createElement('div'); warning.style.color = '#ffd59a';
      warning.textContent = `未计分：${summary.unknown.join('、')}`;
      panel.appendChild(warning);
    }
  }
  window.addEventListener('ethan-combined-results', render);
  setInterval(render, 1000);
  render();
})();
