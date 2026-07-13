# ACME Reminder Automation Platform

Portfolio project by **Jehosua97** demonstrating DevOps, cloud-minded operations, security awareness, and business-process automation.

This project automates scheduled and manual WhatsApp group reminders from an Excel-based control plane. It was designed for a fictional company, **ACME**, where non-technical operators need a simple interface while the automation layer handles scheduling, validation, retries, logs, and local runtime state.

> This project uses `whatsapp-web.js`, an unofficial WhatsApp Web automation library. It is intended as an automation portfolio project and operational prototype, not as an endorsement of unofficial production messaging at scale.

## Engineering focus

- DevOps automation on Windows with PowerShell and Task Scheduler.
- Node.js service logic for message dispatch and reliability controls.
- Excel as a low-friction business UI.
- Operational logging, retry handling, and duplicate-send prevention.
- Security hygiene by excluding runtime sessions, caches, logs, phone details, and real operational workbooks from Git.
- Portfolio-ready repository structure with sanitized sample assets.

## Architecture

```text
Excel workbook
  |-- one main worksheet with a house filter
  |-- weekday checkboxes, active flag, send time, message, status
  |-- protected computed columns for last/next sends
        |
        v
PowerShell orchestration
  |-- manual launcher with confirmation flow
  |-- automatic launcher from Windows Task Scheduler
  |-- lock file, hard timeout, retry control, Excel status updates
        |
        v
Node.js sender
  |-- reads Excel using SheetJS/xlsx
  |-- selects due reminders
  |-- resolves WhatsApp groups by exact name
  |-- sends messages through whatsapp-web.js
  |-- waits for WhatsApp ACK confirmation
  |-- writes structured runtime results
        |
        v
WhatsApp Web session
  |-- persisted locally with LocalAuth
  |-- excluded from Git
```

## Repository layout

```text
.
├── docs/                       # Supporting documentation
├── examples/                   # Sanitized demo workbook for portfolio review
├── runtime/                    # Local logs/status files, ignored by Git
├── scripts/                    # All Node.js, PowerShell, CMD, and VBA scripts
├── workbooks/                  # Local operational Excel files, ignored by Git
└── package.json
```

## Main features

- Excel workbook organized in a single operational sheet with a native house filter.
- Local web admin interface for reminder editing, filtering, service control, and log inspection.
- Scheduled reminder calculation through protected Excel formulas.
- Minute-level testing mode and fixed-hour production mode.
- Manual send mode with operator confirmation.
- Automatic send mode using Windows Task Scheduler.
- WhatsApp Web authentication with persistent `LocalAuth`.
- ACK validation after message send.
- Random delay between messages.
- Anti-duplicate log for scheduled sends.
- Hard timeout and retry handling for stuck WhatsApp Web/Chromium sessions.
- Automatic Excel status update after scheduled sends.

## Requirements

- Windows.
- Microsoft Excel / Microsoft 365.
- Node.js.
- WhatsApp account with access to the target groups.
- A logged-in Windows user session for WhatsApp Web automation.

## Setup

Install dependencies:

```powershell
npm install
```

Place the operational workbook here:

```text
workbooks/RecordatoriosWhatsApp_Programados.xlsx
```

For portfolio review, use the sanitized workbook:

```text
examples/ACME_Reminder_Automation_Template.xlsx
```

## First WhatsApp authentication

Run a manual or automatic send flow once. On first launch, the terminal will display a QR code.

1. Open WhatsApp on the automation phone.
2. Go to linked devices.
3. Scan the QR code.
4. The local session is stored in `.wwebjs_auth/`.

The session folder is intentionally ignored by Git.

## Manual send

Use:

```powershell
.\scripts\EnviarProgramadosManual.cmd
```

The manual workflow:

1. Reads rows marked for manual send.
2. Shows a confirmation prompt.
3. Runs the Node.js sender.
4. Updates Excel status, last send, and notes.

## Web admin interface

The web interface uses the same operational workbook as Excel:

```text
workbooks/RecordatoriosWhatsApp_Programados.xlsx
```

There is no separate database. Excel remains the source of truth, and the web UI reads from and writes back to the same workbook.

Start the web admin:

```powershell
.\scripts\IniciarWebAdmin.cmd
```

Or:

```powershell
npm run web
```

Open:

```text
http://localhost:3000
```

The web UI provides:

- reminder filtering by house, category, active status, and text search;
- editing for category, weekday selection, send time, active flag, manual-send flag, message, and notes;
- read-only visibility for last send and next send;
- system status, service state, and recent logs;
- buttons to start, stop, and restart the persistent WhatsApp service.

Operational note: changes made in Excel must be saved before the web UI can read them. Changes made in the web UI are written directly into the workbook and saved automatically.

## Automatic send

The preferred runtime model is the persistent service. It starts WhatsApp Web once and keeps checking for due reminders.

Start the service:

```powershell
.\scripts\IniciarServicioWhatsApp.cmd
```

Stop the service:

```powershell
.\scripts\DetenerServicioWhatsApp.cmd
```

Install startup launchers:

```powershell
.\scripts\InstalarServicioWhatsApp.cmd
```

If Task Scheduler permissions are unavailable, place `RecordatoriosWhatsAppServicio.cmd` in the Windows Startup folder for the current user.

Legacy one-shot scheduled task installer:

```powershell
.\scripts\InstalarTareaAutomatica.cmd
```

Remove it:

```powershell
.\scripts\DesinstalarTareaAutomatica.cmd
```

The automatic workflow runs through:

```text
scripts/IniciarServicioWhatsApp.cmd
scripts/IniciarServicioWhatsApp.ps1
scripts/enviar_programados.js --service --headless
```

## Testing mode

Enable minute-level scheduling:

```powershell
.\scripts\CambiarHorasModoPruebaMinutos.ps1
```

Testing mode is useful for validating sends at exact times such as `10:12 hrs` or `10:20 hrs`.

## Production mode

Restore fixed hourly selection:

```powershell
.\scripts\CambiarHorasModoHorasFijas.ps1
```

For operations and debugging, see:

```text
docs/OPERATIONS.md
```

For production, configure Task Scheduler frequency and the Node.js tolerance window consistently. The script supports:

```powershell
$env:VENTANA_AUTO_MINUTOS = "210"
```

## Security and operational notes

- Do not commit real workbooks, phone details, runtime logs, or WhatsApp session folders.
- Use a dedicated WhatsApp number for automation.
- Keep the Windows user session logged in.
- Keep the host connected to power for scheduled sends.
- Avoid spam-like behavior and high-volume bursts.
- Excel sheet protection prevents accidental edits; it is not a security boundary.
- For enterprise messaging at scale, evaluate official APIs and compliance requirements.

## Portfolio scope

This repository shows a pragmatic automation pattern: familiar business tooling on the front end, scripted orchestration underneath, and operational safeguards around reliability and traceability.

Relevant domains:

- DevOps automation
- Windows operations
- PowerShell scripting
- Node.js integration
- Security-conscious repository hygiene
- Workflow automation
- Observability through logs and status files
