Option Explicit

Dim shell
Dim command

Set shell = CreateObject("WScript.Shell")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\LeoNa\ConfortPlaceReminder\scripts\IniciarServicioWhatsApp.ps1"""

' 0 = hidden window, False = do not wait.
shell.Run command, 0, False
