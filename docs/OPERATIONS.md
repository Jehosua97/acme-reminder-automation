# Operations and Debugging Guide

This guide explains what each file does and how to troubleshoot the WhatsApp reminder automation.

## Daily commands

All executable scripts are in:

```text
scripts/
```

| Action | Command |
| --- | --- |
| Start persistent service | `.\scripts\IniciarServicioWhatsApp.cmd` |
| Stop persistent service | `.\scripts\DetenerServicioWhatsApp.cmd` |
| Manual send with confirmation | `.\scripts\EnviarProgramadosManual.cmd` |
| One-shot automatic run | `.\scripts\EnviarProgramadosAuto.cmd` |
| Enable minute testing mode | `.\scripts\CambiarHorasModoPruebaMinutos.ps1` |
| Restore fixed-hour mode | `.\scripts\CambiarHorasModoHorasFijas.ps1` |

## Main runtime model

The preferred model is the persistent service:

```text
scripts/IniciarServicioWhatsApp.cmd
→ scripts/IniciarServicioWhatsApp.ps1
→ node scripts/enviar_programados.js --service --headless
```

The service:

1. Opens WhatsApp Web once through Puppeteer/Chromium.
2. Keeps the WhatsApp session alive.
3. Reads `workbooks/RecordatoriosWhatsApp_Programados.xlsx` every 60 seconds.
4. Sends messages when a row is due.
5. Writes logs and status under `runtime/`.

## Important folders

| Folder | Purpose |
| --- | --- |
| `scripts/` | All Node.js, PowerShell, CMD, and VBA scripts. |
| `workbooks/` | Local operational Excel workbook. Ignored by Git. |
| `runtime/` | Logs, status files, lock files, send results. Ignored by Git. |
| `examples/` | Sanitized demo workbook for portfolio/review. |
| `.wwebjs_auth/` | WhatsApp Web session. Ignored by Git. |
| `.wwebjs_cache/` | WhatsApp Web cache. Ignored by Git. |

## Key files

| File | Purpose |
| --- | --- |
| `scripts/enviar_programados.js` | Main Node.js engine. Reads Excel, selects due reminders, sends WhatsApp messages. |
| `scripts/IniciarServicioWhatsApp.ps1` | Starts the persistent service and writes `runtime/servicio_programados.log`. |
| `scripts/DetenerServicioWhatsApp.ps1` | Stops the persistent service and related Node/Chromium process tree. |
| `scripts/EnviarProgramadosManual.ps1` | Manual send workflow with confirmation and Excel status update. |
| `scripts/EnviarProgramadosAuto.ps1` | Legacy one-shot automatic workflow with retry/timeout controls. |
| `scripts/CambiarHorasModoPruebaMinutos.ps1` | Enables minute-level dropdowns for testing exact times. |
| `scripts/CambiarHorasModoHorasFijas.ps1` | Restores hourly dropdowns for production-like use. |
| `scripts/ModuloWhatsApp.bas` | VBA support module. |

## Logs and status

Check these first when something fails:

```text
runtime/servicio_programados.log
runtime/estado_programados.txt
runtime/resultados_programados.tsv
runtime/envios_programados_log.tsv
```

Meaning:

| File | Meaning |
| --- | --- |
| `servicio_programados.log` | Persistent service startup and Node output. |
| `estado_programados.txt` | Last high-level status: `OK` or `ERROR`. |
| `resultados_programados.tsv` | Last send attempt results. |
| `envios_programados_log.tsv` | Anti-duplicate log for scheduled sends. |

## Debug checklist

### 1. Is the service running?

```powershell
Get-Process node,chrome
```

Also check:

```powershell
Get-Content runtime\servicio_programados.lock
```

If the lock has a PID and that PID exists, the service is running.

### 2. What is the last status?

```powershell
Get-Content runtime\estado_programados.txt
```

Expected healthy idle state:

```text
OK
Servicio activo: no hay recordatorios pendientes en esta revision.
```

### 3. Did it send anything?

```powershell
Get-Content runtime\resultados_programados.tsv
Get-Content runtime\envios_programados_log.tsv -Tail 20
```

Look for:

```text
ok = SI
estado = ENVIADO
ACK 1 SERVIDOR
```

### 4. Was the reminder actually due?

Open the relevant house sheet in Excel and verify:

- Today’s weekday checkbox is selected.
- `Hora` is the intended time.
- `Activo` is `SI`.
- `Próximo envío` includes the current date/time.
- The workbook was saved.

### 5. Service is stuck or WhatsApp Web is frozen

Stop and restart:

```powershell
.\scripts\DetenerServicioWhatsApp.cmd
.\scripts\IniciarServicioWhatsApp.cmd
```

If needed, manually clean Puppeteer processes:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process chrome -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*\.cache\puppeteer\*' } |
  Stop-Process -Force
```

### 6. QR code appears again

The WhatsApp session expired or was removed.

Start the service manually in a visible terminal or run one-shot mode and scan the QR code from WhatsApp linked devices.

### 7. Group not found

The group name in Excel must match the WhatsApp group name exactly.

Check for:

- extra spaces;
- accents;
- underscores;
- renamed WhatsApp groups.

### 8. Duplicate send prevention

Scheduled sends are recorded in:

```text
runtime/envios_programados_log.tsv
```

If a message was marked as sent there, the system will not send that same occurrence again.

Do not delete this file unless you intentionally want to allow previous scheduled occurrences to be considered again.

## Testing mode vs production mode

Testing mode:

- minute-level time selector;
- service checks every 60 seconds;
- tolerance window currently controlled by `VENTANA_AUTO_MINUTOS`;
- useful for times like `10:12 hrs` or `10:20 hrs`.

Production mode:

- fixed-hour selector;
- recommended tolerance can be broader, for example `210` minutes;
- use fewer operational changes during scheduled windows.

Environment variables:

```powershell
$env:INTERVALO_SERVICIO_MS = "60000"
$env:VENTANA_AUTO_MINUTOS = "3"
```

## Startup behavior

The current user Startup folder launches:

```text
scripts/IniciarServicioWhatsApp.cmd
```

Startup file location:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RecordatoriosWhatsAppServicio.cmd
```

This starts the service when the Windows user logs in.
