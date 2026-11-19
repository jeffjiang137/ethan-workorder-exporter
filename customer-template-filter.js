(() => {
  'use strict';
  if (window.__ethanTemplateFinder) return;
  window.__ethanTemplateFinder = true;
  const normalize = value => String(value ?? '').replace(/\s/g, '').replace(/模版/g, '模板').replace(/／/g, '/');
  const allowed = new Set(['主图设计', '模板/主图设计', '首页', '首页设计', '信息套版', '详情替换', '主图制作', '精品主图设计', '模板设计', '单品模板/主图']);
  const matches = row => ['design', 'offer', 'optimize', 'other'].some(field =>
    allowed.has(normalize(row['cust_service_list-service_content_' + field])));
  const seen = new WeakSet();
  function scan() {
    for (const root of document.querySelectorAll('.el-table')) {
      if (!root.getClientRects().length) continue;
      const text = root.querySelector('thead')?.textContent || '';
      if (!text.includes('工单ID') || text.includes('公司名称')) continue;
      let section = root.parentElement, header;
      for (let i = 0; section && i < 6; i++, section = section.parentElement) {
        header = Array.from(section.querySelectorAll('.el-card__header, .panel-heading, .box-header, div'))
          .find(el => el.textContent.trim().startsWith('服务工单') && el.textContent.trim().length < 50 && !el.contains(root));
        if (header) break;
      }
      let owner = root.__vue__?.$parent;
      while (owner && (!owner.dataForm || !Array.isArray(owner.dataList))) owner = owner.$parent;
      if (!header || !owner || seen.has(owner) || typeof owner.$http !== 'function' || typeof owner.sizeChangeHandle !== 'function') continue;
      seen.add(owner);
      let active = false;
      const http = owner.$http;
      const proxy = new Proxy(http, {apply: async (target, context, args) => {
        const config = args[0];
        if (!active || !config) return Reflect.apply(target, context, args);
        const sourceKey = config.data != null ? 'data' : 'params';
        const source = config[sourceKey];
        const payload = typeof source === 'string' ? JSON.parse(source) : structuredClone(source);
        const query = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
        if (!query || !('page' in query)) return Reflect.apply(target, context, args);
        const page = Number(query.page) || 1;
        const request = async index => {
          const body = structuredClone(payload);
          const pageQuery = body.data && typeof body.data === 'object' ? body.data : body;
          pageQuery.page = index;
          pageQuery.limit = 50;
          const response = await Reflect.apply(target, context, [{...config, [sourceKey]: typeof source === 'string' ? JSON.stringify(body) : body}]);
          if (response.data?.code !== 0 || !Array.isArray(response.data.page?.list)) throw new Error(response.data?.msg || '找模版查询失败');
          return response;
        };
        // Reuse the native customer-scoped query, including all customer constraints.
        const first = await request(1);
        const all = [...first.data.page.list];
        const total = Number(first.data.page.totalCount);
        for (let index = 2; all.length < total; index++) {
          const next = await request(index);
          if (!next.data.page.list.length) throw new Error('工单分页不完整，请重试');
          all.push(...next.data.page.list);
        }
        const filtered = all.filter(matches);
        return {...first, data: {...first.data, page: {...first.data.page,
          list: filtered.slice((page - 1) * 50, page * 50), totalCount: filtered.length, pageSize: 50,
          currPage: page, totalPage: Math.ceil(filtered.length / 50)}}};
      }});
      owner.$http = proxy;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'el-button el-button--success el-button--mini is-plain';
      header.style.position = 'relative';
      button.style.cssText = 'position:absolute;left:76px;top:50%;transform:translateY(-50%);margin:0;white-space:nowrap';
      button.textContent = '找模版';
      button.setAttribute('aria-pressed', 'false');
      button.title = '仅显示指定的主图、模板、首页、套版及详情替换工单';
      button.onclick = () => {
        if (owner.dataListLoading) return;
        active = !active;
        button.textContent = active ? '恢复' : '找模版';
        button.setAttribute('aria-pressed', String(active));
        owner.dataForm.page = 1;
        owner.sizeChangeHandle(active ? 50 : 5);
      };
      header.appendChild(button);
      if (owner.dataForm.limit !== 5) owner.sizeChangeHandle(5);
      owner.$once('hook:beforeDestroy', () => { if (owner.$http === proxy) owner.$http = http; });
    }
  }
  setInterval(scan, 1000);
  scan();
})();
