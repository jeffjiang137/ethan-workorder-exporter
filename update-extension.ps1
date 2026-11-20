param(
    [string] $Package,
    [switch] $CheckOnly,
    [string] $TargetDirectory,
    [string] $BrowserDataRoot
)

$ErrorActionPreference = 'Stop'
$found = @{}

if (-not $TargetDirectory) {
    $local = [Environment]::GetFolderPath('LocalApplicationData')
    $roots = @(
        (Join-Path $local 'Google\Chrome\User Data'),
        (Join-Path $local 'Microsoft\Edge\User Data')
    )
    if ($BrowserDataRoot) { $roots = @($BrowserDataRoot) }
    $extensionName = 'Ethan ' + (-join [char[]](0x5DE5, 0x5355, 0x52A9, 0x624B))
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($profile in Get-ChildItem -LiteralPath $root -Directory) {
            foreach ($filename in @('Secure Preferences', 'Preferences')) {
                $settingsPath = Join-Path $profile.FullName $filename
                if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { continue }
                try {
                    $preferences = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
                } catch {
                    Write-Warning "Could not read $settingsPath"
                    continue
                }
                foreach ($property in $preferences.extensions.settings.PSObject.Properties) {
                    $extension = $property.Value
                    if ($extension.location -ne 4 -or -not $extension.path -or
                        $extension.path -notmatch '^(?:[A-Za-z]:[/\\]|\\\\)') { continue }
                    $manifest = Join-Path $extension.path 'manifest.json'
                    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
                    try {
                        $candidate = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
                    } catch { continue }
                    if ($candidate.name -ceq $extensionName -and $candidate.manifest_version -eq 3) {
                        $directory = (Resolve-Path -LiteralPath $extension.path).ProviderPath
                        if ($property.Name -notmatch '^[a-p]{32}$') { continue }
                        $found[$directory] = @($found[$directory]) + $property.Name
                    }
                }
            }
        }
    }
    $targets = @($found.Keys | Sort-Object)
    if ($targets.Count -eq 0) {
        throw 'No unpacked Ethan extension found in Chrome or Edge. Close the browser and retry if just installed. You can also run this script with -TargetDirectory and the extension folder.'
    }
    if ($targets.Count -eq 1) {
        $TargetDirectory = $targets[0]
    } else {
        for ($index = 0; $index -lt $targets.Count; $index++) {
            Write-Host "$($index + 1). $($targets[$index])"
        }
        $selection = 0
        if (-not [int]::TryParse((Read-Host 'Choose the extension folder number'), [ref]$selection) -or
            $selection -lt 1 -or $selection -gt $targets.Count) { throw 'Invalid selection.' }
        $TargetDirectory = $targets[$selection - 1]
    }
}

$target = (Resolve-Path -LiteralPath $TargetDirectory).ProviderPath
$extensionIds = @($found[$target] | Where-Object { $_ } | Sort-Object -Unique)
$manifestPath = Join-Path $target 'manifest.json'
$installed = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$staging = Join-Path ([IO.Path]::GetTempPath()) ('ethan-update-' + [guid]::NewGuid())

try {
    if (-not $Package -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'manifest.json'))) {
        $source = $PSScriptRoot
    } elseif (-not $Package) {
        $downloads = Join-Path $env:USERPROFILE 'Downloads'
        $folders = @($PSScriptRoot, $downloads)
        $Package = Get-ChildItem -LiteralPath $folders -File -Filter 'ethan-workorder-exporter-v*.zip' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^ethan-workorder-exporter-v\d+(\.\d+){1,3}\.zip$' } |
            Sort-Object @{ Expression = { [version]($_.BaseName -replace '^ethan-workorder-exporter-v') }; Descending = $true },
                        @{ Expression = 'LastWriteTime'; Descending = $true } |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $source -and -not $Package) { throw 'Extract the entire release ZIP before running the update.' }
    Write-Host "Target:  $target"

    if ($Package) {
        Write-Host "Package: $Package"
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Package).ProviderPath)
        try {
            foreach ($entry in $archive.Entries) {
                if ($entry.FullName -match '(^[/\\]|[:]|(^|[/\\])\.\.?([/\\]|$))') {
                    throw "Invalid ZIP entry: $($entry.FullName)"
                }
            }
        } finally {
            $archive.Dispose()
        }
        Expand-Archive -LiteralPath $Package -DestinationPath $staging
        $manifests = @(Get-ChildItem -LiteralPath $staging -Filter manifest.json -Recurse -File |
            Where-Object {
                $candidate = Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName | ConvertFrom-Json
                $candidate.name -ceq $installed.name -and $candidate.manifest_version -eq $installed.manifest_version
            })
        if ($manifests.Count -ne 1) { throw 'Expected one Ethan extension manifest in the ZIP.' }
        $source = $manifests[0].DirectoryName
    }
    $sourceManifest = Get-Item -LiteralPath (Join-Path $source 'manifest.json')
    $incoming = Get-Content -Raw -Encoding UTF8 -LiteralPath $sourceManifest.FullName | ConvertFrom-Json
    if ($incoming.name -cne $installed.name -or $incoming.manifest_version -ne $installed.manifest_version) {
        throw 'The update manifest does not match the installed extension.'
    }
    $files = @(Get-ChildItem -LiteralPath $source -File |
        Where-Object { $_.Name -ne 'manifest.json' -and $_.Extension -in @('.js','.html','.md','.cmd','.ps1') })
    foreach ($directory in @('batch-collector','icons','koukoutu','native','popup-closer','vendor')) {
        $folder = Join-Path $source $directory
        if (Test-Path -LiteralPath $folder -PathType Container) {
            $files += @(Get-ChildItem -LiteralPath $folder -Recurse -File |
                Where-Object { $_.Name -notin @('ps-host.cmd','com.codex.browser.photoshop.json') })
        }
    }
    $files += $sourceManifest
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($source.Length + 1)
        if ($relative -match '(^|[/\\])\.(git|codex|agents|aws)([/\\]|$)') {
            throw "Unexpected project file in ZIP: $relative"
        }
        $path = $target
        foreach ($part in ($relative -split '[/\\]')) {
            $path = Join-Path $path $part
            $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            if ($item -and $item.LinkType -in @('SymbolicLink', 'Junction', 'HardLink')) {
                throw "Cannot update through a linked path: $path"
            }
        }
    }
    Write-Host "Version: $($installed.version) -> $($incoming.version) ($($files.Count) files)"
    if ($CheckOnly) { return }
    if ([version]$incoming.version -lt [version]$installed.version) {
        throw 'This package is older than the installed extension.'
    }

    if ($source -ne $target) {
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($source.Length + 1)
            $destination = Join-Path $target $relative
            try {
                [IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
                [IO.File]::Copy($file.FullName, $destination, $true)
            } catch {
                throw "Could not update $relative. Close the browser and rerun the updater. $($_.Exception.Message)"
            }
        }
        Write-Host "Updated to $($incoming.version)."
    }
    try {
        $installer = Join-Path $target 'install-ps-native.ps1'
        if ($extensionIds.Count) { & $installer -ExtensionId $extensionIds }
        else { & $installer }
    } catch {
        throw "Photoshop registration failed. Retry this updater to register again. $($_.Exception.Message)"
    }
    Write-Host 'Open chrome://extensions or edge://extensions, reload Ethan, then refresh the working tabs.'
} finally {
    if (Test-Path -LiteralPath $staging) {
        $resolved = (Resolve-Path -LiteralPath $staging).ProviderPath
        if ($resolved -eq $staging) { Remove-Item -LiteralPath $resolved -Recurse -Force }
    }
}
