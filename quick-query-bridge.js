(() => {
  'use strict';
  if (window.__ethanQuickQueryBridge) return;
  window.__ethanQuickQueryBridge = true;
  const operatorFilters = new WeakSet();
  const operatorStyle = document.createElement('style');
  operatorStyle.textContent = `
    .ethan-operator-filter .el-select-dropdown__list:not(.el-select-group__wrap .el-select-dropdown__list),
    .ethan-operator-filter .el-select-group { display:flex; flex-direction:column; }
    .ethan-operator-filter .ethan-design-operator { order:-1; }
  `;
  document.head.append(operatorStyle);

  document.addEventListener('ethan-prioritize-design-operators', event => {
    const select = event.target.__vue__;
    if (select?.$options.name !== 'ElSelect' || operatorFilters.has(select)) return;
    operatorFilters.add(select);

    const prioritize = dropdown => {
      for (const option of dropdown.querySelectorAll('.el-select-dropdown__item')) {
        option.classList.toggle('ethan-design-operator', /^设计\s*[-－—–]/.test(option.textContent.trim()));
      }
    };
    let observer;
    const updateDropdown = visible => {
      observer?.disconnect();
      const dropdown = select.$refs.popper?.$el;
      if (!visible || !dropdown) {
        dropdown?.classList.remove('ethan-operator-filter');
        return;
      }
      dropdown.classList.add('ethan-operator-filter');
      prioritize(dropdown);
      observer = new MutationObserver(() => prioritize(dropdown));
      observer.observe(dropdown, { childList: true, characterData: true, subtree: true });
      select.$nextTick(() => {
        requestAnimationFrame(() => {
          const scroll = dropdown.querySelector('.el-scrollbar__wrap');
          if (select.visible && scroll) scroll.scrollTop = 0;
        });
      });
    };
    select.$watch('visible', updateDropdown, { immediate: true });
    select.$once('hook:beforeDestroy', () => observer?.disconnect());
  });

  function update() {
    for (const element of document.querySelectorAll('.el-dropdown')) {
      if (!element.textContent.includes('常用快捷查询')) continue;
      const control = element.querySelector('[aria-controls],button');
      let owner = element.__vue__;
      while (owner && !Array.isArray(owner.userMenuList)) owner = owner.$parent;
      if (!control || !owner) continue;
      const data = JSON.stringify(owner.userMenuList.map((item, index) => ({
        id: String(item.menu_id ?? index), label: item.menu_title, index
      })));
      if (control.dataset.ethanQueries !== data) control.dataset.ethanQueries = data;
      control.__ethanQueryOwner = owner;
    }
  }
  document.addEventListener('ethan-run-personal-query', event => {
    const control = event.target;
    const owner = control.__ethanQueryOwner;
    const id = control.dataset.ethanRequestedQuery;
    const index = owner?.userMenuList?.findIndex((item, index) => String(item.menu_id ?? index) === id);
    if (index >= 0) owner.handleCommand(`user-${index}`);
  });
  setInterval(update, 500);
  update();
})();
