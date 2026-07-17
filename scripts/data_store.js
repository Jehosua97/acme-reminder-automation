'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'reminders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DIAS = [
  ['dom', 'domingo'],
  ['lun', 'lunes'],
  ['mar', 'martes'],
  ['mie', 'miércoles'],
  ['jue', 'jueves'],
  ['vie', 'viernes'],
  ['sab', 'sábado'],
];
const DAY_KEYS = DIAS.map(([key]) => key);
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DEFAULT_SETTINGS = {
  mode: 'production',
  timeStepMinutes: 30,
  serviceIntervalMs: 300000,
  sendWindowMinutes: 10,
};
const TIME_STEP_MINUTES = DEFAULT_SETTINGS.timeStepMinutes;
const WEEKLY_STATUS_RESET_DAY = 0; // Domingo
const WEEKLY_STATUS_RESET_HOUR = 22; // 22:00 hora local
const CLEANING_ROW_PREFIX = 'cleaning:';
const CLEANING_DEFAULT_DAY = 'sab';
const CLEANING_DEFAULT_HOUR = '10:00';

function defaultCleaningTemplate(language = 'both') {
  const sun = '\u{1F31E}';
  const english = [
    `*${sun} Good morning everyone.*`,
    '',
    'As a reminder, this weekend the cleaning is assigned to room #{{room}}.',
    'The cleaning must be done on Saturday or Sunday. If it isn\u2019t completed on those days, you\u2019ll need to do it later and you\u2019ll also be responsible again next week for not following the assigned schedule.',
    'If you\u2019d like the Clean & Clear team to handle the cleaning, the cost is *$60 CAD*. Please confirm on Saturday so it can be scheduled for Sunday.',
    'From now on, cleanings will no longer be done on Mondays.',
    '',
    'Thank you for your cooperation!',
  ].join('\n');

  const spanish = [
    `*${sun} Buenos d\u00edas a todos.*`,
    '',
    'Como recordatorio, este fin de semana la limpieza le corresponde a la habitaci\u00f3n #{{room}}.',
    'La limpieza debe realizarse *el s\u00e1bado o domingo*. Si no se hace en esos d\u00edas, deber\u00e1n realizarla despu\u00e9s y *tambi\u00e9n les tocar\u00e1 nuevamente la siguiente semana* por no respetar el horario asignado.',
    'Si desean que el equipo de Clean & Clear realice la limpieza, el costo es de *$60 CAD*. Deber\u00e1n confirmarlo *el s\u00e1bado* para programarla el domingo.',
    'A partir de ahora ya no se realizar\u00e1n limpiezas los lunes.',
    '',
    '\u00a1Gracias por su cooperaci\u00f3n!',
  ].join('\n');

  if (language === 'en') return english;
  if (language === 'es') return spanish;
  return `${english}\n\n-----------------------\n\n${spanish}`;
}

function hasRoomPlaceholder(value) {
  return /\{\{\s*room\s*\}\}/i.test(text(value));
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).trim().toUpperCase();
  return normalized === 'TRUE' || normalized === 'SI' || normalized === 'YES' || normalized === '1';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeSettings(input = {}) {
  const mode = text(input.mode).trim().toLowerCase() === 'debug' ? 'debug' : 'production';
  const timeStepMinutes = Number(input.timeStepMinutes);
  const serviceIntervalMs = Number(input.serviceIntervalMs);
  const sendWindowMinutes = Number(input.sendWindowMinutes);
  return {
    mode,
    timeStepMinutes: Number.isInteger(timeStepMinutes) && timeStepMinutes >= 1 && timeStepMinutes <= 60
      ? timeStepMinutes
      : DEFAULT_SETTINGS.timeStepMinutes,
    serviceIntervalMs: Number.isInteger(serviceIntervalMs) && serviceIntervalMs >= 60000
      ? serviceIntervalMs
      : DEFAULT_SETTINGS.serviceIntervalMs,
    sendWindowMinutes: Number.isInteger(sendWindowMinutes) && sendWindowMinutes >= 1
      ? sendWindowMinutes
      : DEFAULT_SETTINGS.sendWindowMinutes,
  };
}

function readSettings() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    return { ...DEFAULT_SETTINGS };
  }
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const clean = normalizeSettings(settings);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

function normalizeHora(hora, { required = false } = {}) {
  const value = text(hora).trim();
  if (!value) return '';

  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`Hora invalida: "${value}". Usa formato HH:mm.`);

  let h = Number(match[1]);
  let m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Hora fuera de rango: "${value}".`);
  }

  const total = h * 60 + m;
  const step = readSettings().timeStepMinutes;
  const rounded = Math.round(total / step) * step;
  const safe = Math.min(23 * 60 + (60 - step), Math.max(0, rounded));
  h = Math.floor(safe / 60);
  m = safe % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function fechaLarga(fecha) {
  return `${DIAS[fecha.getDay()][1]} ${pad2(fecha.getDate())}/${MESES[fecha.getMonth()]}/${fecha.getFullYear()} ${pad2(fecha.getHours())}:${pad2(fecha.getMinutes())} hrs`;
}

function parseHora(hora) {
  const value = normalizeHora(hora);
  if (!value) return { h: 9, m: 0 };
  const [h, m] = value.split(':').map(Number);
  return { h, m };
}

function normalizeScheduleType(value) {
  const normalized = text(value).trim().toLowerCase();
  if (normalized === 'monthly') return 'monthly';
  if (normalized === 'interval') return 'interval';
  return 'weekly';
}

function normalizeMonthly(input = {}) {
  const rawOrdinals = Array.isArray(input.ordinals) ? input.ordinals : [];
  const ordinals = [...new Set(rawOrdinals
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5))]
    .sort((a, b) => a - b);
  const weekday = DAY_KEYS.includes(text(input.weekday).trim()) ? text(input.weekday).trim() : '';
  return { ordinals, weekday };
}

function normalizeHouseList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value).trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function isValidDateOnly(value) {
  const match = text(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseDateOnly(value) {
  if (!isValidDateOnly(value)) return null;
  const [y, m, d] = text(value).trim().split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function normalizeInterval(input = {}) {
  const startDate = isValidDateOnly(input.startDate) ? text(input.startDate).trim() : '';
  const everyWeeks = Number(input.everyWeeks || 0);
  return {
    startDate,
    everyWeeks: Number.isInteger(everyWeeks) && everyWeeks >= 1 && everyWeeks <= 52 ? everyWeeks : 0,
  };
}

function normalizeLanguage(value) {
  const normalized = text(value).trim().toLowerCase();
  if (normalized === 'en') return 'en';
  if (normalized === 'es') return 'es';
  return 'both';
}

function normalizeCleaningRotation(input = {}) {
  const roomCount = Number(input.roomCount || input.rooms || 0);
  const safeRoomCount = Number.isInteger(roomCount) && roomCount >= 1 && roomCount <= 30 ? roomCount : 1;
  const currentRoom = Number(input.currentRoom || 1);
  const safeCurrentRoom = Number.isInteger(currentRoom)
    ? Math.min(safeRoomCount, Math.max(1, currentRoom))
    : 1;
  const sendDay = DAY_KEYS.includes(text(input.sendDay).trim())
    ? text(input.sendDay).trim()
    : CLEANING_DEFAULT_DAY;
  const language = normalizeLanguage(input.language);
  const messageTemplate = text(input.messageTemplate || input.mensaje || input.message).trim()
    || defaultCleaningTemplate(language);
  const rawResponsibleRoom = Number(input.currentResponsibleRoom || input.responsibleRoom || input.lastSentRoom || 0);
  const fallbackResponsibleRoom = safeCurrentRoom <= 1 ? safeRoomCount : safeCurrentRoom - 1;
  const safeResponsibleRoom = Number.isInteger(rawResponsibleRoom) && rawResponsibleRoom >= 1 && rawResponsibleRoom <= safeRoomCount
    ? rawResponsibleRoom
    : fallbackResponsibleRoom;

  return {
    house: text(input.house || input.group).trim(),
    enabled: input.enabled === undefined ? true : bool(input.enabled),
    roomCount: safeRoomCount,
    currentRoom: safeCurrentRoom,
    currentResponsibleRoom: safeResponsibleRoom,
    sendDay,
    hora: normalizeHora(input.hora || CLEANING_DEFAULT_HOUR),
    language,
    messageTemplate,
    lastSentAt: text(input.lastSentAt).trim(),
    lastSentRoom: Number.isInteger(Number(input.lastSentRoom)) ? Number(input.lastSentRoom) : 0,
  };
}

function nextRoom(rotation) {
  const current = Number(rotation.currentRoom || 1);
  const roomCount = Number(rotation.roomCount || 1);
  return current >= roomCount ? 1 : current + 1;
}

function previousRoom(rotation) {
  const current = Number(rotation.currentRoom || 1);
  const roomCount = Number(rotation.roomCount || 1);
  return current <= 1 ? roomCount : current - 1;
}

function responsibleRoom(rotation) {
  const roomCount = Number(rotation.roomCount || 1);
  const currentResponsibleRoom = Number(rotation.currentResponsibleRoom || 0);
  if (Number.isInteger(currentResponsibleRoom) && currentResponsibleRoom >= 1 && currentResponsibleRoom <= roomCount) {
    return currentResponsibleRoom;
  }
  return previousRoom(rotation);
}

function normalizeReminder(input = {}, fallbackId = 1) {
  const id = Number(input.id ?? input.row ?? fallbackId);
  const scheduleType = normalizeScheduleType(input.scheduleType);
  return {
    id,
    group: text(input.group).trim(),
    category: text(input.category).trim(),
    scheduleType,
    monthly: normalizeMonthly(input.monthly),
    interval: normalizeInterval(input.interval),
    days: {
      lun: bool(input.days?.lun),
      mar: bool(input.days?.mar),
      mie: bool(input.days?.mie),
      jue: bool(input.days?.jue),
      vie: bool(input.days?.vie),
      sab: bool(input.days?.sab),
      dom: bool(input.days?.dom),
    },
    hora: normalizeHora(input.hora),
    activo: text(input.activo || 'NO').trim().toUpperCase() === 'SI' ? 'SI' : 'NO',
    enviarManual: text(input.enviarManual || 'NO').trim().toUpperCase() === 'SI' ? 'SI' : 'NO',
    estado: text(input.estado || 'PENDIENTE').trim() || 'PENDIENTE',
    ultimoEnvio: text(input.ultimoEnvio).trim(),
    mensaje: text(input.mensaje),
    notas: text(input.notas),
    filtrarCasa: text(input.filtrarCasa || input.group).trim(),
  };
}

function hasScheduledDay(reminder) {
  if (reminder.scheduleType === 'monthly') {
    return Boolean(reminder.monthly?.weekday && reminder.monthly?.ordinals?.length);
  }
  if (reminder.scheduleType === 'interval') {
    return Boolean(reminder.interval?.startDate && reminder.interval?.everyWeeks);
  }
  return Object.values(reminder.days || {}).some(Boolean);
}

function weeklyStatusResetThreshold(now = new Date()) {
  const threshold = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    WEEKLY_STATUS_RESET_HOUR,
    0,
    0,
    0
  );
  const daysSinceResetDay = (now.getDay() - WEEKLY_STATUS_RESET_DAY + 7) % 7;
  threshold.setDate(threshold.getDate() - daysSinceResetDay);
  if (now < threshold) threshold.setDate(threshold.getDate() - 7);
  return threshold;
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { version: 1, nextId: 1, houses: [], cleaningRotations: [], reminders: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function readStoreRaw() {
  ensureStore();
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
  const normalized = reminders.map((r, i) => normalizeReminder(r, i + 1));
  const maxId = normalized.reduce((max, r) => Math.max(max, r.id), 0);
  const houses = normalizeHouseList([
    ...(parsed.houses || []),
    ...normalized.map((r) => r.filtrarCasa || r.group),
    ...(parsed.cleaningRotations || []).map((r) => r.house || r.group),
  ]);
  const cleaningRotations = (Array.isArray(parsed.cleaningRotations) ? parsed.cleaningRotations : [])
    .map(normalizeCleaningRotation)
    .filter((r) => r.house);
  const store = {
    version: 1,
    lastWeeklyStatusReset: text(parsed.lastWeeklyStatusReset).trim(),
    nextId: Math.max(Number(parsed.nextId || 1), maxId + 1),
    houses,
    cleaningRotations,
    reminders: normalized,
  };
  return applyWeeklyStatusResetIfDue(store);
}

function writeStore(store) {
  ensureStore();
  const clean = {
    version: 1,
    lastWeeklyStatusReset: text(store.lastWeeklyStatusReset).trim(),
    nextId: Number(store.nextId || 1),
    houses: normalizeHouseList([
      ...(store.houses || []),
      ...(store.reminders || []).map((r) => r.filtrarCasa || r.group),
      ...(store.cleaningRotations || []).map((r) => r.house),
    ]),
    cleaningRotations: (store.cleaningRotations || [])
      .map(normalizeCleaningRotation)
      .filter((r) => r.house),
    reminders: (store.reminders || []).map((r, i) => normalizeReminder(r, i + 1)),
  };
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  return clean;
}

function applyWeeklyStatusResetIfDue(store, now = new Date()) {
  const threshold = weeklyStatusResetThreshold(now);
  const thresholdIso = threshold.toISOString();
  if (text(store.lastWeeklyStatusReset) === thresholdIso) return store;

  store.reminders = (store.reminders || []).map((r) => ({
    ...r,
    estado: 'PENDIENTE',
  }));
  store.lastWeeklyStatusReset = thresholdIso;
  return writeStore(store);
}

function nextOccurrences(reminder, now = new Date()) {
  if (reminder.activo !== 'SI') return 'Inactivo';
  if (reminder.scheduleType === 'monthly') return nextMonthlyOccurrences(reminder, now);
  if (reminder.scheduleType === 'interval') return nextIntervalOccurrences(reminder, now);
  const enabled = Object.entries(reminder.days).filter(([, value]) => value).map(([key]) => key);
  if (!enabled.length) return 'Manual / cuando aplique';
  if (!reminder.hora) return 'Falta hora';

  const { h, m } = parseHora(reminder.hora);
  const results = [];
  const toleranceMs = readSettings().sendWindowMinutes * 60 * 1000;
  for (let offset = 0; offset < 180 && results.length < 4; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m, 0, 0);
    const dayKey = DIAS[candidate.getDay()][0];
    if (!reminder.days[dayKey]) continue;
    if (candidate.getTime() < now.getTime() - toleranceMs) continue;
    results.push(fechaLarga(candidate));
  }
  return results.join('\n') || 'Manual / cuando aplique';
}

function monthlyOrdinalForDate(date) {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

function nextMonthlyOccurrences(reminder, now = new Date()) {
  const monthly = reminder.monthly || {};
  if (!monthly.weekday || !Array.isArray(monthly.ordinals) || !monthly.ordinals.length) {
    return 'Falta programación mensual';
  }
  if (!reminder.hora) return 'Falta hora';

  const { h, m } = parseHora(reminder.hora);
  const results = [];
  const toleranceMs = readSettings().sendWindowMinutes * 60 * 1000;

  for (let offset = 0; offset < 370 && results.length < 4; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m, 0, 0);
    const dayKey = DIAS[candidate.getDay()][0];
    if (dayKey !== monthly.weekday) continue;
    if (!monthly.ordinals.includes(monthlyOrdinalForDate(candidate))) continue;
    if (candidate.getTime() < now.getTime() - toleranceMs) continue;
    results.push(fechaLarga(candidate));
  }

  return results.join('\n') || 'Falta programación mensual';
}

function nextIntervalOccurrences(reminder, now = new Date()) {
  const interval = reminder.interval || {};
  if (!interval.startDate || !interval.everyWeeks) return 'Falta programación por intervalo';
  if (!reminder.hora) return 'Falta hora';

  const startDate = parseDateOnly(interval.startDate);
  if (!startDate) return 'Falta programación por intervalo';

  const { h, m } = parseHora(reminder.hora);
  const stepDays = interval.everyWeeks * 7;
  const base = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), h, m, 0, 0);
  const toleranceMs = readSettings().sendWindowMinutes * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const diffDays = Math.floor((today.getTime() - baseDay.getTime()) / dayMs);
  let cycles = Math.max(0, Math.floor(diffDays / stepDays) - 1);
  const results = [];

  while (results.length < 4 && cycles < 2000) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + cycles * stepDays);
    if (candidate.getTime() >= now.getTime() - toleranceMs) {
      results.push(fechaLarga(candidate));
    }
    cycles += 1;
  }

  return results.join('\n') || 'Falta programación por intervalo';
}

function nextCleaningOccurrences(rotation, now = new Date()) {
  if (!rotation.enabled) return 'Inactivo';
  if (!rotation.hora) return 'Falta hora';

  const { h, m } = parseHora(rotation.hora);
  const results = [];
  let room = Number(rotation.currentRoom || 1);
  const roomCount = Number(rotation.roomCount || 1);
  const toleranceMs = readSettings().sendWindowMinutes * 60 * 1000;
  for (let offset = 0; offset < 90 && results.length < 4; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m, 0, 0);
    const dayKey = DIAS[candidate.getDay()][0];
    if (dayKey !== rotation.sendDay) continue;
    if (candidate.getTime() < now.getTime() - toleranceMs) continue;
    results.push(`${fechaLarga(candidate)} | Habitación #${room}`);
    room = room >= roomCount ? 1 : room + 1;
  }
  return results.join('\n') || 'Falta programacion';
}

function cleaningMessage(rotation) {
  const room = Number(rotation.currentRoom || 1);
  const template = text(rotation.messageTemplate).trim() || defaultCleaningTemplate(rotation.language);
  return template.replace(/\{\{\s*room\s*\}\}/gi, String(room));
}

function toApiCleaningRotation(rotation) {
  return {
    house: rotation.house,
    enabled: rotation.enabled,
    roomCount: rotation.roomCount,
    currentRoom: rotation.currentRoom,
    currentResponsibleRoom: responsibleRoom(rotation),
    nextRoom: nextRoom(rotation),
    sendDay: rotation.sendDay,
    hora: rotation.hora,
    language: rotation.language,
    messageTemplate: rotation.messageTemplate,
    proximoEnvio: nextCleaningOccurrences(rotation),
    lastSentAt: rotation.lastSentAt,
    lastSentRoom: rotation.lastSentRoom,
    previewMessage: cleaningMessage(rotation),
  };
}

function cleaningNotes(rotation) {
  const responsibleRoom = previousRoom(rotation);
  const parts = [
    `Esta semana el responsable es el cuarto #${responsibleRoom}.`,
    `La próxima notificación se enviará para el cuarto #${rotation.currentRoom}.`,
    `Si necesitas ajustar, usa el lápiz y cambia "Enviar próxima ejecución desde".`,
  ];
  if (rotation.lastSentAt && rotation.lastSentRoom) {
    parts.push(`Último envío: ${rotation.lastSentAt} | cuarto #${rotation.lastSentRoom}.`);
  }
  return parts.join('\n');
}

function cleaningNotes(rotation) {
  const currentResponsible = responsibleRoom(rotation);
  const nextNotificationRoom = Number(rotation.currentRoom || 1);
  const parts = [
    `Esta semana el responsable es el cuarto #${currentResponsible}.`,
    nextNotificationRoom === currentResponsible
      ? `La próxima notificación se enviará OTRA VEZ para el cuarto #${nextNotificationRoom}.`
      : `La próxima notificación se enviará para el cuarto #${nextNotificationRoom}.`,
    `Si necesitas ajustar, usa el lápiz y cambia "Enviar próxima ejecución desde".`,
  ];
  if (rotation.lastSentAt && rotation.lastSentRoom) {
    parts.push(`Último envío: ${rotation.lastSentAt} | cuarto #${rotation.lastSentRoom}.`);
  }
  return parts.join('\n');
}

function toApiCleaningReminder(rotation) {
  return {
    row: `${CLEANING_ROW_PREFIX}${rotation.house}`,
    group: rotation.house,
    category: 'Limpieza rotativa',
    scheduleType: 'cleaningRotation',
    monthly: { ordinals: [], weekday: '' },
    interval: { startDate: '', everyWeeks: 0 },
    days: {
      lun: rotation.sendDay === 'lun',
      mar: rotation.sendDay === 'mar',
      mie: rotation.sendDay === 'mie',
      jue: rotation.sendDay === 'jue',
      vie: rotation.sendDay === 'vie',
      sab: rotation.sendDay === 'sab',
      dom: rotation.sendDay === 'dom',
    },
    hora: rotation.hora,
    activo: rotation.enabled ? 'SI' : 'NO',
    enviarManual: 'NO',
    estado: rotation.lastSentAt ? 'ENVIADO' : 'PENDIENTE',
    ultimoEnvio: rotation.lastSentAt || '',
    proximoEnvio: nextCleaningOccurrences(rotation),
    mensaje: cleaningMessage(rotation),
    notas: cleaningNotes(rotation),
    filtrarCasa: rotation.house,
    isCleaningRotation: true,
    cleaning: toApiCleaningRotation(rotation),
  };
}

function toApiReminder(reminder) {
  return {
    row: reminder.id,
    group: reminder.group,
    category: reminder.category,
    scheduleType: reminder.scheduleType,
    monthly: reminder.monthly,
    interval: reminder.interval,
    days: reminder.days,
    hora: reminder.hora,
    activo: reminder.activo,
    enviarManual: reminder.enviarManual,
    estado: reminder.estado,
    ultimoEnvio: reminder.ultimoEnvio,
    proximoEnvio: nextOccurrences(reminder),
    mensaje: reminder.mensaje,
    notas: reminder.notas,
    filtrarCasa: reminder.filtrarCasa || reminder.group,
  };
}

function readWorkbookLike() {
  const store = readStoreRaw();
  const regularReminders = store.reminders
    .filter((r) => r.group && r.mensaje)
    .map(toApiReminder);
  const cleaningReminders = (store.cleaningRotations || []).map(toApiCleaningReminder);
  const reminders = [...regularReminders, ...cleaningReminders];
  const houses = normalizeHouseList([
    ...(store.houses || []),
    ...reminders.map((r) => r.filtrarCasa || r.group),
  ]);
  const categories = [...new Set(reminders.map((r) => r.category).filter(Boolean))].sort();
  const cleaningRotations = (store.cleaningRotations || []).map(toApiCleaningRotation);
  return { reminders, houses, categories, cleaningRotations, updatedAt: new Date().toISOString() };
}

function createReminder(payload) {
  const store = readStoreRaw();
  const reminder = normalizeReminder({ ...payload, id: store.nextId }, store.nextId);
  if (!reminder.group) throw new Error('La casa / grupo exacto es obligatorio.');
  if (!reminder.mensaje.trim()) throw new Error('El mensaje es obligatorio.');
  reminder.hora = normalizeHora(reminder.hora);
  if (reminder.scheduleType === 'monthly') {
    if (!reminder.monthly.weekday) throw new Error('Selecciona el dia mensual.');
    if (!reminder.monthly.ordinals.length) throw new Error('Selecciona al menos una semana del mes.');
  }
  if (reminder.scheduleType === 'interval') {
    if (!reminder.interval.startDate) throw new Error('Selecciona la fecha base del intervalo.');
    if (!reminder.interval.everyWeeks) throw new Error('Selecciona cada cuantas semanas se repite.');
  }
  reminder.estado = 'PENDIENTE';
  reminder.ultimoEnvio = '';
  reminder.notas = '';
  reminder.filtrarCasa = reminder.group;
  store.houses = normalizeHouseList([...(store.houses || []), reminder.group]);
  store.reminders.push(reminder);
  store.nextId += 1;
  writeStore(store);
  return readWorkbookLike();
}

function createCleaningRotation(payload) {
  const store = readStoreRaw();
  const rotation = normalizeCleaningRotation(payload);
  if (!rotation.house) throw new Error('La casa / grupo exacto es obligatorio.');
  if (!hasRoomPlaceholder(rotation.messageTemplate)) {
    throw new Error('La plantilla de limpieza debe incluir el placeholder {{room}}.');
  }
  const exists = (store.cleaningRotations || []).some((r) => r.house === rotation.house);
  if (exists) throw new Error(`Ya existe una rotacion de limpieza para "${rotation.house}". Usa el lapiz para editarla.`);

  store.cleaningRotations = [...(store.cleaningRotations || []), rotation];
  store.houses = normalizeHouseList([...(store.houses || []), rotation.house]);
  writeStore(store);
  return readWorkbookLike();
}

function updateReminder(id, payload) {
  const store = readStoreRaw();
  const reminder = store.reminders.find((r) => r.id === Number(id));
  if (!reminder) throw new Error(`No existe recordatorio id ${id}.`);

  const merged = normalizeReminder({ ...reminder, ...payload, id: reminder.id }, reminder.id);
  if (!merged.group) throw new Error('La casa / grupo exacto es obligatorio.');
  if (!merged.mensaje.trim()) throw new Error('El mensaje es obligatorio.');
  merged.hora = normalizeHora(merged.hora);
  if (merged.scheduleType === 'monthly') {
    if (!merged.monthly.weekday) throw new Error('Selecciona el dia mensual.');
    if (!merged.monthly.ordinals.length) throw new Error('Selecciona al menos una semana del mes.');
  }
  if (merged.scheduleType === 'interval') {
    if (!merged.interval.startDate) throw new Error('Selecciona la fecha base del intervalo.');
    if (!merged.interval.everyWeeks) throw new Error('Selecciona cada cuantas semanas se repite.');
  }
  merged.notas = reminder.notas;
  merged.ultimoEnvio = reminder.ultimoEnvio;
  merged.estado = reminder.estado || 'PENDIENTE';
  merged.filtrarCasa = merged.group;
  store.houses = normalizeHouseList([...(store.houses || []), merged.group]);

  store.reminders = store.reminders.map((r) => (r.id === reminder.id ? merged : r));
  writeStore(store);
  return readWorkbookLike();
}

function deleteReminder(id) {
  const store = readStoreRaw();
  store.reminders = store.reminders.filter((r) => r.id !== Number(id));
  writeStore(store);
  return readWorkbookLike();
}

function deleteReminders(ids) {
  const idSet = new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0));
  if (!idSet.size) throw new Error('No hay recordatorios seleccionados para eliminar.');
  const store = readStoreRaw();
  store.reminders = store.reminders.filter((r) => !idSet.has(r.id));
  writeStore(store);
  return readWorkbookLike();
}

function updateRemindersActive(ids, activeValue) {
  const idSet = new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0));
  if (!idSet.size) throw new Error('No hay recordatorios seleccionados para actualizar.');

  const activo = text(activeValue).trim().toUpperCase() === 'SI' ? 'SI' : 'NO';
  const store = readStoreRaw();
  let updated = 0;

  store.reminders = store.reminders.map((r) => {
    if (!idSet.has(r.id)) return r;
    updated += 1;
    return { ...r, activo };
  });

  if (!updated) throw new Error('No se encontraron recordatorios seleccionados.');
  writeStore(store);
  return readWorkbookLike();
}

function deleteCategory(category) {
  const store = readStoreRaw();
  store.reminders = store.reminders.map((r) => (
    r.category === category ? { ...r, category: '' } : r
  ));
  writeStore(store);
  return readWorkbookLike();
}

function deleteHouse(house) {
  const store = readStoreRaw();
  store.houses = normalizeHouseList((store.houses || []).filter((h) => h !== house));
  store.reminders = store.reminders.map((r) => {
    if (r.group !== house && r.filtrarCasa !== house) return r;
    return { ...r, group: '', filtrarCasa: '', activo: 'NO' };
  });
  store.cleaningRotations = (store.cleaningRotations || []).filter((r) => r.house !== house);
  writeStore(store);
  return readWorkbookLike();
}

function updateCleaningRotation(house, payload) {
  const store = readStoreRaw();
  const rotation = (store.cleaningRotations || []).find((r) => r.house === house);
  if (!rotation) throw new Error(`No existe rotacion de limpieza para "${house}".`);

  const merged = normalizeCleaningRotation({
    ...rotation,
    ...payload,
    house: rotation.house,
  });
  if (!merged.house) throw new Error('La casa es obligatoria.');
  if (!hasRoomPlaceholder(merged.messageTemplate)) {
    throw new Error('La plantilla de limpieza debe incluir el placeholder {{room}}.');
  }

  store.cleaningRotations = store.cleaningRotations.map((r) => (
    r.house === house ? merged : r
  ));
  store.houses = normalizeHouseList([...(store.houses || []), merged.house]);
  writeStore(store);
  return readWorkbookLike();
}

function deleteCleaningRotation(house) {
  const store = readStoreRaw();
  const before = (store.cleaningRotations || []).length;
  store.cleaningRotations = (store.cleaningRotations || []).filter((r) => r.house !== house);
  if (store.cleaningRotations.length === before) {
    throw new Error(`No existe rotacion de limpieza para "${house}".`);
  }
  writeStore(store);
  return readWorkbookLike();
}

function rowsForSender() {
  const store = readStoreRaw();
  const reminderRows = store.reminders
    .filter((r) => r.group && r.mensaje)
    .map((r) => ({
      hoja: 'JSON',
      numeroFila: r.id,
      grupo: r.group,
      categoria: r.category,
      scheduleType: r.scheduleType,
      monthly: r.monthly,
      interval: r.interval,
      hora: r.hora,
      activo: r.activo,
      enviarManual: r.enviarManual,
      proximoEnvio: nextOccurrences(r),
      mensaje: r.mensaje,
    }));

  const cleaningRows = (store.cleaningRotations || [])
    .filter((r) => r.enabled && r.house && r.roomCount && r.currentRoom)
    .map((r) => ({
      hoja: 'ROTACION_LIMPIEZA',
      numeroFila: `${CLEANING_ROW_PREFIX}${r.house}`,
      grupo: r.house,
      categoria: 'Limpieza rotativa',
      scheduleType: 'cleaningRotation',
      monthly: { ordinals: [], weekday: '' },
      interval: { startDate: '', everyWeeks: 0 },
      hora: r.hora,
      activo: r.enabled ? 'SI' : 'NO',
      enviarManual: 'NO',
      proximoEnvio: nextCleaningOccurrences(r),
      mensaje: cleaningMessage(r),
    }));

  return [...reminderRows, ...cleaningRows];
}

function applySendResults(results) {
  if (!Array.isArray(results) || !results.length) return;
  const store = readStoreRaw();
  for (const result of results) {
    const fila = text(result.fila);
    if (fila.startsWith(CLEANING_ROW_PREFIX)) {
      const house = fila.slice(CLEANING_ROW_PREFIX.length);
      const rotation = (store.cleaningRotations || []).find((r) => r.house === house);
      if (!rotation || !result.ok) continue;
      rotation.lastSentAt = result.fecha || fechaLarga(new Date());
      rotation.lastSentRoom = rotation.currentRoom;
      rotation.currentResponsibleRoom = rotation.currentRoom;
      rotation.currentRoom = nextRoom(rotation);
      continue;
    }

    const id = Number(result.fila);
    const reminder = store.reminders.find((r) => r.id === id);
    if (!reminder) continue;
    reminder.estado = result.estado || (result.ok ? 'ENVIADO' : 'ERROR');
    if (result.ok) {
      reminder.ultimoEnvio = result.fecha || fechaLarga(new Date());
      reminder.notas = result.nota || reminder.notas;
      reminder.enviarManual = 'NO';
    } else if (result.nota) {
      reminder.notas = result.nota;
    }
  }
  writeStore(store);
}

module.exports = {
  DATA_FILE,
  SETTINGS_FILE,
  readWorkbookLike,
  readSettings,
  writeSettings,
  createReminder,
  createCleaningRotation,
  updateReminder,
  deleteReminder,
  deleteReminders,
  updateRemindersActive,
  updateCleaningRotation,
  deleteCleaningRotation,
  deleteCategory,
  deleteHouse,
  rowsForSender,
  applySendResults,
  normalizeHora,
  TIME_STEP_MINUTES,
  WEEKLY_STATUS_RESET_HOUR,
};
