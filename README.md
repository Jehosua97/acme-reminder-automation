# Confort Place WhatsApp Reminder Automation

Local web dashboard and Windows service automation for scheduled WhatsApp group reminders.

This project manages recurring operational reminders for Confort Place. Operators use a browser dashboard to create, edit, filter, activate, and monitor reminders. A local WhatsApp Web worker sends scheduled messages to WhatsApp groups and records status/logs locally.

> Important: this project uses `whatsapp-web.js`, an unofficial WhatsApp Web automation library. It is useful for group reminders, but it is not the official WhatsApp Business API and it carries account/session risk.

## Current architecture

```text
Browser dashboard
  -> Node/Express API
  -> JSON data store
  -> Persistent WhatsApp worker
  -> whatsapp-web.js
  -> WhatsApp Web groups
```

Windows services:

| Service | Purpose |
| --- | --- |
| `ConfortPlace-Web` | Local dashboard/API at `http://localhost:3000`. |
| `ConfortPlace-WhatsApp` | Persistent WhatsApp scheduler/worker. |

## Features

- Web dashboard for reminder management.
- Local JSON persistence in `data/reminders.json`.
- WhatsApp group sending through `whatsapp-web.js`.
- Weekly, monthly, and interval schedules.
- Rotating cleaning reminders by room number.
- Image reminders with one or multiple image attachments.
- Bulk activate, deactivate, and delete.
- Dashboard status page with service health, logs, and mode controls.
- Debug and production modes.
- Anti-duplicate send log to avoid repeat sends after restarts.
- NSSM-based Windows services for startup reliability.

## Repository layout

```text
.
├── data/
│   └── settings.json              # Safe tracked runtime settings
├── docs/
│   └── OPERATIONS.md              # Operations/debug guide
├── scripts/
│   ├── web_server.js              # Express API + dashboard server
│   ├── enviar_programados.js      # WhatsApp sender/scheduler
│   ├── data_store.js              # JSON persistence + schedule logic
│   ├── diagnosticar_whatsapp.js   # Visible WhatsApp diagnostic helper
│   ├── ActivarModoDebug.*         # Debug mode
│   ├── ActivarModoProduccion.*    # Production mode
│   ├── DetenerServicioWhatsApp.*  # Stop WhatsApp worker
│   ├── IniciarServicioWhatsApp.*  # Start persistent WhatsApp worker
│   ├── InstalarServiciosNSSM.*    # Install Windows services
│   ├── VerificarServiciosNSSM.*   # Check service health
│   ├── ReiniciarServiciosNSSM.*   # Restart services
│   ├── RepararServiciosNSSM.*     # Repair service configuration
│   └── ResetServiciosNSSM.*       # Recreate services if broken
├── web/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── package.json
└── README.md
```

Legacy Excel and Task Scheduler implementations were removed from `main` to keep the production branch clean. They are preserved in the branch:

```text
legacy-with-excel-scripts
```

## Files intentionally not committed

These are local/private and are ignored by git:

| Path | Why |
| --- | --- |
| `.wwebjs_auth/` | WhatsApp Web session. Never share this. |
| `.wwebjs_cache/` | WhatsApp/browser cache. |
| `runtime/` | Logs, status files, anti-duplicate send log. |
| `data/reminders.json` | Real house/group/message database. |
| `data/backups/` | Local operational backups. |
| `data/uploads/` | Uploaded reminder images. |
| `tools/` | Local NSSM/Chromium helper binaries. |

## Fresh setup on Windows

```powershell
git clone https://github.com/Jehosua97/acme-reminder-automation.git ConfortPlaceReminder
cd ConfortPlaceReminder
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

Start the WhatsApp worker manually:

```powershell
npm run service
```

On first run, scan the QR code:

```text
WhatsApp mobile app -> Linked devices -> Link a device
```

After scanning, the session is stored locally in `.wwebjs_auth/`.

## Install as Windows services

Recommended production folder:

```text
C:\Users\LeoNa\ConfortPlaceReminder
```

Install services using NSSM:

```powershell
.\scripts\InstalarServiciosNSSM.cmd
```

Verify:

```powershell
.\scripts\VerificarServiciosNSSM.cmd
```

Repair or reset if services are stuck:

```powershell
.\scripts\RepararServiciosNSSM.cmd
.\scripts\ResetServiciosNSSM.cmd
```

## Debug mode vs production mode

Settings live in:

```text
data/settings.json
```

| Mode | Review interval | Send window | Time selector |
| --- | ---: | ---: | ---: |
| Debug | 2 minutes | 3 minutes | every minute |
| Production | 5 minutes | 10 minutes | every 30 minutes |

Switch modes from the dashboard, or run:

```powershell
.\scripts\ActivarModoDebug.cmd
.\scripts\ActivarModoProduccion.cmd
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run web` | Start dashboard/API manually. |
| `npm run service` | Start persistent WhatsApp worker manually. |
| `npm run send:auto` | Run one automatic due-reminder check. |
| `npm run send` | Run manual-send flow once. |
| `.\scripts\InstalarServiciosNSSM.cmd` | Install Windows services. |
| `.\scripts\VerificarServiciosNSSM.cmd` | Check service health. |
| `.\scripts\ReiniciarServiciosNSSM.cmd` | Restart services. |
| `.\scripts\RepararServiciosNSSM.cmd` | Repair service configuration. |
| `.\scripts\ResetServiciosNSSM.cmd` | Recreate services if stuck/broken. |
| `.\scripts\DetenerServicioWhatsApp.cmd` | Stop WhatsApp worker. |

## Troubleshooting checklist

1. Open the dashboard:

   ```text
   http://localhost:3000
   ```

2. Check services:

   ```powershell
   .\scripts\VerificarServiciosNSSM.cmd
   ```

3. Check runtime logs:

   ```powershell
   Get-Content runtime\estado_programados.txt
   Get-Content runtime\servicio_programados.log -Tail 120
   Get-Content runtime\resultados_programados.tsv
   Get-Content runtime\envios_programados_log.tsv
   ```

4. If WhatsApp asks for QR again, run:

   ```powershell
   npm run service
   ```

   Then scan the QR from the WhatsApp mobile app.

## Operational notes

- The WhatsApp group name in each reminder must match the real group name exactly.
- Keep reminder volume reasonable to reduce WhatsApp blocking risk.
- Avoid large bursts of messages.
- Keep the PC awake and online during send windows.
- Do not commit `.wwebjs_auth/`, `runtime/`, uploaded images, or real reminder data.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for more details.
