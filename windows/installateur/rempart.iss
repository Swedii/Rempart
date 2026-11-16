; Rempart - installateur Windows (Inno Setup 6). Construire avec construire.ps1, pas directement.
; Variables passées par construire.ps1 : Version, Variante, Config (dossier contenant reglages.json).

#ifndef Version
  #define Version "0.1.0"
#endif
#ifndef Variante
  #define Variante "protection"
#endif
#ifndef Config
  #define Config "..\publie-installateur\config-protection"
#endif

[Setup]
AppId={{6F2C8A41-3B7E-4D4C-9A8E-52B1D3E07C19}
AppName=Rempart
AppVersion={#Version}
AppVerName=Rempart {#Version}
AppPublisher=Rempart (logiciel libre, GPL-3.0)
DefaultDirName={autopf}\Rempart
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\sortie
#if Variante == "protection"
OutputBaseFilename=Rempart-{#Version}-installation
#else
OutputBaseFilename=Rempart-{#Version}-{#Variante}
#endif
Compression=lzma2/max
SolidCompression=yes
SetupIconFile=..\Rempart.App\rempart.ico
UninstallDisplayIcon={app}\Rempart.exe
UninstallDisplayName=Rempart
LicenseFile=..\..\LICENSE
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
fr.Avertissement=Rempart va protéger tout ce PC : sites pornographiques bloqués dans tous les navigateurs, navigation privée coupée, SafeSearch forcé.%n%nPour le désinstaller plus tard, il faudra demander un code dans l'application Rempart : il s'affiche au bout de 3 heures et reste valable 15 minutes.%n%nContinuer ?
en.Avertissement=Rempart will protect this whole PC: porn sites blocked in every browser, private browsing disabled, SafeSearch enforced.%n%nTo uninstall it later, you will need to request a code in the Rempart app: it appears after 3 hours and stays valid for 15 minutes.%n%nContinue?
fr.CodeRefuse=Désinstallation annulée : le code n'a pas été validé.
en.CodeRefuse=Uninstall cancelled: the code was not validated.
fr.Ouvrir=Ouvrir Rempart
en.Ouvrir=Open Rempart

[Files]
Source: "..\publie-installateur\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
Source: "..\scripts\remise-a-zero.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\REMISE-A-ZERO.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\data\blocklist.txt"; DestDir: "{commonappdata}\Rempart"; Flags: ignoreversion
Source: "{#Config}\reglages.json"; DestDir: "{commonappdata}\Rempart"; Flags: ignoreversion

[UninstallDelete]
Type: dirifempty; Name: "{app}"

[Icons]
Name: "{autoprograms}\Rempart"; Filename: "{app}\Rempart.exe"

[Run]
; Données du service : réservées à Windows (SYSTEM) et aux administrateurs.
Filename: "{sys}\icacls.exe"; Parameters: """{commonappdata}\Rempart"" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "create Rempart binPath= ""{app}\Rempart.Service.exe"" start= auto DisplayName= ""Rempart"""; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "description Rempart ""Bloque les sites pornographiques sur tout le PC (filtre DNS local)."""; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "failure Rempart reset= 86400 actions= restart/3000/restart/3000/restart/10000"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "start Rempart"; Flags: runhidden
Filename: "{app}\Rempart.exe"; Description: "{cm:Ouvrir}"; Flags: postinstall nowait skipifsilent runasoriginaluser

[Code]
procedure Executer(const Fichier, Parametres: String);
var Code: Integer;
begin
  // Dossier de travail hors du dossier d'installation, sinon il reste verrouillé et ne peut pas être supprimé.
  Exec(Fichier, Parametres, ExpandConstant('{sys}'), SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ Retire le service existant (réinstallation ou mise à jour) : en protection il refuse l'arrêt, on le coupe. }
procedure RetirerService;
begin
  Executer(ExpandConstant('{cmd}'), '/c sc.exe failure Rempart reset= 0 actions= ""');
  Executer(ExpandConstant('{sys}\sc.exe'), 'stop Rempart');
  Executer(ExpandConstant('{sys}\taskkill.exe'), '/f /im Rempart.Service.exe');
  Executer(ExpandConstant('{sys}\sc.exe'), 'delete Rempart');
  Sleep(1500);
end;

function InitializeSetup(): Boolean;
begin
  Result := WizardSilent() or
    (MsgBox(CustomMessage('Avertissement'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Executer(ExpandConstant('{sys}\taskkill.exe'), '/f /im Rempart.exe');
  RetirerService;
  Result := '';
end;

{ Le désinstalleur demande le code au service (Rempart.exe --desinstaller ; 0 = autorisé). }
function InitializeUninstall(): Boolean;
var Code: Integer;
    Appli: String;
begin
  Appli := ExpandConstant('{app}\Rempart.exe');
  if not FileExists(Appli) then begin Result := True; exit; end;
  Result := Exec(Appli, '--desinstaller', '', SW_SHOW, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then MsgBox(CustomMessage('CodeRefuse'), mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    Executer(ExpandConstant('{sys}\taskkill.exe'), '/f /im Rempart.exe');
    RetirerService;
    { Service supprimé : la remise à zéro est immédiate et remet DNS, réglages et dossiers comme avant. }
    Executer(ExpandConstant('{cmd}'), '/c set REMPART_SANS_PAUSE=1&& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{app}\scripts\remise-a-zero.ps1') + '"');
  end;
end;
