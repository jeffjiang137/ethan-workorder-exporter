(() => {
  'use strict';
  if (window.__ethanFollowupRefresh) return;
  window.__ethanFollowupRefresh = true;
  let pending;
  function headerFor(button, title) {
    let node = button.parentElement;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const text = node.textContent.replace(/\s/g, '');
      if (text.startsWith(title) && text.length < 120) return node;
    }
    return null;
  }
  function refreshFollowup() {
    for (const button of document.querySelectorAll('button')) {
      if (!button.getClientRects().length || button.disabled) continue;
      if (!button.querySelector('.el-icon-refresh,.el-icon-refresh-right,.el-icon-refresh-left')) continue;
      if (headerFor(button, '客户跟进')) { button.click(); return; }
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button || !button.textContent.includes('保存') || !headerFor(button, '服务项目')) return;
    pending?.();
    const originalMessages = new Set(document.querySelectorAll('.el-message'));
    const path = location.href;
    const check = () => {
      if (location.href !== path || !button.isConnected) { stop(); return; }
      const messages = Array.from(document.querySelectorAll('.el-message')).filter(node => !originalMessages.has(node));
      if (messages.some(node => node.classList.contains('el-message--error'))) { stop(); return; }
      if (messages.some(node => node.classList.contains('el-message--success')
          || /数据没有更改|数据没有更改，不需保存|无需保存|不需保存/.test(node.textContent))) {
        stop();
        refreshFollowup();
      }
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => stop(), 15000);
    function stop() { observer.disconnect(); clearTimeout(timer); if (pending === stop) pending = null; }
    pending = stop;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }, true);
})();
