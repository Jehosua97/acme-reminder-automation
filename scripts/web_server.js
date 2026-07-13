'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const XLSX = require('xlsx');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKBOOK = path.join(PROJECT_ROOT, 'workbooks', 'RecordatoriosWhatsApp_Programados.xlsx');
const RUNTIME = path.join(PROJECT_ROOT, 'runtime');
const WEB_ROOT = path.join(PROJECT_ROOT, 'web');
const PAUSE_FILE = path.join(RUNTIME, 'sistema_pausado.flag');
const CREATE_SCRIPT = path.join(__dirname, 'AgregarRecordatorioDesdeWeb.ps1');
const UPDATE_SCRIPT = path.join(__dirname, 'ActualizarRecordatorioDesdeWeb.ps1');
const DELETE_SCRIPT = path.join(__dirname, 'EliminarRecordatorioDesdeWeb.ps1');
const DELETE_CATEGORY_SCRIPT = path.join(__dirname, 'EliminarCategoriaDesdeWeb.ps1');
const DELETE_HOUSE_SCRIPT = path.join(__dirname, 'EliminarCasaDesdeWeb.ps1');
const START_SCRIPT = path.join(__dirname, 'IniciarServicioWhatsApp.ps1');
const START_BACKGROUND_SCRIPT = path.join(__dirname, 'IniciarServicioWhatsAppBackground.ps1');
const STOP_SCRIPT = path.join(__dirname, 'DetenerServicioWhatsApp.ps1');

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(WEB_ROOT));

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function bool(value) {
  const normalized = text(value).trim().toUpperCase();
  return normalized === 'TRUE' || normalized === 'SI' || normalized === 'YES' || normalized === '1';
}

function readWorkbook() {
  const wb = XLSX.readFile(WORKBOOK, { cellDates: false });
  const ws = wb.Sheets['Recordatorios Programados'];
  if (!ws) throw new Error('No se encontro la hoja Recordatorios Programados.');

  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  });

  const reminders = [];
  for (let i = 4; i < rows.length; i += 1) {
    const r = rows[i];
    const group = text(r[0]).trim();
    const message = text(r[15]).trim();
    if (!group || group.startsWith('CASA / GRUPO:') || !message) continue;

    reminders.push({
      row: i + 1,
      group,
      category: text(r[1]).trim(),
      days: {
        lun: bool(r[2]),
        mar: bool(r[3]),
        mie: bool(r[4]),
        jue: bool(r[5]),
        vie: bool(r[6]),
        sab: bool(r[7]),
        dom: bool(r[8]),
      },
      hora: text(r[9]).trim(),
      activo: text(r[10]).trim() || 'NO',
      enviarManual: text(r[11]).trim() || 'NO',
      estado: text(r[12]).trim(),
      ultimoEnvio: text(r[13]).trim(),
      proximoEnvio: text(r[14]).trim(),
      mensaje: text(r[15]),
      notas: text(r[16]),
      filtrarCasa: text(r[17]).trim() || group,
    });
  }

  const houses = [...new Set(reminders.map((r) => r.filtrarCasa || r.group))].sort();
  const categories = [...new Set(reminders.map((r) => r.category).filter(Boolean))].sort();
  return { reminders, houses, categories, updatedAt: new Date().toISOString() };
}

function tail(file, lines = 120) {
  const full = path.join(RUNTIME, file);
  if (!fs.existsSync(full)) return '';
  const content = fs.readFileSync(full, 'utf8');
  return content.split(/\r?\n/).slice(-lines).join('\n');
}

function isPidRunning(pid) {
  if (!pid) return false;
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { "YES" } else { "NO" }`,
  ], { encoding: 'utf8' });
  return result.stdout.trim() === 'YES';
}

function serviceInfo() {
  const lockPath = path.join(RUNTIME, 'servicio_programados.lock');
  let pid = null;
  let lock = '';
  if (fs.existsSync(lockPath)) {
    lock = fs.readFileSync(lockPath, 'utf8');
    const match = lock.match(/pid=(\d+)/);
    if (match) pid = Number(match[1]);
  }
  return {
    running: isPidRunning(pid),
    paused: fs.existsSync(PAUSE_FILE),
    pid,
    lock,
    status: tail('estado_programados.txt', 10),
    serviceLog: tail('servicio_programados.log', 160),
    results: tail('resultados_programados.tsv', 80),
    sentLog: tail('envios_programados_log.tsv', 80),
    autoLog: tail('auto_programados.log', 80),
  };
}

function startServiceInBackground() {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    START_BACKGROUND_SCRIPT,
  ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 30000 });
}

app.get('/api/reminders', (req, res) => {
  try {
    res.json(readWorkbook());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reminders', (req, res) => {
  try {
    if (!fs.existsSync(RUNTIME)) fs.mkdirSync(RUNTIME, { recursive: true });
    const jsonPath = path.join(RUNTIME, `web_create_${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(req.body || {}, null, 2), 'utf8');

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      CREATE_SCRIPT,
      '-JsonPath',
      jsonPath,
    ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });

    try { fs.unlinkSync(jsonPath); } catch {}

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'No se pudo agregar el recordatorio en Excel.',
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    res.json({ ok: true, stdout: result.stdout, workbook: readWorkbook() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/reminders/:row', (req, res) => {
  try {
    const row = Number(req.params.row);
    if (!Number.isInteger(row) || row < 5) {
      return res.status(400).json({ error: 'Fila invalida.' });
    }

    if (!fs.existsSync(RUNTIME)) fs.mkdirSync(RUNTIME, { recursive: true });
    const payload = { row, ...req.body };
    const jsonPath = path.join(RUNTIME, `web_update_${Date.now()}_${row}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      UPDATE_SCRIPT,
      '-JsonPath',
      jsonPath,
    ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });

    try { fs.unlinkSync(jsonPath); } catch {}

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'No se pudo actualizar Excel.',
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    res.json({ ok: true, workbook: readWorkbook() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/reminders/:row', (req, res) => {
  try {
    const row = Number(req.params.row);
    if (!Number.isInteger(row) || row < 5) {
      return res.status(400).json({ error: 'Fila invalida.' });
    }

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      DELETE_SCRIPT,
      '-Row',
      String(row),
    ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'No se pudo eliminar la fila en Excel.',
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    res.json({ ok: true, workbook: readWorkbook() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/categories/:category', (req, res) => {
  try {
    const category = decodeURIComponent(req.params.category || '').trim();
    if (!category) return res.status(400).json({ error: 'Categoria invalida.' });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      DELETE_CATEGORY_SCRIPT,
      '-Category',
      category,
    ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'No se pudo eliminar la categoria en Excel.',
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    res.json({ ok: true, stdout: result.stdout, workbook: readWorkbook() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/houses/:house', (req, res) => {
  try {
    const house = decodeURIComponent(req.params.house || '').trim();
    if (!house) return res.status(400).json({ error: 'Casa / grupo invalido.' });

    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      DELETE_HOUSE_SCRIPT,
      '-House',
      house,
    ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });

    if (result.status !== 0) {
      return res.status(500).json({
        error: 'No se pudo eliminar la casa / grupo en Excel.',
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }

    res.json({ ok: true, stdout: result.stdout, workbook: readWorkbook() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  try {
    res.json(serviceInfo());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/system/pause', (req, res) => {
  try {
    if (!fs.existsSync(RUNTIME)) fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(PAUSE_FILE, `paused=${new Date().toISOString()}\n`, 'utf8');
    res.json({ ok: true, message: 'Sistema pausado.', status: serviceInfo() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/system/resume', (req, res) => {
  try {
    if (fs.existsSync(PAUSE_FILE)) fs.unlinkSync(PAUSE_FILE);
    res.json({ ok: true, message: 'Sistema reanudado.', status: serviceInfo() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/service/start', (req, res) => {
  const current = serviceInfo();
  if (current.running) return res.json({ ok: true, message: 'Servicio ya esta corriendo.', status: current });

  const result = startServiceInBackground();
  if (result.status !== 0) {
    return res.status(500).json({
      ok: false,
      message: 'No se pudo iniciar el servicio.',
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  res.json({ ok: true, message: 'Servicio iniciado.', stdout: result.stdout, status: serviceInfo() });
});

app.post('/api/service/stop', (req, res) => {
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    STOP_SCRIPT,
  ], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 30000 });

  res.json({
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  });
});

app.post('/api/service/restart', (req, res) => {
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', STOP_SCRIPT], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });
  const result = startServiceInBackground();
  res.json({
    ok: result.status === 0,
    message: result.status === 0 ? 'Servicio reiniciado.' : 'No se pudo reiniciar el servicio.',
    stdout: result.stdout,
    stderr: result.stderr,
  });
});

app.listen(PORT, () => {
  console.log(`ACME Reminder Web UI running at http://localhost:${PORT}`);
});
