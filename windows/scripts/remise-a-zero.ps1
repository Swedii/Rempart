# Rempart - REMISE A ZERO
# Enleve tout ce que le service Windows de Rempart peut poser sur la machine et remet Internet comme avant.
# Fonctionne sans Internet. Se relance tout seul en administrateur.
#
# IMPORTANT pour les developpeurs : toute nouvelle trace laissee par le service (regle, cle, tache, pare-feu...)
# doit etre ajoutee ici. La liste des reglages navigateur est en haut du fichier.

$ErrorActionPreference = 'Continue'

# --- Se relancer en administrateur si besoin ---------------------------------------------------------------
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    exit
}

# --- Ce que Rempart pose (a garder synchronise avec le service) ---------------------------------------------
$NomService     = 'Rempart'
$Processus      = @('Rempart', 'RempartService', 'Rempart.Service')
$DossierProgramme = Join-Path $env:ProgramFiles 'Rempart'
$DossierDonnees   = Join-Path $env:ProgramData 'Rempart'
$GroupePareFeu  = 'Rempart'
# Identifiants de l'extension installee de force (a remplir quand elle sera publiee).
$IdsExtension   = @()

$ReglagesNavigateurs = @{
    'HKLM:\SOFTWARE\Policies\Google\Chrome' = @(
        'IncognitoModeAvailability', 'BrowserGuestModeEnabled',
        'DnsOverHttpsMode', 'ForceGoogleSafeSearch', 'ForceYouTubeRestrict')
    'HKLM:\SOFTWARE\Policies\Microsoft\Edge' = @(
        'InPrivateModeAvailability', 'BrowserGuestModeEnabled',
        'DnsOverHttpsMode', 'ForceGoogleSafeSearch', 'ForceBingSafeSearch', 'ForceYouTubeRestrict')
    'HKLM:\SOFTWARE\Policies\Mozilla\Firefox' = @(
        'DisablePrivateBrowsing')
    'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient' = @(
        'DoHPolicy')
}
# Sous-cles entieres creees par Rempart (supprimees seulement si elles ne contiennent plus rien d'autre).
$SousClesNavigateurs = @(
    'HKLM:\SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS'
)
$ListesExtensions = @(
    'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist',
    'HKLM:\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist'
)

function Etape($texte) { Write-Host ''; Write-Host "== $texte" -ForegroundColor Cyan }
function Ok($texte)    { Write-Host "   OK  $texte" -ForegroundColor Green }
function Info($texte)  { Write-Host "   ..  $texte" }

function Supprimer-CleSiVide($cle) {
    if (-not (Test-Path $cle)) { return }
    $item = Get-Item $cle
    if ($item.ValueCount -eq 0 -and $item.SubKeyCount -eq 0) {
        Remove-Item $cle -Force
        Info "cle vide retiree : $cle"
        Supprimer-CleSiVide (Split-Path $cle -Parent)
    }
}

Start-Transcript -Path (Join-Path $env:TEMP 'rempart-remise-a-zero.log') -Force | Out-Null
Write-Host 'Rempart - remise a zero' -ForegroundColor Yellow

# 1. Arreter et retirer le service (en premier : sinon la surveillance remettrait tout en place)
Etape 'Service Rempart'
$service = Get-Service -Name $NomService -ErrorAction SilentlyContinue
if ($service) {
    cmd.exe /c "sc.exe failure $NomService reset= 0 actions= `"`"" | Out-Null   # plus de redemarrage automatique
    sc.exe config $NomService start= disabled | Out-Null
    Stop-Service -Name $NomService -Force -ErrorAction SilentlyContinue
    sc.exe delete $NomService | Out-Null
    Ok 'service arrete et supprime'
} else { Info 'aucun service installe' }
foreach ($p in $Processus) {
    Get-Process -Name $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Get-ScheduledTask -TaskName 'Rempart*' -ErrorAction SilentlyContinue | ForEach-Object {
    Unregister-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -Confirm:$false
    Ok "tache planifiee retiree : $($_.TaskName)"
}

# 2. DNS : remettre les cartes reseau comme avant
Etape 'DNS des cartes reseau'
# Format ecrit par le service avant de toucher au DNS : [{ "InterfaceAlias": "...", "Mode": "auto"|"manuel", "Serveurs": [...] }]
$sauvegardeDns = Join-Path $DossierDonnees 'dns-origine.json'
$origine = @{}
if (Test-Path $sauvegardeDns) {
    try {
        (Get-Content $sauvegardeDns -Raw | ConvertFrom-Json) | ForEach-Object { $origine[$_.InterfaceAlias] = $_ }
        Info "sauvegarde trouvee : $sauvegardeDns"
    } catch { Info 'sauvegarde illisible, retour au DNS automatique' }
}
$boucle = @('127.0.0.1', '::1')
$cartesTouchees = 0
Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses | Where-Object { $boucle -contains $_ } } |
    Select-Object -ExpandProperty InterfaceAlias -Unique | ForEach-Object {
        $alias = $_
        $o = $origine[$alias]
        if ($o -and $o.Mode -eq 'manuel' -and $o.Serveurs.Count -gt 0) {
            Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses $o.Serveurs
            Ok "$alias : DNS manuel d'origine remis ($($o.Serveurs -join ', '))"
        } else {
            Set-DnsClientServerAddress -InterfaceAlias $alias -ResetServerAddresses
            Ok "$alias : DNS automatique remis"
        }
        $cartesTouchees++
    }
if ($cartesTouchees -eq 0) { Info 'aucune carte ne pointait vers le filtre local' }

# 3. Reglages des navigateurs et de Windows
Etape 'Reglages des navigateurs'
foreach ($cle in $ReglagesNavigateurs.Keys) {
    if (-not (Test-Path $cle)) { continue }
    foreach ($nom in $ReglagesNavigateurs[$cle]) {
        if ($null -ne (Get-ItemProperty -Path $cle -Name $nom -ErrorAction SilentlyContinue)) {
            Remove-ItemProperty -Path $cle -Name $nom -Force
            Ok "$cle\$nom retire"
        }
    }
}
foreach ($cle in $SousClesNavigateurs) {
    if (Test-Path $cle) { Remove-Item $cle -Recurse -Force; Ok "$cle retire" }
}
foreach ($cle in $ListesExtensions) {
    if (-not (Test-Path $cle)) { continue }
    $item = Get-Item $cle
    foreach ($nom in $item.GetValueNames()) {
        $valeur = [string]$item.GetValue($nom)
        foreach ($id in $IdsExtension) {
            if ($valeur.StartsWith($id)) { Remove-ItemProperty -Path $cle -Name $nom -Force; Ok "extension retiree de $cle" }
        }
    }
}
foreach ($cle in @($ReglagesNavigateurs.Keys) + $ListesExtensions) { Supprimer-CleSiVide $cle }
$policiesFirefox = Join-Path $env:ProgramFiles 'Mozilla Firefox\distribution\policies.json'
if ((Test-Path $policiesFirefox) -and ((Get-Content $policiesFirefox -Raw) -match '"_rempart"')) {
    Remove-Item $policiesFirefox -Force
    Ok 'policies.json de Firefox (cree par Rempart) retire'
}

# 4. Pare-feu
Etape 'Pare-feu'
$regles = Get-NetFirewallRule -Group $GroupePareFeu -ErrorAction SilentlyContinue
if ($regles) { $regles | Remove-NetFirewallRule; Ok "$(@($regles).Count) regle(s) retiree(s)" } else { Info 'aucune regle' }

# 5. Fichiers du programme
Etape 'Fichiers'
foreach ($d in @($DossierProgramme, $DossierDonnees)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; Ok "$d supprime" }
    else { Info "$d absent" }
}

# 6. Verification
Etape 'Verification'
Clear-DnsClientCache
ipconfig /flushdns | Out-Null
Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses -and $_.InterfaceAlias -notlike 'Loopback*' } |
    ForEach-Object { Info "$($_.InterfaceAlias) -> $($_.ServerAddresses -join ', ')" }
try {
    $r = Resolve-DnsName -Name 'example.com' -Type A -DnsOnly -QuickTimeout -ErrorAction Stop | Select-Object -First 1
    Ok "Internet repond (example.com -> $($r.IPAddress))"
} catch {
    Write-Host '   !!  example.com ne repond pas : verifier le cable ou la box, ou redemarrer le PC.' -ForegroundColor Red
}

Write-Host ''
Write-Host 'Termine. Fermez puis rouvrez Chrome et Edge pour qu''ils oublient les anciens reglages.' -ForegroundColor Yellow
Stop-Transcript | Out-Null
if ($Host.Name -eq 'ConsoleHost' -and -not $env:REMPART_SANS_PAUSE) { Read-Host 'Appuyez sur Entree pour fermer' | Out-Null }
