(() => {
  'use strict';
  if (window.__ethanQuickQueryBridge) return;
  window.__ethanQuickQueryBridge = true;
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
