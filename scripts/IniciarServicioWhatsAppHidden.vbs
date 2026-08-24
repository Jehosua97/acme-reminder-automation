Option Explicit

Dim fileSystem, shell, scriptsRoot, guardianPath, command, exitCode
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptsRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
guardianPath = fileSystem.BuildPath(scriptsRoot, "IniciarServiciosWhatsApp.ps1")

If Not fileSystem.FileExists(guardianPath) Then
    WScript.Quit 2
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & guardianPath & """"
exitCode = shell.Run(command, 0, False)
WScript.Quit exitCode
