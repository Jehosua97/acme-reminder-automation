'use strict';

const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUTA_SESION = path.join(PROJECT_ROOT, '.wwebjs_auth');
const WWEB_VERSION = process.env.WWEB_VERSION || '2.3000.1043159177-alpha';
const WWEB_REMOTE_CACHE = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html';

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'recordatorios-excel',
    dataPath: RUTA_SESION,
  }),
  webVersion: WWEB_VERSION,
  webVersionCache: {
    type: 'remote',
    remotePath: WWEB_REMOTE_CACHE,
    strict: true,
  },
  puppeteer: {
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  },
});

function finish(code) {
  setTimeout(async () => {
    try { await client.destroy(); } catch {}
    process.exit(code);
  }, 1000);
}

client.on('qr', (qr) => {
  console.log('QR requerido. Escanealo desde WhatsApp > Dispositivos vinculados.');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('Autenticacion correcta.');
});

client.on('ready', async () => {
  console.log(`WhatsApp listo. Version fijada: ${WWEB_VERSION}`);
  try {
    const groups = await client.pupPage.evaluate(() => {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();
      return chats
        .map((chat) => {
          const id = chat.id?._serialized || chat.id?.toString?.() || '';
          const name = chat.name || chat.formattedTitle || '';
          return { id, name, isGroup: id.endsWith('@g.us') };
        })
        .filter((chat) => chat.id && chat.name && chat.isGroup);
    });
    console.log(`Grupos leidos: ${groups.length}`);
    console.log('Primeros grupos:');
    groups.slice(0, 20).forEach((group) => console.log(`- ${group.name}`));
    finish(0);
  } catch (error) {
    console.error('Fallo getChats:', error && (error.stack || error.message) ? (error.stack || error.message) : error);
    finish(2);
  }
});

client.on('auth_failure', (message) => {
  console.error('Fallo autenticacion:', message);
  finish(3);
});

client.on('disconnected', (reason) => {
  console.error('Desconectado:', reason);
  finish(4);
});

setTimeout(() => {
  console.error('Timeout: WhatsApp no estuvo listo en 120s.');
  finish(5);
}, 120000);

client.initialize();
