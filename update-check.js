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
  const repo = 'jeffjiang137/ethan-workorder-exporter';
  const button = document.getElementById('checkForUpdates');
  const status = document.getElementById('updateStatus');
  function compare(a, b) {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return Math.sign(d);
    }
    return 0;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '正在检查 GitHub 最新版本…';
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        cache: 'no-store', signal: AbortSignal.timeout(20000), headers: {Accept:'application/vnd.github+json'}
      });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 请求受限，请稍后重试' : `检查失败（HTTP ${response.status}）`);
      const release = await response.json();
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (!/^\d+(\.\d+){0,3}$/.test(version) || release.draft || release.prerelease) throw new Error('发布版本信息无效');
      const current = chrome.runtime.getManifest().version;
      if (compare(version, current) <= 0) { status.textContent = `当前 v${current} 已是最新版本`; return; }
      const asset = release.assets?.find(item => item.name === `ethan-workorder-exporter-v${version}.zip`);
      if (!asset || !asset.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`)) throw new Error('新版尚未提供有效的更新包');
      await chrome.downloads.download({url:asset.browser_download_url,filename:asset.name,saveAs:true});
      status.textContent = `已开始下载 v${version}。完整解压后双击 update-extension.cmd，更新并注册 Photoshop 组件，再重新加载扩展。`;
    } catch (error) {
      status.textContent = `更新检查未完成：${ethanChineseError(error.message) || '请检查网络后重试'}`;
    } finally { button.disabled = false; }
  });
})();
