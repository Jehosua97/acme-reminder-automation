# Confort Place Operations Guide

This guide covers the current production model: web dashboard, JSON data store, persistent WhatsApp worker, and NSSM Windows services.

Legacy Excel and Windows Task Scheduler scripts were removed from `main`. They remain available in:

```text
legacy-with-excel-scripts
```

## Daily operations

| Action | Command |
| --- | --- |
| Open dashboard | `http://localhost:3000` |
| Start dashboard manually | `npm run web` |
| Start WhatsApp worker manually | `npm run service` |
| Stop WhatsApp worker | `.\scripts\DetenerServicioWhatsApp.cmd` |
| Enable debug mode | `.\scripts\ActivarModoDebug.cmd` |
| Enable production mode | `.\scripts\ActivarModoProduccion.cmd` |
| Verify Windows services | `.\scripts\VerificarServiciosNSSM.cmd` |
| Restart Windows services | `.\scripts\ReiniciarServiciosNSSM.cmd` |
| Repair Windows services | `.\scripts\RepararServiciosNSSM.cmd` |
| Reset Windows services | `.\scripts\ResetServiciosNSSM.cmd` |

## Runtime model

```text
Web dashboard
-> Express API
-> data/reminders.json
-> WhatsApp worker
-> whatsapp-web.js
-> WhatsApp Web groups
```

The dashboard and sender use the same JSON reminder records.

## Reminder data

Reminder data is stored locally in:

```text
data/reminders.json
```

This file is intentionally ignored by git because it contains real operational data.

Important fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable reminder identifier used by logs and duplicate protection. |
| `group` | Exact WhatsApp group name. |
| `category` | UI category. |
| `scheduleType` | `weekly`, `monthly`, or `interval`. |
| `days` | Weekday schedule for weekly reminders. |
| `monthly` | Week-of-month and weekday schedule. |
| `interval` | Base date and repeat interval in weeks. |
| `hora` | Scheduled send time. |
| `activo` | `SI` or `NO`. Only `SI` sends automatically. |
| `estado` | Current weekly result status. |
| `ultimoEnvio` | Last successful send timestamp. |
| `mensaje` | WhatsApp text/caption. |
| `mediaItems` | Optional image attachments for image reminders. |
| `notas` | Last operational note/result. |

## Dashboard

The dashboard supports:

- filtering by multiple houses;
- adding/editing/deleting reminders;
- inline autosave;
- weekly, monthly, and interval schedules;
- rotating cleaning reminders by room;
- image reminders with multiple attachments;
- bulk activate/deactivate/delete;
- service status and logs;
- debug/production mode controls.

## Modes

| Mode | Review interval | Send window | Time selector |
| --- | ---: | ---: | ---: |
| Debug | 2 minutes | 3 minutes | every minute |
| Production | 5 minutes | 10 minutes | every 30 minutes |

Use debug mode for short live tests. Use production mode for normal operation.

Settings are stored in:

```text
data/settings.json
```

## Logs and status

Check these first:

```text
runtime/servicio_programados.log
runtime/estado_programados.txt
runtime/resultados_programados.tsv
runtime/envios_programados_log.tsv
```

| File | Meaning |
| --- | --- |
| `servicio_programados.log` | Persistent worker startup and Node output. |
| `estado_programados.txt` | Last high-level status: `OK` or `ERROR`. |
| `resultados_programados.tsv` | Last send attempt results. |
| `envios_programados_log.tsv` | Anti-duplicate log for successful scheduled sends. |

## Duplicate protection

Scheduled sends use this occurrence key:

```text
reminderId|yyyy-mm-dd hh:mm
```

If the worker restarts inside the send window, already-confirmed sends are skipped.

## Weekly result reset

The `Resultado` status resets weekly.

Every Sunday at 22:00 local time, reminder results reset to:

```text
PENDIENTE
```

If the system is not running at exactly that time, the reset runs the next time reminder data is read.

## WhatsApp session

The WhatsApp login is stored in:

```text
.wwebjs_auth/
```

Do not commit or share this folder.

If WhatsApp asks for QR again:

```powershell
npm run service
```

Then scan the QR from:

```text
WhatsApp mobile app -> Linked devices -> Link a device
```

## Common failures

### Group not found

The configured `group` must match the WhatsApp group name exactly.

### Service says browser profile is already running

This usually means a previous Chromium instance is still holding the WhatsApp Web profile. Use:

```powershell
.\scripts\DetenerServicioWhatsApp.cmd
.\scripts\ActivarModoProduccion.cmd
```

If it continues, run the dashboard as admin or repair services:

```powershell
.\scripts\RepararServiciosNSSM.cmd
```

### PC slept during a send window

Sleep/hibernate prevents reliable sending. Keep the PC plugged in, awake, and connected to the internet.

### WhatsApp disconnected

Check:

```powershell
Get-Content runtime\servicio_programados.log -Tail 120
```

Common causes:

- WhatsApp Web session expired.
- The phone/account was unlinked.
- Network instability.
- PC sleep/hibernate.

## Service management

Install services:

```powershell
.\scripts\InstalarServiciosNSSM.cmd
```

Verify:

```powershell
.\scripts\VerificarServiciosNSSM.cmd
```

Restart:

```powershell
.\scripts\ReiniciarServiciosNSSM.cmd
```

Repair:

```powershell
.\scripts\RepararServiciosNSSM.cmd
```

Reset:

```powershell
.\scripts\ResetServiciosNSSM.cmd
```
