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

(() => {
  'use strict';

  let keepAliveActive = false;
  let keepAlivePort = null;
  let keepAliveReconnectTimer = null;

  function connectKeepAlivePort() {
    clearTimeout(keepAliveReconnectTimer);
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'ETHAN_MATERIAL_KEEPALIVE' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        if (keepAliveActive) keepAliveReconnectTimer = setTimeout(connectKeepAlivePort, 700);
      });
    } catch (error) {
      keepAlivePort = null;
      if (keepAliveActive) keepAliveReconnectTimer = setTimeout(connectKeepAlivePort, 700);
    }
  }

  function sendKeepAlivePing() {
    if (!keepAliveActive) return;
    if (!keepAlivePort) connectKeepAlivePort();
    try {
      keepAlivePort?.postMessage({ type: 'ETHAN_MATERIAL_KEEPALIVE_PING', at: Date.now() });
    } catch (error) {
      keepAlivePort = null;
      connectKeepAlivePort();
    }
  }

  connectKeepAlivePort();
  setInterval(sendKeepAlivePing, 15000);
  const textEncoder = new TextEncoder();
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
  }

  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  class StoreZipWriter {
    constructor() {
      this.parts = [];
      this.entries = [];
      this.offset = 0;
    }

    addDirectory(path) {
      const normalized = path.endsWith('/') ? path : `${path}/`;
      if (this.entries.some((entry) => entry.name === normalized)) return;
      this.addFile(normalized, new Uint8Array(), true);
    }

    addFile(path, bytes, isDirectory = false) {
      const name = path.replace(/\\/g, '/');
      const nameBytes = textEncoder.encode(name);
      const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const crc = isDirectory ? 0 : crc32(payload);
      const dt = dosDateTime();
      const header = new ArrayBuffer(30 + nameBytes.length);
      const view = new DataView(header);
      writeU32(view, 0, 0x04034b50);
      writeU16(view, 4, 20);
      writeU16(view, 6, 0x0800);
      writeU16(view, 8, 0);
      writeU16(view, 10, dt.time);
      writeU16(view, 12, dt.date);
      writeU32(view, 14, crc);
      writeU32(view, 18, payload.byteLength);
      writeU32(view, 22, payload.byteLength);
      writeU16(view, 26, nameBytes.length);
      writeU16(view, 28, 0);
      new Uint8Array(header, 30).set(nameBytes);
      const localOffset = this.offset;
      this.parts.push(header);
      this.offset += header.byteLength;
      if (payload.byteLength) {
        this.parts.push(payload);
        this.offset += payload.byteLength;
      }
      this.entries.push({ name, nameBytes, crc, size: payload.byteLength, offset: localOffset, time: dt.time, date: dt.date, isDirectory });
    }

    build() {
      const centralStart = this.offset;
      for (const entry of this.entries) {
        const header = new ArrayBuffer(46 + entry.nameBytes.length);
        const view = new DataView(header);
        writeU32(view, 0, 0x02014b50);
        writeU16(view, 4, 20);
        writeU16(view, 6, 20);
        writeU16(view, 8, 0x0800);
        writeU16(view, 10, 0);
        writeU16(view, 12, entry.time);
        writeU16(view, 14, entry.date);
        writeU32(view, 16, entry.crc);
        writeU32(view, 20, entry.size);
        writeU32(view, 24, entry.size);
        writeU16(view, 28, entry.nameBytes.length);
        writeU16(view, 30, 0);
        writeU16(view, 32, 0);
        writeU16(view, 34, 0);
        writeU16(view, 36, 0);
        writeU32(view, 38, entry.isDirectory ? 0x10 : 0);
        writeU32(view, 42, entry.offset);
        new Uint8Array(header, 46).set(entry.nameBytes);
        this.parts.push(header);
        this.offset += header.byteLength;
      }
      const centralSize = this.offset - centralStart;
      const end = new ArrayBuffer(22);
      const view = new DataView(end);
      writeU32(view, 0, 0x06054b50);
      writeU16(view, 4, 0);
      writeU16(view, 6, 0);
      writeU16(view, 8, this.entries.length);
      writeU16(view, 10, this.entries.length);
      writeU32(view, 12, centralSize);
      writeU32(view, 16, centralStart);
      writeU16(view, 20, 0);
      this.parts.push(end);
      return new Blob(this.parts, { type: 'application/zip' });
    }
  }

  function sanitizeSegment(value, fallback = '未命名产品', maxLength = 100) {
    let text = String(value || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();
    if (!text) text = fallback;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(text)) text = `_${text}`;
    return Array.from(text).slice(0, maxLength).join('');
  }

  function extensionFromType(type, url, fallback) {
    const typeMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'application/vnd.apple.mpegurl': 'm3u8', 'application/x-mpegurl': 'm3u8' };
    if (typeMap[type]) return typeMap[type];
    try {
      const match = decodeURIComponent(new URL(url).pathname).match(/\.([a-z0-9]{2,5})(?:$|_)/i);
      if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
    } catch (error) {}
    return fallback;
  }

  function filenameFromUrl(url, type, index, category) {
    let base = '';
    try {
      base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    } catch (error) {}
    base = base
      .replace(/(\.(?:jpe?g|png|webp|gif|bmp|avif))_\.(?:webp|avif)$/i, '$1')
      .replace(/(\.(?:jpe?g|png|webp|gif|bmp|avif))_(?:\d+x\d+|q\d+|Q\d+|sum|search)[^/?]*(?:\.(?:jpe?g|png|webp|gif|avif))?$/i, '$1');
    const isVideo = /视频/.test(category);
    const ext = extensionFromType(type, url, isVideo ? 'mp4' : 'jpg');
    if (category === '主图' || category === '描述图') return `${category}_${String(index + 1).padStart(3, '0')}.${ext}`;
    if (!base || !/\.[a-z0-9]{2,5}$/i.test(base)) base = `${category}_${String(index + 1).padStart(3, '0')}.${ext}`;
    base = sanitizeSegment(base, `${category}_${String(index + 1).padStart(3, '0')}.${ext}`, 150);
    if (!base.toLowerCase().endsWith(`.${ext}`) && !/\.[a-z0-9]{2,5}$/i.test(base)) base += `.${ext}`;
    return base;
  }

  function uniqueFilename(name, used) {
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
    const match = name.match(/^(.*?)(\.[^.]+)?$/);
    const stem = match?.[1] || name;
    const ext = match?.[2] || '';
    let n = 2;
    let candidate;
    do { candidate = `${stem}(${n})${ext}`; n += 1; } while (used.has(candidate.toLowerCase()));
    used.add(candidate.toLowerCase());
    return candidate;
  }

  async function fetchBlob(url, sourceUrl) {
    const gate = await chrome.runtime.sendMessage({type:'ETHAN_LINK_QUEUE_GATE'});
    if (gate?.ok === false) throw new Error('任务已清除');
    const attempts = [];
    if (sourceUrl) attempts.push({ credentials: 'include', cache: 'force-cache', referrer: sourceUrl, referrerPolicy: 'no-referrer-when-downgrade' });
    attempts.push({ credentials: 'include', cache: 'force-cache' });
    attempts.push({ credentials: 'omit', cache: 'no-cache' });
    let lastError = null;
    for (const options of attempts) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) { lastError = new Error(`HTTP ${response.status}`); continue; }
        return response.blob();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('下载素材失败');
  }

  async function imageInfo(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const info = { width: bitmap.width, height: bitmap.height, bitmap };
      return info;
    } catch (error) {
      return null;
    }
  }

  function validImage(category, blob, info) {
    if (!info || !info.width || !info.height) return false;
    const { width, height } = info;
    if (category === 'SKU图') return width >= 32 && height >= 32;
    if (category === '描述图') return width >= 160 && height >= 20 && width * height >= 12000;
    if (blob.size < 3500) return false;
    if (width <= 64 && height <= 64) return false;
    if (category === '主图') return width >= 180 && height >= 180 && width * height >= 45000;
    return true;
  }

  async function canvasToJpeg(canvas, quality = 0.92) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画布导出失败')), 'image/jpeg', quality));
  }

  async function makeStitchedDetailImages(detailItems) {
    if (!detailItems.length) return [];
    const targetWidth = Math.max(500, Math.min(1400, Math.max(...detailItems.map((item) => item.width || 0))));
    if (!Number.isFinite(targetWidth) || targetWidth <= 0) return [];
    const maxHeight = 30000;
    const parts = [];
    let canvas = document.createElement('canvas');
    let ctx = null;
    let y = 0;

    async function finishCurrent() {
      if (!ctx || y <= 0) return;
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = targetWidth;
      finalCanvas.height = y;
      const finalCtx = finalCanvas.getContext('2d');
      finalCtx.fillStyle = '#fff';
      finalCtx.fillRect(0, 0, targetWidth, y);
      finalCtx.drawImage(canvas, 0, 0);
      parts.push(await canvasToJpeg(finalCanvas));
      canvas.width = 1; canvas.height = 1;
      canvas = document.createElement('canvas');
      ctx = null;
      y = 0;
    }

    function ensureCanvas() {
      if (ctx) return;
      canvas.width = targetWidth;
      canvas.height = maxHeight;
      ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, targetWidth, maxHeight);
    }

    for (const item of detailItems) {
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(new Blob([item.bytes], { type: item.type || 'image/jpeg' }));
        const scale = targetWidth / bitmap.width;
        let scaledHeight = Math.max(1, Math.round(bitmap.height * scale));
        let sourceY = 0;
        while (scaledHeight > 0) {
          ensureCanvas();
          const available = maxHeight - y;
          if (available <= 0) { await finishCurrent(); continue; }
          const drawHeight = Math.min(scaledHeight, available);
          const sourceHeight = drawHeight / scale;
          ctx.drawImage(bitmap, 0, sourceY, bitmap.width, sourceHeight, 0, y, targetWidth, drawHeight);
          y += drawHeight;
          sourceY += sourceHeight;
          scaledHeight -= drawHeight;
          if (y >= maxHeight) await finishCurrent();
        }
      } finally {
        bitmap?.close?.();
      }
    }
    await finishCurrent();
    return parts;
  }

  async function sendProgress(payload) {
    try { await chrome.runtime.sendMessage({ type: 'ETHAN_BATCH_MATERIAL_PROGRESS', ...payload }); } catch (error) {}
  }

  async function packageMaterials(message) {
    const products = Array.isArray(message.products) ? message.products : [];
    if (!products.length) return { ok: false, message: '没有可打包的产品素材。' };

    const kinds = {video:true, main:true, detail:true, stitch:true, sku:true, ...message.downloadKinds};
    const zip = new StoreZipWriter();
    const failures = [];
    const pendingDownloads = new Set();
    async function saveOutput(path, bytes, type) {
      if (message.directFolderDownload) {
        const gate = await chrome.runtime.sendMessage({type:'ETHAN_LINK_QUEUE_GATE'});
        if (gate?.ok === false) throw new Error('任务已清除');
      }
      if (!message.directFolderDownload) {
        zip.addFile(path, bytes);
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes], {type: type || 'application/octet-stream'}));
      const task = (async () => {
      try {
        let saved;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          saved = await chrome.runtime.sendMessage({type:'ETHAN_SAVE_QUEUE_ZIP', url, filename:path});
          if (saved?.ok) break;
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!saved?.ok) throw new Error(saved?.message || '文件下载失败');
      } catch (error) {
        failures.push({path, stage:'save', message:ethanChineseError(error.message)});
        failedCount += 1;
        fileCount -= 1;
      } finally { URL.revokeObjectURL(url); }
      })();
      pendingDownloads.add(task);
      task.then(() => pendingDownloads.delete(task));
      if (pendingDownloads.size >= 6) await Promise.race(pendingDownloads);
    }
    const usedProductFolders = new Set();
    let fileCount = 0;
    let skippedCount = Number(message.scanFailedCount || 0);
    let failedCount = 0;
    let processedFiles = 0;
    const totalFiles = products.reduce((count, product) => count + Object.values(product.materials || {})
      .reduce((sum, urls) => sum + new Set(urls.filter(Boolean)).size, 0), 0);

    for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
      const product = products[productIndex];
      const titleBase = sanitizeSegment(product.title, product.offerId ? `产品_${product.offerId}` : `产品_${productIndex + 1}`);
      const base = message.directFolderDownload && product.offerId
        ? titleBase.slice(0, 78) + '_' + product.offerId : titleBase;
      let folder = base;
      let duplicate = 0;
      while (usedProductFolders.has(folder.toLowerCase())) {
        const suffix = `_${product.offerId || productIndex + 1}${duplicate ? `_${duplicate}` : ''}`;
        folder = `${base.slice(0, 100 - suffix.length)}${suffix}`;
        duplicate += 1;
      }
      usedProductFolders.add(folder.toLowerCase());

      const detailForStitch = [];
      const categorySources = {
        '主图': product.materials?.['主图'] || [],
        '主图视频': product.materials?.['主图视频'] || [],
        'SKU图': product.materials?.['SKU图'] || [],
        '描述图': product.materials?.['描述图'] || [],
        '描述视频': product.materials?.['描述视频'] || []
      };

      for (const category of ['主图', '主图视频', 'SKU图', '描述图', '描述视频']) {
        const enabled = category === '主图' ? kinds.main : category === 'SKU图' ? kinds.sku :
          category === '描述图' ? (kinds.detail || kinds.stitch) : kinds.video;
        if (!enabled) continue;
        const skuEntries = category === 'SKU图' && product.skuEntries?.length ? product.skuEntries : null;
        const urls = skuEntries ? skuEntries.map(item => item.url) : [...new Set((categorySources[category] || []).filter(Boolean))];
        const usedNames = new Set();
        let savedInCategory = 0;
        const prefetched = new Map();
        function prefetch(index) {
          if (index >= urls.length || prefetched.has(index)) return;
          prefetched.set(index, fetchBlob(urls[index], product.sourceUrl)
            .then(blob => ({ blob }), error => ({ error })));
        }
        // Bounded prefetch also speeds ZIP exports; output still follows source order.
        for (let index = 0; index < Math.min(4, urls.length); index += 1) prefetch(index);
        for (let index = 0; index < urls.length; index += 1) {
          const url = urls[index];
          await sendProgress({ stage: 'pack', current: productIndex + 1, total: products.length, title: product.title || product.offerId || folder, category, fileCount, skippedCount, failedCount, processedFiles, totalFiles });
          try {
            const fetched = prefetched.has(index) ? await prefetched.get(index) : null;
            prefetched.delete(index);
            if (fetched?.error) throw fetched.error;
            const blob = fetched ? fetched.blob : await fetchBlob(url, product.sourceUrl);
            if (blob.size <= 0) { skippedCount += 1; continue; }
            let info = null;
            if (!/视频/.test(category)) {
              info = await imageInfo(blob);
              if (!validImage(category, blob, info)) {
                info?.bitmap?.close?.();
                skippedCount += 1;
                continue;
              }
            }
            const outputIndex = category === '主图' || category === '描述图' ? savedInCategory : index;
            const skuName = category === 'SKU图' ? skuEntries?.[index]?.name || product.skuNames?.[url] : '';
            const rawName = skuName
              ? `${sanitizeSegment(skuName)}.${extensionFromType(blob.type, url, 'jpg')}`
              : filenameFromUrl(url, blob.type, outputIndex, category);
            const filename = uniqueFilename(rawName, usedNames);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            if (category !== '描述图' || kinds.detail) {
              await saveOutput(`${folder}/${category}/${filename}`, bytes, blob.type);
              fileCount += 1;
            }
            savedInCategory += 1;
            if (category === '描述图') detailForStitch.push({ bytes, type: blob.type, width: info?.width || 0, height: info?.height || 0 });
            info?.bitmap?.close?.();
          } catch (error) {
            failures.push({url, category, product:product.title, stage:'fetch', message:ethanChineseError(error.message)});
            failedCount += 1;
          } finally {
            processedFiles += 1;
            prefetch(index + 4);
          }
        }
      }

      try {
        const stitched = kinds.stitch ? await makeStitchedDetailImages(detailForStitch) : [];
        for (let index = 0; index < stitched.length; index += 1) {
          const name = stitched.length === 1 ? '描述图_拼接.jpg' : `描述图_拼接_${String(index + 1).padStart(2, '0')}.jpg`;
          await saveOutput(`${folder}/描述图(拼接)/${name}`, new Uint8Array(await stitched[index].arrayBuffer()), "image/jpeg");
          fileCount += 1;
        }
      } catch (error) {
        failures.push({product:product.title, stage:'stitch', message:ethanChineseError(error.message)});
        failedCount += 1;
      } finally {
        // 描述图位图逐张解码并立即释放，避免批量产品时占用过多内存。
      }
    }

    if (message.directFolderDownload) {
      await Promise.all(pendingDownloads);
      if (failures.length) {
        await chrome.runtime.sendMessage({type:'ETHAN_MATERIAL_FAILURE_LOG', failures}).catch(() => {});
      }
      return {ok: failedCount === 0, productCount:products.length, fileCount, skippedCount, failedCount,
        message: failedCount ? '部分素材下载失败，已保留商品标签页' : ''};
    }
    await sendProgress({ stage: 'zip', productCount: products.length, fileCount, skippedCount, failedCount });
    const blob = zip.build();
    const fileName = `${sanitizeSegment(message.batchName || '1688批量素材', '1688批量素材', 120)}.zip`;
    const url = URL.createObjectURL(blob);
    try {
      if (message.waitForDownload) {
        const saved = await chrome.runtime.sendMessage({type:'ETHAN_SAVE_QUEUE_ZIP', url, filename:fileName});
        if (!saved?.ok) throw new Error(saved?.message || '下载未完成');
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }

    const result = { ok: true, batchFolder: fileName, productCount: products.length, fileCount, skippedCount, failedCount, zipSize: blob.size };
    await sendProgress({ stage: 'done', ...result });
    return result;
  }

  async function sendPackageResult(jobId, result) {
    try {
      await chrome.runtime.sendMessage({ type: 'ETHAN_OFFSCREEN_PACKAGE_RESULT', jobId, result });
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        await chrome.runtime.sendMessage({ type: 'ETHAN_OFFSCREEN_PACKAGE_RESULT', jobId, result });
      } catch (retryError) {}
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'ETHAN_OFFSCREEN_KEEPALIVE_START') {
      keepAliveActive = true;
      connectKeepAlivePort();
      sendKeepAlivePing();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'ETHAN_OFFSCREEN_KEEPALIVE_STOP') {
      keepAliveActive = false;
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type !== 'ETHAN_OFFSCREEN_PACKAGE_MATERIALS') return false;

    const jobId = String(message.jobId || '');
    sendResponse({ ok: true, started: true, jobId });
    Promise.resolve()
      .then(() => packageMaterials(message))
      .then((result) => sendPackageResult(jobId, result))
      .catch(async (error) => {
        const result = { ok: false, message: ethanChineseError(error?.message) || '素材打包失败。' };
        await sendProgress({ stage: 'error', message: result.message });
        await sendPackageResult(jobId, result);
      });
    return false;
  });
})();
