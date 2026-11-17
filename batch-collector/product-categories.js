(() => {
  if (globalThis.__ethanProductCategories) return;
  const groups = [
    ['SKU图', '.module-od-sku-selection,[class*="valueItem--"],[class*="valueItemImgWrap--"],[class*="sale-prop"],[class*="saleProp"],[class*="prop-item"],[class*="propItem"],[class*="spec-item"]'],
    ['主图', '.module-od-picture-gallery .od-picture-gallery-list > li:not(.video-image-cover),[class*="thumbnailItem--"] img,#J_UlThumb img'],
    ['详情图', '#imageTextInfo-content,.desc-root,#J_DivItemDesc,.html-description,#description,#detailContent,#desc-lazyload-container,[class*="description-content"]']
  ];
  function urls(node) {
    const values = ['data-original','data-lazy-src','data-actualsrc','data-ks-lazyload','data-lazyload-src','data-src','src']
      .map(name => node.getAttribute?.(name)).filter(Boolean);
    const style = node.style?.backgroundImage || '';
    for (const match of style.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) values.push(match[1]);
    if (node.currentSrc) values.push(node.currentSrc);
    return values;
  }
  function key(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin + url.pathname.replace(/(\.(?:jpg|jpeg|png|webp))_.*$/i, '$1');
    } catch (_) { return value; }
  }
  globalThis.__ethanProductCategories = items => {
    const categories = new Map();
    const metadata = new Map();
    const categoryCounts = {};
    const excluded = new Set();
    const extra = [];
    for (const [category, selector] of groups) {
      for (const region of (category === "主图" ? Array.from(document.querySelectorAll(selector)).slice(0, 5) : document.querySelectorAll(selector))) {
        if (region.closest('#bf-v14-collector-host,[class*="wcm-"],#wcm-dialog')) continue;
        const root = region.shadowRoot || region;
        for (const node of [region, ...root.querySelectorAll('img,[style*="background"]')]) {
          for (const src of urls(node)) {
            const id = key(src);
            if (!/(?:ibank|imgextra|bao\/uploaded)/i.test(id)) continue;
            if (category === '详情图' && node.closest('.sdmap-dynamic-offer-list,.offer-list-wapper,.dynamic-backup-img,a[href*="description.sdmap"]')) {
              excluded.add(id);
              continue;
            }
            if (categories.has(id) && category !== "主图") continue;
            categories.set(id, category);
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            const skuItem = category === 'SKU图' ? node.closest('.sku-filter-button,.expand-view-item,[class*="sku-item"],[class*="prop-item"]') : null;
            const label = skuItem?.querySelector('.label-name,.item-label,[class*="value-name"],[class*="prop-name"]');
            const retailItem = node.closest('[class*="valueItem--"]');
            const retailLabel = retailItem?.querySelector('[class*="valueItemText--"]');
            const skuName = (retailLabel?.getAttribute('title') || retailLabel?.textContent || label?.getAttribute('title') || label?.textContent || skuItem?.getAttribute('title') || node.alt || '').trim();
            metadata.set(id, { categoryOrder: categoryCounts[category], skuName: category === 'SKU图' ? skuName : '' });
            // 直接补齐商品区域的图片地址，包含尚无尺寸的懒加载详情图。
            // 通用扫描会按可见性过滤，这里使用明确的区域和营销排除规则。
            extra.push({src: id, type:'image', category, categoryOrder: categoryCounts[category], skuName: category === 'SKU图' ? skuName : '', categoryExplicit: true, width:node.naturalWidth || 0, height:node.naturalHeight || 0, title:node.alt || document.querySelector('.title-content h1')?.textContent || document.title, sourceLink:location.href, pageUrl:location.href});
          }
        }
      }
    }
    const result = new Map();
    for (const item of [...items, ...extra]) {
      const id = key(item.originalSrc || item.src);
      if (excluded.has(id)) continue;
      const category = item.categoryExplicit ? item.category : categories.get(id) || '其他';
      const normalized = {...item, ...metadata.get(id), category};
      if (item.categoryExplicit) { normalized.categoryOrder = item.categoryOrder; normalized.skuName = item.skuName; }
      if (category !== '其他' && item.type === 'image') {
        normalized.src = id;
        normalized.originalSrc = id;
        normalized.identitySrc = id;
        normalized.candidates = [id];
      }
      const identity = item.type + '|' + category + '|' + id;
      const previous = result.get(identity);
      if (!previous || normalized.width * normalized.height > previous.width * previous.height) result.set(identity, normalized);
    }
    return [...result.values()];
  };
})();
