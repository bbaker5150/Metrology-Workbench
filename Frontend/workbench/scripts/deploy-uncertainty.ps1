<#
.SYNOPSIS
    Put the latest built uncertainty tool into its SharePoint library.

.DESCRIPTION
    Downloads the newest single-file build from the GitHub release, checks it
    against the SHA-256 published alongside it, and overwrites the file in a
    synced SharePoint library folder.

    It deliberately does not talk to SharePoint. The OneDrive sync client
    uploads the file as you, with the permissions you already have — no app
    registration, no admin consent, and no credential that could write to a
    .mil tenant sitting in commercial CI. The cost is that this runs on a
    workstation rather than on a runner.

    The filename never changes, so the .aspx that points at it never needs
    editing. The library keeps the previous version, which is the rollback.

.PARAMETER LibraryPath
    The synced library folder, e.g. 'C:\Users\you\Navy\ISEAMETENG - AppFiles'.
    Get it from the library's Sync button in SharePoint.

.PARAMETER Repo
    owner/repo to pull the release from.

.PARAMETER Token
    A GitHub token. Only needed if the repository is private.

.PARAMETER WhatIf
    Check and report without writing anything.

.EXAMPLE
    pwsh ./deploy-uncertainty.ps1 -LibraryPath 'C:\Users\you\Navy\ISEAMETENG - AppFiles'
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string] $LibraryPath,
    [string] $Repo  = 'bbaker5150/Metrology-Workbench',
    [string] $Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Asset    = 'uncertainty-budget.html'
$Base     = "https://github.com/$Repo/releases/latest/download"
$Headers  = @{ 'User-Agent' = 'deploy-uncertainty' }
if ($Token) { $Headers['Authorization'] = "Bearer $Token" }

if (-not (Test-Path -LiteralPath $LibraryPath -PathType Container)) {
    throw "LibraryPath '$LibraryPath' does not exist. Sync the library from SharePoint first (library -> Sync), then pass the local folder."
}

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("uncertainty-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    $htmlPath = Join-Path $staging $Asset
    $shaPath  = "$htmlPath.sha256"

    Write-Host "Downloading the latest release from $Repo..."
    try {
        # -UseBasicParsing is a no-op on PowerShell 7 but required on the 5.1
        # that ships with Windows, so the script runs under either.
        Invoke-WebRequest -Uri "$Base/$Asset"        -OutFile $htmlPath -Headers $Headers -UseBasicParsing
        Invoke-WebRequest -Uri "$Base/$Asset.sha256" -OutFile $shaPath  -Headers $Headers -UseBasicParsing
    }
    catch {
        throw ("Could not download the release from $Repo. " +
               "If the repository is private, pass -Token or set GITHUB_TOKEN. " +
               "Underlying error: $($_.Exception.Message)")
    }

    # The published checksum is what makes this safe to automate: a truncated
    # download would otherwise be uploaded over a working app.
    $expected = ((Get-Content -LiteralPath $shaPath -Raw).Trim() -split '\s+')[0]
    $actual   = (Get-FileHash -LiteralPath $htmlPath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) {
        throw "Checksum mismatch. Expected $expected, got $actual. Nothing was deployed."
    }

    $bytes = (Get-Item -LiteralPath $htmlPath).Length
    # Select-String -List streams and stops at the first hit. The stamp sits
    # past line 760 — behind the inlined dev console — so reading a fixed
    # number of leading lines would miss it, and slurping 7 MB to find it is
    # wasteful.
    $match = Select-String -LiteralPath $htmlPath -Pattern 'x-uncertainty-build" content="([^"]+)"' -List
    $stamp = if ($match) { $match.Matches[0].Groups[1].Value } else { 'unknown' }

    $target = Join-Path $LibraryPath $Asset
    $current = if (Test-Path -LiteralPath $target) {
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()
    } else { '' }

    Write-Host ""
    Write-Host "  build     $stamp"
    Write-Host "  size      $bytes bytes"
    Write-Host "  sha256    $actual"
    Write-Host "  target    $target"

    if ($current -eq $actual) {
        # Rewriting identical bytes would burn a version in the library's
        # history for no change, and make "when did this last move?" unreadable.
        Write-Host ""
        Write-Host "Already deployed - the library holds this exact build. Nothing to do." -ForegroundColor Green
        return
    }

    if ($PSCmdlet.ShouldProcess($target, 'Overwrite with the latest build')) {
        Copy-Item -LiteralPath $htmlPath -Destination $target -Force
        Write-Host ""
        Write-Host "Deployed. OneDrive will sync it up; the URL is unchanged." -ForegroundColor Green
        Write-Host "Confirm in the browser with a hard refresh (Ctrl+F5) and check the build stamp reads $stamp."
    }
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
