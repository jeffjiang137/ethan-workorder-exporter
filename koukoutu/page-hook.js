'use strict';

(() => {
  if (window.__KKT_DELETE_CONFIRM_HOOK__) return;
  window.__KKT_DELETE_CONFIRM_HOOK__ = true;

  const nativeConfirm = window.confirm.bind(window);
  let deleteConfirmExpiresAt = 0;

  window.addEventListener('KKT_AUTO_CONFIRM_DELETE', () => {
    deleteConfirmExpiresAt = Date.now() + 5_000;
  });

  const confirmInterceptor = (message) => {
    const text = String(message || '');
    if (Date.now() <= deleteConfirmExpiresAt && /(删除|移除|delete|remove)/i.test(text)) {
      deleteConfirmExpiresAt = 0;
      window.dispatchEvent(new Event('KKT_AUTO_CONFIRM_DELETE_DONE'));
      return true;
    }
    return nativeConfirm(message);
  };

  try {
    window.confirm = confirmInterceptor;
  } catch (_) {
    // If the page locks this property, the content script will safely stop
    // when the card count does not decrease instead of deleting anything else.
  }
})();
