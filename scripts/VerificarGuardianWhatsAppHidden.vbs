Option Explicit

Dim fileSystem, shell, scriptsRoot, watchdogPath, command, exitCode
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptsRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
watchdogPath = fileSystem.BuildPath(scriptsRoot, "VerificarGuardianWhatsApp.ps1")

If Not fileSystem.FileExists(watchdogPath) Then
    WScript.Quit 2
End If

shell.CurrentDirectory = fileSystem.GetParentFolderName(scriptsRoot)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass " & _
    "-WindowStyle Hidden -File """ & watchdogPath & """"
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
