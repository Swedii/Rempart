# Rempart - construit l'installateur Windows.
#   .\construire.ps1                      -> vraie version (protection, liste complète, code au bout de 3 h)
#   .\construire.ps1 -Variante repetition -> répétition générale : protection, 3 domaines de test,
#                                            code au bout de 3 min, remise à zéro au bout de 2 min
#   .\construire.ps1 -Variante test       -> mode test (rien de réel bloqué, arrêt = tout retiré)
param([ValidateSet('protection', 'repetition', 'test')][string]$Variante = 'protection')

$ErrorActionPreference = 'Stop'
$windows = Split-Path $PSScriptRoot -Parent
$publie = Join-Path $windows 'publie-installateur'
$version = '0.1.0'

$reglages = switch ($Variante) {
    'protection' { [ordered]@{ Mode = 'protection' } }
    'repetition' { [ordered]@{ Mode = 'protection'; Liste = 'test'; DelaiDesinstallationHeures = 0.05; AttenteRemiseAZeroMinutes = 2 } }
    'test'       { [ordered]@{ Mode = 'test' } }
}
$config = Join-Path $publie "config-$Variante"
New-Item -ItemType Directory -Force $config | Out-Null
$reglages | ConvertTo-Json | Set-Content (Join-Path $config 'reglages.json') -Encoding ASCII

# Programme autonome (pas besoin d'installer .NET sur le PC de l'utilisateur).
$app = Join-Path $publie 'app'
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
foreach ($projet in 'Rempart.Service', 'Rempart.App') {
    dotnet publish (Join-Path $windows $projet) -c Release -r win-x64 --self-contained -o $app -v q -p:DebugType=none
    if ($LASTEXITCODE) { throw "publication de $projet : échec" }
}

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 introuvable (winget install JRSoftware.InnoSetup --scope user)' }
& $iscc /Q "/DVersion=$version" "/DVariante=$Variante" "/DConfig=$config" (Join-Path $PSScriptRoot 'rempart.iss')
if ($LASTEXITCODE) { throw 'Inno Setup : échec' }
Get-ChildItem (Join-Path $windows 'sortie') -Filter "Rempart-$version-*.exe" | Sort-Object LastWriteTime | Select-Object -Last 1 |
    ForEach-Object { "{0} ({1:N1} Mo)" -f $_.FullName, ($_.Length / 1MB) }
