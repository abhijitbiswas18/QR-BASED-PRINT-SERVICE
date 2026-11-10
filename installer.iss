#define MyAppName "QR-Based Print Service"
#define MyAppVersion "3.0.2"
#define MyAppPublisher "Abhijit Biswas"
#define MyAppURL "https://github.com/abhijitbiswas18/QR-BASED-PRINT-SERVICE"
#define MyAppExeName "bi-print-service.exe"
#define ServiceName "QR-Based-Print-Service"

[Setup]
AppId={{B1A2C3D4-E5F6-7890-ABCD-EF1234567890}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName=C:\PrintService
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=installer_output
OutputBaseFilename=Scan-QR-To-Print-3.0.2
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\bi-print-service.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
; Create and start the Windows service
Filename: "{sys}\sc.exe"; Parameters: "create {#ServiceName} binPath= ""{app}\{#MyAppExeName}"" start= auto DisplayName= ""{#MyAppName}"""; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "description {#ServiceName} ""QR-based document upload, review, and select-printer printing service."""; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "start {#ServiceName}"; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "delete {#ServiceName}"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}\uploads"
Type: filesandordirs; Name: "{app}\converted"
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{app}\public"
