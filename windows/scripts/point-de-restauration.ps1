# Rempart - a lancer UNE FOIS avant toute installation du service.
# 1. cree un point de restauration Windows « Avant Rempart » ;
# 2. note l'etat d'origine (DNS, reglages navigateurs) dans windows\sauvegarde\ ;
# 3. pose sur le Bureau un raccourci « Rempart - REMISE A ZERO ».
# Se relance tout seul en administrateur. Le compte rendu est ecrit dans windows\sauvegarde\point-de-restauration.log.

$ErrorActionPreference = 'Continue'
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) {
    Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

$racine     = Split-Path (Split-Path $PSCommandPath -Parent) -Parent      # dossier windows\
$sauvegarde = Join-Path $racine 'sauvegarde'
New-Item -ItemType Directory -Force $sauvegarde | Out-Null
$journal = Join-Path $sauvegarde 'point-de-restauration.log'
Start-Transcript -Path $journal -Force | Out-Null

# 1. Point de restauration (Windows refuse d'en creer plus d'un par 24 h sans ce reglage temporaire)
$cleSR = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
$ancienneFrequence = (Get-ItemProperty $cleSR -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
try {
    Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction Stop
    Set-ItemProperty $cleSR -Name SystemRestorePointCreationFrequency -Value 0 -Type DWord
    Checkpoint-Computer -Description 'Avant Rempart' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop
    $dernier = Get-ComputerRestorePoint | Sort-Object SequenceNumber | Select-Object -Last 1
    Write-Host "POINT_OK : n°$($dernier.SequenceNumber) « $($dernier.Description) » $($dernier.ConvertToDateTime($dernier.CreationTime))"
} catch {
    Write-Host "POINT_ECHEC : $($_.Exception.Message)"
} finally {
    if ($null -eq $ancienneFrequence) { Remove-ItemProperty $cleSR -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue }
    else { Set-ItemProperty $cleSR -Name SystemRestorePointCreationFrequency -Value $ancienneFrequence -Type DWord }
}

# 2. Etat d'origine (pour memoire ; la remise a zero n'en depend pas)
$etat = [ordered]@{
    Date = (Get-Date).ToString('s')
    Dns  = @(Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object {
        $g = $_.InterfaceGuid
        $v4 = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$g" -ErrorAction SilentlyContinue
        $v6 = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\$g" -ErrorAction SilentlyContinue
        [ordered]@{ InterfaceAlias = $_.Name; ManuelIPv4 = "$($v4.NameServer)"; ManuelIPv6 = "$($v6.NameServer)"
                    ServeursActuels = @((Get-DnsClientServerAddress -InterfaceAlias $_.Name).ServerAddresses) }
    })
    ReglagesNavigateurs = [ordered]@{}
}
foreach ($cle in 'HKLM:\SOFTWARE\Policies\Google\Chrome', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge',
                 'HKLM:\SOFTWARE\Policies\Mozilla\Firefox', 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient') {
    $etat.ReglagesNavigateurs[$cle] = if (Test-Path $cle) { (Get-Item $cle).GetValueNames() } else { 'absent' }
}
$etat | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $sauvegarde 'etat-origine.json') -Encoding UTF8
Write-Host 'ETAT_OK : windows\sauvegarde\etat-origine.json'

# 3. Raccourci sur le Bureau
$cmd = Join-Path $racine 'REMISE-A-ZERO.cmd'
$bureau = [Environment]::GetFolderPath('Desktop')
if ($env:USERPROFILE -and (Test-Path $cmd)) {
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $bureau 'Rempart - REMISE A ZERO.lnk'))
    $lnk.TargetPath = $cmd
    $lnk.WorkingDirectory = $racine
    $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,238"
    $lnk.Description = 'Enlever toutes les protections Rempart et remettre Internet comme avant'
    $lnk.Save()
    Write-Host "RACCOURCI_OK : $bureau"
}

Stop-Transcript | Out-Null
