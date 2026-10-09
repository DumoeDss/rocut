param(
    [Parameter(Mandatory = $true)][string]$WebDirectory,
    [switch]$VerifyExisting
)

$ErrorActionPreference = 'Stop'
$privateRoot = 'C:\Users\Sayo\AppData\Local\Temp\rocut-multishot-20261008-7ca2b1-c'
$permitted = @{
    'E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\.tmp-probe\multishot-20261008-7ca2b1\rocut-multishot-mv-5qrzGu\web' = 'rocut-multishot-mv-5qrzGu-web.zip'
    'C:\Users\Sayo\AppData\Local\Temp\rocut-multishot-20261008-7ca2b1-c\rocut-multishot-mv-0qHG9M\web' = 'rocut-multishot-mv-0qHG9M-web.zip'
    'C:\Users\Sayo\AppData\Local\Temp\rocut-multishot-20261008-7ca2b1-c\rocut-multishot-mv-VwgXO6\web' = 'rocut-multishot-mv-VwgXO6-web.zip'
    'C:\Users\Sayo\AppData\Local\Temp\rocut-multishot-20261008-7ca2b1-c\rocut-multishot-mv-tbZSm9\web' = 'rocut-multishot-mv-tbZSm9-web.zip'
}
$target = [System.IO.Path]::GetFullPath($WebDirectory)
if (-not $permitted.ContainsKey($target)) { throw 'Only the explicitly authorized terminal private web bundles are permitted' }

function Assert-DirectPath([string]$Path) {
    $canonical = [System.IO.Path]::GetFullPath($Path)
    $resolved = (Resolve-Path -LiteralPath $canonical).ProviderPath
    if (-not [string]::Equals($resolved, $canonical, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Resolved path differs from the explicit absolute target'
    }
    $cursor = $canonical
    while ($cursor) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse points are not permitted in the artifact path'
        }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
}

function Get-VerifiedFiles([string]$Root) {
    Assert-DirectPath $Root
    $prefix = $Root + '\'
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in (Get-ChildItem -LiteralPath $directory -Force)) {
            if (-not $item.FullName.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw 'Artifact child escaped the explicit web directory'
            }
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Artifact tree contains a reparse point'
            }
            if ($item.PSIsContainer) {
                $pending.Push($item.FullName)
            } else {
                [pscustomobject]@{
                    Relative = $item.FullName.Substring($prefix.Length).Replace('\', '/')
                    Length = $item.Length
                    Hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
                }
            }
        }
    }
}

Assert-DirectPath $privateRoot
$destination = [System.IO.Path]::Combine($privateRoot, $permitted[$target])
$archiveExists = Test-Path -LiteralPath $destination
if ($archiveExists -and -not $VerifyExisting) { throw 'Archive already exists; refusing to overwrite evidence' }
if (-not $archiveExists -and $VerifyExisting) { throw 'No existing archive to verify' }
$files = @(Get-VerifiedFiles $target)
if ($files.Count -eq 0) { throw 'Refusing to archive an empty web bundle' }
$byName = @{}
foreach ($file in $files) { $byName.Add($file.Relative, $file) }

Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not $VerifyExisting) {
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $target, $destination, [System.IO.Compression.CompressionLevel]::Fastest, $false
    )
}
Assert-DirectPath $destination
$archive = [System.IO.Compression.ZipFile]::OpenRead($destination)
try {
    $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if ($entries.Count -ne $files.Count) { throw 'Archive file count mismatch; original retained' }
    $seen = @{}
    foreach ($entry in $entries) {
        # Windows PowerShell 5.1's .NET Framework ZipFile writes backslash names.
        $entryName = $entry.FullName.Replace('\', '/')
        if (-not $byName.ContainsKey($entryName) -or $seen.ContainsKey($entryName)) {
            throw 'Unexpected or duplicate archive path; original retained'
        }
        $seen.Add($entryName, $true)
        $original = $byName[$entryName]
        if ($entry.Length -ne $original.Length) { throw 'Archive size mismatch; original retained' }
        $stream = $entry.Open()
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try { $hash = [System.BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
        finally { $hasher.Dispose(); $stream.Dispose() }
        if ($hash -ne $original.Hash) { throw 'Archive SHA256 mismatch; original retained' }
    }
} finally { $archive.Dispose() }

# Re-enumerate, revalidate every descendant, and rehash after compression, before deletion.
$unchanged = @(Get-VerifiedFiles $target)
if ($unchanged.Count -ne $files.Count) { throw 'Web bundle changed during archival; original retained' }
foreach ($file in $unchanged) {
    if (-not $byName.ContainsKey($file.Relative)) { throw 'Web bundle file set changed; original retained' }
    $original = $byName[$file.Relative]
    if ($original.Length -ne $file.Length -or $original.Hash -ne $file.Hash) {
        throw 'Web bundle content changed; original retained'
    }
}
Assert-DirectPath $target
Assert-DirectPath $destination
$archiveHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
$archiveLength = (Get-Item -LiteralPath $destination).Length
$originalLength = ($files | Measure-Object -Property Length -Sum).Sum
$receiptPath = $destination + '.receipt.json'
if (Test-Path -LiteralPath $receiptPath) { throw 'Refusing to replace an existing archive receipt' }
$receipt = [pscustomobject]@{
    State = 'verified-before-removal'
    RemovedWebDirectory = $target
    RecoveryArchive = $destination
    FilesVerified = $files.Count
    OriginalBytes = $originalLength
    ArchiveBytes = $archiveLength
    ArchiveSha256 = $archiveHash
    RestoreDestination = $target
    Files = $files
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 5), $utf8)
foreach ($file in $files) {
    $sourcePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($target, $file.Relative.Replace('/', '\')))
    if (-not $sourcePath.StartsWith($target + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Removal target escaped the verified web directory'
    }
    Assert-DirectPath $sourcePath
    $sourceItem = Get-Item -LiteralPath $sourcePath
    if ($sourceItem.Length -ne $file.Length -or (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $file.Hash) {
        throw 'Source changed before individual removal; remaining originals retained'
    }
    Remove-Item -LiteralPath $sourcePath -Force
}
# Remove only empty verified directories; never recursively delete new content.
$directories = @(Get-ChildItem -LiteralPath $target -Directory -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending)
foreach ($directory in $directories) {
    Assert-DirectPath $directory.FullName
    [System.IO.Directory]::Delete($directory.FullName, $false)
}
Assert-DirectPath $target
[System.IO.Directory]::Delete($target, $false)
$receipt.State = 'archived-original-removed'
[System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 5), $utf8)
$receipt | Select-Object State,RemovedWebDirectory,RecoveryArchive,FilesVerified,OriginalBytes,ArchiveBytes,ArchiveSha256,RestoreDestination | ConvertTo-Json -Compress
