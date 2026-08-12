'use strict';

const DEFAULT_APPOINTMENT_SETTINGS = {
  startDate: '2026-08-18',
  endDate: '2026-08-31',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timeWindows: [
    { id: 'weekday-evening', start: '18:00', end: '21:00', weekdays: [1, 2, 3, 4, 5] },
    { id: 'weekend-afternoon', start: '13:00', end: '18:00', weekdays: [0, 6] },
  ],
  timezone: 'America/Toronto',
};
const APPOINTMENT_SLOT_MINUTES = 30;

function validIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validateAppointmentSettings(input = {}, current = DEFAULT_APPOINTMENT_SETTINGS) {
  const startDate = String(input.startDate ?? current.startDate ?? '').trim();
  const endDate = String(input.endDate ?? current.endDate ?? '').trim();
  const weekdaysInput = input.weekdays ?? current.weekdays;
  const windowsInput = input.timeWindows ?? current.timeWindows;
  const timezone = String(input.timezone ?? current.timezone ?? 'America/Toronto').trim();

  if (!validIsoDate(startDate) || !validIsoDate(endDate)) throw new Error('Selecciona fechas de inicio y fin válidas.');
  if (startDate > endDate) throw new Error('La fecha de inicio no puede ser posterior a la fecha final.');
  const span = (new Date(`${endDate}T12:00:00Z`) - new Date(`${startDate}T12:00:00Z`)) / 86400000;
  if (span > 366) throw new Error('El periodo de visitas no puede exceder 366 días.');

  if (!Array.isArray(weekdaysInput)) throw new Error('Los días disponibles no son válidos.');
  const fallbackWeekdays = [...new Set(weekdaysInput.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();

  if (!Array.isArray(windowsInput) || windowsInput.length > 4) {
    throw new Error('Configura hasta cuatro horarios de visita.');
  }
  const timeWindows = windowsInput.map((window, index) => {
    const start = String(window?.start || '').trim();
    const end = String(window?.end || '').trim();
    const id = String(window?.id || `window-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const windowWeekdaysInput = window?.weekdays ?? fallbackWeekdays;
    if (!Array.isArray(windowWeekdaysInput)) throw new Error(`Los días del horario ${index + 1} no son válidos.`);
    const windowWeekdays = [...new Set(windowWeekdaysInput.map(Number))]
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
    if (!id || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)
        || start < '00:00' || end > '23:59' || start >= end) {
      throw new Error(`El horario ${index + 1} no es válido.`);
    }
    if (!windowWeekdays.length) throw new Error(`Selecciona al menos un día para el horario ${index + 1}.`);
    return { id, start, end, weekdays: windowWeekdays };
  });
  if (new Set(timeWindows.map((window) => window.id)).size !== timeWindows.length) {
    throw new Error('Los horarios deben tener identificadores diferentes.');
  }
  const weekdays = [...new Set(timeWindows.flatMap((window) => window.weekdays))].sort();
  if (!timezone || timezone.length > 100) throw new Error('La zona horaria no es válida.');
  return { startDate, endDate, weekdays, timeWindows, timezone };
}

function availableDates(settings) {
  const safe = validateAppointmentSettings(settings);
  const dates = [];
  const cursor = new Date(`${safe.startDate}T12:00:00Z`);
  const end = new Date(`${safe.endDate}T12:00:00Z`);
  while (cursor <= end) {
    if (safe.weekdays.includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function minutesFromTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function timeFromMinutes(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function availableTimes(settings, weekday = null) {
  const safe = validateAppointmentSettings(settings);
  const slots = new Map();
  for (const window of safe.timeWindows.filter((item) => weekday === null || item.weekdays.includes(Number(weekday)))) {
    const start = minutesFromTime(window.start);
    const end = minutesFromTime(window.end);
    for (let minute = start; minute < end; minute += APPOINTMENT_SLOT_MINUTES) {
      const time = timeFromMinutes(minute);
      if (!slots.has(time)) slots.set(time, { time, windowId: window.id });
    }
  }
  return [...slots.values()].sort((left, right) => left.time.localeCompare(right.time));
}

function formatDate(isoDate, language = 'es') {
  if (!validIsoDate(isoDate)) return String(isoDate || '');
  return new Intl.DateTimeFormat(language === 'en' ? 'en-CA' : 'es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

function formatClock(value) {
  const [hourText, minute] = String(value).split(':');
  const hour = Number(hourText);
  const suffix = hour < 12 ? 'a.m.' : 'p.m.';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function formatTimeWindow(window, language = 'es') {
  if (!window) return '';
  return language === 'en'
    ? `${formatClock(window.start)} to ${formatClock(window.end)}`
    : `${formatClock(window.start)} a ${formatClock(window.end)}`;
}

module.exports = {
  APPOINTMENT_SLOT_MINUTES,
  DEFAULT_APPOINTMENT_SETTINGS,
  availableDates,
  availableTimes,
  formatClock,
  formatDate,
  formatTimeWindow,
  validateAppointmentSettings,
};
