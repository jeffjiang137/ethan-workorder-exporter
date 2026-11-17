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
      status.textContent = `已开始下载 v${version}。下载完成后解压覆盖原插件目录，再在扩展管理页重新加载。`;
    } catch (error) {
      status.textContent = `更新检查未完成：${error.message || '请检查网络后重试'}`;
    } finally { button.disabled = false; }
  });
})();
