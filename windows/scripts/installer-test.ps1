# Rempart - installe le service en MODE TEST (développement).
# - copie windows\publie\ dans C:\Program Files\Rempart ;
# - mode test : seuls example.org, example.net et neverssl.com sont bloqués ; la box reste en DNS de secours ;
# - démarrage MANUEL (jamais au démarrage de Windows) ;
# - démarre le service. Le compte rendu est écrit dans windows\sauvegarde\installer-test.log.
# Pour tout enlever : windows\REMISE-A-ZERO.cmd (ou le raccourci sur le Bureau).

$ErrorActionPreference = 'Stop'
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) {
    Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

$racine   = Split-Path (Split-Path $PSCommandPath -Parent) -Parent       # dossier windows\
$publie   = Join-Path $racine 'publie'
$programme = Join-Path $env:ProgramFiles 'Rempart'
$donnees  = Join-Path $env:ProgramData 'Rempart'
New-Item -ItemType Directory -Force (Join-Path $racine 'sauvegarde') | Out-Null
Start-Transcript -Path (Join-Path $racine 'sauvegarde\installer-test.log') -Force | Out-Null

try {
    if (-not (Test-Path (Join-Path $publie 'Rempart.Service.exe'))) { throw "Programme absent : $publie" }
    if (Get-Service Rempart -ErrorAction SilentlyContinue) {
        Stop-Service Rempart -Force -ErrorAction SilentlyContinue
        sc.exe delete Rempart | Out-Null
        Start-Sleep -Seconds 2
    }
    New-Item -ItemType Directory -Force $programme, $donnees | Out-Null
    Copy-Item (Join-Path $publie '*') $programme -Recurse -Force
    Copy-Item (Join-Path (Split-Path $racine -Parent) 'data\blocklist.txt') $donnees -Force
    '{ "Mode": "test" }' | Set-Content (Join-Path $donnees 'reglages.json') -Encoding ASCII

    New-Service -Name Rempart -DisplayName 'Rempart (filtre DNS)' -StartupType Manual `
        -BinaryPathName "`"$programme\Rempart.Service.exe`"" `
        -Description 'Bloque les sites pornographiques sur tout le PC (filtre DNS local).' | Out-Null
    Start-Service Rempart
    Start-Sleep -Seconds 3
    Write-Host "SERVICE : $((Get-Service Rempart).Status), démarrage $((Get-Service Rempart).StartType)"
    Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses -and $_.InterfaceAlias -notlike 'Loopback*' } |
        ForEach-Object { Write-Host "DNS : $($_.InterfaceAlias) [$($_.AddressFamily)] -> $($_.ServerAddresses -join ', ')" }
    Write-Host 'INSTALLATION_OK'
} catch {
    Write-Host "INSTALLATION_ECHEC : $($_.Exception.Message)"
} finally {
    Stop-Transcript | Out-Null
}
