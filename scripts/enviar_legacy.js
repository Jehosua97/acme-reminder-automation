'use strict';

/**
 * Envía recordatorios a grupos de WhatsApp definidos en un libro de Excel.
 *
 * Uso:
 *   node enviar.js "C:\ruta\RecordatoriosWhatsApp.xlsm"
 *
 * Si no se pasa una ruta, se usa el archivo configurado en RUTA_EXCEL_PREDETERMINADA.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Opcional: ruta fija para ejecutar el script manualmente sin argumentos.
// La macro VBA pasa la ruta del libro automáticamente, por lo que normalmente
// no hace falta cambiar esta línea.
const RUTA_EXCEL_PREDETERMINADA = path.join(
  __dirname,
  'RecordatoriosWhatsApp.xlsm'
);

const RUTA_EXCEL = path.resolve(process.argv[2] || RUTA_EXCEL_PREDETERMINADA);
const RUTA_ESTADO = path.join(__dirname, 'estado_envio.txt');
const RUTA_ESTADO_TEMPORAL = `${RUTA_ESTADO}.tmp`;
const RUTA_RESULTADOS = path.join(__dirname, 'resultados_envio.tsv');
const RUTA_RESULTADOS_TEMPORAL = `${RUTA_RESULTADOS}.tmp`;
const RUTA_SESION = path.join(__dirname, '.wwebjs_auth');
const ACK_MINIMO_CONFIRMADO = 1; // 1 = recibido por servidor de WhatsApp.
const TIEMPO_MAXIMO_CONFIRMACION_MS = 30000;

let finalizando = false;
let client;
let resultadosEnvio = [];

function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor);
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

function limpiarParaTsv(valor) {
  return texto(valor).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function demoraAleatoria() {
  return Math.floor(Math.random() * 3001) + 2000; // 2.000 a 5.000 ms
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

function esperarConfirmacionMensaje(mensaje) {
  return new Promise((resolve) => {
    const idMensaje = mensaje.id && mensaje.id._serialized;

    if (!idMensaje) {
      resolve(mensaje.ack);
      return;
    }

    if (mensaje.ack >= ACK_MINIMO_CONFIRMADO) {
      resolve(mensaje.ack);
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

function escribirEstado(ok, resumen) {
  const contenido = `${ok ? 'OK' : 'ERROR'}\r\n${resumen}\r\n`;

  // Escritura temporal + renombrado: evita que VBA lea un archivo incompleto.
  fs.writeFileSync(RUTA_ESTADO_TEMPORAL, contenido, 'utf8');
  fs.renameSync(RUTA_ESTADO_TEMPORAL, RUTA_ESTADO);
}

function registrarResultado(numeroFila, ok, estado, nota) {
  resultadosEnvio.push({
    numeroFila,
    ok,
    estado,
    nota,
  });
}

function escribirResultados() {
  const encabezado = 'fila\tok\testado\tnota\r\n';
  const lineas = resultadosEnvio
    .map((resultado) =>
      [
        resultado.numeroFila,
        resultado.ok ? 'SI' : 'NO',
        limpiarParaTsv(resultado.estado),
        limpiarParaTsv(resultado.nota),
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

async function finalizar(ok, resumen, codigoSalida = ok ? 0 : 1) {
  if (finalizando) return;
  finalizando = true;

  console.log(`\n${resumen}`);

  try {
    escribirEstado(ok, resumen);
    escribirResultados();
  } catch (error) {
    console.error('No se pudo escribir el archivo de estado/resultados:', error.message);
    codigoSalida = 1;
  }

  try {
    if (client) await client.destroy();
  } catch (error) {
    console.error('Aviso al cerrar WhatsApp Web:', error.message);
  }

  // Fuerza el cierre porque Chromium puede dejar manejadores activos.
  setTimeout(() => process.exit(codigoSalida), 250);
}

function leerFilasSeleccionadas() {
  if (!fs.existsSync(RUTA_EXCEL)) {
    throw new Error(`No existe el archivo Excel: ${RUTA_EXCEL}`);
  }

  const libro = XLSX.readFile(RUTA_EXCEL, { cellDates: false });
  const nombreHoja = libro.SheetNames[0];

  if (!nombreHoja) {
    throw new Error('El libro no contiene hojas.');
  }

  const hoja = libro.Sheets[nombreHoja];
  const filas = XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  });

  if (filas.length === 0) {
    throw new Error('La primera hoja está vacía.');
  }

  const indiceEncabezado = filas.findIndex((fila) => {
    const encabezados = fila.map((celda) => normalizar(celda));
    const columnaGrupo = encabezados.findIndex(
      (encabezado) => encabezado.includes('GRUPO') || encabezado.includes('CASA')
    );
    const columnaEnviar = encabezados.findIndex((encabezado) =>
      encabezado.includes('ENVIAR')
    );
    const columnaMensaje = encabezados.findIndex((encabezado) =>
      encabezado.includes('MENSAJE')
    );
    const columnas = new Set([columnaGrupo, columnaEnviar, columnaMensaje]);

    return (
      columnaGrupo !== -1 &&
      columnaEnviar !== -1 &&
      columnaMensaje !== -1 &&
      columnas.size === 3
    );
  });

  if (indiceEncabezado === -1) {
    throw new Error(
      'No se encontró la fila de encabezados. La hoja debe tener columnas ' +
        'para Casa/Grupo, Enviar y Mensaje.'
    );
  }

  const encabezados = filas[indiceEncabezado].map((celda) => normalizar(celda));
  const columnaGrupo = encabezados.findIndex(
    (encabezado) => encabezado.includes('GRUPO') || encabezado.includes('CASA')
  );
  const columnaEnviar = encabezados.findIndex((encabezado) =>
    encabezado.includes('ENVIAR')
  );
  const columnaMensaje = encabezados.findIndex((encabezado) =>
    encabezado.includes('MENSAJE')
  );
  const columnaTipo = encabezados.findIndex(
    (encabezado) =>
      encabezado.includes('TIPO') || encabezado.includes('CATEGORIA')
  );

  if (columnaGrupo === -1 || columnaEnviar === -1 || columnaMensaje === -1) {
    throw new Error(
      'No se pudieron identificar las columnas Casa/Grupo, Enviar y Mensaje.'
    );
  }

  // Se omiten las filas superiores de título/ayuda y la fila de encabezados.
  return filas
    .slice(indiceEncabezado + 1)
    .map((fila, indice) => ({
      numeroFila: indiceEncabezado + indice + 2,
      grupo: texto(fila[columnaGrupo]).trim(),
      tipo: columnaTipo === -1 ? '' : texto(fila[columnaTipo]).trim(),
      enviar: texto(fila[columnaEnviar]).trim(),
      mensaje: texto(fila[columnaMensaje]).trim(),
    }))
    .filter((fila) => esSi(fila.enviar));
}

async function procesarEnvios() {
  let seleccionadas;

  try {
    seleccionadas = leerFilasSeleccionadas();
  } catch (error) {
    await finalizar(false, `No se pudo leer Excel: ${error.message}`);
    return;
  }

  if (seleccionadas.length === 0) {
    await finalizar(true, 'No hay filas marcadas con SI. No se envió ningún mensaje.');
    return;
  }

  console.log(`Libro: ${RUTA_EXCEL}`);
  console.log(`Filas marcadas con SI: ${seleccionadas.length}`);
  console.log('Cargando la lista de chats...');

  let chats;
  try {
    chats = await client.getChats();
  } catch (error) {
    await finalizar(false, `No se pudieron obtener los chats: ${error.message}`);
    return;
  }

  let enviados = 0;
  let errores = 0;

  for (let i = 0; i < seleccionadas.length; i += 1) {
    const fila = seleccionadas[i];

    if (!fila.grupo) {
      errores += 1;
      registrarResultado(
        fila.numeroFila,
        false,
        'ERROR',
        'No se envió: el nombre del grupo está vacío.'
      );
      console.error(`[ERROR] Fila ${fila.numeroFila}: el nombre del grupo está vacío.`);
      continue;
    }

    if (!fila.mensaje) {
      errores += 1;
      registrarResultado(
        fila.numeroFila,
        false,
        'ERROR',
        'No se envió: el mensaje está vacío.'
      );
      console.error(`[ERROR] Fila ${fila.numeroFila}: el mensaje está vacío.`);
      continue;
    }

    // Comparación exacta, sensible a mayúsculas, minúsculas, tildes y espacios.
    const coincidencias = chats.filter(
      (chat) => chat.isGroup && chat.name === fila.grupo
    );

    if (coincidencias.length === 0) {
      errores += 1;
      registrarResultado(
        fila.numeroFila,
        false,
        'ERROR',
        `No se encontró el grupo exacto "${fila.grupo}".`
      );
      console.error(
        `[ERROR] Fila ${fila.numeroFila}: no se encontró el grupo exacto "${fila.grupo}".`
      );
      continue;
    }

    // Dos grupos pueden tener el mismo nombre. No enviamos para evitar hacerlo
    // al grupo equivocado.
    if (coincidencias.length > 1) {
      errores += 1;
      registrarResultado(
        fila.numeroFila,
        false,
        'ERROR',
        `Hay ${coincidencias.length} grupos llamados "${fila.grupo}".`
      );
      console.error(
        `[ERROR] Fila ${fila.numeroFila}: hay ${coincidencias.length} grupos llamados ` +
          `"${fila.grupo}". Cambia uno de los nombres para que sea único.`
      );
      continue;
    }

    try {
      const mensajeEnviado = await coincidencias[0].sendMessage(fila.mensaje);
      const ack = await esperarConfirmacionMensaje(mensajeEnviado);

      if (ack >= ACK_MINIMO_CONFIRMADO) {
        enviados += 1;
        const horaEnvio = new Date().toLocaleString('es-MX', {
          hour12: false,
        });
        registrarResultado(
          fila.numeroFila,
          true,
          'ENVIADO',
          `${horaEnvio} | Último mensaje: ${fila.mensaje}`
        );
        console.log(
          `[ENVIADO] Fila ${fila.numeroFila} -> "${fila.grupo}" ` +
            `(ACK ${ack} ${nombreAck(ack)}): ${fila.mensaje}`
        );
      } else {
        errores += 1;
        registrarResultado(
          fila.numeroFila,
          false,
          'PENDIENTE',
          `WhatsApp no confirmó el envío en ${
            TIEMPO_MAXIMO_CONFIRMACION_MS / 1000
          }s (ACK ${ack} ${nombreAck(ack)}).`
        );
        console.error(
          `[ERROR] Fila ${fila.numeroFila} -> "${fila.grupo}": ` +
            `WhatsApp no confirmó el envío en ` +
            `${TIEMPO_MAXIMO_CONFIRMACION_MS / 1000}s ` +
            `(ACK ${ack} ${nombreAck(ack)}).`
        );
      }
    } catch (error) {
      errores += 1;
      registrarResultado(fila.numeroFila, false, 'ERROR', error.message);
      console.error(
        `[ERROR] Fila ${fila.numeroFila} -> "${fila.grupo}": ${error.message}`
      );
    }

    // Solo esperamos si todavía queda otra fila seleccionada por procesar.
    if (i < seleccionadas.length - 1) {
      const ms = demoraAleatoria();
      console.log(`Esperando ${(ms / 1000).toFixed(1)} segundos...`);
      await esperar(ms);
    }
  }

  const resumen = `Proceso terminado: ${enviados} enviado(s), ${errores} error(es).`;
  await finalizar(errores === 0, resumen, errores === 0 ? 0 : 2);
}

client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'recordatorios-excel',
    dataPath: RUTA_SESION,
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\nEscanea este QR desde WhatsApp > Dispositivos vinculados:');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('Autenticación correcta. Cargando WhatsApp...');
});

client.on('ready', () => {
  console.log('WhatsApp está listo.');
  procesarEnvios().catch((error) =>
    finalizar(false, `Error inesperado: ${error.message}`)
  );
});

client.on('auth_failure', (mensaje) => {
  finalizar(false, `Falló la autenticación: ${mensaje}`);
});

client.on('disconnected', (razon) => {
  finalizar(false, `WhatsApp se desconectó: ${razon}`);
});

process.on('uncaughtException', (error) => {
  finalizar(false, `Error no controlado: ${error.message}`);
});

process.on('unhandledRejection', (error) => {
  const mensaje = error && error.message ? error.message : String(error);
  finalizar(false, `Promesa rechazada: ${mensaje}`);
});

client.initialize();
