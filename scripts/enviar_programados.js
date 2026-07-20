'use strict';

/**
 * Envio de recordatorios programados.
 *
 * Modo manual:
 *   node enviar_programados.js
 *   EnvÃ­a filas donde "Enviar manual" = SI.
 *
 * Modo automÃ¡tico:
 *   node enviar_programados.js --auto
 *   EnvÃ­a filas donde "Activo" = SI y ProgramaciÃ³n/Hora coinciden con el horario actual.
 *
 * Este script actualiza el registro local de recordatorios y escribe:
 *   estado_programados.txt
 *   resultados_programados.tsv
 */

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { rowsForSender, applySendResults } = require('./data_store');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ARGUMENTOS = process.argv.slice(2);
const MODO_AUTO = ARGUMENTOS.includes('--auto');
const MODO_SERVICIO = ARGUMENTOS.includes('--service');
const MODO_HEADLESS = MODO_AUTO || MODO_SERVICIO || ARGUMENTOS.includes('--headless');
const RUTA_RUNTIME = path.join(PROJECT_ROOT, 'runtime');
if (!fs.existsSync(RUTA_RUNTIME)) fs.mkdirSync(RUTA_RUNTIME, { recursive: true });
const RUTA_ESTADO = path.join(RUTA_RUNTIME, 'estado_programados.txt');
const RUTA_ESTADO_TEMPORAL = `${RUTA_ESTADO}.tmp`;
const RUTA_RESULTADOS = path.join(RUTA_RUNTIME, 'resultados_programados.tsv');
const RUTA_RESULTADOS_TEMPORAL = `${RUTA_RESULTADOS}.tmp`;
const RUTA_LOG = path.join(RUTA_RUNTIME, 'envios_programados_log.tsv');
const RUTA_PAUSA = path.join(RUTA_RUNTIME, 'sistema_pausado.flag');
const RUTA_SESION = path.join(PROJECT_ROOT, '.wwebjs_auth');
const RUTA_WWEB_CACHE = path.join(PROJECT_ROOT, '.wwebjs_cache');

const ACK_MINIMO_CONFIRMADO = 1;
const TIEMPO_MAXIMO_CONFIRMACION_MS = 90000;
const PUPPETEER_PROTOCOL_TIMEOUT_MS = 300000;
const PUPPETEER_DEFAULT_TIMEOUT_MS = 180000;
const TIEMPO_MAXIMO_INICIALIZACION_MS = 120000;
const CODIGO_REINICIO_WHATSAPP = 75;
const WWEB_VERSION = process.env.WWEB_VERSION || '2.3000.1043159177-alpha';
const WWEB_REMOTE_CACHE = 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html';
const WWEB_LOCAL_CACHE_FILE = path.join(RUTA_WWEB_CACHE, `${WWEB_VERSION}.html`);
const INTERVALO_SERVICIO_MS = Number(process.env.INTERVALO_SERVICIO_MS || 60000);
// Ventana de tolerancia para envios automaticos.
// En testing se usa 3 minutos con una tarea frecuente.
// En produccion puede sobrescribirse con la variable VENTANA_AUTO_MINUTOS.
const VENTANA_AUTO_MINUTOS = Number(process.env.VENTANA_AUTO_MINUTOS || 3);
const PRIMER_SABADO_RUIDO = new Date(2026, 6, 11); // 2026-07-11
const MESES_ES = {
  ENE: 0,
  FEB: 1,
  MAR: 2,
  ABR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AGO: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DIC: 11,
};

let client;
let finalizando = false;
let resultados = [];
let filasPreseleccionadas = null;
let temporizadorInicializacion = null;
let cicloServicioEnCurso = false;

function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor);
}

function rutaMediaAbsoluta(mediaPath) {
  const value = texto(mediaPath).trim();
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.join(PROJECT_ROOT, value);
}

function mediaItemsFila(fila = {}) {
  const items = Array.isArray(fila.mediaItems) ? fila.mediaItems : [];
  const normalized = items
    .map((item) => ({
      mediaPath: texto(item?.mediaPath).trim(),
      mediaName: texto(item?.mediaName).trim(),
      mediaMime: texto(item?.mediaMime).trim(),
    }))
    .filter((item) => item.mediaPath);

  if (!normalized.length && texto(fila.mediaPath).trim()) {
    normalized.push({
      mediaPath: texto(fila.mediaPath).trim(),
      mediaName: texto(fila.mediaName).trim(),
      mediaMime: texto(fila.mediaMime).trim(),
    });
  }

  return normalized;
}

function descripcionMediaFila(fila = {}) {
  const items = mediaItemsFila(fila);
  if (!items.length) return '';
  const nombres = items.map((item) => item.mediaName || item.mediaPath).filter(Boolean);
  if (items.length === 1) return `[Imagen: ${nombres[0] || 'imagen'}] `;
  return `[${items.length} imagenes: ${nombres.slice(0, 5).join(', ')}${nombres.length > 5 ? ', ...' : ''}] `;
}

async function enviarFila(chatId, fila) {
  const mediaItems = mediaItemsFila(fila);
  if (mediaItems.length) {
    const enviados = [];
    for (let i = 0; i < mediaItems.length; i += 1) {
      const item = mediaItems[i];
      const mediaFile = rutaMediaAbsoluta(item.mediaPath);
      if (!fs.existsSync(mediaFile)) {
        throw new Error(`No existe la imagen configurada: ${mediaFile}`);
      }
      const media = MessageMedia.fromFilePath(mediaFile);
      const enviado = await client.sendMessage(chatId, media, {
        caption: i === 0 ? texto(fila.mensaje).trim() : '',
      });
      enviados.push(enviado);
    }
    return enviados[enviados.length - 1];
  }
  return client.sendMessage(chatId, fila.mensaje);
}

function normalizar(valor) {
  return texto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function esSi(valor) {
  return normalizar(valor) === 'SI';
}

function limpiarTsv(valor) {
  return texto(valor).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorReiniciarWhatsapp(mensaje, causa) {
  const error = new Error(mensaje);
  error.reiniciarWhatsapp = true;
  if (causa) error.cause = causa;
  return error;
}

function mensajeError(error) {
  if (!error) return 'Error desconocido';
  if (error.stack) return error.stack;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function demoraAleatoria() {
  return Math.floor(Math.random() * 3001) + 2000;
}

function nombreAck(ack) {
  const nombres = {
    '-1': 'ERROR',
    0: 'PENDIENTE',
    1: 'SERVIDOR',
    2: 'DISPOSITIVO',
    3: 'LEIDO',
    4: 'REPRODUCIDO',
  };
  return nombres[String(ack)] || `DESCONOCIDO_${ack}`;
}

function pad2(numero) {
  return String(numero).padStart(2, '0');
}

function fechaEnvio(fecha = new Date()) {
  const dias = [
    'domingo',
    'lunes',
    'martes',
    'miÃ©rcoles',
    'jueves',
    'viernes',
    'sÃ¡bado',
  ];
  const meses = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  return `${dias[fecha.getDay()]} ${pad2(fecha.getDate())}/${
    meses[fecha.getMonth()]
  }/${fecha.getFullYear()} ${pad2(fecha.getHours())}:${pad2(
    fecha.getMinutes()
  )} hrs`;
}

function claveFechaHora(fecha) {
  return `${fecha.getFullYear()}-${pad2(fecha.getMonth() + 1)}-${pad2(
    fecha.getDate()
  )} ${pad2(fecha.getHours())}:${pad2(fecha.getMinutes())}`;
}

function soloFecha(fecha) {
  return `${fecha.getFullYear()}-${pad2(fecha.getMonth() + 1)}-${pad2(
    fecha.getDate()
  )}`;
}

function horaProgramada(hora) {
  const valor = normalizar(hora);
  if (!valor) return null;
  if (valor.includes('7:00 PM') || valor.includes('7 PM')) return { h: 19, m: 0 };
  if (valor.includes('8:00 PM') || valor.includes('8 PM')) return { h: 20, m: 0 };
  if (valor.includes('9:00 PM') || valor.includes('9 PM')) return { h: 21, m: 0 };
  if (valor.includes('NOCHE')) return { h: 21, m: 0 };

  const match24 = valor.match(/(\d{1,2}):(\d{2})/);
  if (match24) {
    return { h: Number(match24[1]), m: Number(match24[2]) };
  }

  return null;
}

function parseFechaProximoEnvio(linea) {
  const limpia = texto(linea).trim();
  const match = limpia.match(
    /(\d{1,2})\/([A-Za-zÃÃ‰ÃÃ“ÃšÃœÃ‘Ã¡Ã©Ã­Ã³ÃºÃ¼Ã±]{3})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+hrs/i
  );

  if (!match) return null;

  const dia = Number(match[1]);
  const mes = MESES_ES[normalizar(match[2]).slice(0, 3)];
  const anio = Number(match[3]);
  const hora = Number(match[4]);
  const minuto = Number(match[5]);

  if (mes === undefined) return null;

  return new Date(anio, mes, dia, hora, minuto, 0, 0);
}

function inicioDelDia(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

function diferenciaDias(a, b) {
  return Math.round((inicioDelDia(a) - inicioDelDia(b)) / 86400000);
}

function ocurrenciaProgramada(fila, ahora = new Date()) {
  const fechasProximoEnvio = texto(fila.proximoEnvio)
    .split(/\r?\n/)
    .map(parseFechaProximoEnvio)
    .filter(Boolean);

  for (const fechaObjetivo of fechasProximoEnvio) {
    const diferenciaMinutos = Math.floor((ahora - fechaObjetivo) / 60000);

    if (diferenciaMinutos >= 0 && diferenciaMinutos < VENTANA_AUTO_MINUTOS) {
      return {
        fechaObjetivo,
        clave: `${fila.numeroFila}|${claveFechaHora(fechaObjetivo)}`,
      };
    }
  }

  return null;
}

function leerLogEnvios() {
  const enviados = new Set();
  if (!fs.existsSync(RUTA_LOG)) return enviados;

  const lineas = fs.readFileSync(RUTA_LOG, 'utf8').split(/\r?\n/).slice(1);
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const [clave, ok] = linea.split('\t');
    if (ok === 'SI') enviados.add(clave);
  }
  return enviados;
}

function agregarLogEnvio(resultado) {
  const existe = fs.existsSync(RUTA_LOG);
  const encabezado = 'clave\tok\tfecha\tfila\tgrupo\tcategoria\tnota\r\n';
  const linea = [
    limpiarTsv(resultado.ocurrencia || ''),
    resultado.ok ? 'SI' : 'NO',
    limpiarTsv(resultado.fecha || ''),
    resultado.fila,
    limpiarTsv(resultado.grupo || ''),
    limpiarTsv(resultado.categoria || ''),
    limpiarTsv(resultado.nota || ''),
  ].join('\t');

  fs.appendFileSync(RUTA_LOG, (existe ? '' : encabezado) + `${linea}\r\n`, 'utf8');
}

function escribirEstado(ok, resumen) {
  fs.writeFileSync(
    RUTA_ESTADO_TEMPORAL,
    `${ok ? 'OK' : 'ERROR'}\r\n${resumen}\r\n`,
    'utf8'
  );
  fs.renameSync(RUTA_ESTADO_TEMPORAL, RUTA_ESTADO);
}

function registrarResultado({
  fila,
  hoja = '',
  ok,
  estado,
  nota,
  fecha = '',
  ocurrencia = '',
  grupo = '',
  categoria = '',
}) {
  const resultado = { fila, hoja, ok, estado, nota, fecha, ocurrencia, grupo, categoria };
  resultados.push(resultado);
  if ((MODO_AUTO || MODO_SERVICIO) && ocurrencia) agregarLogEnvio(resultado);
}

function escribirResultados() {
  const encabezado = 'fila\thoja\tok\testado\tfecha\tnota\tocurrencia\tgrupo\tcategoria\r\n';
  const lineas = resultados
    .map((r) =>
      [
        r.fila,
        limpiarTsv(r.hoja || ''),
        r.ok ? 'SI' : 'NO',
        limpiarTsv(r.estado),
        limpiarTsv(r.fecha),
        limpiarTsv(r.nota),
        limpiarTsv(r.ocurrencia || ''),
        limpiarTsv(r.grupo || ''),
        limpiarTsv(r.categoria || ''),
      ].join('\t')
    )
    .join('\r\n');

  fs.writeFileSync(
    RUTA_RESULTADOS_TEMPORAL,
    encabezado + lineas + (lineas ? '\r\n' : ''),
    'utf8'
  );
  fs.renameSync(RUTA_RESULTADOS_TEMPORAL, RUTA_RESULTADOS);
}

function actualizarDataStoreDesdeResultados() {
  try {
    applySendResults(resultados);
  } catch (error) {
    console.error(`No se pudo actualizar el registro local de recordatorios: ${error.message}`);
  }
}

async function finalizar(ok, resumen, codigo = ok ? 0 : 1) {
  if (finalizando) return;
  finalizando = true;

  console.log(`\n${resumen}`);

  try {
    escribirEstado(ok, resumen);
    escribirResultados();
    actualizarDataStoreDesdeResultados();
  } catch (error) {
    console.error('No se pudo escribir estado/resultados:', error.message);
    codigo = 1;
  }

  try {
    if (client) await client.destroy();
  } catch (error) {
    console.error('Aviso al cerrar WhatsApp Web:', error.message);
  }

  setTimeout(() => process.exit(codigo), 250);
}

function esperarConfirmacionMensaje(mensaje) {
  return new Promise((resolve) => {
    if (!mensaje) {
      resolve(ACK_MINIMO_CONFIRMADO);
      return;
    }

    const idMensaje = mensaje.id && mensaje.id._serialized;

    if (!idMensaje || mensaje.ack >= ACK_MINIMO_CONFIRMADO) {
      resolve(typeof mensaje.ack === 'number' ? mensaje.ack : ACK_MINIMO_CONFIRMADO);
      return;
    }

    const terminar = (ack) => {
      clearTimeout(timeout);
      client.off('message_ack', alCambiarAck);
      resolve(ack);
    };

    const alCambiarAck = (mensajeActualizado, ack) => {
      const idActualizado =
        mensajeActualizado.id && mensajeActualizado.id._serialized;
      if (idActualizado === idMensaje && ack >= ACK_MINIMO_CONFIRMADO) {
        terminar(ack);
      }
    };

    const timeout = setTimeout(() => {
      client.off('message_ack', alCambiarAck);
      resolve(mensaje.ack);
    }, TIEMPO_MAXIMO_CONFIRMACION_MS);

    client.on('message_ack', alCambiarAck);
  });
}

async function obtenerGruposConRecuperacion() {
  try {
    return await obtenerGruposBasicos();
  } catch (primerError) {
    console.error(`Aviso: lectura de grupos fallo. Reintentando en 10s: ${mensajeError(primerError)}`);
    await esperar(10000);
    try {
      return await obtenerGruposBasicos();
    } catch (segundoError) {
      throw errorReiniciarWhatsapp(
        `No se pudieron obtener los grupos despues de reintentar: ${mensajeError(segundoError)}`,
        segundoError
      );
    }
  }
}

async function obtenerGruposBasicos() {
  const grupos = await client.pupPage.evaluate(() => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    return chats
      .map((chat) => {
        const id = chat.id?._serialized || chat.id?.toString?.() || '';
        const name = chat.name || chat.formattedTitle || '';
        return {
          id,
          name,
          isGroup: id.endsWith('@g.us'),
        };
      })
      .filter((chat) => chat.id && chat.name && chat.isGroup);
  });

  return grupos;
}

function leerFilasDataStore() {
  return rowsForSender();
}

function seleccionarFilas() {
  const filas = leerFilasDataStore();

  if (!MODO_AUTO && !MODO_SERVICIO) {
    return filas.filter((fila) => esSi(fila.enviarManual));
  }

  const yaEnviados = leerLogEnvios();
  const ahora = new Date();

  return filas
    .filter((fila) => esSi(fila.activo))
    .map((fila) => ({ ...fila, ocurrencia: ocurrenciaProgramada(fila, ahora) }))
    .filter((fila) => {
      if (!fila.ocurrencia) return false;
      if (yaEnviados.has(fila.ocurrencia.clave)) {
        console.log(
          `[DUPLICADO OMITIDO] Fila ${fila.numeroFila} -> "${fila.grupo}" ` +
            `(${fila.ocurrencia.clave})`
        );
        return false;
      }
      return true;
    });
}

async function procesarEnvios() {
  let filas;

  try {
    filas = filasPreseleccionadas || seleccionarFilas();
  } catch (error) {
    await finalizar(false, `No se pudo leer data store: ${error.message}`);
    return;
  }

  if (filas.length === 0) {
    const mensaje = MODO_AUTO
      ? 'No hay recordatorios automÃ¡ticos pendientes en esta ventana.'
      : 'No hay filas marcadas con Enviar manual = SI.';
    await finalizar(true, mensaje);
    return;
  }

  const resultado = await procesarFilas(filas);
  const resumen = `Proceso terminado: ${resultado.enviados} enviado(s), ${resultado.errores} error(es).`;
  await finalizar(resultado.errores === 0, resumen, resultado.errores === 0 ? 0 : 2);
}

async function procesarFilas(filas) {
  console.log(`Modo: ${MODO_SERVICIO ? 'SERVICIO' : MODO_AUTO ? 'AUTOMÃTICO' : 'MANUAL'}`);
  console.log('Sistema de recordatorios: Confort Place');
  console.log(`Filas a enviar: ${filas.length}`);
  console.log('Cargando grupos de WhatsApp...');

  const grupos = await obtenerGruposConRecuperacion();
  console.log(`Grupos disponibles: ${grupos.length}`);

  let enviados = 0;
  let errores = 0;

  for (let i = 0; i < filas.length; i += 1) {
    const fila = filas[i];
    const ocurrencia = fila.ocurrencia ? fila.ocurrencia.clave : '';

    const coincidencias = grupos.filter((chat) => chat.name === fila.grupo);

    if (coincidencias.length === 0) {
      errores += 1;
      registrarResultado({
        fila: fila.numeroFila,
        hoja: fila.hoja,
        ok: false,
        estado: 'ERROR',
        nota: `No se encontrÃ³ el grupo exacto "${fila.grupo}".`,
        ocurrencia,
        grupo: fila.grupo,
        categoria: fila.categoria,
      });
      console.error(`[ERROR] No se encontrÃ³ "${fila.grupo}".`);
      continue;
    }

    if (coincidencias.length > 1) {
      errores += 1;
      registrarResultado({
        fila: fila.numeroFila,
        hoja: fila.hoja,
        ok: false,
        estado: 'ERROR',
        nota: `Hay ${coincidencias.length} grupos con el nombre "${fila.grupo}".`,
        ocurrencia,
        grupo: fila.grupo,
        categoria: fila.categoria,
      });
      continue;
    }

    try {
      const enviado = await enviarFila(coincidencias[0].id, fila);
      const ack = await esperarConfirmacionMensaje(enviado);

      if (ack >= ACK_MINIMO_CONFIRMADO) {
        enviados += 1;
        const fecha = fechaEnvio();
        registrarResultado({
          fila: fila.numeroFila,
          hoja: fila.hoja,
          ok: true,
          estado: 'ENVIADO',
          fecha,
          nota: `${fecha} | ${fila.categoria} | ${descripcionMediaFila(fila)}${fila.mensaje}`,
          ocurrencia,
          grupo: fila.grupo,
          categoria: fila.categoria,
        });
        console.log(
          `[ENVIADO] Fila ${fila.numeroFila} -> "${fila.grupo}" ` +
            `(ACK ${ack} ${nombreAck(ack)})`
        );
      } else {
        errores += 1;
        registrarResultado({
          fila: fila.numeroFila,
          hoja: fila.hoja,
          ok: false,
          estado: 'PENDIENTE',
          nota: `WhatsApp no confirmÃ³ en ${TIEMPO_MAXIMO_CONFIRMACION_MS / 1000}s ` +
            `(ACK ${ack} ${nombreAck(ack)}).`,
          ocurrencia,
          grupo: fila.grupo,
          categoria: fila.categoria,
        });
      }
    } catch (error) {
      errores += 1;
      registrarResultado({
        fila: fila.numeroFila,
        hoja: fila.hoja,
        ok: false,
        estado: 'ERROR',
        nota: error.message,
        ocurrencia,
        grupo: fila.grupo,
        categoria: fila.categoria,
      });
    }

    if (i < filas.length - 1) {
      const ms = demoraAleatoria();
      console.log(`Esperando ${(ms / 1000).toFixed(1)} segundos...`);
      await esperar(ms);
    }
  }

  return { enviados, errores };
}

async function ejecutarCicloServicio() {
  if (cicloServicioEnCurso) {
    console.log('Servicio: ciclo anterior sigue en curso; se omite esta revision.');
    return;
  }

  cicloServicioEnCurso = true;
  resultados = [];

  try {
    if (fs.existsSync(RUTA_PAUSA)) {
      const mensaje = 'Servicio pausado: no se enviaran recordatorios hasta reanudar.';
      console.log(`${fechaEnvio()} | ${mensaje}`);
      escribirEstado(true, mensaje);
      escribirResultados();
      return;
    }

    const filas = seleccionarFilas();

    if (filas.length === 0) {
      const mensaje = 'Servicio activo: no hay recordatorios pendientes en esta revision.';
      console.log(`${fechaEnvio()} | ${mensaje}`);
      escribirEstado(true, mensaje);
      escribirResultados();
      return;
    }

    const resultado = await procesarFilas(filas);
    const resumen = `Servicio: ${resultado.enviados} enviado(s), ${resultado.errores} error(es).`;
    console.log(resumen);
    escribirEstado(resultado.errores === 0, resumen);
    escribirResultados();
    actualizarDataStoreDesdeResultados();
  } catch (error) {
    const resumen = `Servicio: error en ciclo: ${error.message}`;
    console.error(resumen);
    escribirEstado(false, resumen);
    escribirResultados();
    if (error.reiniciarWhatsapp) {
      console.error('Servicio: WhatsApp Web parece inestable. Se reiniciara el cliente automaticamente.');
      setTimeout(() => process.exit(CODIGO_REINICIO_WHATSAPP), 500);
    }
  } finally {
    cicloServicioEnCurso = false;
  }
}

function iniciarServicio() {
  console.log(`Servicio iniciado. Revision cada ${Math.round(INTERVALO_SERVICIO_MS / 1000)} segundos.`);
  ejecutarCicloServicio();
  setInterval(ejecutarCicloServicio, INTERVALO_SERVICIO_MS);
}

if (!MODO_SERVICIO) try {
  filasPreseleccionadas = seleccionarFilas();
  if (filasPreseleccionadas.length === 0) {
    const mensaje = MODO_AUTO
      ? 'No hay recordatorios automÃ¡ticos pendientes en esta ventana.'
      : 'No hay filas marcadas con Enviar manual = SI.';
    console.log(mensaje);
    escribirEstado(true, mensaje);
    escribirResultados();
    process.exit(0);
  }
} catch (error) {
  const mensaje = `No se pudo leer data store: ${error.message}`;
  console.error(mensaje);
  escribirEstado(false, mensaje);
  escribirResultados();
  process.exit(1);
}

client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'recordatorios-excel',
    dataPath: RUTA_SESION,
  }),
  webVersion: WWEB_VERSION,
  webVersionCache: fs.existsSync(WWEB_LOCAL_CACHE_FILE)
    ? {
        type: 'local',
        path: RUTA_WWEB_CACHE,
        strict: true,
      }
    : {
        type: 'remote',
        remotePath: WWEB_REMOTE_CACHE,
        strict: true,
      },
  puppeteer: {
    headless: MODO_HEADLESS,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: PUPPETEER_PROTOCOL_TIMEOUT_MS,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-features=Crashpad',
      '--noerrdialogs',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  },
});

client.on('qr', (qr) => {
  if (temporizadorInicializacion) clearTimeout(temporizadorInicializacion);
  console.log('\nEscanea este QR desde WhatsApp > Dispositivos vinculados:');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('AutenticaciÃ³n correcta. Cargando WhatsApp...');
});

client.on('ready', () => {
  if (temporizadorInicializacion) clearTimeout(temporizadorInicializacion);
  console.log('WhatsApp estÃ¡ listo.');
  try {
    if (client.pupPage) {
      client.pupPage.setDefaultTimeout(PUPPETEER_DEFAULT_TIMEOUT_MS);
      client.pupPage.setDefaultNavigationTimeout(PUPPETEER_DEFAULT_TIMEOUT_MS);
    }
  } catch (error) {
    console.log(`Aviso: no se pudieron ajustar timeouts de Puppeteer: ${error.message}`);
  }
  if (MODO_SERVICIO) {
    iniciarServicio();
  } else {
    procesarEnvios().catch((error) =>
      finalizar(false, `Error inesperado: ${error.message}`)
    );
  }
});

client.on('auth_failure', (mensaje) => {
  finalizar(false, `FallÃ³ la autenticaciÃ³n: ${mensaje}`);
});

client.on('disconnected', (razon) => {
  finalizar(
    false,
    `WhatsApp se desconectÃ³: ${razon}`,
    MODO_SERVICIO ? CODIGO_REINICIO_WHATSAPP : 1
  );
});

process.on('uncaughtException', (error) => {
  finalizar(false, `Error no controlado: ${mensajeError(error)}`);
});

process.on('unhandledRejection', (error) => {
  const mensaje = mensajeError(error);
  const perfilOcupado = /browser is already running|userDataDir|running browser/i.test(mensaje);
  finalizar(
    false,
    `Promesa rechazada: ${mensaje}`,
    MODO_SERVICIO && perfilOcupado ? CODIGO_REINICIO_WHATSAPP : 1
  );
});

temporizadorInicializacion = setTimeout(() => {
  finalizar(
    false,
    `WhatsApp Web no estuvo listo en ${TIEMPO_MAXIMO_INICIALIZACION_MS / 1000}s.`,
    MODO_SERVICIO ? CODIGO_REINICIO_WHATSAPP : 1
  );
}, TIEMPO_MAXIMO_INICIALIZACION_MS);

client.initialize();

