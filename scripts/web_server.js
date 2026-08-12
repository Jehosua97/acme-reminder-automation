'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const store = require('./data_store');
const { createReminderRouter } = require('./modules/reminders/routes');
const { createSystemService } = require('./modules/system/service');
const { createSystemRouter } = require('./modules/system/routes');
const { createNewCustomersInfoRouter } = require('./modules/new-customers-info/routes');
const { createNewCustomersService } = require('./modules/new-customers-info/service');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(PROJECT_ROOT, 'runtime');
const WEB_ROOT = path.join(PROJECT_ROOT, 'web');
const UPLOAD_ROOT = path.join(PROJECT_ROOT, 'data', 'uploads');
const PORT = Number(process.env.PORT || 3000);

function safeImageExtension(mime, originalName = '') {
  const lower = String(originalName || '').toLowerCase();
  if (mime === 'image/jpeg' || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
  if (mime === 'image/png' || lower.endsWith('.png')) return '.png';
  if (mime === 'image/webp' || lower.endsWith('.webp')) return '.webp';
  if (mime === 'image/gif' || lower.endsWith('.gif')) return '.gif';
  return '';
}

function saveUploadedImage(body = {}) {
  const dataUrl = String(body.dataUrl || '');
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Imagen invalida. Usa PNG, JPG, WEBP o GIF.');
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const extension = safeImageExtension(mime, body.name);
  if (!extension) throw new Error('Formato de imagen no soportado.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('La imagen esta vacia.');
  if (buffer.length > 12 * 1024 * 1024) throw new Error('La imagen es demasiado grande. Maximo 12 MB.');
  if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  const basename = `image-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
  const fullPath = path.join(UPLOAD_ROOT, basename);
  fs.writeFileSync(fullPath, buffer);
  return {
    mediaPath: path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/'),
    mediaName: String(body.name || basename).trim() || basename,
    mediaMime: mime,
    mediaUrl: `/uploads/${encodeURIComponent(basename)}`,
  };
}

function createApp(options = {}) {
  const app = express();
  const newCustomersService = options.newCustomersService || createNewCustomersService();
  const systemService = createSystemService({
    projectRoot: PROJECT_ROOT,
    runtime: RUNTIME,
    scriptsRoot: __dirname,
    readSettings: store.readSettings,
  });

  app.use(express.json({ limit: '18mb' }));
  app.use('/uploads', express.static(UPLOAD_ROOT));
  app.use(express.static(WEB_ROOT, { index: false }));

  app.get('/', (req, res) => res.sendFile(path.join(WEB_ROOT, 'dashboard.html')));
  app.get('/reminders', (req, res) => res.sendFile(path.join(WEB_ROOT, 'index.html')));
  app.get('/new-customers-info', (req, res) => res.sendFile(path.join(WEB_ROOT, 'dashboard.html')));

  app.post('/api/uploads/image', (req, res) => {
    try { res.json({ ok: true, image: saveUploadedImage(req.body || {}) }); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.use('/api', createReminderRouter(store));
  app.use('/api', createSystemRouter(systemService));
  app.use('/api/new-customers-info', createNewCustomersInfoRouter(newCustomersService));
  return app;
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(`Confort Place Web UI running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
