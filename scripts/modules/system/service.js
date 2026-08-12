'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function createSystemService({ projectRoot, runtime, scriptsRoot, readSettings }) {
  const pauseFile = path.join(runtime, 'sistema_pausado.flag');
  const startScript = path.join(scriptsRoot, 'IniciarServicioWhatsAppBackground.ps1');
  const stopScript = path.join(scriptsRoot, 'DetenerServicioWhatsApp.ps1');

  function tail(file, lines = 120) {
    const full = path.join(runtime, file);
    if (!fs.existsSync(full)) return '';
    return fs.readFileSync(full, 'utf8').split(/\r?\n/).filter((line) => (
      !/Data source:/i.test(line) && !/Archivo:\s*.*RecordatoriosWhatsApp/i.test(line)
    )).slice(-lines).join('\n');
  }

  function isPidRunning(pid) {
    if (!pid) return false;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { "YES" } else { "NO" }`], { encoding: 'utf8' });
    return result.stdout.trim() === 'YES';
  }

  function info() {
    const lockPath = path.join(runtime, 'servicio_programados.lock');
    const lock = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : '';
    const match = lock.match(/pid=(\d+)/);
    const pid = match ? Number(match[1]) : null;
    return {
      running: isPidRunning(pid), paused: fs.existsSync(pauseFile), pid, lock,
      status: tail('estado_programados.txt', 10), serviceLog: tail('servicio_programados.log', 160),
      results: tail('resultados_programados.tsv', 80), sentLog: tail('envios_programados_log.tsv', 80),
      autoLog: tail('auto_programados.log', 80), settings: readSettings(),
    };
  }

  function run(script) {
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { cwd: projectRoot, encoding: 'utf8', timeout: 30000 });
  }

  return {
    info,
    pause() { if (!fs.existsSync(runtime)) fs.mkdirSync(runtime, { recursive: true }); fs.writeFileSync(pauseFile, `paused=${new Date().toISOString()}\n`, 'utf8'); },
    resume() { if (fs.existsSync(pauseFile)) fs.unlinkSync(pauseFile); },
    start() { return run(startScript); },
    stop() { return run(stopScript); },
  };
}

module.exports = { createSystemService };
