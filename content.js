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

(() => {
  'use strict';

  // 使用版本化标记，避免扩展升级后旧脚本留下的通用标记阻止新脚本重新注入。
  const SCRIPT_INSTANCE_KEY = '__ETHAN_WORKORDER_EXPORTER_TODAY_COPY_V6__';
  const EXTENSION_VERSION = chrome.runtime.getManifest().version;
  if (window[SCRIPT_INSTANCE_KEY]) return;
  window[SCRIPT_INSTANCE_KEY] = true;
  try { delete window.__ETHAN_WORKORDER_EXPORTER__; } catch (error) { /* 忽略 */ }

  // 扩展在当前网页打开期间被重新加载时，旧内容脚本的消息监听会失效，
  // 但旧按钮和弹窗节点可能仍留在页面中。新脚本注入后先清理旧节点，再完整重建。
  document.getElementById('ethan-workorder-exporter-root')?.remove();
  document.getElementById('ethan-workorder-page-actions')?.remove();
  document.getElementById('ethan-workorder-page-actions-style')?.remove();

  const FIELD_DEFS = {
    operator: ['运营人员', '运营负责人', '运营专员', '运营', '负责人'],
    company: ['公司名称', '客户公司', '企业名称', '客户名称', '商家名称', '公司'],
    executor: ['操作人员', '执行人员', '设计师', '服务人员', '制作人员', '操作人'],
    // 计划完成与实际完成必须分开映射，避免“计划完成时间”因包含“完成时间”而被误提取。
    plannedAt: ['计划完成', '计划完成时间', '计划完成日期', '预计完成', '预计完成时间', '预计完成日期', '要求完成时间', '截止时间'],
    completedAt: ['完成时间', '实际完成时间', '处理完成时间', '工单完成时间', '服务完成时间', '实际完成日期', '完成日期', '完结时间', '实际完结时间'],
    designService: ['设计服务', '设计服务内容', '设计项目', '设计类服务'],
    infoService: ['信息服务', '信息服务内容', '信息项目', '信息类服务'],
    optimizeService: ['优化服务', '优化服务内容', '优化项目', '优化类服务'],
    otherService: ['其他服务', '其他服务内容', '其他项目', '其他类服务'],
    dealResult: ['处理结果'],
    orderQuantity: ['下单数量', '下单数', '订单数量', '服务数量', '制作数量']
  };

  const COLUMN_WIDTHS = [80, 215, 80, 100, 90, 110];
  const TABLE_COLOR_OPTIONS = [
    { name: '奶油黄', bg: '#fff2cc', focus: '#fff7d8' },
    { name: '薄荷绿', bg: '#e2f0d9', focus: '#edf7e8' },
    { name: '雾霾蓝', bg: '#ddebf7', focus: '#ebf4fb' },
    { name: '柔雾紫', bg: '#e4dfec', focus: '#f0ecf5' },
    { name: '樱花粉', bg: '#fce4ec', focus: '#fdefF4' },
    { name: '杏仁橙', bg: '#fce4d6', focus: '#fdf0e8' },
    { name: '浅灰蓝', bg: '#e7e6e6', focus: '#f1f0f0' }
  ];
  const EMPTY_MARKERS = new Set(['', '-', '--', '—', '无', '暂无', '未选择', '未填写', 'null', 'undefined', '/']);

  const SERVICE_RULES = [
    [/信息\s*套版|^套版$/, '套版'],
    [/店铺首页|首页装修|首页设计|首页/, '首页'],
    // “模板/主图设计”属于模板服务；模板规则必须优先于所有主图规则。
    [/模板\s*[\/／]\s*主图(?:设计)?|模板设计|模板/, '模板'],
    [/简易\s*主图(?:设计)?/, '简易主图'],
    // “精品主图设计 / 精品主图”以及“主图制作”简写为“主图”。
    [/(?:精品\s*主图(?:设计)?|主图\s*制作)/, '主图'],
    // “详情替换 / 详情页换图”等属于替换服务，必须优先于详情规则。
    [/(?:详情(?:页|页面)?\s*(?:替换|换图|更换)|(?:替换|换图|更换)\s*详情(?:页|页面)?)/, '替换'],
    [/详情长图|详情页面|详情页|详情设计|详情/, '详情'],
    [/板块|版块|模块/, '板块'],
    [/轮播图|轮播/, '轮播'],
    [/海报|banner|横幅/i, '海报'],
    [/白底图|白底/, '白底'],
    [/场景图|场景/, '场景'],
    [/短视频|视频/, '视频'],
    [/标题优化|商品标题|标题/, '标题'],
    [/关键词/, '关键词'],
    [/商品发布|发布商品|上架/, '上架'],
    [/属性优化|商品属性|属性/, '属性'],
    [/信息优化|信息完善|信息服务/, '信息'],
    [/运营诊断|店铺诊断|运营/, '运营'],
    [/数据分析|数据/, '数据']
  ];


  // “待处理工单”统计时使用。顺序即最终文本中的优先输出顺序。
  const SERVICE_STAT_RULES = [
    ['套版', /信息\s*套版|^套版$/i],
    ['首页', /店铺首页|首页装修|首页设计|首页/i],
    ['模板', /模板(?:设计)?/i],
    ['简易主图', /简易\s*主图(?:设计)?/i],
    // “精品主图设计 / 精品主图”以及“主图制作”计入“主图”。
    ['主图', /(?:精品\s*主图(?:设计)?|主图\s*制作)/i],
    ['详情', /详情长图|详情页面|详情页|详情设计|详情/i],
    ['替换', /替换|换图|更换/i],
    ['修改', /修改|改图|修图/i],
    ['新增', /新增|新加/i],
    ['板块', /板块|版块|模块/i],
    ['轮播', /轮播图|轮播/i],
    ['海报', /海报|banner|横幅/i],
    ['白底', /白底图|白底/i],
    ['场景', /场景图|场景/i],
    ['视频', /短视频|视频/i],
    ['标题', /标题优化|商品标题|标题/i],
    ['关键词', /关键词/i],
    ['上架', /商品发布|发布商品|上架/i],
    ['属性', /属性优化|商品属性|属性/i],
    ['信息', /信息优化|信息完善/i],
    ['运营', /运营诊断|店铺诊断/i],
    ['数据', /数据分析/i]
  ];

  const SERVICE_STAT_ORDER = SERVICE_STAT_RULES.map(([label]) => label);

  // 点击不同工单按钮时，先自动切换“操作状态”筛选项并执行查询。
  const ACTION_FILTER_STATUS = {
    extract: '等待客户确认',
    stats: '等待处理'
  };
  const EXTRACT_DATE_FILTER = {
    field: '完成时间',
    shortcut: '本月'
  };
  const TODAY_COMPLETED_DATE_FILTER = {
    field: '完成时间',
    shortcut: '今天'
  };
  const OPERATOR_STORAGE_KEY = 'ethanOperatorName';
  let cachedOperatorName = null;

  let uiHost;
  let shadow;
  let currentRows = [];
  let currentColumnWidths = COLUMN_WIDTHS;
  let currentModalTitle = '待确认工单表格';
  let currentHasHeader = false;
  let selectedTableColor = TABLE_COLOR_OPTIONS[0];

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function compactHeader(value) {
    return normalizeText(value).replace(/[：:()（）\s]/g, '').toLowerCase();
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getCellText(cell) {
    if (!cell) return '';

    const text = normalizeText(cell.innerText || cell.textContent || '');
    const inputValues = Array.from(cell.querySelectorAll('input, textarea, select'))
      .map((node) => normalizeText(node.value))
      .filter(Boolean);
    const attributeValues = [cell, ...cell.querySelectorAll('[title], [aria-label]')]
      .flatMap((node) => [normalizeText(node.getAttribute?.('title')), normalizeText(node.getAttribute?.('aria-label'))])
      .filter(Boolean);

    // Element UI 的省略文本通常把完整名称放在内部节点的 title 中。
    // 只在 title 明显是正文完整版时采用，避免把“点击排序”等辅助文字当成字段值。
    if (text) {
      const visiblePrefix = text.replace(/(?:\.{3}|…+)$/g, '').trim();
      const fullValue = attributeValues
        .filter((value) => value !== text && visiblePrefix && value.includes(visiblePrefix))
        .sort((a, b) => b.length - a.length)[0];
      return fullValue || text;
    }

    return inputValues[0] || attributeValues.sort((a, b) => b.length - a.length)[0] || '';
  }

  function getDirectCells(row, selector) {
    return Array.from(row.children).filter((child) => child.matches?.(selector));
  }

  function fieldForHeader(headerText) {
    const header = compactHeader(headerText);
    if (!header) return null;

    // 先做完全匹配，确保“完成时间”不会被更长的“计划完成时间”反向包含后误判为 plannedAt。
    for (const [field, aliases] of Object.entries(FIELD_DEFS)) {
      if (aliases.some((alias) => compactHeader(alias) === header)) return field;
    }

    // 再允许表头包含别名（例如“实际完成时间(分钟)”包含“实际完成时间”）。
    // 禁止使用 token.includes(header)：短表头“完成时间”会被“计划完成时间”错误命中。
    let best = null;
    let bestLength = 0;
    for (const [field, aliases] of Object.entries(FIELD_DEFS)) {
      for (const alias of aliases) {
        const token = compactHeader(alias);
        if (token && header.includes(token) && token.length > bestLength) {
          best = field;
          bestLength = token.length;
        }
      }
    }
    return best;
  }

  function mapHeaders(headers) {
    const mapping = {};
    headers.forEach((header, index) => {
      const field = fieldForHeader(header);
      if (field && mapping[field] == null) mapping[field] = index;
    });
    return mapping;
  }

  function candidateScore(mapping, rowCount, bonus = 0) {
    const requiredHits = ['operator', 'company', 'executor', 'completedAt']
      .filter((key) => mapping[key] != null).length;
    const serviceHits = ['designService', 'infoService']
      .filter((key) => mapping[key] != null).length;
    const quantityHit = mapping.orderQuantity != null ? 8 : 0;
    return bonus + requiredHits * 20 + serviceHits * 12 + quantityHit + Math.min(rowCount, 30);
  }

  function getHeaderInfo(table) {
    if (!table) return null;
    const headerRows = Array.from(table.querySelectorAll('thead tr')).filter(isElementVisible);
    const fallbackRows = Array.from(table.querySelectorAll('tr')).filter(isElementVisible).slice(0, 4);
    const row = headerRows.at(-1) || fallbackRows.find((item) => getDirectCells(item, 'th').length > 0);
    if (!row) return null;
    const headers = getDirectCells(row, 'th,td').map(getCellText);
    return { headers, mapping: mapHeaders(headers) };
  }

  // 只改变显示坐标，保留 Vue 管理的 DOM 顺序、列标识、排序事件和提取索引。
  function startWorkOrderColumnLayout() {
    const styleId = 'ethan-workorder-column-layout';
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    let frame = 0;
    const resizeObserver = new ResizeObserver(schedule);
    const observed = new Set();

    function update() {
      frame = 0;
      const rules = [];
      const current = new Set();
      document.querySelectorAll('.el-table').forEach((root) => {
        const header = root.querySelector('.el-table__header-wrapper table');
        const row = header?.querySelector('thead tr');
        if (!row || !isElementVisible(root)) return;
        const cells = getDirectCells(row, 'th').filter((cell) => !cell.classList.contains('gutter'));
        const labels = cells.map((cell) => compactHeader(getCellText(cell)));
        if (!labels.includes('工单id') || !labels.includes('公司名称')) return;
        const targets = ['优化服务', '其他服务'].map((label) => labels.indexOf(label));
        if (targets.some((index) => index < 0) || cells.some((cell) => cell.colSpan > 1)) return;
        const columns = cells.map((cell, index) => ({
          cell, index, width: cell.offsetWidth,
          id: Array.from(cell.classList).find((name) => /^el-table_\d+_column_\d+$/.test(name))
        }));
        if (columns.some((column) => !column.id || !column.width)) return;
        const rightRow = root.querySelector('.el-table__fixed-right thead tr');
        const fixedRight = new Set(rightRow ? getDirectCells(rightRow, 'th')
          .filter((cell) => !cell.classList.contains('is-hidden'))
          .flatMap((cell) => Array.from(cell.classList)) : []);
        // 原生右侧固定操作列仍固定；两项移到可滚动列的末尾。
        const remaining = columns.filter((column) => !targets.includes(column.index));
        const ordered = [
          ...remaining.filter((column) => !fixedRight.has(column.id)),
          ...targets.map((index) => columns[index]),
          ...remaining.filter((column) => fixedRight.has(column.id))
        ];
        const originalOffsets = [];
        let offset = 0;
        columns.forEach((column) => { originalOffsets[column.index] = offset; offset += column.width; });
        offset = 0;
        ordered.forEach((column) => {
          const shift = offset - originalOffsets[column.index];
          if (shift) rules.push(`.el-table th.${column.id},.el-table td.${column.id}{transform:translateX(${shift}px);}`);
          offset += column.width;
          current.add(column.cell);
          if (!observed.has(column.cell)) resizeObserver.observe(column.cell);
        });
      });
      observed.forEach((cell) => { if (!current.has(cell)) resizeObserver.unobserve(cell); });
      observed.clear();
      current.forEach((cell) => observed.add(cell));
      const css = rules.join('\n');
      if (style.textContent !== css) style.textContent = css;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', schedule, { passive: true });
    schedule();
  }

  function getBodyRows(table) {
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody > tr'))
      .filter((row) => !row.classList.contains('el-table__expanded-cell') && isElementVisible(row));
  }

  function collectElementUiCandidates() {
    const candidates = [];

    document.querySelectorAll('.el-table').forEach((root) => {
      if (!isElementVisible(root)) return;

      // Ethan 工单页使用 Element UI：表头和数据行分别位于两张 table 中。
      // 旧版按单张 table 读取，只会选中“有表头、无数据行”的 header table。
      const headerTable =
        root.querySelector(':scope > .el-table__inner-wrapper > .el-table__header-wrapper table') ||
        root.querySelector(':scope > .el-table__header-wrapper table') ||
        root.querySelector('.el-table__header-wrapper table');
      const bodyTable =
        root.querySelector(':scope > .el-table__inner-wrapper > .el-table__body-wrapper table') ||
        root.querySelector(':scope > .el-table__body-wrapper table') ||
        root.querySelector('.el-table__body-wrapper table');

      const headerInfo = getHeaderInfo(headerTable);
      if (!headerInfo) return;
      const rows = getBodyRows(bodyTable);
      const score = candidateScore(headerInfo.mapping, rows.length, 220);
      candidates.push({
        kind: 'element-ui',
        node: root,
        headers: headerInfo.headers,
        mapping: headerInfo.mapping,
        rows,
        score
      });
    });

    return candidates;
  }

  function collectTableCandidates() {
    const candidates = collectElementUiCandidates();
    document.querySelectorAll('table').forEach((table) => {
      if (!isElementVisible(table)) return;
      const headerRows = Array.from(table.querySelectorAll('thead tr')).filter(isElementVisible);
      const fallbackRows = Array.from(table.querySelectorAll('tr')).filter(isElementVisible).slice(0, 3);
      const row = headerRows.at(-1) || fallbackRows.find((item) => getDirectCells(item, 'th').length > 0);
      if (!row) return;
      const headerCells = getDirectCells(row, 'th,td');
      const headers = headerCells.map(getCellText);
      const mapping = mapHeaders(headers);
      const bodyRows = Array.from(table.querySelectorAll('tbody tr')).filter(isElementVisible);
      const score = candidateScore(mapping, bodyRows.length) - (table.closest('[aria-hidden="true"]') ? 100 : 0);
      candidates.push({ kind: 'table', node: table, headers, mapping, rows: bodyRows, score });
    });

    // 兼容部分使用 div/ARIA grid 渲染的表格。
    document.querySelectorAll('[role="table"], [role="grid"]').forEach((grid) => {
      if (!isElementVisible(grid) || grid.querySelector('table')) return;
      const headerRow = Array.from(grid.querySelectorAll('[role="row"]')).find((row) => row.querySelector('[role="columnheader"]'));
      if (!headerRow) return;
      const headerCells = Array.from(headerRow.querySelectorAll('[role="columnheader"]'));
      const headers = headerCells.map(getCellText);
      const mapping = mapHeaders(headers);
      const rows = Array.from(grid.querySelectorAll('[role="row"]')).filter((row) => row !== headerRow && row.querySelector('[role="cell"], [role="gridcell"]') && isElementVisible(row));
      const score = candidateScore(mapping, rows.length);
      candidates.push({ kind: 'grid', node: grid, headers, mapping, rows, score });
    });

    return candidates.sort((a, b) => b.score - a.score);
  }

  function bestCandidate() {
    return collectTableCandidates()[0] || null;
  }

  function candidateSignature() {
    const candidate = bestCandidate();
    if (!candidate) return 'NO_TABLE';
    const text = normalizeText(candidate.node.innerText || candidate.node.textContent || '').slice(0, 5000);
    return `${candidate.kind}|${candidate.rows.length}|${text}`;
  }

  async function waitForTableChangeAndStable(previousSignature) {
    const started = Date.now();
    let last = '';
    let stableCount = 0;
    let changed = false;

    while (Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 220));
      const current = candidateSignature();
      if (current !== previousSignature && current !== 'NO_TABLE') changed = true;
      stableCount = current === last ? stableCount + 1 : 0;
      last = current;
      if (changed && stableCount >= 2) return;
      if (!changed && Date.now() - started > 1300 && stableCount >= 3) return;
    }
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitUntil(predicate, timeout = 2200, interval = 80) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        // 页面局部刷新时节点可能瞬间失效，继续等待下一轮。
      }
      await delay(interval);
    }
    return null;
  }

  function dispatchSyntheticClick(node) {
    if (!(node instanceof Element)) return false;
    const options = { bubbles: true, cancelable: true, view: window };
    try {
      node.dispatchEvent(new PointerEvent('pointerdown', options));
      node.dispatchEvent(new PointerEvent('pointerup', options));
    } catch (error) {
      // 旧版浏览器可能没有 PointerEvent，不影响后续鼠标事件。
    }
    node.dispatchEvent(new MouseEvent('mousedown', options));
    node.dispatchEvent(new MouseEvent('mouseup', options));
    node.click();
    return true;
  }

  function selectDisplayValue(root) {
    if (!(root instanceof Element)) return '';
    const input = root.querySelector('input, textarea');
    const inputValue = normalizeText(input?.value || '');
    if (inputValue) return inputValue;

    const selectedNode = root.querySelector(
      '.el-select__selected-item, .el-select__tags-text, .el-input__inner, [class*="selected"]'
    );
    const selectedText = normalizeText(selectedNode?.innerText || selectedNode?.textContent || '');
    if (selectedText) return selectedText;

    return normalizeText(root.innerText || root.textContent || '');
  }

  function visibleSelectRoots() {
    return Array.from(document.querySelectorAll('.el-select'))
      .filter((node) => isElementVisible(node) && !node.closest?.(`#${PAGE_ACTIONS_ID}`));
  }

  function sameVisualRow(rectA, rectB) {
    const overlap = Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top);
    const minHeight = Math.max(1, Math.min(rectA.height, rectB.height));
    const centerA = (rectA.top + rectA.bottom) / 2;
    const centerB = (rectB.top + rectB.bottom) / 2;
    return overlap >= minHeight * 0.55 || Math.abs(centerA - centerB) <= 9;
  }

  function findFilterByLabel(fieldLabel) {
    const roots = visibleSelectRoots();
    const fieldRoots = roots.filter((root) => selectDisplayValue(root) === fieldLabel);

    for (const fieldRoot of fieldRoots) {
      const fieldRect = fieldRoot.getBoundingClientRect();
      const rowRoots = roots
        .filter((root) => sameVisualRow(fieldRect, root.getBoundingClientRect()))
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

      const fieldIndex = rowRoots.indexOf(fieldRoot);
      if (fieldIndex < 0) continue;

      const rightSide = rowRoots.slice(fieldIndex + 1);
      const valueRoot = [...rightSide]
        .reverse()
        .find((root) => !['等于', '不等于', '包含', '不包含'].includes(selectDisplayValue(root)));

      if (valueRoot) return { fieldRoot, valueRoot, rowRoots };
    }

    return null;
  }

  function findOperationStatusFilter() {
    return findFilterByLabel('操作状态');
  }

  function findOperationPersonFilter() {
    return findFilterByLabel('操作人员');
  }

  const FILTER_JOIN_WORDS = new Set(['并且', '或者']);
  const FILTER_COMPARE_WORDS = new Set(['等于', '不等于', '包含', '不包含', '大于', '大于等于', '小于', '小于等于']);
  const EMPTY_SELECT_PLACEHOLDERS = new Set(['', '请选择', '选择或输入', '请输入', '全部', '不限']);

  function selectLooksEmpty(root) {
    const value = selectDisplayValue(root).replace(/\s+/g, '');
    return EMPTY_SELECT_PLACEHOLDERS.has(value);
  }

  function collectFilterRows() {
    const roots = visibleSelectRoots();
    const joins = roots
      .filter((root) => FILTER_JOIN_WORDS.has(selectDisplayValue(root)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const rows = [];
    const seenFields = new Set();

    for (const joinRoot of joins) {
      const joinRect = joinRoot.getBoundingClientRect();
      const rowRoots = roots
        .filter((root) => sameVisualRow(joinRect, root.getBoundingClientRect()))
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const joinIndex = rowRoots.indexOf(joinRoot);
      const fieldRoot = rowRoots.slice(joinIndex + 1).find((root) => {
        const value = selectDisplayValue(root);
        return value && !FILTER_JOIN_WORDS.has(value) && !FILTER_COMPARE_WORDS.has(value);
      });
      if (!fieldRoot || seenFields.has(fieldRoot)) continue;
      seenFields.add(fieldRoot);

      const fieldLabel = selectDisplayValue(fieldRoot);
      const fieldIndex = rowRoots.indexOf(fieldRoot);
      const rightRoots = rowRoots.slice(fieldIndex + 1);
      const comparatorRoot = rightRoots.find((root) => FILTER_COMPARE_WORDS.has(selectDisplayValue(root))) || null;
      const valueSelectRoot = [...rightRoots]
        .reverse()
        .find((root) => root !== comparatorRoot && !FILTER_COMPARE_WORDS.has(selectDisplayValue(root))) || null;

      rows.push({
        joinRoot,
        fieldRoot,
        fieldLabel,
        comparatorRoot,
        valueSelectRoot,
        rowRoots
      });
    }

    return rows;
  }

  function dispatchHover(node) {
    if (!(node instanceof Element)) return;
    for (const type of ['mouseenter', 'mouseover', 'mousemove']) {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function findClearControl(root) {
    if (!(root instanceof Element)) return null;
    const selectors = [
      '.el-range__close-icon',
      '.el-select__clear',
      '.el-input__clear',
      '.el-cascader__clear',
      '.el-icon-circle-close',
      '[class*="clear"]'
    ];
    const candidates = Array.from(root.querySelectorAll(selectors.join(',')));
    return candidates.find((node) => {
      if (!(node instanceof Element)) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    }) || candidates[0] || null;
  }

  function dateRangeHasValue(root) {
    if (!(root instanceof Element)) return false;
    return Array.from(root.querySelectorAll('input')).some((input) => normalizeText(input.value || ''));
  }

  async function clearDateRangeValue(dateRoot) {
    if (!(dateRoot instanceof Element) || !dateRangeHasValue(dateRoot)) return { ok: true, changed: false };

    dispatchHover(dateRoot);
    await delay(60);
    const clearControl = findClearControl(dateRoot);
    if (clearControl) {
      dispatchSyntheticClick(clearControl);
      const cleared = await waitUntil(() => !dateRangeHasValue(dateRoot), 1600, 70);
      if (cleared) return { ok: true, changed: true };
    }

    const inputs = Array.from(dateRoot.querySelectorAll('input'));
    for (const input of inputs) {
      input.focus();
      setNativeInputValue(input, '');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    await delay(120);
    return !dateRangeHasValue(dateRoot)
      ? { ok: true, changed: true }
      : { ok: false, message: '未能清除日期范围' };
  }

  async function clearSelectValue(selectRoot) {
    if (!(selectRoot instanceof Element) || selectLooksEmpty(selectRoot)) return { ok: true, changed: false };

    dispatchHover(selectRoot);
    await delay(60);
    const clearControl = findClearControl(selectRoot);
    if (clearControl) {
      dispatchSyntheticClick(clearControl);
      const cleared = await waitUntil(() => selectLooksEmpty(selectRoot), 1600, 70);
      if (cleared) return { ok: true, changed: true };
    }

    const input = selectRoot.querySelector('input');
    if (input) {
      input.focus();
      setNativeInputValue(input, '');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      await delay(100);
    }

    return selectLooksEmpty(selectRoot)
      ? { ok: true, changed: true }
      : { ok: false, message: `未能清除“${selectDisplayValue(selectRoot)}”` };
  }

  function visiblePlainInputsOnRow(fieldRoot, excludedRoots = []) {
    if (!(fieldRoot instanceof Element)) return [];
    const fieldRect = fieldRoot.getBoundingClientRect();
    return Array.from(document.querySelectorAll('input, textarea')).filter((input) => {
      if (!isElementVisible(input)) return false;
      if (!sameVisualRow(fieldRect, input.getBoundingClientRect())) return false;
      if (input.closest?.(`#${PAGE_ACTIONS_ID}`)) return false;
      if (excludedRoots.some((root) => root instanceof Element && root.contains(input))) return false;
      if (input.closest('.el-select, .el-date-editor, .el-range-editor, .el-picker-panel, .el-picker__popper')) return false;
      return true;
    });
  }

  async function clearOtherFilterValues(protectedLabels = new Set(['操作人员', '操作状态'])) {
    const rows = collectFilterRows();
    const failedLabels = [];
    let changedCount = 0;

    for (const row of rows) {
      if (protectedLabels.has(row.fieldLabel)) continue;
      if (!row.fieldRoot?.isConnected) continue;

      const dateRoot = findDateRangeRootForField(row.fieldRoot);
      if (dateRoot && dateRangeHasValue(dateRoot)) {
        const result = await clearDateRangeValue(dateRoot);
        if (!result.ok) failedLabels.push(row.fieldLabel || '日期范围');
        if (result.changed) changedCount += 1;
      }

      const latestRows = collectFilterRows();
      const latestRow = latestRows.find((item) => item.fieldLabel === row.fieldLabel) || row;
      const latestDateRoot = findDateRangeRootForField(latestRow.fieldRoot);
      const valueSelectRoot = latestRow.valueSelectRoot;
      if (valueSelectRoot && valueSelectRoot !== latestRow.fieldRoot && !selectLooksEmpty(valueSelectRoot)) {
        const result = await clearSelectValue(valueSelectRoot);
        if (!result.ok) failedLabels.push(row.fieldLabel || '筛选项');
        if (result.changed) changedCount += 1;
      }

      const excluded = [latestRow.fieldRoot, latestRow.comparatorRoot, valueSelectRoot, latestDateRoot].filter(Boolean);
      const plainInputs = visiblePlainInputsOnRow(latestRow.fieldRoot, excluded);
      for (const input of plainInputs) {
        if (!normalizeText(input.value || '')) continue;
        input.focus();
        setNativeInputValue(input, '');
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        changedCount += 1;
      }
      await delay(45);
    }

    if (failedLabels.length) {
      return {
        ok: false,
        message: `未能清除以下筛选项：${[...new Set(failedLabels)].join('、')}。请手动清空后重试。`
      };
    }

    return { ok: true, changedCount };
  }


  async function clearFiltersExceptOperatorAndTodayCompletion() {
    const rows = collectFilterRows();
    const failedLabels = [];
    let changedCount = 0;
    let keptTodayCompletion = false;

    for (const originalRow of rows) {
      if (!originalRow.fieldRoot?.isConnected) continue;

      let row = collectFilterRows().find((item) => item.fieldRoot === originalRow.fieldRoot)
        || collectFilterRows().find((item) => item.fieldLabel === originalRow.fieldLabel)
        || originalRow;

      if (row.fieldLabel === '操作人员') continue;

      const dateRoot = findDateRangeRootForField(row.fieldRoot);
      const shouldKeepTodayCompletion = row.fieldLabel === TODAY_COMPLETED_DATE_FILTER.field
        && dateRoot
        && dateRangeIsToday(dateRoot)
        && !keptTodayCompletion;

      if (shouldKeepTodayCompletion) {
        keptTodayCompletion = true;
        continue;
      }

      if (dateRoot && dateRangeHasValue(dateRoot)) {
        const result = await clearDateRangeValue(dateRoot);
        if (!result.ok) failedLabels.push(row.fieldLabel || '日期范围');
        if (result.changed) changedCount += 1;
      }

      row = collectFilterRows().find((item) => item.fieldLabel === row.fieldLabel) || row;
      const latestDateRoot = findDateRangeRootForField(row.fieldRoot);
      const valueSelectRoot = row.valueSelectRoot;
      if (valueSelectRoot && valueSelectRoot !== row.fieldRoot && !selectLooksEmpty(valueSelectRoot)) {
        const result = await clearSelectValue(valueSelectRoot);
        if (!result.ok) failedLabels.push(row.fieldLabel || '筛选项');
        if (result.changed) changedCount += 1;
      }

      const excluded = [row.fieldRoot, row.comparatorRoot, valueSelectRoot, latestDateRoot].filter(Boolean);
      const plainInputs = visiblePlainInputsOnRow(row.fieldRoot, excluded);
      for (const input of plainInputs) {
        if (!normalizeText(input.value || '')) continue;
        input.focus();
        setNativeInputValue(input, '');
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        changedCount += 1;
      }
      await delay(55);
    }

    if (failedLabels.length) {
      return {
        ok: false,
        message: `今日完成工单仅允许保留操作人员和完成时间（今天），但以下筛选项未能清除：${[...new Set(failedLabels)].join('、')}。请手动清空后重试。`
      };
    }

    return { ok: true, changedCount, keptTodayCompletion };
  }

  function collectVisibleSelectOptions() {
    const selectors = [
      '.el-select-dropdown__item',
      '[role="option"]',
      '.el-dropdown-menu__item'
    ];

    return Array.from(document.querySelectorAll(selectors.join(',')))
      .filter((node) => isElementVisible(node))
      .sort((a, b) => {
        const za = Number.parseInt(getComputedStyle(a.closest('.el-popper, .el-select-dropdown') || a).zIndex, 10) || 0;
        const zb = Number.parseInt(getComputedStyle(b.closest('.el-popper, .el-select-dropdown') || b).zIndex, 10) || 0;
        return zb - za;
      });
  }

  function findVisibleSelectOption(targetText) {
    return collectVisibleSelectOptions().find(
      (node) => normalizeText(node.innerText || node.textContent || '') === targetText
    ) || null;
  }

  function normalizeOperatorToken(value) {
    return normalizeText(value)
      .replace(/[—–－﹣]/g, '-')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function getOperatorTarget(savedName) {
    const original = normalizeText(savedName).replace(/\s+/g, '');
    const plainName = original.replace(/^(?:设计|运营|信息|优化|客服|支持|助理)[-—–－﹣_:：|/]+/i, '');
    return {
      original,
      plainName,
      preferredText: plainName ? `设计-${plainName}` : ''
    };
  }

  function operatorValueMatches(value, savedName) {
    const target = getOperatorTarget(savedName);
    if (!target.plainName) return true;
    const current = normalizeOperatorToken(value);
    const preferred = normalizeOperatorToken(target.preferredText);
    return current === preferred || (current.startsWith('设计-') && current.includes(normalizeOperatorToken(target.plainName)));
  }

  function findVisibleOperatorOption(savedName) {
    const target = getOperatorTarget(savedName);
    if (!target.plainName) return null;
    const nameToken = normalizeOperatorToken(target.plainName);
    const preferredToken = normalizeOperatorToken(target.preferredText);

    const ranked = collectVisibleSelectOptions()
      .map((node) => {
        const text = normalizeText(node.innerText || node.textContent || '');
        const token = normalizeOperatorToken(text);
        let rank = Number.POSITIVE_INFINITY;
        if (token === preferredToken) rank = 0;
        else if (token.startsWith('设计-') && token.includes(nameToken)) rank = 1;
        else if (token.endsWith(nameToken)) rank = 2;
        else if (token.includes(nameToken)) rank = 3;
        return { node, rank, text };
      })
      .filter((item) => Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank || a.text.length - b.text.length);

    return ranked[0]?.node || null;
  }

  function setNativeInputValue(input, value) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    try {
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch (error) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function chooseElementUiSelectValue(selectRoot, targetText, fieldName = '操作状态') {
    if (!(selectRoot instanceof Element)) {
      return { ok: false, message: `未找到“${fieldName}”的选项框。` };
    }

    if (selectDisplayValue(selectRoot) === targetText) return { ok: true, changed: false };

    const clickTarget = selectRoot.querySelector('.el-input, .el-select__wrapper, input') || selectRoot;
    dispatchSyntheticClick(clickTarget);

    const option = await waitUntil(() => findVisibleSelectOption(targetText), 2400, 70);
    if (!option) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, message: `未找到${fieldName}选项“${targetText}”，请确认网站下拉选项名称未变化。` };
    }

    dispatchSyntheticClick(option);
    const updated = await waitUntil(
      () => selectDisplayValue(selectRoot) === targetText,
      2200,
      80
    );

    if (!updated) {
      return { ok: false, message: `${fieldName}未能切换为“${targetText}”，请刷新页面后重试。` };
    }

    return { ok: true, changed: true };
  }

  function visibleDateRangeRoots() {
    const selectors = [
      '.el-date-editor',
      '.el-range-editor',
      '.el-date-editor--daterange',
      '.el-date-editor--datetimerange',
      '[class*="date-editor"]'
    ];
    const roots = [];
    const seen = new Set();
    for (const node of document.querySelectorAll(selectors.join(','))) {
      if (!(node instanceof Element) || seen.has(node) || !isElementVisible(node)) continue;
      if (node.closest('.el-picker-panel, .el-picker__popper, .el-date-range-picker')) continue;
      if (node.closest?.(`#${PAGE_ACTIONS_ID}`)) continue;
      seen.add(node);
      roots.push(node);
    }
    return roots;
  }

  function findDateRangeRootForField(fieldRoot) {
    if (!(fieldRoot instanceof Element)) return null;
    const fieldRect = fieldRoot.getBoundingClientRect();
    return visibleDateRangeRoots()
      .filter((root) => sameVisualRow(fieldRect, root.getBoundingClientRect()))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const ad = ar.left >= fieldRect.right ? ar.left - fieldRect.right : 10000 + Math.abs(ar.left - fieldRect.right);
        const bd = br.left >= fieldRect.right ? br.left - fieldRect.right : 10000 + Math.abs(br.left - fieldRect.right);
        return ad - bd;
      })[0] || null;
  }

  function findDateFieldRootByLabel(label) {
    return visibleSelectRoots()
      .filter((root) => selectDisplayValue(root) === label && findDateRangeRootForField(root))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function findCompletionDateFieldRoot() {
    // 工单页默认第二个日期筛选通常是“计划完成”；优先把该行改为“完成时间”。
    const planned = findDateFieldRootByLabel('计划完成');
    if (planned) return planned;

    const completed = findDateFieldRootByLabel(EXTRACT_DATE_FILTER.field);
    if (completed) return completed;

    // 兼容字段名称或默认筛选变化：从日期筛选行中取第二行（若只有一行则取该行），
    // 并选择日期框左侧最近的字段下拉框。
    const dateRoots = visibleDateRangeRoots()
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const dateRoot = dateRoots.length >= 2 ? dateRoots[1] : dateRoots[0];
    if (!dateRoot) return null;

    const dateRect = dateRoot.getBoundingClientRect();
    return visibleSelectRoots()
      .filter((root) => {
        const value = selectDisplayValue(root);
        const rect = root.getBoundingClientRect();
        return sameVisualRow(dateRect, rect) && rect.right <= dateRect.left + 8 && value !== '并且';
      })
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] || null;
  }

  function visibleDatePickerPanels() {
    const selectors = [
      '.el-picker-panel',
      '.el-date-range-picker',
      '.el-picker__popper',
      '.el-date-picker'
    ];
    const found = [];
    const seen = new Set();
    for (const node of document.querySelectorAll(selectors.join(','))) {
      if (!(node instanceof Element) || seen.has(node) || !isElementVisible(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 100) continue;
      seen.add(node);
      found.push(node);
    }
    return found.sort((a, b) => {
      const za = Number.parseInt(getComputedStyle(a).zIndex, 10) || 0;
      const zb = Number.parseInt(getComputedStyle(b).zIndex, 10) || 0;
      return zb - za;
    });
  }

  function findVisibleDateShortcut(shortcutText) {
    for (const panel of visibleDatePickerPanels()) {
      const exact = Array.from(panel.querySelectorAll(
        '.el-picker-panel__shortcut, button, [role="button"], li, a, span'
      )).filter((node) => isElementVisible(node) && normalizeText(node.innerText || node.textContent || '') === shortcutText);
      if (!exact.length) continue;
      const preferred = exact.find((node) => node.matches('.el-picker-panel__shortcut, button, [role="button"], a')) || exact[0];
      return preferred.closest('.el-picker-panel__shortcut, button, [role="button"], a, li') || preferred;
    }
    return null;
  }

  function localIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function currentMonthDateRange() {
    const today = new Date();
    return {
      start: localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: localIsoDate(today)
    };
  }

  function todayDateRange() {
    const today = localIsoDate(new Date());
    return { start: today, end: today };
  }

  function dateRangeDisplayValue(root) {
    if (!(root instanceof Element)) return '';
    const values = Array.from(root.querySelectorAll('input'))
      .map((input) => normalizeText(input.value || ''))
      .filter(Boolean);
    const text = normalizeText(root.innerText || root.textContent || '');
    return [...values, text].filter(Boolean).join(' - ');
  }

  function normalizedIsoDatesFromText(value) {
    return Array.from(String(value || '').matchAll(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/g))
      .map((match) => `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`);
  }

  function dateRangeIsCurrentMonth(root) {
    const expected = currentMonthDateRange();
    const dates = normalizedIsoDatesFromText(dateRangeDisplayValue(root));
    return dates.includes(expected.start) && dates.includes(expected.end);
  }

  function dateRangeIsToday(root) {
    const expected = todayDateRange();
    const dates = normalizedIsoDatesFromText(dateRangeDisplayValue(root));
    return dates.filter((value) => value === expected.start).length >= 2 ||
      (dates.length === 1 && dates[0] === expected.start);
  }

  function dateRangeMatchesShortcut(root, shortcutText) {
    if (shortcutText === '本月') return dateRangeIsCurrentMonth(root);
    if (shortcutText === '今天') return dateRangeIsToday(root);
    return false;
  }

  async function chooseDatePickerShortcut(dateRoot, shortcutText) {
    if (!(dateRoot instanceof Element)) {
      return { ok: false, message: '未找到“完成时间”右侧的日期范围。' };
    }

    if (dateRangeMatchesShortcut(dateRoot, shortcutText)) {
      return { ok: true, changed: false };
    }

    const before = dateRangeDisplayValue(dateRoot);
    const clickTarget = dateRoot.querySelector('.el-range-input, input, .el-input__inner') || dateRoot;
    dispatchSyntheticClick(clickTarget);

    const shortcut = await waitUntil(() => findVisibleDateShortcut(shortcutText), 2600, 70);
    if (!shortcut) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, message: `已设置完成时间，但未找到日期快捷选项“${shortcutText}”。` };
    }

    const panel = shortcut.closest('.el-picker-panel, .el-date-range-picker, .el-picker__popper, .el-date-picker');
    dispatchSyntheticClick(shortcut);

    const updated = await waitUntil(() => {
      const latestField = findDateFieldRootByLabel('完成时间');
      const latestRoot = findDateRangeRootForField(latestField) || dateRoot;
      if (dateRangeMatchesShortcut(latestRoot, shortcutText)) return latestRoot;
      const after = dateRangeDisplayValue(latestRoot);
      return after && after !== before && (!panel || !isElementVisible(panel)) ? latestRoot : null;
    }, 2800, 80);

    if (!updated) {
      return { ok: false, message: `日期范围未能设置为“${shortcutText}”，请刷新页面后重试。` };
    }

    return { ok: true, changed: true, dateRoot: updated };
  }

  async function ensureCompletedDateFilter(config) {
    const originalFieldRoot = findCompletionDateFieldRoot();
    if (!originalFieldRoot) {
      return { ok: false, message: `未找到日期筛选行，无法设置“${config.field}｜${config.shortcut}”。` };
    }

    const fieldResult = await chooseElementUiSelectValue(
      originalFieldRoot,
      config.field,
      '日期筛选字段'
    );
    if (!fieldResult.ok) return fieldResult;

    await delay(140);
    const latestFieldRoot = findDateFieldRootByLabel(config.field) || originalFieldRoot;
    const dateRoot = findDateRangeRootForField(latestFieldRoot);
    const dateResult = await chooseDatePickerShortcut(dateRoot, config.shortcut);
    if (!dateResult.ok) return dateResult;

    return {
      ok: true,
      fieldRoot: latestFieldRoot,
      field: config.field,
      range: config.shortcut
    };
  }

  function ensureCompletedThisMonthFilter() {
    return ensureCompletedDateFilter(EXTRACT_DATE_FILTER);
  }

  function ensureCompletedTodayFilter() {
    return ensureCompletedDateFilter(TODAY_COMPLETED_DATE_FILTER);
  }

  async function chooseElementUiOperatorValue(selectRoot, savedName) {
    const target = getOperatorTarget(savedName);
    if (!target.plainName) return { ok: true, changed: false, value: '' };
    if (!(selectRoot instanceof Element)) {
      return { ok: false, message: '未找到“操作人员”的选项框。' };
    }

    if (operatorValueMatches(selectDisplayValue(selectRoot), savedName)) {
      return { ok: true, changed: false, value: selectDisplayValue(selectRoot) };
    }

    const clickTarget = selectRoot.querySelector('.el-input, .el-select__wrapper, input') || selectRoot;
    dispatchSyntheticClick(clickTarget);

    // 优先匹配“设计-姓名”；如列表较长，则向可输入的下拉框写入姓名以筛选选项。
    let option = await waitUntil(() => findVisibleOperatorOption(savedName), 700, 60);
    if (!option) {
      const input = selectRoot.querySelector('input');
      if (input) {
        input.focus();
        setNativeInputValue(input, target.plainName);
        option = await waitUntil(() => findVisibleOperatorOption(savedName), 1800, 70);
      }
    }

    // 兼容虚拟滚动或不可搜索的人员下拉列表，逐屏查找包含姓名的选项。
    if (!option) {
      const scrollRoot = Array.from(document.querySelectorAll(
        '.el-select-dropdown .el-scrollbar__wrap, .el-select-dropdown__wrap, .el-select-dropdown .el-scrollbar__view'
      )).find((node) => isElementVisible(node) && node.scrollHeight > node.clientHeight + 4);
      if (scrollRoot) {
        scrollRoot.scrollTop = 0;
        for (let index = 0; index < 35 && !option; index += 1) {
          await delay(65);
          option = findVisibleOperatorOption(savedName);
          if (option) break;
          const previous = scrollRoot.scrollTop;
          scrollRoot.scrollTop = Math.min(
            scrollRoot.scrollHeight,
            previous + Math.max(80, scrollRoot.clientHeight * 0.75)
          );
          if (scrollRoot.scrollTop === previous) break;
        }
      }
    }

    if (!option) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        ok: false,
        message: `未找到包含“${target.plainName}”的操作人员选项，请确认插件面板中保存的姓名与网站选项一致。`
      };
    }

    const selectedText = normalizeText(option.innerText || option.textContent || '');
    dispatchSyntheticClick(option);
    const updated = await waitUntil(() => {
      const latestRoot = findOperationPersonFilter()?.valueRoot;
      return operatorValueMatches(selectDisplayValue(latestRoot || selectRoot), savedName);
    }, 2400, 80);

    if (!updated) {
      return {
        ok: false,
        message: `操作人员未能切换为“${selectedText || target.preferredText}”，请刷新页面后重试。`
      };
    }

    return { ok: true, changed: true, value: selectedText || target.preferredText };
  }

  async function getSavedOperatorName(forceRefresh = false) {
    if (!forceRefresh && cachedOperatorName !== null) return cachedOperatorName;
    try {
      if (!chrome?.storage?.local) return cachedOperatorName || '';
      const stored = await chrome.storage.local.get(OPERATOR_STORAGE_KEY);
      cachedOperatorName = normalizeText(stored?.[OPERATOR_STORAGE_KEY] || '').replace(/\s+/g, '');
      return cachedOperatorName;
    } catch (error) {
      return cachedOperatorName || '';
    }
  }

  function normalizeOperatorOverride(value) {
    return normalizeText(value || '').replace(/\s+/g, '');
  }

  function compactControlText(node) {
    if (!(node instanceof Element)) return '';
    const value = node instanceof HTMLInputElement ? node.value : '';
    return normalizeText(value || node.innerText || node.textContent || '').replace(/\s+/g, '');
  }

  function promoteToClickableControl(node) {
    if (!(node instanceof Element)) return null;
    const selector = [
      'button',
      '[role="button"]',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '.el-button',
      '[class*="btn"]',
      '[onclick]'
    ].join(',');
    const control = node.matches(selector) ? node : node.closest(selector);
    if (control && isElementVisible(control)) return control;
    if (isElementVisible(node) && getComputedStyle(node).cursor === 'pointer') return node;
    return null;
  }

  function collectQueryControls(scope) {
    if (!(scope instanceof Document || scope instanceof Element)) return [];
    const found = new Set();
    const directSelectors = [
      'button',
      '[role="button"]',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '.el-button',
      '[class*="btn"]',
      '[onclick]'
    ].join(',');

    Array.from(scope.querySelectorAll(directSelectors)).forEach((node) => {
      if (compactControlText(node) === '查询' && isElementVisible(node)) found.add(node);
    });

    // 有些 Element UI 页面把文字放在 span 内，外层并不使用标准 button 标签。
    Array.from(scope.querySelectorAll('span, strong, em')).forEach((node) => {
      if (compactControlText(node) !== '查询' || !isElementVisible(node)) return;
      const control = promoteToClickableControl(node);
      if (control) found.add(control);
    });

    return Array.from(found).filter((node) => !node.closest?.(`#${PAGE_ACTIONS_ID}`));
  }

  function findQueryButtonNear(fieldRoot) {
    // 选择下拉项后，Element UI 可能重建整行 DOM；优先重新获取最新的“操作状态”节点。
    const latestFieldRoot = findOperationStatusFilter()?.fieldRoot;
    const anchor = latestFieldRoot || (fieldRoot?.isConnected ? fieldRoot : null);

    if (anchor) {
      let ancestor = anchor;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        const controls = collectQueryControls(ancestor);
        if (controls.length) {
          const anchorRect = anchor.getBoundingClientRect();
          return controls.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const ad = Math.abs((ar.top + ar.bottom) / 2 - (anchorRect.top + anchorRect.bottom) / 2)
              + Math.abs(ar.left - anchorRect.right) * 0.35;
            const bd = Math.abs((br.top + br.bottom) / 2 - (anchorRect.top + anchorRect.bottom) / 2)
              + Math.abs(br.left - anchorRect.right) * 0.35;
            return ad - bd;
          })[0];
        }
        ancestor = ancestor.parentElement;
      }
    }

    const candidates = collectQueryControls(document);
    if (!candidates.length) return null;
    if (!anchor) return candidates[0];

    const fieldRect = anchor.getBoundingClientRect();
    return candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const ad = Math.abs((ar.top + ar.bottom) / 2 - (fieldRect.top + fieldRect.bottom) / 2)
        + Math.abs(ar.left - fieldRect.right) * 0.35;
      const bd = Math.abs((br.top + br.bottom) / 2 - (fieldRect.top + fieldRect.bottom) / 2)
        + Math.abs(br.left - fieldRect.right) * 0.35;
      return ad - bd;
    })[0] || null;
  }

  async function applyActionFiltersAndQuery(targetStatus, options = {}) {
    // 插件面板调用时可直接把已保存姓名传进来；页面按钮则从 storage 读取。
    // 这样即使页面内容脚本刚刚重新注入，也不会因为读取延迟而漏填操作人员。
    const overrideName = normalizeOperatorOverride(options.operatorName);
    const savedOperatorName = overrideName || await getSavedOperatorName(Boolean(options.forceOperatorRefresh));
    let anchorFieldRoot = null;
    let selectedOperator = '';

    if (options.clearOtherFilters) {
      const protectedLabels = new Set(
        Array.isArray(options.protectedFilterLabels)
          ? options.protectedFilterLabels
          : ['操作人员', '操作状态']
      );
      const clearResult = await clearOtherFilterValues(protectedLabels);
      if (!clearResult.ok) return clearResult;
      await delay(180);
    }

    // 先设置操作状态和日期。网站在切换这些筛选项时可能重建整块筛选表单，
    // 如果先填操作人员，重建后会被清空，所以操作人员改为最后设置。
    if (targetStatus) {
      const statusFilter = findOperationStatusFilter();
      if (!statusFilter) {
        return {
          ok: false,
          message: '未找到筛选区中的“操作状态”。请确认当前位于工单管理页并已显示筛选条件。'
        };
      }

      const statusResult = await chooseElementUiSelectValue(statusFilter.valueRoot, targetStatus, '操作状态');
      if (!statusResult.ok) return statusResult;
      anchorFieldRoot = statusFilter.fieldRoot;
      await delay(150);
    }

    if (options.completedThisMonth) {
      const dateResult = await ensureCompletedThisMonthFilter();
      if (!dateResult.ok) return dateResult;
      anchorFieldRoot = dateResult.fieldRoot || anchorFieldRoot;
      await delay(160);
    }

    if (options.completedToday) {
      const dateResult = await ensureCompletedTodayFilter();
      if (!dateResult.ok) return dateResult;
      anchorFieldRoot = dateResult.fieldRoot || anchorFieldRoot;
      await delay(160);
    }

    if (savedOperatorName) {
      let operatorFilter = await waitUntil(() => findOperationPersonFilter(), 2800, 80);
      if (!operatorFilter) {
        return {
          ok: false,
          message: `已保存操作人员“${savedOperatorName}”，但未找到筛选区中的“操作人员”。请确认当前位于工单管理页。`
        };
      }

      let operatorResult = await chooseElementUiOperatorValue(operatorFilter.valueRoot, savedOperatorName);
      if (!operatorResult.ok) return operatorResult;
      selectedOperator = operatorResult.value || selectDisplayValue(findOperationPersonFilter()?.valueRoot || operatorFilter.valueRoot);
      anchorFieldRoot = operatorFilter.fieldRoot || anchorFieldRoot;
      await delay(180);

      // 再次核验，防止 Element UI 在收起下拉或日期组件更新后把操作人员重置。
      const verified = await waitUntil(() => {
        const latest = findOperationPersonFilter();
        return latest && operatorValueMatches(selectDisplayValue(latest.valueRoot), savedOperatorName);
      }, 1500, 80);

      if (!verified) {
        operatorFilter = findOperationPersonFilter();
        if (!operatorFilter) {
          return { ok: false, message: '筛选区刷新后未找到“操作人员”，请重新点击一次。' };
        }
        operatorResult = await chooseElementUiOperatorValue(operatorFilter.valueRoot, savedOperatorName);
        if (!operatorResult.ok) return operatorResult;
        selectedOperator = operatorResult.value || selectDisplayValue(operatorFilter.valueRoot);
        anchorFieldRoot = operatorFilter.fieldRoot || anchorFieldRoot;
        await delay(160);
      }
    }

    if (options.strictTodayCompletedOnly) {
      const strictClearResult = await clearFiltersExceptOperatorAndTodayCompletion();
      if (!strictClearResult.ok) return strictClearResult;
      await delay(180);

      // 严格清理后再次核验两个唯一保留条件，防止 Element UI 重绘导致日期或人员丢失。
      let completionFieldRoot = findDateFieldRootByLabel(TODAY_COMPLETED_DATE_FILTER.field);
      let completionDateRoot = completionFieldRoot ? findDateRangeRootForField(completionFieldRoot) : null;
      if (!completionFieldRoot || !completionDateRoot || !dateRangeIsToday(completionDateRoot)) {
        const dateResult = await ensureCompletedTodayFilter();
        if (!dateResult.ok) return dateResult;
        anchorFieldRoot = dateResult.fieldRoot || anchorFieldRoot;
        await delay(150);
      }

      if (savedOperatorName) {
        const operatorFilter = await waitUntil(() => findOperationPersonFilter(), 2200, 80);
        if (!operatorFilter) {
          return { ok: false, message: '严格清理筛选后未找到“操作人员”，请重新点击一次。' };
        }
        if (!operatorValueMatches(selectDisplayValue(operatorFilter.valueRoot), savedOperatorName)) {
          const operatorResult = await chooseElementUiOperatorValue(operatorFilter.valueRoot, savedOperatorName);
          if (!operatorResult.ok) return operatorResult;
          selectedOperator = operatorResult.value || selectDisplayValue(operatorFilter.valueRoot);
        }
        anchorFieldRoot = operatorFilter.fieldRoot || anchorFieldRoot;
      }
    }

    // 操作人员、可选操作状态及日期条件都检查完成后，只点击一次网站原生“查询”按钮。
    await delay(160);
    const queryButton = await waitUntil(
      () => findQueryButtonNear(anchorFieldRoot),
      3200,
      80
    );
    if (!queryButton) {
      return { ok: false, message: '已设置筛选条件，但未找到“查询”按钮。' };
    }

    const previousSignature = candidateSignature();
    queryButton.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    dispatchSyntheticClick(queryButton);
    await waitForTableChangeAndStable(previousSignature);
    return { ok: true, status: targetStatus, operator: selectedOperator || savedOperatorName };
  }

  function stripLabel(value, labels) {
    let text = normalizeText(value);
    for (const label of labels) {
      text = text.replace(new RegExp(`^${escapeRegExp(label)}\\s*[：:]?\\s*`, 'i'), '');
    }
    return normalizeText(text);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanPerson(value, labels) {
    let text = stripLabel(value, labels);
    text = text
      .replace(/^[-—–_:：|/]\s*/, '')
      .replace(/^(?:(?:运营|设计|信息|优化|客服|操作|执行|人员|负责人|专员)\s*[-—–_:：|/]\s*)+/i, '')
      .replace(/(?:手机号|手机|电话|工号|账号)\s*[：:]?\s*[\w+\-]{4,}.*/i, '')
      .replace(/[（(]\s*(?:运营|设计|信息|优化|操作|执行|人员|负责人|专员)\s*[）)]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  }

  function cleanCompany(value) {
    let text = stripLabel(value, FIELD_DEFS.company);
    text = text
      .replace(/(?:联系人|联系电话|手机号|手机|电话)\s*[：:].*$/i, '')
      .replace(/\s+/g, '')
      .trim();
    return text;
  }

  function formatDate(value) {
    const text = stripLabel(value, FIELD_DEFS.completedAt);
    let match = text.match(/(?:\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
    if (!match) match = text.match(/(?:^|\D)(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
    if (match) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${month}月${day}日`;
    }
    return normalizeText(text.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?.*$/, ''));
  }

  // 用原始“完成时间”字段生成排序值，避免格式化成“7月16日”后丢失年份和时分秒。
  // 有效日期按从早到晚排列；无法识别或为空的日期放到最后，并保持原页面顺序。
  function completionSortValue(value) {
    const text = stripLabel(value, FIELD_DEFS.completedAt);
    if (!text) return Number.POSITIVE_INFINITY;

    let match = text.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?(?:[ T\s]+(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?)?/);
    let year;
    let month;
    let day;
    let hour = 0;
    let minute = 0;
    let second = 0;

    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      hour = Number(match[4] || 0);
      minute = Number(match[5] || 0);
      second = Number(match[6] || 0);
    } else {
      match = text.match(/(?:^|\D)(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?(?:[ T\s]+(\d{1,2})[:：](\d{1,2})(?:[:：](\d{1,2}))?)?/);
      if (!match) return Number.POSITIVE_INFINITY;
      year = new Date().getFullYear();
      month = Number(match[1]);
      day = Number(match[2]);
      hour = Number(match[3] || 0);
      minute = Number(match[4] || 0);
      second = Number(match[5] || 0);
    }

    if (
      year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59
    ) return Number.POSITIVE_INFINITY;

    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (
      date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second
    ) return Number.POSITIVE_INFINITY;

    return date.getTime();
  }

  function isEmptyService(value) {
    return EMPTY_MARKERS.has(normalizeText(value).toLowerCase());
  }

  function shortenService(designValue, infoValue) {
    let text = !isEmptyService(designValue) ? designValue : infoValue;
    text = normalizeText(text)
      .replace(/^(?:设计服务|信息服务|服务内容|服务项目)\s*[：:]?\s*/i, '')
      .replace(/\s+/g, ' ')
      // 兼容工单中把“模板”误写成“模版”的情况。
      .replace(/模版/g, '模板')
      .trim();
    if (isEmptyService(text)) return '';
    for (const [rule, output] of SERVICE_RULES) {
      if (rule.test(text)) return output;
    }
    const rawFirstPart = text.split(/[、，,;；|/／]+/)[0].trim();
    // 未被规则命中的普通“主图设计”保留原称，不能误简写为“主图”。
    const firstPart = /主图/i.test(rawFirstPart)
      ? rawFirstPart
      : rawFirstPart.replace(/(?:设计|制作|服务|优化|项目|内容)$/g, '').trim();
    return Array.from(firstPart).slice(0, 6).join('');
  }


  function parseOrderQuantity(value) {
    const text = stripLabel(value, FIELD_DEFS.orderQuantity);
    const match = normalizeText(text).match(/-?\d+(?:\.\d+)?/);
    if (!match) return 1;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) return 1;
    return Math.max(0, number);
  }

  function cleanServiceText(value) {
    return normalizeText(value)
      // 网页富文本可能夹带肉眼不可见的零宽/方向控制符，导致“模板”被识别成不同类别。
      .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
      .replace(/^(?:设计服务|信息服务|服务内容|服务项目)\s*[：:]?\s*/i, '')
      .replace(/(?:\.{3}|…+)$/g, '')
      .trim();
  }

  // 这两个名称是同一种模板服务。必须在按“/”拆分服务前统一，
  // 否则“模板/主图设计”会被拆成两个片段，导致汇总结果出现重复的“模板”。
  function normalizeServiceAliases(value) {
    return cleanServiceText(value)
      .replace(/模版/g, '模板')
      .replace(/模板\s*[\/／]\s*主图\s*(?:设计)?/gi, '模板')
      .replace(/模板\s*设计/gi, '模板');
  }

  function serviceCategories(designValue, infoValue) {
    const categories = new Set();
    const sourceValues = [designValue, infoValue]
      .map(normalizeServiceAliases)
      .filter((value) => !isEmptyService(value));
    const rowHasTemplate = sourceValues.some((value) => /模板/i.test(value));

    for (const source of sourceValues) {
      const parts = source.split(/[、，,;；|/／＋+＆&]+/).map(normalizeText).filter(Boolean);
      const targets = parts.length ? parts : [source];

      for (const target of targets) {
        // 模板与普通“主图设计”可能分列，或因分隔符/省略号被拆开；
        // 在同一工单行里出现模板时，将普通主图设计并入模板，避免多出“主图设计1”。
        if (rowHasTemplate && /^主图\s*(?:设计)?$/i.test(target)) {
          categories.add('模板');
          continue;
        }

        let matched = false;
        const isSimpleMainImage = /简易\s*主图/i.test(target);
        const isBlockService = /板块|版块|模块/i.test(target);
        const isDetailReplacement = /详情(?:页|页面)?\s*(?:替换|换图|更换)|(?:替换|换图|更换)\s*详情(?:页|页面)?/i.test(target);
        for (const [label, rule] of SERVICE_STAT_RULES) {
          // “简易主图”单独统计，不能再被通用“主图”规则重复命中。
          if (label === '主图' && isSimpleMainImage) continue;
          // “详情替换 / 详情页换图”等只统计为“替换”，不重复统计“详情”。
          if (label === '详情' && isDetailReplacement) continue;
          // “版块新加 / 板块新增 / 新增模块”等属于板块服务，避免同时多统计一个“新增”。
          if (label === '新增' && isBlockService) continue;
          if (rule.test(target)) {
            categories.add(label);
            matched = true;
          }
        }

        // 未命中常用类型时保留一个简写，避免遗漏新的服务名称。
        if (!matched) {
          const fallback = shortenService(target, '');
          if (fallback && !isEmptyService(fallback)) categories.add(fallback);
        }
      }
    }

    return [...categories];
  }

  function formatStatNumber(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function valueAt(cells, mapping, field) {
    const index = mapping[field];
    return index == null ? '' : getCellText(cells[index]);
  }

  function extractRows() {
    const candidate = bestCandidate();
    if (!candidate) {
      return { ok: false, message: '未找到页面表格。请确认筛选结果已显示后再试。' };
    }

    const mapping = candidate.mapping;
    const missing = ['operator', 'company', 'executor', 'completedAt'].filter((field) => mapping[field] == null);
    if (missing.length) {
      return {
        ok: false,
        message: `未识别完整字段。当前表头：${candidate.headers.filter(Boolean).join('｜') || '无'}`
      };
    }

    const rowItems = [];
    for (const row of candidate.rows) {
      if (!isElementVisible(row)) continue;
      const cells = candidate.kind === 'table' || candidate.kind === 'element-ui'
        ? getDirectCells(row, 'td,th')
        : Array.from(row.querySelectorAll(':scope > [role="cell"], :scope > [role="gridcell"]'));
      if (!cells.length) continue;

      const operator = cleanPerson(valueAt(cells, mapping, 'operator'), FIELD_DEFS.operator);
      const company = cleanCompany(valueAt(cells, mapping, 'company'));
      // 内部占位客户不进入“待确认工单”表格；仅影响待确认表格，不影响待处理服务统计。
      if (company.replace(/[－—–]/g, '-').replace(/\s+/g, '') === '超级工厂（视觉设计）-1') continue;
      const executor = cleanPerson(valueAt(cells, mapping, 'executor'), FIELD_DEFS.executor);
      const completedAtRaw = valueAt(cells, mapping, 'completedAt');
      const completedAt = formatDate(completedAtRaw);
      const designService = valueAt(cells, mapping, 'designService');
      const infoService = valueAt(cells, mapping, 'infoService');
      const service = shortenService(designService, infoService);

      if (![operator, company, executor, completedAt, service].some(Boolean)) continue;
      rowItems.push({
        cells: [operator, company, executor, completedAt, service, '待确认'],
        completedAtSort: completionSortValue(completedAtRaw),
        originalIndex: rowItems.length
      });
    }

    if (!rowItems.length) {
      return { ok: false, message: `已识别工单表头，但未读取到数据行。请刷新页面后重试。表头：${candidate.headers.filter(Boolean).join('｜')}` };
    }

    // 按完成时间从早到晚排序；同一完成时间保持网站原有顺序。
    rowItems.sort((a, b) => {
      if (a.completedAtSort === b.completedAtSort) return a.originalIndex - b.originalIndex;
      return a.completedAtSort - b.completedAtSort;
    });

    return { ok: true, rows: rowItems.map((item) => item.cells), candidate };
  }

  function extractServiceStats({ completedQuantity = false } = {}) {
    const candidate = bestCandidate();
    if (!candidate) {
      return { ok: false, message: '未找到页面表格。请确认筛选结果已显示后再试。' };
    }

    const mapping = candidate.mapping;
    if (mapping.designService == null && mapping.infoService == null) {
      return {
        ok: false,
        message: `未识别“设计服务/信息服务”字段。当前表头：${candidate.headers.filter(Boolean).join('｜') || '无'}`
      };
    }
    const quantityField = completedQuantity ? 'dealResult' : 'orderQuantity';
    if (mapping[quantityField] == null) {
      return {
        ok: false,
        message: `未识别“${completedQuantity ? '处理结果' : '下单数量'}”字段。当前表头：${candidate.headers.filter(Boolean).join('｜') || '无'}`
      };
    }

    const totals = new Map();
    let dataRowCount = 0;

    for (const row of candidate.rows) {
      if (!isElementVisible(row)) continue;
      const cells = candidate.kind === 'table' || candidate.kind === 'element-ui'
        ? getDirectCells(row, 'td,th')
        : Array.from(row.querySelectorAll(':scope > [role="cell"], :scope > [role="gridcell"]'));
      if (!cells.length) continue;

      const designService = valueAt(cells, mapping, 'designService');
      const infoService = valueAt(cells, mapping, 'infoService');
      const rawQuantity = valueAt(cells, mapping, quantityField);
      const quantity = completedQuantity
        ? Math.max(0, Number(normalizeText(rawQuantity).replace(/,/g, '')) || 0)
        : parseOrderQuantity(rawQuantity);
      const categories = serviceCategories(designService, infoService);
      if (!categories.length || quantity <= 0) continue;

      dataRowCount += 1;
      for (const category of categories) {
        totals.set(category, (totals.get(category) || 0) + quantity);
      }
    }

    if (!totals.size) {
      return { ok: false, message: '已找到表格，但没有识别到可统计的服务内容。' };
    }

    const orderedLabels = [
      ...SERVICE_STAT_ORDER.filter((label) => totals.has(label)),
      ...[...totals.keys()].filter((label) => !SERVICE_STAT_ORDER.includes(label))
    ];
    const text = orderedLabels.map((label) => `${label}${formatStatNumber(totals.get(label))}`).join('');

    return {
      ok: true,
      text,
      totals: Object.fromEntries(orderedLabels.map((label) => [label, totals.get(label)])),
      rowCount: dataRowCount,
      candidate
    };
  }

  async function runStatsMultiStatusAction(actionOptions = {}) {
    const filtered = await showCombinedWorkOrders(actionOptions);
    if (!filtered.ok) return filtered;

    if (!filtered.rowCount) {
      const message = '未查到等待处理的工单';
      showToast(message);
      return { ...filtered, statsMessage: message };
    }
    const stats = await extractStatsAndCopy();
    return { ...filtered, text: stats.text, copied: stats.copied, statsMessage: stats.message };
  }

  function sendWorkorderRequest(message) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('工单查询超时，请确认网站原生查询可用后重试；若刚更新插件，请先刷新工单页')),25000);
      chrome.runtime.sendMessage(message).then(result=>{clearTimeout(timer);resolve(result);},error=>{clearTimeout(timer);reject(error);});
    });
  }

  async function showCombinedWorkOrders(actionOptions = {}) {
    const savedName = normalizeOperatorOverride(actionOptions.operatorName)
      || await getSavedOperatorName(Boolean(actionOptions.forceOperatorRefresh));
    const result = await sendWorkorderRequest({
      type: 'ETHAN_NATIVE_COMBINED_ROWS',
      action: 'query',
      operator: getOperatorTarget(savedName).preferredText
    });
    if (!result?.ok) {
      const message = result?.message || '联合查询失败';
      if (!actionOptions.silent) showError(message);
      return { ok: false, message };
    }
    return { ...result, shown: 'native-list' };
  }

  function ensureUI() {
    if (uiHost?.isConnected) return;
    uiHost = document.createElement('div');
    uiHost.id = 'ethan-workorder-exporter-root';
    uiHost.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;width:0;height:0;';
    shadow = uiHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}
        .mask{position:fixed;inset:0;background:rgba(0,0,0,.38);display:none;align-items:center;justify-content:center;padding:24px}
        .mask.show{display:flex}
        .panel{width:min(920px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 20px 70px rgba(0,0,0,.3);font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#222}
        .head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;background:#fff;border-bottom:1px solid #eee}
        .title{font-size:18px;font-weight:800}
        .close{border:0;background:#f2f2f2;border-radius:8px;width:34px;height:34px;font-size:20px;cursor:pointer}
        .body{padding:18px;overflow:auto}
        .row-warning{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;border:1px solid #f0c36d;border-radius:8px;background:#fff4d6;color:#7a4d00;font-size:13px;font-weight:800;line-height:1.5}
        .row-warning::before{content:'!';display:grid;place-items:center;flex:0 0 20px;width:20px;height:20px;border-radius:50%;background:#f2b705;color:#fff;font-size:13px;font-weight:900}
        .color-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 14px;padding:10px 12px;border:1px solid #ebeef5;border-radius:8px;background:#fafafa}
        .color-label{margin-right:2px;font-size:13px;font-weight:700;color:#555}
        .color-swatch{position:relative;width:30px;height:30px;padding:0;border:1px solid rgba(0,0,0,.24);border-radius:7px;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);transition:transform .15s,box-shadow .15s,border-color .15s}
        .color-swatch:hover{transform:translateY(-1px);box-shadow:0 3px 9px rgba(0,0,0,.14),inset 0 0 0 1px rgba(255,255,255,.6)}
        .color-swatch.active{border-color:#303133;box-shadow:0 0 0 2px #fff,0 0 0 4px #606266}
        .color-swatch.active::after{content:'✓';position:absolute;inset:0;display:grid;place-items:center;font-size:16px;font-weight:900;color:#303133;text-shadow:0 1px 0 rgba(255,255,255,.85)}
        table{border-collapse:collapse;table-layout:fixed;margin:0 auto;font-size:16px;color:#111;background:var(--table-bg,#fff2cc)}
        td{border:1px solid #111;background:var(--table-bg,#fff2cc);padding:8px 10px;text-align:center;vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:40px;outline:none}
        td:focus{box-shadow:inset 0 0 0 2px #606266;background:var(--table-focus-bg,#fff7d8)}
        .actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;padding:14px 18px;background:#fff;border-top:1px solid #eee}
        .btn{border:0;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer}
        .primary{background:#f2b705;color:#211900}.secondary{background:#f1f1f1;color:#333}
        .toast{position:fixed;left:50%;top:38px;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:8px;font:14px "Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);display:none}
        .toast.show{display:block}
      </style>
      <div class="mask" id="mask" role="dialog" aria-modal="true" aria-label="待确认工单表格预览">
        <div class="panel">
          <div class="head">
            <div class="title">待确认工单表格</div>
            <button class="close" id="close" aria-label="关闭">×</button>
          </div>
          <div class="body">
            <div class="row-warning" id="rowHint">请先删除旧的表格行，在粘贴位置插入相同数量的空白行，再粘贴表格，避免覆盖下方已有内容。</div>
            <div class="color-toolbar" id="colorToolbar" aria-label="表格背景颜色">
              <span class="color-label">表格背景</span>
              ${TABLE_COLOR_OPTIONS.map((option, index) => `<button type="button" class="color-swatch${index === 0 ? ' active' : ''}" data-color-index="${index}" title="${option.name}" aria-label="${option.name}" style="background:${option.bg}"></button>`).join('')}
            </div>
            <div id="tableWrap"></div>
          </div>
          <div class="actions"><button class="btn secondary" id="cancel">关闭</button><button class="btn primary" id="copy">复制到表格</button></div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
    `;
    document.documentElement.appendChild(uiHost);

    shadow.getElementById('close').addEventListener('click', hideModal);
    shadow.getElementById('cancel').addEventListener('click', hideModal);
    shadow.getElementById('mask').addEventListener('click', (event) => {
      if (event.target.id === 'mask') hideModal();
    });
    shadow.getElementById('copy').addEventListener('click', copyPreview);
    shadow.getElementById('colorToolbar').addEventListener('click', (event) => {
      const button = event.target.closest('.color-swatch');
      if (!button) return;
      const index = Number.parseInt(button.dataset.colorIndex, 10);
      const option = TABLE_COLOR_OPTIONS[index];
      if (!option) return;
      setTableBackground(option);
    });
    applySelectedTableBackground();
  }

  function applySelectedTableBackground() {
    if (!shadow) return;
    const panel = shadow.querySelector('.panel');
    panel?.style.setProperty('--table-bg', selectedTableColor.bg);
    panel?.style.setProperty('--table-focus-bg', selectedTableColor.focus);
    shadow.querySelectorAll('.color-swatch').forEach((button) => {
      const index = Number.parseInt(button.dataset.colorIndex, 10);
      button.classList.toggle('active', TABLE_COLOR_OPTIONS[index]?.bg === selectedTableColor.bg);
      button.setAttribute('aria-pressed', TABLE_COLOR_OPTIONS[index]?.bg === selectedTableColor.bg ? 'true' : 'false');
    });
  }

  function setTableBackground(option) {
    selectedTableColor = option;
    applySelectedTableBackground();
    showToast(`表格背景已切换为${option.name}`);
  }

  function hideModal() {
    shadow?.getElementById('mask')?.classList.remove('show');
  }

  function showToast(message, duration = 2200) {
    ensureUI();
    const toast = shadow.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => toast.classList.remove('show'), duration);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderRows(rows) {
    ensureUI();
    currentRows = rows.map((row) => [...row]);
    const colCount = rows[0]?.length || 0;
    const colgroup = Array.from({ length: colCount }, (_, i) => `<col style="width:${currentColumnWidths[i] ?? 100}px">`).join('');
    const body = rows.map((row, rowIndex) => {
      const isHeader = currentHasHeader && rowIndex === 0;
      const cells = row.map((cell, colIndex) => {
        if (isHeader) {
          return `<th contenteditable="false" spellcheck="false" data-row="${rowIndex}" data-col="${colIndex}" title="${escapeHtml(cell)}" style="border:1px solid #111;background:#f1efe8;padding:8px 10px;text-align:center;vertical-align:middle;font-weight:500;">${escapeHtml(cell)}</th>`;
        }
        return `<td contenteditable="true" spellcheck="false" data-row="${rowIndex}" data-col="${colIndex}" title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    shadow.getElementById('tableWrap').innerHTML = `<table><colgroup>${colgroup}</colgroup><tbody>${body}</tbody></table>`;
    applySelectedTableBackground();
    const titleNode = shadow.querySelector('.title');
    if (titleNode) titleNode.textContent = currentModalTitle;
    if (currentHasHeader) {
      const dataCount = Math.max(rows.length - 1, 0);
      shadow.getElementById('rowHint').textContent = `共 ${dataCount} 项服务，已自动复制表格，可直接粘贴到 Excel。`;
    } else {
      shadow.getElementById('rowHint').textContent = `共提取${rows.length}行，请先删除旧的表格行，在粘贴位置插入 ${rows.length} 个空白行，再粘贴表格，避免覆盖下方已有内容。`;
    }
    shadow.getElementById('mask').classList.add('show');
  }

  function showError(message) {
    ensureUI();
    showToast(message);
  }

  function extractAndShow() {
    const result = extractRows();
    if (!result.ok) {
      showError(result.message);
      return result;
    }
    currentColumnWidths = COLUMN_WIDTHS;
    currentModalTitle = '待确认工单表格';
    currentHasHeader = false;
    renderRows(result.rows);
    return result;
  }

  async function runExtractAction(actionOptions = {}) {
    const savedName = normalizeOperatorOverride(actionOptions.operatorName)
      || await getSavedOperatorName(Boolean(actionOptions.forceOperatorRefresh));
    const prepared = await sendWorkorderRequest({
      type: 'ETHAN_NATIVE_COMBINED_ROWS',
      action: 'month',
      operator: getOperatorTarget(savedName).preferredText
    });
    if (!prepared?.ok) {
      const message = prepared?.message || '本月待确认工单查询失败';
      showError(message);
      return { ok: false, message };
    }
    return extractAndShow();
  }

  function rowsFromPreview() {
    const table = shadow?.querySelector('#tableWrap table');
    if (!table) return currentRows;
    return Array.from(table.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td,th')).map((cell) => normalizeText(cell.innerText || cell.textContent || ''))
    );
  }

  function buildClipboardPayload(rows) {
    const plain = rows.map((row) => row.join('\t')).join('\r\n');
    const background = selectedTableColor?.bg || TABLE_COLOR_OPTIONS[0].bg;
    const htmlRows = rows.map((row) => `<tr>${row.map((cell, index) => `<td style="border:1px solid #111;background:${background};padding:8px 10px;text-align:center;vertical-align:middle;white-space:nowrap;width:${COLUMN_WIDTHS[index]}px;font-family:Microsoft YaHei,PingFang SC,Arial,sans-serif;font-size:16px;color:#111;">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    const html = `<html><body><table style="border-collapse:collapse;table-layout:fixed;background:${background};"><tbody>${htmlRows}</tbody></table></body></html>`;
    return { plain, html };
  }

  async function copyPreview() {
    const rows = rowsFromPreview();
    if (!rows.length) return showToast('没有可复制的数据');
    const { plain, html } = buildClipboardPayload(rows);
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
          })
        ]);
      } else {
        fallbackCopy(html, plain);
      }
      showToast(currentHasHeader ? `已复制统计表格（${rows.length} 行），可直接粘贴到 Excel` : `已复制 ${rows.length} 行；请先删除旧的表格行，再插入 ${rows.length} 个空白行后粘贴`, 4600);
    } catch (error) {
      try {
        fallbackCopy(html, plain);
        showToast(currentHasHeader ? `已复制统计表格（${rows.length} 行），可直接粘贴到 Excel` : `已复制 ${rows.length} 行；请先删除旧的表格行，再插入 ${rows.length} 个空白行后粘贴`, 4600);
      } catch (fallbackError) {
        showToast('复制失败，请在表格中全选后手动复制');
      }
    }
  }

  function fallbackCopy(html, plain) {
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;';
    holder.innerHTML = html;
    holder.addEventListener('copy', (event) => {
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', plain);
      event.preventDefault();
    }, { once: true });
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand('copy');
    selection.removeAllRanges();
    holder.remove();
    if (!ok) throw new Error('execCommand copy failed');
  }

  async function copyPlainText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // 继续尝试 execCommand 兼容方案。
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('copy failed');
    return true;
  }

  async function extractStatsAndCopy(options = {}) {
    const result = extractServiceStats(options);
    if (!result.ok) {
      showError(result.message);
      return result;
    }

    let copied = false;
    try {
      copied = await copyPlainText(result.text);
      showToast(`已复制统计结果（v${EXTENSION_VERSION}）：${result.text}`);
    } catch (error) {
      showToast(`统计完成（v${EXTENSION_VERSION}）：${result.text}`);
    }
    return { ...result, copied };
  }

  function buildTodayStatsRows(result) {
    const totals = result.totals || {};
    const orderedLabels = Object.keys(totals);
    const grandTotal = orderedLabels.reduce((sum, label) => sum + (Number(totals[label]) || 0), 0);
    const rows = [
      ['服务类型', '数量'],
      ...orderedLabels.map((label) => [label, formatStatNumber(Number(totals[label]) || 0)]),
      ['合计', formatStatNumber(grandTotal)]
    ];
    return { rows, count: orderedLabels.length, grandTotal };
  }

  async function showTodayStatsTable(result) {
    const { rows, count, grandTotal } = buildTodayStatsRows(result);
    currentColumnWidths = [150, 110];
    currentModalTitle = '今日完成工单统计';
    currentHasHeader = true;
    renderRows(rows);

    let copied = false;
    try {
      const { plain, html } = buildClipboardPayload(rows);
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
          })
        ]);
        copied = true;
      } else {
        fallbackCopy(html, plain);
        copied = true;
      }
    } catch (error) {
      try {
        const payload = buildClipboardPayload(rows);
        fallbackCopy(payload.html, payload.plain);
        copied = true;
      } catch (e) {
        // 忽略，用户可在弹窗中手动复制
      }
    }
    showToast(copied
      ? `已复制统计表格（${count} 项服务，合计 ${formatStatNumber(grandTotal)}）`
      : '统计完成，请在弹窗中点"复制到表格"', 4000);
    return { ok: true, text: result.text, totals: result.totals, rowCount: result.rowCount, copied };
  }

  async function runStatsAction(actionOptions = {}) {
    const prepared = await applyActionFiltersAndQuery(ACTION_FILTER_STATUS.stats, {
      clearOtherFilters: true,
      operatorName: actionOptions.operatorName,
      forceOperatorRefresh: actionOptions.forceOperatorRefresh
    });
    if (!prepared.ok) {
      showError(prepared.message);
      return prepared;
    }
    return extractStatsAndCopy();
  }

  async function runTodayCompletedStatsAction(actionOptions = {}) {
    const savedName = normalizeOperatorOverride(actionOptions.operatorName)
      || await getSavedOperatorName(Boolean(actionOptions.forceOperatorRefresh));
    const prepared = await sendWorkorderRequest({
      type: 'ETHAN_NATIVE_COMBINED_ROWS', action: 'today',
      operator: getOperatorTarget(savedName).preferredText
    });
    if (!prepared?.ok) {
      showError(prepared?.message || '今日完成查询失败');
      return prepared || { ok: false };
    }
    hideModal();
    const result = await extractStatsAndCopy({ completedQuantity: true });
    if (prepared.incompleteOrders?.length) {
      window.alert('发现 ' + prepared.incompleteOrders.length + ' 条工单存在未填项，已在当前列表标红：\n\n' +
        prepared.incompleteOrders.map(item => '工单 ' + item.id + '：' + item.missing.join('、')).join('\n') +
        '\n\n1970 年的时间视为未填写。');
    }
    return result;
  }

  // 页面内快捷按钮：固定定位到“常用快捷查询”左侧。
  // 使用 body 级浮层而不是插入原工具栏布局，避免挤掉或隐藏网站自带的“常用快捷查询”。
  const PAGE_ACTIONS_ID = 'ethan-workorder-page-actions';
  const PAGE_ACTIONS_STYLE_ID = 'ethan-workorder-page-actions-style';
  let pageActionObserver = null;
  let pageActionTimer = null;
  let pageActionInterval = null;
  let pageActionWrapper = null;

  function ensurePageActionStyles() {
    if (document.getElementById(PAGE_ACTIONS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PAGE_ACTIONS_STYLE_ID;
    style.textContent = `
      #${PAGE_ACTIONS_ID}{
        position:fixed!important;
        z-index:1900!important;
        display:none!important;
        align-items:center!important;
        flex-wrap:wrap!important;
        justify-content:flex-end!important;
        gap:8px!important;
        width:max-content!important;
        height:auto!important;
        margin:0!important;
        padding:0!important;
        white-space:nowrap!important;
        pointer-events:auto!important;
      }
      #${PAGE_ACTIONS_ID}[data-visible="true"]{
        display:inline-flex!important;
      }
      #${PAGE_ACTIONS_ID} .ethan-page-action{
        display:inline-flex!important;
        flex:0 0 auto!important;
        align-items:center!important;
        justify-content:center!important;
        min-width:0!important;
        width:auto!important;
        height:var(--ethan-action-height,32px)!important;
        margin:0!important;
        padding:var(--ethan-action-padding,7px 12px)!important;
        border:1px solid #c2e7b0!important;
        border-radius:var(--ethan-action-radius,4px)!important;
        outline:0!important;
        background:#f0f9eb!important;
        color:#67c23a!important;
        box-shadow:none!important;
        font-family:inherit!important;
        font-size:var(--ethan-action-font-size,12px)!important;
        font-weight:400!important;
        line-height:var(--ethan-action-line-height,1)!important;
        cursor:pointer!important;
        transition:background-color .18s,border-color .18s,color .18s,opacity .18s!important;
      }
      #${PAGE_ACTIONS_ID} .ethan-page-action:hover,
      #${PAGE_ACTIONS_ID} .ethan-page-action:focus{
        border-color:#67c23a!important;
        background:#67c23a!important;
        color:#fff!important;
      }
      #${PAGE_ACTIONS_ID} .ethan-page-action:active{
        border-color:#5daf34!important;
        background:#5daf34!important;
        color:#fff!important;
      }
      #${PAGE_ACTIONS_ID} .ethan-page-action[disabled]{
        border-color:#d9ecce!important;
        background:#f0f9eb!important;
        color:#a4d88d!important;
        cursor:wait!important;
        opacity:.75!important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findVisibleControlByText(targetText) {
    const controls = Array.from(document.querySelectorAll(
      'button, [role="button"], a, .el-button, .el-dropdown-link'
    ));
    return controls.find((node) => {
      if (!isElementVisible(node)) return false;
      if (node.closest(`#${PAGE_ACTIONS_ID}`)) return false;
      const text = normalizeText(node.innerText || node.textContent || '');
      return text === targetText || text.startsWith(targetText);
    }) || null;
  }

  function getQuickQueryAnchor() {
    const control = findVisibleControlByText('常用快捷查询');
    if (!control) return null;

    // 优先使用网站原按钮/下拉组件的完整外框来计算位置。
    const candidates = [
      control.closest('.el-dropdown'),
      control.closest('button, [role="button"], a, .el-button'),
      control
    ].filter(Boolean);

    return candidates.find((node) => isElementVisible(node)) || control;
  }

  function syncPageActionButtonMetrics(referenceControl, wrapper) {
    if (!(referenceControl instanceof Element) || !(wrapper instanceof Element)) return;

    const style = window.getComputedStyle(referenceControl);
    const rect = referenceControl.getBoundingClientRect();
    const height = rect.height > 0 ? `${Math.round(rect.height * 100) / 100}px` : style.height;
    const padding = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;

    wrapper.style.setProperty('--ethan-action-height', height || '32px');
    wrapper.style.setProperty('--ethan-action-padding', padding || '7px 12px');
    wrapper.style.setProperty('--ethan-action-radius', style.borderRadius || '4px');
    wrapper.style.setProperty('--ethan-action-font-size', style.fontSize || '12px');
    wrapper.style.setProperty('--ethan-action-line-height', style.lineHeight || '1');
  }

  function setPageButtonBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      const width = button.getBoundingClientRect().width;
      if (width > 0) button.style.setProperty('width', `${width}px`, 'important');
    }
    button.disabled = busy;
    button.textContent = busy ? busyText : button.dataset.label;
    if (!busy) button.style.removeProperty('width');
  }

  function createPageActionButton(label, mode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'el-button el-button--success el-button--small is-plain ethan-page-action';
    button.dataset.label = label;
    button.dataset.workorderAction = mode;
    button.textContent = label;
    button.title = mode === 'extract'
      ? '提取本月待确认工单并生成表格'
      : mode === 'todayStats'
        ? '清除其他筛选，设置完成时间为今天并复制服务类型统计'
        : '查看等待处理的工单';

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;

      setPageButtonBusy(button, true, mode === 'extract' ? '正在提取…' : '正在统计…');
      try {
        if (mode === 'extract') {
          await runExtractAction();
        } else if (mode === 'todayStats') {
          await runTodayCompletedStatsAction();
        } else {
          await runStatsMultiStatusAction();
        }
      } catch (error) {
        const message = ethanChineseError(error?.message) || '';
        showError(!chrome.runtime?.id || /Extension context invalidated/i.test(message)
          ? '插件已重新加载，请刷新工单页面后再试。'
          : message || (mode === 'extract' ? '提取失败' : '统计失败'));
      } finally {
        setPageButtonBusy(button, false, '');
      }
    }, true);

    return button;
  }

  function ensurePageActionWrapper() {
    ensurePageActionStyles();

    const existing = document.getElementById(PAGE_ACTIONS_ID);
    if (existing) {
      pageActionWrapper = existing;
      // Repair toolbars retained from an earlier content-script instance.
      if (!existing.querySelector('[data-workorder-action="todayStats"]')) {
        const todayButton = createPageActionButton('今日完成工单', 'todayStats');
        const stats = Array.from(existing.children).find(node => node.dataset.label === '待处理');
        if (stats) stats.after(todayButton); else existing.prepend(todayButton);
      }
      // 修复旧版可能被插入到网站工具栏内部的问题，移到 body，避免影响原按钮布局。
      if (existing.parentElement !== document.body && document.body) {
        document.body.appendChild(existing);
      }
      return existing;
    }

    const wrapper = document.createElement('div');
    wrapper.id = PAGE_ACTIONS_ID;
    wrapper.setAttribute('data-ethan-extension', 'page-actions');
    wrapper.setAttribute('data-visible', 'false');
    wrapper.append(
      createPageActionButton('本月待确认工单', 'extract'),
      createPageActionButton('待处理', 'stats'),
      createPageActionButton('今日完成工单', 'todayStats')
    );
    (document.body || document.documentElement).appendChild(wrapper);
    pageActionWrapper = wrapper;
    return wrapper;
  }

  function hasOpenPageModal() {
    // Ethan 使用 Element UI 弹窗。网站弹窗打开时隐藏页面快捷按钮，
    // 避免按钮因较高 z-index 浮在遮罩和编辑弹窗上方显得突兀。
    const modalSelectors = [
      '.el-dialog__wrapper',
      '.el-message-box__wrapper',
      '.el-drawer__wrapper',
      '[role="dialog"][aria-modal="true"]'
    ];

    const hasVisibleDialog = modalSelectors.some((selector) =>
      Array.from(document.querySelectorAll(selector)).some((node) => {
        if (node.closest?.(`#${PAGE_ACTIONS_ID}`)) return false;
        return isElementVisible(node);
      })
    );
    if (hasVisibleDialog) return true;

    // 日期选择器、下拉菜单、级联面板等通常挂载到 body，若快捷按钮仍保持高层级，
    // 会浮在这些临时面板上方。检测到常见 Element UI / Element Plus 浮层时暂时隐藏。
    const floatingPanelSelectors = [
      '.el-picker-panel',
      '.el-picker__popper',
      '.el-date-picker',
      '.el-date-range-picker',
      '.el-time-panel',
      '.el-time-range-picker',
      '.el-select-dropdown',
      '.el-select__popper',
      '.el-cascader__dropdown',
      '.el-dropdown-menu',
      '.el-dropdown__popper',
      '.el-autocomplete-suggestion',
      '.el-color-dropdown',
      '.el-popover'
    ];

    const hasVisibleFloatingPanel = floatingPanelSelectors.some((selector) =>
      Array.from(document.querySelectorAll(selector)).some((node) => {
        if (node.closest?.(`#${PAGE_ACTIONS_ID}`)) return false;
        if (!isElementVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        // 忽略尺寸很小的提示气泡，只隐藏可能遮挡页面操作区的面板。
        return rect.width >= 120 && rect.height >= 48;
      })
    );
    if (hasVisibleFloatingPanel) return true;

    // Element UI 的全屏遮罩通常使用 v-modal；仅在可见且覆盖较大区域时视为弹窗遮罩，
    // 避免把普通局部遮罩误判为弹窗。
    return Array.from(document.querySelectorAll('.v-modal, .el-overlay')).some((node) => {
      if (!isElementVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.7 && rect.height >= window.innerHeight * 0.7;
    });
  }

  function positionPageActionButtons() {
    syncQueryOrderControls();
    if (location.hostname !== 'ethan.hzzichi.com') return false;

    const wrapper = ensurePageActionWrapper();
    if (hasOpenPageModal()) {
      wrapper.setAttribute('data-visible', 'false');
      wrapper.setAttribute('aria-hidden', 'true');
      return false;
    }
    wrapper.removeAttribute('aria-hidden');

    const anchor = getQuickQueryAnchor();
    if (!anchor) {
      wrapper.setAttribute('data-visible', 'false');
      return false;
    }

    const quickQueryControl = findVisibleControlByText('常用快捷查询') || anchor;
    syncPageActionButtonMetrics(quickQueryControl, wrapper);
    syncPersonalQueryButtons(wrapper, quickQueryControl);

    const rect = anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      wrapper.setAttribute('data-visible', 'false');
      return false;
    }

    // 空间不足时向上换行，末行仍贴着原生快捷查询按钮。
    wrapper.style.maxWidth = `${Math.max(0, rect.left - 16)}px`;
    wrapper.setAttribute('data-visible', 'true');
    const wrapperRect = wrapper.getBoundingClientRect();
    const gap = 8;
    const edge = 8;

    let left = rect.left - wrapperRect.width - gap;
    let top = rect.bottom - wrapperRect.height;

    // 桌面端正常情况下位于快捷查询左侧；空间不足时贴近视口左边，但绝不覆盖原按钮。
    left = Math.max(edge, Math.min(left, rect.left - wrapperRect.width - 2));
    top = Math.max(edge, Math.min(top, window.innerHeight - wrapperRect.height - edge));

    wrapper.style.left = `${Math.round(left)}px`;
    wrapper.style.top = `${Math.round(top)}px`;
    return true;
  }

  const QUERY_ORDER_KEY = 'ethanPersonalQueryOrder';
  const PAGE_QUERY_ORDER_KEY = 'ethan-workorder-exporter:personal-query-order';
  let personalQueryOrder = [];
  let draggedQueryRow = null;

  function queryRank(label) {
    const index = personalQueryOrder.indexOf(normalizeText(label));
    return index < 0 ? personalQueryOrder.length : index;
  }

  function syncQueryOrderControls() {
    const dialog = document.querySelector('.el-dialog[aria-label="管理我的快捷菜单"]');
    const list = dialog?.querySelector('.el-cascader-menu__list');
    if (!list || !isElementVisible(dialog)) return;
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    const rows = Array.from(list.querySelectorAll(':scope > .el-cascader-node.is-selectable'));
    const label = (row) => normalizeText(row.querySelector('.el-cascader-node__label')?.textContent);
    for (const row of rows) {
      row.style.order = String(queryRank(label(row)));
      if (row.querySelector('[data-ethan-query-grip]')) continue;
      const grip = document.createElement('span');
      grip.dataset.ethanQueryGrip = '';
      grip.draggable = true;
      grip.textContent = '⠿';
      grip.title = '拖动调整快捷按钮顺序';
      grip.style.cssText = 'cursor:grab;margin-left:auto;padding:0 8px;color:#606266;font-size:18px;user-select:none';
      grip.addEventListener('click', (event) => event.stopPropagation());
      grip.addEventListener('dragstart', (event) => {
        draggedQueryRow = row;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', label(row));
      });
      grip.addEventListener('dragend', () => { draggedQueryRow = null; });
      row.addEventListener('dragover', (event) => {
        if (draggedQueryRow?.parentElement === list) event.preventDefault();
      });
      row.addEventListener('drop', (event) => {
        if (draggedQueryRow?.parentElement !== list) return;
        event.preventDefault();
        const source = draggedQueryRow;
        draggedQueryRow = null;
        if (source === row) return;
        const ordered = Array.from(list.querySelectorAll(':scope > .el-cascader-node.is-selectable'))
          .sort((a, b) => queryRank(label(a)) - queryRank(label(b)));
        const targetIndex = ordered.indexOf(row);
        ordered.splice(ordered.indexOf(source), 1);
        ordered.splice(targetIndex, 0, source);
        const order = ordered.map(label);
        try {
          localStorage.setItem(PAGE_QUERY_ORDER_KEY, JSON.stringify(order));
          personalQueryOrder = order;
          schedulePageActionInjection(0);
        } catch (error) {
          showToast('快捷按钮顺序保存失败，请重试');
        }
      });
      row.appendChild(grip);
    }
  }

  function syncPersonalQueryButtons(wrapper, control) {
    if (control.dataset.ethanQueries) {
      let queries;
      try { queries = JSON.parse(control.dataset.ethanQueries); } catch { return; }
      queries.sort((a, b) => queryRank(a.label) - queryRank(b.label));
      const signature = JSON.stringify(queries);
      if (wrapper.dataset.querySignature === signature && wrapper.queryControl === control) return;
      wrapper.dataset.querySignature = signature;
      wrapper.queryControl = control;
      wrapper.querySelectorAll('[data-personal-query]').forEach(button => button.remove());
      for (const query of queries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ethan-page-action';
        button.dataset.personalQuery = '';
        button.textContent = query.label;
        button.addEventListener('click', () => {
          control.dataset.ethanRequestedQuery = query.id;
          control.dispatchEvent(new Event('ethan-run-personal-query', { bubbles: true }));
        });
        wrapper.appendChild(button);
      }
      return;
    }
    const menuId = control.getAttribute('aria-controls');
    const menu = menuId && document.getElementById(menuId);
    const items = Array.from(menu?.querySelectorAll('.el-dropdown-menu__item') || [])
      .filter((item) => item.querySelector('.el-icon-user') && !item.classList.contains('is-disabled'))
      .sort((a, b) => queryRank(a.textContent) - queryRank(b.textContent));
    const buttons = Array.from(wrapper.querySelectorAll('[data-personal-query]'));
    if (buttons.length === items.length && buttons.every((button, i) =>
      button.queryItem === items[i] && button.textContent === normalizeText(items[i].textContent))) return;

    buttons.forEach((button) => button.remove());
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ethan-page-action';
      button.dataset.personalQuery = '';
      button.textContent = normalizeText(item.textContent);
      button.queryItem = item;
      button.addEventListener('click', () => {
        if (item.isConnected && !item.classList.contains('is-disabled')) item.click();
      });
      wrapper.appendChild(button);
    }
  }

  function schedulePageActionInjection(delay = 40) {
    clearTimeout(pageActionTimer);
    pageActionTimer = setTimeout(() => {
      window.requestAnimationFrame(() => positionPageActionButtons());
    }, delay);
  }

  function startPageActionInjection() {
    try {
      const saved = JSON.parse(localStorage.getItem(PAGE_QUERY_ORDER_KEY));
      if (Array.isArray(saved)) {
        personalQueryOrder = saved;
      } else {
        // Import an order saved by an earlier version if no page order exists yet.
        chrome.storage.local.get(QUERY_ORDER_KEY).then((stored) => {
          const legacy = stored[QUERY_ORDER_KEY];
          if (!Array.isArray(legacy) || localStorage.getItem(PAGE_QUERY_ORDER_KEY) !== null) return;
          localStorage.setItem(PAGE_QUERY_ORDER_KEY, JSON.stringify(legacy));
          personalQueryOrder = legacy;
          schedulePageActionInjection(0);
        }).catch(() => {});
      }
    } catch (error) {
      console.warn('读取快捷按钮顺序失败', error);
    }
    schedulePageActionInjection(0);

    if (!pageActionObserver) {
      pageActionObserver = new MutationObserver(() => schedulePageActionInjection());
      pageActionObserver.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    }

    // Ethan 为单页应用，切换菜单、查询或翻页时原工具栏可能重建。
    if (!pageActionInterval) {
      pageActionInterval = window.setInterval(() => positionPageActionButtons(), 1200);
    }

    window.addEventListener('resize', () => schedulePageActionInjection(0), { passive: true });
    window.addEventListener('scroll', () => schedulePageActionInjection(0), { passive: true, capture: true });

    // 日期框、下拉框常在点击后才切换浮层显示状态；在交互后立即重新判断，
    // 避免等待轮询期间短暂遮挡面板。
    document.addEventListener('pointerdown', () => schedulePageActionInjection(30), { passive: true, capture: true });
    document.addEventListener('focusin', () => schedulePageActionInjection(30), { passive: true, capture: true });
  }

  // 登录后自动展开“业务管理”，再进入“工单管理”页。
  // 使用 sessionStorage 记录本标签页已执行状态，避免用户进入其他页面后被反复强制跳回。
  const AUTO_OPEN_WORKORDER_KEY = 'ethan-workorder-auto-opened-v1.0.31';
  const AUTO_APPLY_DEFAULT_FILTERS_KEY = 'ethan-workorder-auto-default-combined-v1';
  let autoOpenObserver = null;
  let autoOpenTimer = null;
  let autoOpenRetryTimer = null;
  let autoOpenAttempts = 0;
  let autoOpenNextActionAt = 0;
  let autoDefaultFilterObserver = null;
  let autoDefaultFilterTimer = null;
  let autoDefaultFilterRetryTimer = null;
  let autoDefaultFilterAttempts = 0;
  let autoDefaultFilterRunning = false;

  function visibleExactTextElements(targetText) {
    return Array.from(document.querySelectorAll(
      'a, button, li, [role="menuitem"], [role="tab"], .el-menu-item, .el-submenu__title, .el-tabs__item, .tags-view-item, span, div'
    )).filter((node) => {
      if (!isElementVisible(node)) return false;
      if (node.closest?.(`#${PAGE_ACTIONS_ID}`)) return false;
      return normalizeText(node.innerText || node.textContent || '') === targetText;
    });
  }

  function isLoginPageVisible() {
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(isElementVisible);
    if (!passwordInputs.length) return false;

    const loginControls = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a'))
      .filter(isElementVisible)
      .some((node) => /^(登录|立即登录|登\s*录)$/.test(normalizeText(node.value || node.innerText || node.textContent || '')));

    return loginControls || Boolean(passwordInputs[0].closest('form, .login, [class*="login"], [id*="login"]'));
  }

  function isWorkOrderPageActive() {
    // 优先判断左侧菜单或页签的激活状态。
    const activeSelectors = [
      '.el-menu-item.is-active',
      '[role="menuitem"].is-active',
      '.router-link-active',
      '.router-link-exact-active',
      '.el-tabs__item.is-active',
      '.tags-view-item.active',
      '[role="tab"][aria-selected="true"]'
    ];
    if (activeSelectors.some((selector) =>
      Array.from(document.querySelectorAll(selector)).some((node) =>
        isElementVisible(node) && normalizeText(node.innerText || node.textContent || '') === '工单管理'
      )
    )) return true;

    // Ethan 工单页的表格与工具栏组合特征，用于兼容激活类名变化。
    const bodyText = normalizeText(document.body?.innerText || '');
    const hasWorkOrderHeaders = ['工单ID', '公司名称', '运营人员', '服务项目', '操作人员']
      .every((label) => bodyText.includes(label));
    const hasWorkOrderToolbar = visibleExactTextElements('添加资源').length > 0 ||
      visibleExactTextElements('批量发起流程').length > 0;
    return hasWorkOrderHeaders && hasWorkOrderToolbar;
  }

  function closestMenuClickTarget(node) {
    if (!node) return null;
    const target = node.closest(
      'a[href], .el-menu-item, [role="menuitem"], button, .el-submenu__title'
    );
    return target && isElementVisible(target) ? target : null;
  }

  function findWorkOrderMenuTarget() {
    const matches = visibleExactTextElements('工单管理');
    if (!matches.length) return null;

    // 优先点击真正的菜单项或链接，避免只点击内部文字节点无效。
    for (const node of matches) {
      const target = closestMenuClickTarget(node);
      if (target) return target;
    }
    return matches[0];
  }

  function findBusinessManagementMenuTarget() {
    const matches = visibleExactTextElements('业务管理');
    if (!matches.length) return null;

    for (const node of matches) {
      const submenu = node.closest('.el-submenu');
      const submenuTitle = submenu?.querySelector(':scope > .el-submenu__title');
      if (submenuTitle && isElementVisible(submenuTitle)) return submenuTitle;

      const target = closestMenuClickTarget(node);
      if (target) return target;
    }
    return matches[0];
  }

  function isBusinessManagementExpanded(target) {
    if (findWorkOrderMenuTarget()) return true;
    if (!target) return false;

    const submenu = target.closest('.el-submenu');
    if (submenu?.classList.contains('is-opened')) return true;
    if (target.getAttribute('aria-expanded') === 'true') return true;

    const inlineMenu = submenu?.querySelector(':scope > .el-menu, :scope > ul, .el-menu--inline');
    if (inlineMenu && isElementVisible(inlineMenu)) {
      const style = window.getComputedStyle(inlineMenu);
      if (style.display !== 'none' && style.visibility !== 'hidden' && inlineMenu.getBoundingClientRect().height > 0) {
        return true;
      }
    }
    return false;
  }

  function clickMenuTarget(target) {
    if (!target || !isElementVisible(target)) return false;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }

  function clearAutoOpenStateOnLogin() {
    if (!isLoginPageVisible()) return false;
    try {
      sessionStorage.removeItem(AUTO_OPEN_WORKORDER_KEY);
      sessionStorage.removeItem(AUTO_APPLY_DEFAULT_FILTERS_KEY);
    } catch (error) {
      // 某些严格隐私模式可能限制 sessionStorage，不影响后续点击逻辑。
    }
    autoOpenAttempts = 0;
    autoOpenNextActionAt = 0;
    autoDefaultFilterAttempts = 0;
    autoDefaultFilterRunning = false;
    return true;
  }

  function hasAutoOpenedWorkOrder() {
    try {
      return sessionStorage.getItem(AUTO_OPEN_WORKORDER_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function markAutoOpenedWorkOrder() {
    try {
      sessionStorage.setItem(AUTO_OPEN_WORKORDER_KEY, '1');
    } catch (error) {
      // 忽略存储失败；内存中的尝试次数仍可防止短时间重复点击。
    }
  }

  function hasAutoAppliedDefaultFilters() {
    try {
      return sessionStorage.getItem(AUTO_APPLY_DEFAULT_FILTERS_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function markAutoAppliedDefaultFilters() {
    try {
      sessionStorage.setItem(AUTO_APPLY_DEFAULT_FILTERS_KEY, '1');
    } catch (error) {
      // 忽略存储失败；后续逻辑仍可依赖本次页面流程完成。
    }
  }

  function scheduleAutoApplyDefaultFiltersRetry(delay = 650) {
    clearTimeout(autoDefaultFilterRetryTimer);
    autoDefaultFilterRetryTimer = setTimeout(() => scheduleAutoApplyDefaultFilters(0), delay);
  }

  async function tryAutoApplyDefaultFilters() {
    if (location.hostname !== 'ethan.hzzichi.com') return false;
    if (isLoginPageVisible()) {
      try {
        sessionStorage.removeItem(AUTO_APPLY_DEFAULT_FILTERS_KEY);
      } catch (error) {
        // 忽略会话存储异常。
      }
      autoDefaultFilterAttempts = 0;
      autoDefaultFilterRunning = false;
      return false;
    }
    if (autoDefaultFilterRunning) return false;
    if (hasAutoAppliedDefaultFilters()) return false;
    if (!isWorkOrderPageActive()) return false;
    if (hasOpenPageModal()) {
      scheduleAutoApplyDefaultFiltersRetry(420);
      return false;
    }

    const savedOperatorName = await getSavedOperatorName(true);
    if (!savedOperatorName) {
      // 未设置姓名时不标记完成；用户随后在插件面板保存姓名后仍可自动执行。
      return false;
    }

    if (autoDefaultFilterAttempts >= 12) return false;

    autoDefaultFilterRunning = true;
    autoDefaultFilterAttempts += 1;
    try {
      const result = await showCombinedWorkOrders({ operatorName: savedOperatorName, silent: true });
      if (result?.ok) {
        markAutoAppliedDefaultFilters();
        autoDefaultFilterAttempts = 0;
        showToast(`已自动查询${savedOperatorName}的待处理工单，共 ${result.rowCount} 条`, 3200);
        return true;
      }
      if (autoDefaultFilterAttempts < 12) {
        scheduleAutoApplyDefaultFiltersRetry(700);
      }
      return false;
    } catch (error) {
      if (autoDefaultFilterAttempts < 12) {
        scheduleAutoApplyDefaultFiltersRetry(700);
      }
      return false;
    } finally {
      autoDefaultFilterRunning = false;
    }
  }

  function scheduleAutoApplyDefaultFilters(delay = 180) {
    clearTimeout(autoDefaultFilterTimer);
    autoDefaultFilterTimer = setTimeout(() => {
      window.requestAnimationFrame(() => {
        void tryAutoApplyDefaultFilters();
      });
    }, delay);
  }

  function scheduleAutoOpenRetry(delay = 500) {
    clearTimeout(autoOpenRetryTimer);
    autoOpenRetryTimer = setTimeout(() => scheduleAutoOpenWorkOrder(0), delay);
  }

  function tryAutoOpenWorkOrderPage() {
    if (location.hostname !== 'ethan.hzzichi.com') return false;
    if (clearAutoOpenStateOnLogin()) return false;
    if (hasAutoOpenedWorkOrder()) return false;

    if (isWorkOrderPageActive()) {
      markAutoOpenedWorkOrder();
      autoOpenAttempts = 0;
      scheduleAutoApplyDefaultFilters(260);
      return true;
    }

    // 菜单展开动画或路由切换期间，避免 MutationObserver 导致连续重复点击。
    if (Date.now() < autoOpenNextActionAt) return false;
    if (autoOpenAttempts >= 10) return false;

    const workOrderTarget = findWorkOrderMenuTarget();
    if (workOrderTarget) {
      autoOpenAttempts += 1;
      autoOpenNextActionAt = Date.now() + 1200;
      clickMenuTarget(workOrderTarget);
      scheduleAutoOpenRetry(1400);
      return true;
    }

    // “工单管理”是“业务管理”的子菜单；登录后先展开父菜单，再继续寻找子菜单。
    const businessTarget = findBusinessManagementMenuTarget();
    if (businessTarget) {
      autoOpenAttempts += 1;
      if (!isBusinessManagementExpanded(businessTarget)) {
        autoOpenNextActionAt = Date.now() + 650;
        clickMenuTarget(businessTarget);
      } else {
        // 父菜单已经展开但子菜单尚在渲染，稍后直接重试，不反向折叠菜单。
        autoOpenNextActionAt = Date.now() + 300;
      }
      scheduleAutoOpenRetry(700);
      return true;
    }

    // 登录后的首页可能仍在异步渲染左侧导航，短暂等待后再次检查。
    autoOpenAttempts += 1;
    autoOpenNextActionAt = Date.now() + 350;
    scheduleAutoOpenRetry(450);
    return false;
  }

  function scheduleAutoOpenWorkOrder(delay = 80) {
    clearTimeout(autoOpenTimer);
    autoOpenTimer = setTimeout(() => {
      window.requestAnimationFrame(() => tryAutoOpenWorkOrderPage());
    }, delay);
  }

  function startAutoOpenWorkOrderPage() {
    scheduleAutoOpenWorkOrder(0);

    if (!autoOpenObserver) {
      autoOpenObserver = new MutationObserver(() => scheduleAutoOpenWorkOrder());
      autoOpenObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // 登录提交后页面可能只更新路由而不重建 DOM，补充监听常见交互与历史路由变化。
    document.addEventListener('click', () => scheduleAutoOpenWorkOrder(180), { passive: true, capture: true });
    window.addEventListener('popstate', () => scheduleAutoOpenWorkOrder(80), { passive: true });
    window.addEventListener('hashchange', () => scheduleAutoOpenWorkOrder(80), { passive: true });
  }

  function startAutoApplyDefaultFilters() {
    scheduleAutoApplyDefaultFilters(240);

    if (!autoDefaultFilterObserver) {
      autoDefaultFilterObserver = new MutationObserver(() => scheduleAutoApplyDefaultFilters(220));
      autoDefaultFilterObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.addEventListener('click', () => scheduleAutoApplyDefaultFilters(240), { passive: true, capture: true });
    document.addEventListener('focusin', () => scheduleAutoApplyDefaultFilters(220), { passive: true, capture: true });
    window.addEventListener('popstate', () => scheduleAutoApplyDefaultFilters(120), { passive: true });
    window.addEventListener('hashchange', () => scheduleAutoApplyDefaultFilters(120), { passive: true });
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[OPERATOR_STORAGE_KEY]) return;
      cachedOperatorName = normalizeOperatorOverride(changes[OPERATOR_STORAGE_KEY].newValue);
      markAutoAppliedDefaultFilters();
      clearTimeout(autoDefaultFilterRetryTimer);
      const operatorName = cachedOperatorName;
      if (!isWorkOrderPageActive()) return;
      void chrome.runtime.sendMessage({type:'ETHAN_NATIVE_COMBINED_ROWS',action:'operator',operator:getOperatorTarget(operatorName).preferredText})
        .then(result=>{if(!result?.ok)showError(result?.message||'切换操作人员查询失败');else showToast('已按当前筛选查询'+operatorName+'的工单');})
        .catch(error=>showError(ethanChineseError(error.message)));
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideModal();
  }, true);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'ETHAN_EXTRACT_NOW') {
      runExtractAction({ operatorName: message.operatorName, forceOperatorRefresh: true })
        .then((result) => {
          sendResponse(result?.ok
            ? { ok: true }
            : { ok: false, message: result?.message || '提取失败' });
        })
        .catch((error) => sendResponse({ ok: false, message: ethanChineseError(error?.message) || '提取失败' }));
      return true;
    }

    if (message?.type === 'ETHAN_STATS_MULTI_NOW') {
      runStatsMultiStatusAction({ operatorName: message.operatorName, forceOperatorRefresh: true })
        .then((result) => {
          sendResponse(result?.ok
            ? { ok: true, rowCount: result.rowCount, shown: result.shown,
                text: result.text, copied: result.copied, statsMessage: result.statsMessage }
            : { ok: false, message: result?.message || '筛选失败' });
        })
        .catch((error) => sendResponse({ ok: false, message: ethanChineseError(error?.message) || '筛选失败' }));
      return true;
    }

    if (message?.type === 'ETHAN_TODAY_COMPLETED_STATS_NOW') {
      runTodayCompletedStatsAction({ operatorName: message.operatorName, forceOperatorRefresh: true })
        .then((result) => {
          sendResponse(result?.ok
            ? { ok: true, text: result.text, totals: result.totals, rowCount: result.rowCount, copied: result.copied }
            : { ok: false, message: result?.message || '统计失败' });
        })
        .catch((error) => sendResponse({ ok: false, message: ethanChineseError(error?.message) || '统计失败' }));
      return true;
    }

    return false;
  });

  // Wait for the workorder component before applying the page-size default.
  let pageSizeAttempts = 0;
  const pageSizeTimer = setInterval(async () => {
    if (++pageSizeAttempts > 120) { clearInterval(pageSizeTimer); return; }
    if (!Array.from(document.querySelectorAll('.el-table')).some(el => el.innerText.includes('工单ID'))) return;
    clearInterval(pageSizeTimer);
    try {
      const result = await chrome.runtime.sendMessage({type: 'ETHAN_NATIVE_COMBINED_ROWS', action: 'pageSize'});
      if (!result?.ok) console.warn('Ethan 每页50条设置失败', result?.message);
    } catch (error) { console.warn('Ethan 每页50条设置失败', error); }
  }, 500);
  ensureUI();
  function showSnapshotToast(message) {
    document.getElementById('ethan-snapshot-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'ethan-snapshot-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:rgba(38,50,56,.92);color:#fff;padding:10px 18px;border-radius:6px;font:13px/1.6 sans-serif;max-width:80vw;box-shadow:0 3px 12px #0002';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-ethan-dialog-snapshot]');
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const dialog = button.closest('.el-dialog');
    if (!dialog) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.title = '正在截取并复制…';
    const snapshotStyles = [];
    const expandForSnapshot = (node, css) => {
      snapshotStyles.push([node, node.getAttribute('style'), node.scrollTop]);
      node.style.cssText += css;
    };
    const restoreSnapshotLayout = () => {
      for (const [node, style, scrollTop] of snapshotStyles.splice(0).reverse()) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
        node.scrollTop = scrollTop;
      }
    };
    try {
      // Fit the entire expanded dialog into a single browser capture, including
      // content previously clipped by the dialog body's own scroll container.
      const originalWidth = dialog.getBoundingClientRect().width;
      const body = dialog.querySelector('.el-dialog__body');
      if (body) expandForSnapshot(body, ';max-height:none!important;height:auto!important;overflow:visible!important;');
      expandForSnapshot(dialog, ';position:fixed!important;top:0!important;left:0!important;margin:0!important;width:' + originalWidth + 'px!important;height:auto!important;max-height:none!important;overflow:visible!important;transform:none!important;transition:none!important;');
      const fullHeight = Math.max(dialog.scrollHeight, dialog.getBoundingClientRect().height);
      const scale = Math.min(1, (window.innerWidth - 4) / originalWidth, (window.innerHeight - 4) / fullHeight);
      dialog.style.setProperty('transform-origin', 'top left', 'important');
      dialog.style.setProperty('transform', 'scale(' + scale + ')', 'important');
      dialog.style.setProperty('left', ((window.innerWidth - originalWidth * scale) / 2) + 'px', 'important');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = dialog.getBoundingClientRect();
      const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
      const response = await chrome.runtime.sendMessage({type: 'ETHAN_DIALOG_SNAPSHOT'});
      restoreSnapshotLayout();
      if (!response?.ok) throw new Error(response?.message || '截图失败');
      const image = new Image();
      image.src = response.dataUrl;
      await image.decode();
      const sx = image.naturalWidth / viewportWidth, sy = image.naturalHeight / viewportHeight;
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      const width = Math.min(viewportWidth, rect.right) - left;
      const height = Math.min(viewportHeight, rect.bottom) - top;
      if (width <= 0 || height <= 0) throw new Error('弹窗不在可见区域');
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * sx);
      canvas.height = Math.round(height * sy);
      canvas.getContext('2d').drawImage(image, left * sx, top * sy, width * sx, height * sy, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('截图转换失败');
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      button.title = '弹窗快照已复制';
      showSnapshotToast('完整弹窗快照已复制，可直接粘贴。');
    } catch (error) {
      showSnapshotToast('快照复制失败：' + error.message);
    } finally {
      restoreSnapshotLayout();
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.title = '快照并复制弹窗';
    }
  });
  startWorkOrderColumnLayout();
  startAutoOpenWorkOrderPage();
  startAutoApplyDefaultFilters();
  startPageActionInjection();
})();
