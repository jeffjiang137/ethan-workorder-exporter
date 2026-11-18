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

const extractShopPageLinks = () => {
        const recommendationRoots = Array.from(document.querySelectorAll('div,h2,h3,section')).filter(node =>
          node.textContent.trim().startsWith('为你推荐') && node.textContent.trim().length < 80 &&
          !Array.from(node.children).some(child => child.textContent.trim().startsWith('为你推荐'))
        ).map(header => {
          let root = header;
          for (let depth = 0; depth < 4 && root.parentElement; depth += 1) {
            if (root.querySelectorAll('img').length) break;
            root = root.parentElement;
          }
          return root;
        });
        const isRecommendation = node => recommendationRoots.some(root => root.contains(node)) ||
          !!node.closest('[class*="recommend-offer"],[class*="recommendOffer"]');
        const links = new Set();
        for (const anchor of document.querySelectorAll('a[href]')) {
          if (isRecommendation(anchor)) continue;
          let url;
          try { url = new URL(anchor.getAttribute('href'), document.baseURI); } catch { continue; }
          const offer = url.hostname === 'detail.1688.com' && url.pathname.match(/^\/offer\/(\d+)\.html$/);
          if (offer) {
            links.add(`https://detail.1688.com/offer/${offer[1]}.html`);
          } else if (url.hostname.endsWith('.alibaba.com') && /^\/product-detail\/.+\.html$/.test(url.pathname)) {
            links.add(`https://${url.hostname}${url.pathname}`);
          } else if (['item.taobao.com', 'detail.tmall.com'].includes(url.hostname)
              && url.pathname === '/item.htm' && /^\d+$/.test(url.searchParams.get('id') || '')) {
            links.add(`https://${url.hostname}/item.htm?id=${url.searchParams.get('id')}`);
          }
        }
        // Modern 1688 shop cards navigate through React events, without anchor URLs.
        if (location.hostname === '1688.com' || location.hostname.endsWith('.1688.com')) {
          const visited = new Set();
          for (const element of document.querySelectorAll('p[title], [data-offer-id], [data-offerid]')) {
            if (isRecommendation(element)) continue;
            const attributeId = element.getAttribute('data-offer-id') || element.getAttribute('data-offerid');
            if (/^\d{6,20}$/.test(attributeId || '')) links.add(`https://detail.1688.com/offer/${attributeId}.html`);
            const key = Object.keys(element).find(key => /^__react(?:InternalInstance|Fiber)\$/.test(key));
            let fiber = key && element[key];
            for (let depth = 0; fiber && depth < 12 && !visited.has(fiber); depth++, fiber = fiber.return) {
              visited.add(fiber);
              const props = fiber.memoizedProps;
              const data = props?.data;
              if (data && typeof data === 'object' && typeof data.title === 'string'
                  && data.imgUrl && /^\d{6,20}$/.test(String(data.id))) {
                links.add(`https://detail.1688.com/offer/${data.id}.html`);
              }
            }
          }
        }
        return [...links];
      };
let shopLinkCollectionRunning = false;

async function shopPageNavigation(action) {
  const next = [...document.querySelectorAll('button')].find(el => /下一页/.test(el.textContent));
  if (!next) {
    if (/\/page\/offerlist\.htm/.test(location.pathname)) return {current:1,total:1};
    return { error: '未找到商品分页，请打开店铺「全部商品」页面' };
  }
  const pager = next.parentElement;
  const text = pager.innerText;
  const page = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!page) return { error: '无法确认分页状态，已停止并保留结果' };
  const current = Number(page[1]), total = Number(page[2]);
  if (action === 'first' && current !== 1) {
    const first = [...pager.querySelectorAll('button,a,span')].find(el => el.textContent.trim() === '1');
    if (!first) return { error: '无法定位第一页' };
    first.click();
  }
  if (action === 'next' && current < total) next.click();
  return {current,total};
}

async function collectShopLinks(tabId) {
  await ensureOffscreenDocument();
  await delayMs(180);
  await setOffscreenKeepAlive(true);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https:\/\/[^/]+\.1688\.com\/page\/offerlist\.htm/.test(tab.url || '')) {
      throw new Error('请先打开店铺的「全部商品」页面');
    }
    await chrome.storage.local.set({
      ethanProductLinksDraft:'',
      shopLinkProgress:'已清空原有链接，正在获取全店链接…'
    });
    let expectedPage = 1;
    let previousSignature = '';
    await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:shopPageNavigation,args:['first']})
      .then(results => { if (results[0]?.result?.error) throw new Error(results[0].result.error); });
    while (expectedPage <= 500) {
      await chrome.storage.local.set({shopLinkProgress:'正在获取全店第 ' + expectedPage + ' 页…'});
      let links, page;
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await delayMs(1500);
        const [state] = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:shopPageNavigation,args:['status']});
        page = state?.result;
        if (page?.error) throw new Error(page.error + '，如遇验证码请手动验证');
        if (page.current !== expectedPage) continue;
        const [result] = await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:extractShopPageLinks});
        links = result?.result || [];
        if (links.length && links.join('|') !== previousSignature) break;
        links = null;
      }
      if (!links) throw new Error('页面加载超时或翻页未更新，已保留获取结果');
      previousSignature = links.join('|');
      const stored = await chrome.storage.local.get('ethanProductLinksDraft');
      const lines = (stored.ethanProductLinksDraft || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      const identity = value => value.match(/\/offer\/(\d+)\.html/)?.[1] || value;
      const seen = new Set(lines.map(identity));
      for (const link of links) if (!seen.has(identity(link))) { seen.add(identity(link)); lines.push(link); }
      await chrome.storage.local.set({ethanProductLinksDraft:lines.join('\n'),
        shopLinkProgress:'已获取 ' + expectedPage + '/' + page.total + ' 页 · 总计 ' + seen.size + ' 个链接'});
      if (expectedPage >= page.total) return;
      await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:shopPageNavigation,args:['next']});
      expectedPage += 1;
    }
    throw new Error('已达到 500 页上限，结果已保存');
  } finally {
    shopLinkCollectionRunning = false;
    await setOffscreenKeepAlive(false);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'ETHAN_COLLECT_SHOP_LINKS') return false;
  if (shopLinkCollectionRunning || MATERIAL_JOB_STATE.running || linkedProductQueueRunning) {
    respond({message:'已有采集或下载任务正在运行，请稍后再试'});
    return false;
  }
  shopLinkCollectionRunning = true;
  respond({message:'全店链接采集已启动，可关闭面板，结果会自动保存'});
  void collectShopLinks(message.tabId).catch(error => chrome.storage.local.set({shopLinkProgress:ethanChineseError(error.message)}));
  return false;
});
