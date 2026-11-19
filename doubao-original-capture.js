(() => {
    // Read the original URL supplied by Doubao without modifying its signature.
    const originalKey = /(?:^|\.)(?:image_ori_raw|no_?watermark|unwatermark|without_?watermark)(?:\.|$)/i;
    const excludedKey = /^(avatar|icon|emoji|input|upload|user|human|reference|refer|mask|source|init|before|prompt_image|image_pre(?:view)?|preview_image|image_preview|with_watermark)$/i;
    const seen = new Map();

    function walk(value, path = '', depth = 0) {
        if (depth > 16 || value == null) return;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (/^[\[{]/.test(trimmed) && trimmed.length < 5_000_000) {
                try { walk(JSON.parse(trimmed), path, depth + 1); } catch {}
                return;
            }
            const url = trimmed.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/^\/\//, 'https://');
            if (!/^https:\/\//i.test(url) || /(?:^|[-_])lwm\d*(?:[._-]|$)|watermark|preview|downsize|thumbnail|resize[:/_,-]/i.test(url)) return;
            const rawImage = /\/rc_gen_image\/[^?#]+-image_raw\.(?:png|jpe?g|webp|avif)(?:[?#]|$)/i.test(url);
            const rank = originalKey.test(path) || rawImage ? 3 : 0;
            if (!rank || seen.get(url) === rank) return;
            if (seen.size >= 800) seen.delete(seen.keys().next().value);
            seen.set(url, rank);
            window.postMessage({ type: 'ethan-doubao-original', url, rank }, location.origin);
            return;
        }
        if (typeof value !== 'object' || [value.role, value.message_role, value.author?.role, value.sender?.role].some(role => /^(user|human)$/i.test(role))) return;
        for (const [key, item] of Object.entries(value)) {
            if (!excludedKey.test(key)) walk(item, path + '.' + key, depth + 1);
        }
    }

    function scan(text) {
        try { walk(JSON.parse(text)); return; } catch {}
        for (const line of text.split(/\r?\n/)) {
            const payload = line.replace(/^data:\s*/, '').trim();
            if (/^[\[{]/.test(payload)) {
                try { walk(JSON.parse(payload)); } catch {}
            }
        }
    }

    function isDoubaoResponse(value) {
        try { return /(^|\.)doubao\.com$/i.test(new URL(value, location.href).hostname); }
        catch { return false; }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const url = response.url || args[0]?.url || args[0];
        if (isDoubaoResponse(url) && /json|event-stream|text\/plain/i.test(response.headers.get('content-type') || '')) {
            const copy = response.clone();
            if (/event-stream/i.test(copy.headers.get('content-type')) && copy.body) {
                void (async () => {
                    const reader = copy.body.pipeThrough(new TextDecoderStream()).getReader();
                    let pending = '';
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) { scan(pending); break; }
                        pending += value;
                        const lastBreak = pending.lastIndexOf('\n');
                        if (lastBreak >= 0) {
                            scan(pending.slice(0, lastBreak));
                            pending = pending.slice(lastBreak + 1);
                        }
                        if (pending.length > 5_000_000) pending = '';
                    }
                })().catch(() => {});
            } else {
                void copy.text().then(scan).catch(() => {});
            }
        }
        return response;
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener('load', () => {
            if (!isDoubaoResponse(this.responseURL)) return;
            if (this.responseType === 'json') walk(this.response);
            else if (!this.responseType || this.responseType === 'text') scan(this.responseText);
        }, { once: true });
        return originalSend.apply(this, args);
    };
})();
