'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const { createNewCustomersService } = require('./modules/new-customers-info/service');
const { createNewCustomersInfoRouter } = require('./modules/new-customers-info/routes');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(PROJECT_ROOT, 'runtime');
const AUTH_ROOT = path.join(PROJECT_ROOT, '.wwebjs_auth');
const CACHE_ROOT = path.join(PROJECT_ROOT, '.wwebjs_cache');
const DATABASE_FILE = path.join(PROJECT_ROOT, 'data', 'new-customers-whatsapp.sqlite');
const STATUS_FILE = path.join(RUNTIME, 'new_customers_whatsapp_status.json');
const LOCK_FILE = path.join(RUNTIME, 'new_customers_whatsapp.lock');
const QR_SVG_FILE = path.join(RUNTIME, 'new_customers_whatsapp_qr.svg');
const QR_PNG_FILE = path.join(RUNTIME, 'new_customers_whatsapp_qr.png');
const API_PORT = Number(process.env.NEW_CUSTOMERS_API_PORT || 3001);
const WWEB_VERSION = process.env.WWEB_VERSION || '2.3000.1043159177-alpha';
const WWEB_REMOTE_CACHE = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html';
const WWEB_LOCAL_CACHE_FILE = path.join(CACHE_ROOT, `${WWEB_VERSION}.html`);
const EXIT_RESTART = 75;

fs.mkdirSync(RUNTIME, { recursive: true });
fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });

let currentState = {};
function writeState(status, extra = {}) {
  currentState = {
    service: 'new-customers-info',
    status,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify(currentState, null, 2)}\n`, 'utf8');
}

function removeQrFiles() {
  for (const filename of [QR_SVG_FILE, QR_PNG_FILE]) {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function qrMatrix(value) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(value);
  qr.make();
  return qr.modules;
}

function writeQrFiles(value) {
  const modules = qrMatrix(value);
  const quiet = 4;
  const scale = 8;
  const count = modules.length;
  const size = (count + (quiet * 2)) * scale;
  const rectangles = [];
  modules.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) rectangles.push(`<rect x="${(x + quiet) * scale}" y="${(y + quiet) * scale}" width="${scale}" height="${scale}"/>`);
  }));
  fs.writeFileSync(QR_SVG_FILE,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rectangles.join('')}</g></svg>`,
    'utf8');

  const rows = [];
  for (let pixelY = 0; pixelY < size; pixelY += 1) {
    const row = Buffer.alloc(1 + size, 255);
    row[0] = 0;
    const moduleY = Math.floor(pixelY / scale) - quiet;
    for (let pixelX = 0; pixelX < size; pixelX += 1) {
      const moduleX = Math.floor(pixelX / scale) - quiet;
      if (moduleY >= 0 && moduleY < count && moduleX >= 0 && moduleX < count && modules[moduleY][moduleX]) row[pixelX + 1] = 0;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND'),
  ]);
  fs.writeFileSync(QR_PNG_FILE, png);
}

fs.writeFileSync(LOCK_FILE, `pid=${process.pid}\ninicio=${new Date().toISOString()}\n`, 'utf8');
writeState('STARTING');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'new-customers-info', dataPath: AUTH_ROOT }),
  webVersion: WWEB_VERSION,
  webVersionCache: fs.existsSync(WWEB_LOCAL_CACHE_FILE)
    ? { type: 'local', path: CACHE_ROOT, strict: true }
    : { type: 'remote', remotePath: WWEB_REMOTE_CACHE, strict: true },
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 300000,
    defaultViewport: null,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-extensions', '--disable-crash-reporter', '--disable-breakpad', '--noerrdialogs',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check',
    ],
  },
});

const newCustomersService = createNewCustomersService({ filename: DATABASE_FILE });
newCustomersService.attach(client);

const api = express();
api.use((req, res, next) => {
  const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
  const origin = String(req.headers.origin || '');
  if (allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
api.use(express.json({ limit: '18mb' }));
api.get('/api/new-customers-info/whatsapp/status', (req, res) => res.json({ ...currentState, qrAvailable: fs.existsSync(QR_PNG_FILE) }));
api.get('/api/new-customers-info/whatsapp/qr', (req, res) => {
  if (!fs.existsSync(QR_PNG_FILE)) return res.status(404).json({ error: 'No hay un QR pendiente.' });
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.sendFile(QR_PNG_FILE);
});
api.use('/api/new-customers-info', createNewCustomersInfoRouter(newCustomersService));
const apiServer = api.listen(API_PORT, '127.0.0.1', () => {
  console.log(`New Customers WhatsApp: API local activa en http://127.0.0.1:${API_PORT}.`);
});

client.on('qr', (value) => {
  writeQrFiles(value);
  writeState('WAITING_FOR_QR', { qrAvailable: true });
  console.log('New Customers WhatsApp: QR listo para vincular la cuenta exclusiva de clientes nuevos.');
});

client.on('authenticated', () => {
  writeState('AUTHENTICATED', { qrAvailable: fs.existsSync(QR_PNG_FILE) });
  console.log('New Customers WhatsApp: autenticación aceptada.');
});

client.on('ready', () => {
  removeQrFiles();
  const linkedDigits = String(client.info?.wid?.user || client.info?.wid?._serialized || '').replace(/\D/g, '');
  writeState('READY', {
    qrAvailable: false,
    linkedNumberMasked: linkedDigits ? `***${linkedDigits.slice(-4)}` : '',
    mode: newCustomersService.policyInfo().testMode ? 'test' : 'production',
  });
  console.log(`New Customers WhatsApp: listo con la cuenta ${linkedDigits ? `***${linkedDigits.slice(-4)}` : 'no identificada'}.`);
});

client.on('auth_failure', (message) => {
  writeState('AUTH_FAILURE', { error: String(message || 'Authentication failed').slice(0, 500) });
  console.error(`New Customers WhatsApp: falló la autenticación: ${message}`);
  process.exitCode = EXIT_RESTART;
});

client.on('disconnected', (reason) => {
  writeState('DISCONNECTED', { reason: String(reason || '').slice(0, 500) });
  console.error(`New Customers WhatsApp: desconectado: ${reason}`);
  setTimeout(() => process.exit(EXIT_RESTART), 250);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  writeState('STOPPING', { signal });
  try { await new Promise((resolve) => apiServer.close(resolve)); } catch {}
  try { await client.destroy(); } catch {}
  try { newCustomersService.store.close(); } catch {}
  if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  writeState('ERROR', { error: String(error?.stack || error).slice(0, 2000) });
  console.error(error?.stack || error);
  process.exit(EXIT_RESTART);
});
process.on('unhandledRejection', (error) => {
  writeState('ERROR', { error: String(error?.stack || error).slice(0, 2000) });
  console.error(error?.stack || error);
  process.exit(EXIT_RESTART);
});

client.initialize().catch((error) => {
  writeState('ERROR', { error: String(error?.stack || error).slice(0, 2000) });
  console.error(error?.stack || error);
  process.exit(EXIT_RESTART);
});
