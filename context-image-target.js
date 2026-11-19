// Remember the actual right-click location even when a product link covers its image.
(() => {
  document.addEventListener('contextmenu', event => {
    const valid = value => {
      try {
        const url = new URL(value, document.baseURI);
        return /^(https?:|blob:|data:)/.test(url.protocol) ? url.href : '';
      } catch { return ''; }
    };
    const read = element => {
      if (element.tagName === 'IMG') return valid(element.currentSrc || element.getAttribute('data-src') || element.src);
      const background = getComputedStyle(element).backgroundImage;
      const match = background.match(/url\(["']?(.*?)["']?\)/);
      return match ? valid(match[1]) : '';
    };
    const { clientX: x, clientY: y } = event;
    let src = '';
    for (const element of document.elementsFromPoint(x, y)) {
      src = read(element);
      if (src) break;
      // Only consider images visually under the click, never another card.
      for (const image of element.querySelectorAll('img')) {
        const rect = image.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          src = read(image);
          if (src) break;
        }
      }
      if (src) break;
    }
    // Walk only as far as a single product card; stop before a multi-product grid.
    const productUrl = anchor => {
      try {
        const url = new URL(anchor.href, document.baseURI);
        return /^https?:$/.test(url.protocol) && /(?:^|\.)1688\.com$/i.test(url.hostname) && /^\/offer\/\d+\.html$/.test(url.pathname) ? url.href : '';
      } catch { return ''; }
    };
    let title = '', sourceLink = '';
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    for (let node = event.target; node && node !== document.body; node = node.parentElement) {
      const anchors = [...(node.matches?.('a[href]') ? [node] : []), ...node.querySelectorAll('a[href]')];
      const links = anchors.filter(anchor => productUrl(anchor));
      const ids = new Set(links.map(anchor => new URL(productUrl(anchor)).pathname));
      if (ids.size > 1) break;
      if (!links.length) continue;
      sourceLink = productUrl(links[0]);
      const names = links.map(anchor => clean(anchor.getAttribute('title') || anchor.innerText || anchor.getAttribute('aria-label'))).filter(Boolean);
      const image = node.matches?.('img') ? node : node.querySelector('img');
      title = names.sort((a, b) => b.length - a.length)[0] || clean(image?.getAttribute('alt') || image?.getAttribute('title')) || title;
      if (title) break;
    }
    globalThis.__ethanContextImage = { src, title, sourceLink, time: Date.now() };
  }, true);
})();
