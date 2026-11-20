(() => {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || event.detail > 1) return;
    const cell = event.target.closest('td');
    if (!cell?.parentElement.matches('tr.el-table__row')) return;

    const table = cell.closest('.el-table')?.__vue__;
    if (!table?.$listeners?.['row-dblclick'] ||
        !table.columns?.some((column) => column.label === '工单ID')) return;

    const column = table.columns.find((candidate) => cell.classList.contains(candidate.id));
    if (!column || column.label === '公司名称' || column.type === 'selection') return;
    if (event.target.closest('button, a, input, select, textarea, label, [role=button]')) return;

    // Let Element UI resolve the clicked row and run its existing editor handler.
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
})();
