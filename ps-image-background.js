let busy = false;
async function importNativeImage(base64, confirmOpen, requestId) {
    if (busy) throw new Error('上一张图片正在处理，请稍候');
    busy = true;
    let port;
    try {
        port = chrome.runtime.connectNative('com.codex.browser.photoshop');
        return await new Promise((resolve, reject) => {
            let offset = 0;
            const timer = setTimeout(() => reject(new Error('本机 PS 处理超时，请检查 PS 图层后重试')), 100000);
            function chunk() {
                if (offset < base64.length) {
                    const value = base64.slice(offset, offset + 192 * 1024); offset += value.length;
                    port.postMessage({ type: 'chunk', value });
                } else port.postMessage({ type: 'execute', confirmOpen });
            }
            port.onMessage.addListener(message => {
                if (message.type === 'ready' || message.type === 'ack') chunk();
                if (message.type === 'progress') console.debug(message.detail);
                if (message.type === 'result') {
                    clearTimeout(timer); message.ok ? resolve(message.result) : reject(new Error(message.error));
                }
            });
            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError?.message;
                clearTimeout(timer);
                reject(new Error(`本机 PS 组件断开：${error || '连接关闭'}。请运行 install-ps-native.ps1 注册组件；扩展 ID：${chrome.runtime.id}`));
            });
            port.postMessage({ type: 'start' });
        });
    } finally { port?.disconnect(); busy = false; }
}

function photoshopImageFormat(bytes) {
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
    const header = String.fromCharCode(...bytes.subarray(0, 12));
    if (/^GIF8[79]a/.test(header)) return 'gif';
    if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') return 'webp';
    return '';
}

async function encodePhotoshopPng(blob) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        throw new Error('下载到的原图无法解码，请在网页中重新打开图片后重试');
    }
    try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const png = await canvas.convertToBlob({ type: 'image/png' });
        if (png.size > 20 * 1024 * 1024) throw new Error('原图转为 PNG 后超过 20MB，无法置入 Photoshop');
        return new Uint8Array(await png.arrayBuffer());
    } finally {
        bitmap.close();
    }
}

async function fetchPhotoshopImage(value, headers) {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error('不支持此图片地址');
    const response = await fetch(url.href, { credentials: 'include', headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('图片超过 20MB'); } chunks.push(value); }
    return new Blob(chunks, { type: response.headers.get('content-type') || '' });
}

async function fetchDoubaoPhotoshopBytes(candidates, { png = false } = {}) {
    let error;
    for (const value of candidates.slice(0, 3)) {
        try {
            // Ask the CDN for an image representation of the same signed URL.
            const blob = await fetchPhotoshopImage(value, { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const format = photoshopImageFormat(bytes);
            if (format === 'png' || (format && !png)) return bytes;
            if (/^(text\/|application\/(?:json|xml))/i.test(blob.type)) {
                throw new Error('豆包原图地址返回了非图片响应，请刷新会话后重试');
            }
            return await encodePhotoshopPng(blob);
        } catch (failure) {
            error = failure;
        }
    }
    throw error;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.source !== 'codex-ps-image' || !sender.tab?.id || sender.id !== chrome.runtime.id) return;
    void (async () => {
        const requestId = crypto.randomUUID();
        try {
            const doubaoCandidates = /^https:\/\/(?:[\w-]+\.)*doubao\.com\//i.test(sender.url || '') && message.doubaoCandidates;
            let blob;
            let bytes;
            if (Array.isArray(doubaoCandidates) && doubaoCandidates.length) {
                bytes = await fetchDoubaoPhotoshopBytes(doubaoCandidates);
            } else if (message.dataUrl && /^(blob:|data:)/.test(message.url)) {
                if (message.dataUrl.length > 28 * 1024 * 1024 || !/^data:image\//.test(message.dataUrl)) throw new Error('图片数据无效或过大');
                blob = await (await fetch(message.dataUrl)).blob();
            } else {
                blob = await fetchPhotoshopImage(message.url);
            }
            if (blob?.size > 20 * 1024 * 1024) throw new Error('图片超过 20MB');
            bytes ??= new Uint8Array(await blob.arrayBuffer());
            const format = photoshopImageFormat(bytes);
            if (!format) {
                bytes = await encodePhotoshopPng(blob);
            } else if (format === 'webp') {
                const version=await new Promise((resolve,reject)=>{
                    const port=chrome.runtime.connectNative('com.codex.browser.photoshop');
                    const timer=setTimeout(()=>{port.disconnect();reject(new Error('PS版本检测超时'));},15000);
                    port.onMessage.addListener(m=>{if(m.type==='result'){clearTimeout(timer);m.ok?resolve(parseFloat(m.result.version)):reject(new Error(m.error));port.disconnect();}});
                    port.onDisconnect.addListener(()=>{const error=chrome.runtime.lastError;clearTimeout(timer);reject(new Error(error?.message || 'PS版本检测连接关闭'));});
                    port.postMessage({type:'version'});
                });
                if (!version || version<24) {
                    bytes = await encodePhotoshopPng(new Blob([bytes], { type: 'image/webp' }));
                }
            }
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            const result = await importNativeImage(btoa(binary), message.confirmOpen === true, requestId);
            reply({ ok: true, result });
        } catch (error) { const needsSetup = /native messaging host.*(forbidden|not found)|specified native messaging host|未找到.*本机/i.test(error.message);
            if (needsSetup) {
                const setupUrl=chrome.runtime.getURL('ps-setup.html');
                const tabs=await chrome.tabs.query({url:setupUrl});
                if(tabs.length) await chrome.tabs.update(tabs[0].id,{active:true});
                else await chrome.tabs.create({url:setupUrl});
            }
            reply({ok:false,error:needsSetup?'首次使用需要安装本机 PS 组件，已打开安装引导。':error.message}); }
    })();
    return true;
});
