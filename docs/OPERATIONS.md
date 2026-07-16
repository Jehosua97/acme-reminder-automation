# Confort Place Operations and Debugging Guide

This guide explains how to operate and troubleshoot the Confort Place WhatsApp reminder automation.

## Daily commands

| Action | Command |
| --- | --- |
| Start web admin interface | `.\scripts\IniciarWebAdmin.cmd` |
| Start persistent WhatsApp service | `.\scripts\IniciarServicioWhatsApp.cmd` |
| Stop persistent WhatsApp service | `.\scripts\DetenerServicioWhatsApp.cmd` |
| Manual send from CLI | `npm run send` |
| One-shot automatic run | `npm run send:auto` |
| Persistent service from CLI | `npm run service` |

## Runtime model

```text
Web dashboard
-> Local API
-> Reminder storage
-> WhatsApp sender service
-> WhatsApp Web
```

The dashboard and the sender service use the same local reminder records.

## Reminder fields

| Field | Purpose |
| --- | --- |
| `id` | Stable reminder identifier used by the app and sender logs. |
| `group` | Exact WhatsApp group name. Must match WhatsApp Web exactly. |
| `category` | Reminder category shown in the UI. |
| `scheduleType` | `weekly`, `monthly`, or `interval`. Existing reminders default to `weekly`. |
| `days` | Weekday schedule for weekly reminders. |
| `monthly` | Week-of-month and weekday schedule for monthly reminders. |
| `interval` | Base date and repeat interval in weeks for alternating schedules. |
| `hora` | Scheduled send time, e.g. `19:00`. |
| `activo` | `SI` or `NO`. Only active reminders are sent automatically. |
| `enviarManual` | `SI` or `NO`. Manual sends use this flag. |
| `estado` | Weekly result status. Resets to `PENDIENTE` after Sunday night. |
| `ultimoEnvio` | Last successful send timestamp. |
| `mensaje` | WhatsApp message body. |
| `notas` | Last operational note/result. |

## Web admin interface

Start it:

```powershell
.\scripts\IniciarWebAdmin.cmd
```

Open:

```text
http://localhost:3000
```

The web UI supports:

- filtering by multiple houses;
- adding reminders;
- editing reminders inline;
- editing full details from the popup;
- weekly schedules;
- monthly schedules such as first Friday, first/third Saturday, or second/fourth Saturday;
- interval schedules such as every 2 weeks from a known base date;
- selecting multiple rows and deleting them together;
- deleting single reminders;
- adding/removing houses and categories;
- pausing/resuming the system;
- starting/stopping/restarting the WhatsApp service;
- viewing logs and runtime status.

## Weekly result reset

The `Resultado` column is weekly.

Every Sunday night at 22:00 local time, the system resets reminder results to:

```text
PENDIENTE
```

If the service or dashboard is not open at exactly that time, the reset runs the next time the system starts or reads the reminder records.

The reset does not delete:

- last send timestamp;
- notes;
- schedules;
- active/inactive state;
- runtime logs.

## WhatsApp service

The persistent service keeps WhatsApp Web open through `whatsapp-web.js` and checks for due reminders on each cycle.

Default environment values:

| Variable | Default | Meaning |
| --- | --- | --- |
| `INTERVALO_SERVICIO_MS` | `300000` | Service review interval: every 5 minutes. |
| `VENTANA_AUTO_MINUTOS` | `10` | Due-send tolerance window: 10 minutes. |

The current mode is stored in `data/settings.json`.

| Mode | Review interval | Send window | Time selector |
| --- | ---: | ---: | ---: |
| Debug | 2 minutes | 3 minutes | every minute |
| Production | 5 minutes | 10 minutes | every 30 minutes |

Use the dashboard buttons in `Estado del sistema`, or run:

```powershell
.\scripts\ActivarModoDebug.cmd
.\scripts\ActivarModoProduccion.cmd
```

To run:

```powershell
.\scripts\IniciarServicioWhatsApp.cmd
```

To stop:

```powershell
.\scripts\DetenerServicioWhatsApp.cmd
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
| `servicio_programados.log` | Persistent service startup and Node output. |
| `estado_programados.txt` | Last high-level status: `OK` or `ERROR`. |
| `resultados_programados.tsv` | Last send attempt results. |
| `envios_programados_log.tsv` | Anti-duplicate log for scheduled sends. |

## Duplicate protection

Scheduled sends use this occurrence key:

```text
reminderId|yyyy-mm-dd hh:mm
```

Successful automatic sends are recorded in `runtime/envios_programados_log.tsv`.

If the service restarts inside the tolerance window, it checks that log and skips already-sent occurrences.

## Debug checklist

### 1. Is the service running?

```powershell
Get-Content runtime\servicio_programados.lock
```

Then verify the PID:

```powershell
Get-Process -Id <PID>
```

### 2. What was the last status?

```powershell
Get-Content runtime\estado_programados.txt
```

### 3. Did the sender select any reminders?

```powershell
Get-Content runtime\resultados_programados.tsv
```

### 4. Was a reminder skipped as duplicate?

```powershell
Get-Content runtime\envios_programados_log.tsv
```

### 5. Is WhatsApp disconnected?

Check:

```powershell
Get-Content runtime\servicio_programados.log -Tail 120
```

Common causes:

- WhatsApp Web session expired.
- PC slept or lost network.
- WhatsApp group name changed.
- The linked phone/account was logged out.
