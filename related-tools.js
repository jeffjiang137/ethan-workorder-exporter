(() => {
  const status = document.getElementById('relatedToolStatus');
  function bind(id, resolveDownload) {
    const button = document.getElementById(id);
    let busy = false;
    button.addEventListener('click', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      button.setAttribute('aria-disabled', 'true');
      status.textContent = '正在获取最新下载地址…';
      try {
        const download = await resolveDownload();
        await chrome.downloads.download({...download, saveAs:true});
        status.textContent = '已开始下载，请在浏览器下载列表查看进度。';
      } catch (error) {
        status.textContent = '下载未开始：' + ethanChineseError(error.message);
      } finally { busy = false; button.removeAttribute('aria-disabled'); }
    });
  }
  bind('downloadLatestDesktop', async () => {
    const repo = 'jeffjiang137/image-slicer-tauri';
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      cache:'no-store', signal:AbortSignal.timeout(20000), headers:{Accept:'application/vnd.github+json'}
    });
    if (!response.ok) throw new Error('无法获取最新版本，请检查网络或稍后重试（HTTP '+response.status+'）');
    const release = await response.json();
    if (release.draft || release.prerelease) throw new Error('当前没有可下载的正式版本');
    const assets = (release.assets || []).filter(a => /(?:x64|x86_64).*setup\.exe$/i.test(a.name));
    if (assets.length !== 1) throw new Error('最新版未提供唯一的 Windows x64 安装包，请前往项目发布页确认');
    const asset = assets[0];
    if (!asset.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`)) throw new Error('安装包地址无效');
    return {url:asset.browser_download_url};
  });
  bind('downloadLatestPs', async () => ({
    url:'https://github.com/jeffjiang137/xinyang-photoshop-cep-assistant/archive/refs/heads/main.zip?download='+Date.now(),
    filename:'xinyang-photoshop-cep-assistant-main.zip'
  }));
})();
