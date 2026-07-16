# Confort Place WhatsApp Reminder Automation

Local web-managed automation for scheduled and manual WhatsApp group reminders.

The system is designed for Confort Place operators who need a simple dashboard to manage recurring house reminders while the automation layer handles scheduling, delivery attempts, status tracking, and logs.

## Architecture

```text
Web dashboard
  -> Express API
  -> Reminder storage
  -> WhatsApp sender service
  -> whatsapp-web.js / WhatsApp Web
```

Runtime logs:

```text
runtime/
```

## Features

- Local Express web dashboard.
- Multi-house filtering with checkbox selectors.
- Add/edit/delete reminders from the browser.
- Bulk delete for selected reminders.
- Editable house, category, schedule, time, active flag, manual-send flag, and message.
- Weekly, monthly, and interval scheduling, including rules such as first Friday, first/third Saturday, or every 2 weeks from a base date.
- Read-only operational notes and last-send metadata.
- Weekly result reset so Monday starts with reminders pending.
- Category and house management from combobox controls.
- Pause/resume control from the dashboard.
- Start/stop/restart WhatsApp service from the dashboard.
- Persistent WhatsApp Web session via `whatsapp-web.js` `LocalAuth`.
- Anti-duplicate scheduled-send log.
- Service status and logs surfaced in the web UI.

## Tech stack

- Node.js
- Express
- whatsapp-web.js
- qrcode-terminal
- Local file persistence
- PowerShell/CMD launchers for Windows

## Setup

Install dependencies:

```powershell
npm install
```

Start the web dashboard:

```powershell
npm run web
```

Open:

```text
http://localhost:3000
```

Start the persistent WhatsApp service:

```powershell
.\scripts\IniciarServicioWhatsApp.cmd
```

On first run, scan the QR code from WhatsApp:

```text
WhatsApp -> Linked devices -> Link a device
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run web` | Start the local web dashboard. |
| `npm run send` | Run manual-send mode once. |
| `npm run send:auto` | Run automatic due-reminder mode once. |
| `npm run service` | Run the persistent WhatsApp service in the current terminal. |
| `.\scripts\IniciarServicioWhatsApp.cmd` | Start the hidden Windows service wrapper. |
| `.\scripts\DetenerServicioWhatsApp.cmd` | Stop the service and related process tree. |

## Data model

Each reminder has:

- exact WhatsApp group name;
- category;
- schedule type and rules;
- send time;
- active/manual flags;
- message body;
- result status;
- last send timestamp;
- notes.

The next scheduled sends are calculated automatically.

## Operations

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for service control, logs, debugging, and operational details.

## Security and reliability notes

This project uses `whatsapp-web.js`, which controls WhatsApp Web through an unofficial automation layer. That has operational risk:

- WhatsApp may block or limit the account.
- WhatsApp Web sessions may expire.
- Group names must match exactly.
- The PC must remain awake and online.

Recommended controls:

- keep reminder volume low;
- avoid burst sending;
- use human-like spacing between messages;
- monitor logs daily;
- keep the machine awake while the service is expected to send;
- do not commit `.wwebjs_auth/`, `runtime/`, or real operational secrets.
