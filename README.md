# Confort Place WhatsApp Reminder Automation

Local web dashboard and Windows service automation for scheduled WhatsApp group reminders.

This project was built as an operations automation system for Confort Place. It lets an operator manage recurring reminders from a browser dashboard while a local WhatsApp Web worker handles scheduled delivery, anti-duplicate protection, status updates, and operational logs.

> Important: this project uses `whatsapp-web.js`, an unofficial WhatsApp Web automation library. It is useful for group reminders, but it is not the official WhatsApp Business API and it carries account/session risk.

## What it does

- Runs a local dashboard at `http://localhost:3000`.
- Stores reminders locally in `data/reminders.json`.
- Sends WhatsApp group messages through `whatsapp-web.js`.
- Supports weekly, monthly, and interval schedules.
- Supports rotating cleaning reminders by room number.
- Supports bulk activate, deactivate, and delete actions.
- Shows service status, logs, and controls from the web UI.
- Runs as Windows services through NSSM for better reliability after reboot.
- Keeps WhatsApp login persistent with LocalAuth, without scanning QR every run.

## Architecture

```text
Browser dashboard
  -> Node/Express API
  -> Local JSON data store
  -> Persistent WhatsApp scheduler
  -> whatsapp-web.js
  -> WhatsApp Web
```

Main services:

| Service | Purpose |
| --- | --- |
| `ConfortPlace-Web` | Local dashboard/API on port `3000`. |
| `ConfortPlace-WhatsApp` | Persistent WhatsApp sender/scheduler. |

## Repository layout

```text
.
├── data/
│   └── settings.json              # Safe tracked runtime settings
├── docs/
│   └── OPERATIONS.md              # Detailed operations/debug guide
├── scripts/
│   ├── web_server.js              # Express API + dashboard server
│   ├── enviar_programados.js      # WhatsApp sender/scheduler
│   ├── data_store.js              # JSON persistence + schedule logic
│   ├── InstalarServiciosNSSM.*    # Install Windows services
│   ├── VerificarServiciosNSSM.*   # Check service health
│   ├── ReiniciarServiciosNSSM.*   # Restart services
│   ├── ResetServiciosNSSM.*       # Recreate services if broken
│   ├── ActivarModoDebug.*         # Debug mode: faster checks/minute times
│   └── ActivarModoProduccion.*    # Production mode
├── web/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── package.json
└── README.md
```

## Files intentionally not committed

These are local/private and are ignored by git:

| Path | Why |
| --- | --- |
| `.wwebjs_auth/` | WhatsApp Web session. Do not share this. |
| `.wwebjs_cache/` | Browser/session cache. |
| `runtime/` | Logs, status files, anti-duplicate send log. |
| `data/reminders.json` | Real house/group/message database. |
| `data/backups/` | Local operational backups. |
| `workbooks/` / `*.xlsm` | Legacy/private Excel files. |

When this repo is cloned on a new machine, the app will create a fresh empty `data/reminders.json` automatically.

## Fresh setup on Windows

Use PowerShell from the project folder:

```powershell
cd C:\Users\<YourUser>\ConfortPlaceReminder
npm install
```

Start the dashboard manually:

```powershell
npm run web
```

Open:

```text
http://localhost:3000
```

Start the WhatsApp scheduler manually:

```powershell
npm run service
```

On the first WhatsApp run, scan the QR code:

```text
WhatsApp mobile app -> Linked devices -> Link a device
```

After the QR is scanned, the session is stored locally in `.wwebjs_auth/`.

## Install as always-on Windows services

Recommended production folder:

```text
C:\Users\LeoNa\ConfortPlaceReminder
```

Install both services using NSSM:

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

If Windows marks a service for deletion or the services get stuck:

```powershell
.\scripts\ResetServiciosNSSM.cmd
```

Then reboot Windows if the service still appears as “marked for deletion”.

## Clone this repo on another system with another WhatsApp

This is the safest path when using a different WhatsApp number/account:

1. Clone the repo.

   ```powershell
   git clone https://github.com/Jehosua97/acme-reminder-automation.git ConfortPlaceReminder
   cd ConfortPlaceReminder
   npm install
   ```

2. Do not copy `.wwebjs_auth/` from the old machine unless you intentionally want to reuse the same WhatsApp session.

3. Start the dashboard:

   ```powershell
   npm run web
   ```

4. Start WhatsApp once in a visible/manual terminal:

   ```powershell
   npm run service
   ```

5. Scan the QR with the new WhatsApp account.

6. Add houses/reminders from the dashboard, or copy a sanitized `data/reminders.json` if you want to migrate reminder data.

7. Install services:

   ```powershell
   .\scripts\InstalarServiciosNSSM.cmd
   ```

8. Verify:

   ```powershell
   .\scripts\VerificarServiciosNSSM.cmd
   ```

## Migrating existing reminders to another machine

Reminder data lives here:

```text
data/reminders.json
```

To migrate reminders but use a different WhatsApp account:

1. Copy only `data/reminders.json`.
2. Do not copy `.wwebjs_auth/`.
3. Start `npm run service`.
4. Scan QR with the new WhatsApp account.
5. Confirm WhatsApp group names match exactly.

If a group name differs by one character, WhatsApp sending will fail for that group.

## Debugging checklist

### 1. Is the dashboard running?

Open:

```text
http://localhost:3000
```

Or check:

```powershell
Get-Service ConfortPlace-Web
```

### 2. Is the WhatsApp service running?

```powershell
Get-Service ConfortPlace-WhatsApp
```

Or:

```powershell
.\scripts\VerificarServiciosNSSM.cmd
```

### 3. What did the scheduler do last?

Check:

```powershell
Get-Content runtime\estado_programados.txt
Get-Content runtime\servicio_programados.log -Tail 120
Get-Content runtime\resultados_programados.tsv
```

### 4. Was a message skipped as duplicate?

Check:

```powershell
Get-Content runtime\envios_programados_log.tsv
```

Scheduled sends use this anti-duplicate key:

```text
reminderId|yyyy-mm-dd hh:mm
```

If the service restarts inside the send window, already-confirmed sends are skipped.

### 5. Does WhatsApp need QR again?

Run:

```powershell
npm run service
```

If a QR appears, scan it again from WhatsApp mobile.

Common reasons:

- WhatsApp Web session expired.
- The phone/account was unlinked.
- `.wwebjs_auth/` was deleted.
- The service was moved to a new Windows user/folder.

### 6. Did the PC sleep?

For reliable sending:

- keep Windows plugged in;
- set sleep/hibernate to Never;
- keep internet stable;
- avoid shutting down during scheduled send windows.

Screen off is fine; sleep/hibernate is not.

## Debug mode vs production mode

Settings are stored in:

```text
data/settings.json
```

| Mode | Review interval | Send window | Time selector |
| --- | ---: | ---: | ---: |
| Debug | 2 minutes | 3 minutes | every minute |
| Production | 5 minutes | 10 minutes | every 30 minutes |

Switch modes:

```powershell
.\scripts\ActivarModoDebug.cmd
.\scripts\ActivarModoProduccion.cmd
```

Use debug mode for short live tests. Use production mode for real operation.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run web` | Start dashboard/API manually. |
| `npm run service` | Start persistent WhatsApp scheduler manually. |
| `npm run send:auto` | Run one automatic due-reminder check. |
| `npm run send` | Run manual-send flow once. |
| `.\scripts\InstalarServiciosNSSM.cmd` | Install Windows services. |
| `.\scripts\VerificarServiciosNSSM.cmd` | Check service health. |
| `.\scripts\ReiniciarServiciosNSSM.cmd` | Restart services. |
| `.\scripts\ResetServiciosNSSM.cmd` | Recreate services if stuck/broken. |
| `.\scripts\DetenerServicioWhatsApp.cmd` | Stop WhatsApp scheduler. |

## Operational notes

- The WhatsApp group name in each reminder must match the real WhatsApp group name exactly.
- Keep reminder volume reasonable to reduce WhatsApp blocking risk.
- Avoid large bursts of messages.
- Review logs after schedule changes.
- Keep the PC awake and connected.
- Do not commit `.wwebjs_auth/`, `runtime/`, or real production data.

## More details

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for a deeper operations and troubleshooting guide.
