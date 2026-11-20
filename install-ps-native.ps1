param([string[]]$ExtensionId)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
if (!$ExtensionId) {
    $ids = @()
    foreach ($browser in @('Microsoft\Edge', 'Google\Chrome')) {
        $root = Join-Path $env:LOCALAPPDATA "$browser\User Data"
        if (!(Test-Path -LiteralPath $root)) { continue }
        foreach ($profile in Get-ChildItem -LiteralPath $root -Directory) {
            foreach ($name in @('Preferences', 'Secure Preferences')) {
                try {
                    $settings = (Get-Content -LiteralPath (Join-Path $profile.FullName $name) -Raw | ConvertFrom-Json).extensions.settings
                    foreach ($entry in $settings.PSObject.Properties) {
                        if ($entry.Value.path -like '*ethan-workorder-exporter*' -or $entry.Value.manifest.name -eq 'Ethan 工单助手') { $ids += $entry.Name }
                    }
                } catch { }
            }
        }
    }
    $ExtensionId = @($ids | Sort-Object -Unique)
}
if (!$ExtensionId -or @($ExtensionId | Where-Object { $_ -notmatch '^[a-p]{32}$' }).Count) { throw '未找到有效扩展 ID。请运行 .\install-ps-native.ps1 -ExtensionId 浏览器扩展管理页显示的ID' }
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (!$nodePath) {
    $runtimeDir = Join-Path $env:LOCALAPPDATA 'EthanWorkorder\runtime'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $nodePath = Join-Path $runtimeDir 'node.exe'
    if (!(Test-Path -LiteralPath $nodePath)) {
        Write-Output '正在从 Node.js 官网下载本机运行组件，无需另行安装 Node.js…'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
        $base = 'https://nodejs.org/dist/latest-v24.x'
        $temporary = Join-Path $runtimeDir ('node-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        try {
            $checksums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
            $match = [regex]::Match($checksums, "(?m)^([a-f0-9]{64})\s+win-$architecture/node.exe\s*$")
            if (!$match.Success) { throw '官网校验信息无效，请稍后重试' }
            Invoke-WebRequest -Uri "$base/win-$architecture/node.exe" -OutFile $temporary -UseBasicParsing
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $match.Groups[1].Value) {
                throw '运行组件校验失败，请重新运行安装'
            }
            Move-Item -LiteralPath $temporary -Destination $nodePath -Force
        } catch {
            throw "运行组件下载失败。请检查网络后重新双击安装。详情：$($_.Exception.Message)"
        } finally {
            if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
        }
    }
}
$nativeDir = Join-Path $projectDir 'native'
$launcher = Join-Path $nativeDir 'ps-host.cmd'
$utf8 = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($launcher, "@echo off`r`nchcp 65001 >nul`r`n`"$nodePath`" `"$(Join-Path $nativeDir 'ps-host.mjs')`" %*`r`n", $utf8)
$manifest = Join-Path $nativeDir 'com.codex.browser.photoshop.json'
$origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
# Preserve origins already registered for the source extension.
foreach ($browser in @('Microsoft\Edge', 'Google\Chrome')) {
    $existingKey = "HKCU:\Software\$browser\NativeMessagingHosts\com.codex.browser.photoshop"
    if (Test-Path -LiteralPath $existingKey) {
        $existingPath = (Get-Item -LiteralPath $existingKey).GetValue('')
        if ($existingPath -and (Test-Path -LiteralPath $existingPath)) {
            $existing = Get-Content -LiteralPath $existingPath -Raw | ConvertFrom-Json
            $origins += @($existing.allowed_origins | Where-Object { $_ -match '^chrome-extension://[a-p]{32}/$' })
        }
    }
}
$origins = @($origins | Sort-Object -Unique)
$data = @{ name='com.codex.browser.photoshop'; description='Browser images to Photoshop via Windows COM'; path=$launcher; type='stdio'; allowed_origins=$origins }
[IO.File]::WriteAllText($manifest, ($data | ConvertTo-Json -Depth 4), $utf8)
foreach ($browser in @('Microsoft\Edge', 'Google\Chrome')) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.codex.browser.photoshop"
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $manifest
}
Write-Output '本机 PS 组件注册成功。重新加载浏览器扩展并刷新网页，无需启动 MCP 或 PS 插件桥接。'
