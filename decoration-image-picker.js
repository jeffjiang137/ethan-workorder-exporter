(() => {
  if (window.parent === window ||
      document.referrer.split('/')[2] !== 'mobiledesign.1688.com') return;

  const storageKey = 'decorationLastUploadAlbum';
  const albumSelector = '.tabs-content.upload .upload-form select';
  let rememberedAlbum;
  let albumReady = false;
  let switched = false;
  let restored = false;

  document.addEventListener('change', event => {
    if (!event.isTrusted || !event.target.matches(albumSelector)) return;
    rememberedAlbum = event.target.value;
    restored = true;
    chrome.storage.local.set({ [storageKey]: rememberedAlbum }).catch(() => {});
  }, true);

  function applyDefaults() {
    const uploadTab = document.querySelector('.ib-wrap li.tab-upload');
    if (!switched && uploadTab?.getClientRects().length) {
      switched = true;
      if (!uploadTab.classList.contains('current')) uploadTab.click();
    }

    if (!switched || !albumReady || restored) return;
    const select = document.querySelector(albumSelector);
    if (!select?.options.length) return;
    if (!rememberedAlbum) {
      restored = true;
      return;
    }
    if (![...select.options].some(option => option.value === rememberedAlbum &&
        !option.disabled && !option.closest('optgroup[disabled]'))) return;

    restored = true;
    if (select.value !== rememberedAlbum) {
      select.value = rememberedAlbum;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  const observer = new MutationObserver(applyDefaults);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'value']
  });
  applyDefaults();
  chrome.storage.local.get(storageKey).then(items => {
    if (!restored) rememberedAlbum = items[storageKey];
  }).catch(() => {}).finally(() => {
    albumReady = true;
    applyDefaults();
  });
})();
