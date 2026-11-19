(() => {
    const originals = new Map();
    let enabled = true;
    let rightClicked = null;
    const watermark = /(?:^|[-_])lwm\d*(?:[._-]|$)|watermark|image_pre(?:view)?|preview|downsize|thumbnail|resize[:/_,-]/i;
    const source = img => img?.currentSrc || img?.src || '';
    const missing = '未匹配到这张豆包图片的无水印原图，请刷新豆包后重新打开图片再试。';

    function asset(value) {
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || !/(^|\.)(doubao\.com|byteimg\.com|byteimg\.cn|ibytedtos\.com|volces\.com|volccdn\.com)$/i.test(url.hostname)) return null;
            const path = decodeURIComponent(url.pathname).split('~')[0];
            const id = path.match(/(?:rc_gen_image|aigc_image|inpaint|outpaint|expand_image|edit_image)[/_-]([^/]+)/i)?.[1]
                || path.match(/\/([\w-]{20,})(?:\.[a-z0-9]+)?$/i)?.[1];
            return id ? { id: id.replace(/\.(png|jpe?g|webp|avif|bmp|gif)$/i, ''), url } : null;
        } catch { return null; }
    }

    function valid(item) {
        const expiry = item.url.searchParams.get('x-expires');
        return !expiry || !/^\d{10,13}$/.test(expiry) || Number(expiry) * (expiry.length === 13 ? 1 : 1000) > Date.now();
    }

    chrome.storage.local.get({ doubaoOriginalEnabled: true }).then(settings => { enabled = settings.doubaoOriginalEnabled; });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.doubaoOriginalEnabled) enabled = changes.doubaoOriginalEnabled.newValue ?? true;
    });

    window.addEventListener('message', event => {
        const data = event.data;
        if (event.source !== window || event.origin !== location.origin || data?.type !== 'ethan-doubao-original' || data.rank !== 3) return;
        const item = asset(data.url);
        if (!item || watermark.test(item.url.href) || !valid(item)) return;
        const alternatives = (originals.get(item.id) || []).filter(other => other.url.href !== item.url.href && valid(other));
        originals.delete(item.id);
        originals.set(item.id, [item, ...alternatives].slice(0, 3));
        if (originals.size > 400) originals.delete(originals.keys().next().value);
    });

    function cachedOriginal(target) {
        try {
            const items = JSON.parse(sessionStorage.getItem('doubaoGeneratedAssetMapV9') || '[]');
            const match = items.find(entry => {
                const item = asset(entry?.url);
                return entry?.kind === 'image' && item?.id === target.id && valid(item) &&
                    /-image_raw\.(?:png|jpe?g|webp|avif)$/i.test(item.url.pathname);
            });
            return match?.url;
        } catch { return undefined; }
    }

    function resolve(value) {
        if (!enabled) return { enabled };
        const target = asset(value);
        if (!target) return { enabled, error: missing };
        const candidates = (originals.get(target.id) || []).filter(valid).map(item => item.url.href);
        const cached = cachedOriginal(target);
        if (cached && !candidates.includes(cached)) candidates.unshift(cached);
        if (candidates.length) return { enabled, url: candidates[0], candidates };
        return { enabled, error: missing };
    }
    globalThis.ethanDoubaoOriginal = resolve;

    window.addEventListener('contextmenu', event => {
        rightClicked = event.target instanceof HTMLImageElement ? event.target : null;
    }, true);
    globalThis.ethanDoubaoContextOriginal = value => resolve(value || source(rightClicked));

    function previewImage(button) {
        const activeThumbnail = [...document.querySelectorAll('img[class*="thumb-image-"][class*="active-"]')]
            .find(img => {
                const rect = img.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.left > innerWidth / 2;
            });
        if (activeThumbnail) return activeThumbnail;
        const dialog = button.closest('dialog,[role="dialog"]');
        const buttonRect = button.getBoundingClientRect();
        const images = [];
        for (const img of (dialog || document).querySelectorAll('img')) {
            const box = img.getBoundingClientRect();
            if (box.width < 120 || box.height < 120 || box.bottom <= buttonRect.bottom ||
                (!dialog && box.left + box.width / 2 < innerWidth / 2)) continue;
            const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            if (hit !== img && !hit?.contains(img)) continue;
            images.push({ img, area: box.width * box.height });
        }
        images.sort((a, b) => b.area - a.area);
        return images[0]?.img;
    }

    window.addEventListener('click', event => {
        if (!enabled || !(event.target instanceof Element)) return;
        const cardDownload = event.target.closest('[data-testid="edit_image_hover_tag_download_btn"]');
        if (cardDownload) {
            const card = cardDownload.closest('[class*="hover-actions-slot-"]')?.parentElement;
            const img = [...(card?.querySelectorAll('img') || [])].find(image => asset(source(image)));
            event.preventDefault();
            event.stopImmediatePropagation();
            downloadOriginal(img);
            return;
        }
        const label = event.composedPath().find(element => {
            if (!(element instanceof Element)) return false;
            const names = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent];
            return names.some(name => /^(保存|保存图片|下载原图)$/.test(name?.trim()));
        });
        if (!label) return;
        const button = label.closest('button,[role="button"],a') || label;
        const img = previewImage(button);
        // The viewer toolbar is on the right even when the current image is
        // rendered via a blob or the display image has not finished loading.
        if (!img && button.getBoundingClientRect().left < innerWidth * 0.75) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        downloadOriginal(img);
    }, true);

    function downloadOriginal(img) {
        const result = resolve(source(img));
        if (!result.url) { window.alert(result.error); return; }
        chrome.runtime.sendMessage({ type: 'ethan-doubao-save-original', url: result.url, candidates: result.candidates })
            .then(reply => { if (!reply?.ok) window.alert(reply?.error || '豆包原图下载失败'); })
            .catch(() => window.alert('豆包原图下载失败，请刷新网页后重试。'));
    }
})();
