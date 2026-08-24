'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_PROPERTIES } = require('./catalog');
const {
  DEFAULT_APPOINTMENT_SETTINGS,
  availableDates,
  availableTimes,
  validateAppointmentSettings,
} = require('./appointment-schedule');

const LEAD_STATUSES = [
  'NUEVO', 'EN_CONVERSACION', 'OPCIONES_ENVIADAS', 'INTERESADO',
  'CITA_AGENDADA', 'CITA_CANCELADA', 'ATENCION_HUMANA', 'NO_INTERESADO', 'SEGUIMIENTO',
  'CONVERTIDO', 'REQUIERE_ATENCION', 'BOT_DETENIDO',
];

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

function propertyMediaItem(item) {
  const mediaPath = String(item?.mediaPath || '').replace(/\\/g, '/').trim();
  if (!/^(?:web\/assets\/new-customers|data\/uploads)\/[A-Za-z0-9._/-]+\.(?:jpe?g|png|webp|gif)$/i.test(mediaPath)
      || mediaPath.includes('..')) {
    throw new Error('Una de las imagenes no pertenece al catalogo o a la carpeta de uploads.');
  }
  const filename = path.posix.basename(mediaPath);
  const mediaUrl = mediaPath.startsWith('web/')
    ? `/${mediaPath.slice(4)}`
    : `/uploads/${encodeURIComponent(filename)}`;
  return {
    mediaPath,
    mediaUrl,
    mediaName: String(item?.mediaName || filename).trim().slice(0, 200) || filename,
    ...(item?.mediaMime ? { mediaMime: String(item.mediaMime).slice(0, 100) } : {}),
  };
}

function normalizedProperty(payload = {}, current = {}) {
  const address = String(payload.address ?? current.address ?? '').trim();
  const room = String(payload.room ?? current.room ?? '').trim();
  const available = payload.available === undefined ? current.available !== false : payload.available === true;
  const maxOccupants = Number(payload.maxOccupants ?? current.maxOccupants ?? 1);
  const parkingSpaces = Number(payload.parkingSpaces ?? current.parkingSpaces ?? 0);
  const prices = payload.prices && typeof payload.prices === 'object'
    ? payload.prices
    : (current.prices || {});
  const priceOne = Number(prices[1] ?? prices['1']);
  const priceTwoValue = prices[2] ?? prices['2'];
  const priceTwo = priceTwoValue === undefined || priceTwoValue === null || priceTwoValue === ''
    ? null
    : Number(priceTwoValue);
  const mediaItems = payload.mediaItems === undefined ? (current.mediaItems || []) : payload.mediaItems;

  if (!address || address.length > 250) throw new Error('La direccion es obligatoria y debe tener menos de 250 caracteres.');
  if (!room || room.length > 150) throw new Error('La habitacion es obligatoria y debe tener menos de 150 caracteres.');
  if (![1, 2].includes(maxOccupants)) throw new Error('La capacidad debe ser de una o dos personas.');
  if (!Number.isInteger(parkingSpaces) || parkingSpaces < 0 || parkingSpaces > 5) throw new Error('Los espacios de parking deben ser un numero entre 0 y 5.');
  if (!Number.isInteger(priceOne) || priceOne <= 0 || priceOne > 100000) throw new Error('El precio para una persona debe ser un numero valido.');
  if (maxOccupants === 2 && (!Number.isInteger(priceTwo) || priceTwo <= 0 || priceTwo > 100000)) {
    throw new Error('Agrega un precio valido para dos personas.');
  }
  if (!Array.isArray(mediaItems) || mediaItems.length > 8) throw new Error('Puedes adjuntar hasta 8 imagenes por oferta.');

  return {
    address,
    room,
    available,
    maxOccupants,
    parkingSpaces,
    priceOne,
    priceTwo: maxOccupants === 2 ? priceTwo : null,
    mediaItems: mediaItems.map(propertyMediaItem),
  };
}

class NewCustomersStore {
  constructor(filename) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL UNIQUE,
        phone_e164 TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        lead_status TEXT NOT NULL DEFAULT 'NUEVO',
        conversation_status TEXT NOT NULL DEFAULT 'ACTIVE',
        current_field_id TEXT,
        language TEXT,
        match_ids_json TEXT NOT NULL DEFAULT '[]',
        last_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answers (
        contact_id TEXT NOT NULL,
        field_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'CHAT',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (contact_id, field_id),
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS answer_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        field_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message_text TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS outgoing_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        body TEXT NOT NULL,
        media_path TEXT NOT NULL DEFAULT '',
        media_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        sent_at TEXT,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS properties (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        room TEXT NOT NULL,
        available INTEGER NOT NULL DEFAULT 1,
        max_occupants INTEGER NOT NULL,
        parking_spaces INTEGER NOT NULL,
        price_one INTEGER NOT NULL,
        price_two INTEGER,
        media_items_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS appointment_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        weekdays_json TEXT NOT NULL,
        time_windows_json TEXT NOT NULL,
        timezone TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        property_id TEXT NOT NULL,
        visit_date TEXT NOT NULL,
        visit_time TEXT NOT NULL DEFAULT '',
        time_window_id TEXT NOT NULL,
        time_start TEXT NOT NULL,
        time_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cancelled_at TEXT,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (property_id) REFERENCES properties(id)
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_updated ON contacts(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_outgoing_pending ON outgoing_messages(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_contact ON audit_events(contact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(visit_date, time_start);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_active_contact ON appointments(contact_id) WHERE status='SCHEDULED';
    `);
    const outboxColumns = new Set(this.db.prepare('PRAGMA table_info(outgoing_messages)').all().map((column) => column.name));
    if (!outboxColumns.has('media_path')) this.db.exec("ALTER TABLE outgoing_messages ADD COLUMN media_path TEXT NOT NULL DEFAULT ''");
    if (!outboxColumns.has('media_name')) this.db.exec("ALTER TABLE outgoing_messages ADD COLUMN media_name TEXT NOT NULL DEFAULT ''");
    const appointmentColumns = new Set(this.db.prepare('PRAGMA table_info(appointments)').all().map((column) => column.name));
    if (!appointmentColumns.has('visit_time')) this.db.exec("ALTER TABLE appointments ADD COLUMN visit_time TEXT NOT NULL DEFAULT ''");
    const propertyColumns = new Set(this.db.prepare('PRAGMA table_info(properties)').all().map((column) => column.name));
    if (!propertyColumns.has('deleted_at')) this.db.exec('ALTER TABLE properties ADD COLUMN deleted_at TEXT');
    this.db.exec("UPDATE appointments SET visit_time=time_start WHERE visit_time='' OR visit_time IS NULL");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_exact_time ON appointments(visit_date, visit_time, status)');
    const seed = this.db.prepare(`INSERT OR IGNORE INTO properties
      (id, address, room, available, max_occupants, parking_spaces, price_one, price_two, media_items_json, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const timestamp = nowIso();
    DEFAULT_PROPERTIES.forEach((property, index) => seed.run(
      property.id,
      property.address,
      property.room,
      property.available === false ? 0 : 1,
      property.maxOccupants,
      property.parkingSpaces,
      property.prices[1],
      property.prices[2] || null,
      JSON.stringify(property.mediaItems || []),
      index,
      timestamp,
    ));
    const defaults = DEFAULT_APPOINTMENT_SETTINGS;
    this.db.prepare(`INSERT OR IGNORE INTO appointment_settings
      (id, start_date, end_date, weekdays_json, time_windows_json, timezone, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)`)
      .run(defaults.startDate, defaults.endDate, JSON.stringify(defaults.weekdays),
        JSON.stringify(defaults.timeWindows), defaults.timezone, timestamp);
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  isProcessed(messageId) {
    return Boolean(messageId && this.db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?').get(messageId));
  }

  markProcessed(messageId) {
    const value = String(messageId || '').trim();
    if (!value) return false;
    return this.db.prepare('INSERT OR IGNORE INTO processed_messages (message_id, processed_at) VALUES (?, ?)')
      .run(value, nowIso()).changes > 0;
  }

  contactFromRow(row) {
    if (!row) return null;
    const answerRows = this.db.prepare('SELECT field_id, value_json FROM answers WHERE contact_id = ?').all(row.id);
    return {
      id: row.id,
      chatId: row.chat_id,
      phoneE164: row.phone_e164,
      displayName: row.display_name,
      leadStatus: row.lead_status,
      conversationStatus: row.conversation_status,
      currentFieldId: row.current_field_id,
      language: row.language,
      matchIds: safeJson(row.match_ids_json, []),
      lastMessage: row.last_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      answers: Object.fromEntries(answerRows.map((item) => [item.field_id, safeJson(item.value_json, null)])),
      appointment: this.getActiveAppointment(row.id),
    };
  }

  getContactByChat(chatId) {
    return this.contactFromRow(this.db.prepare('SELECT * FROM contacts WHERE chat_id = ?').get(chatId));
  }

  getContact(id) {
    return this.contactFromRow(this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
  }

  propertyFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      address: row.address,
      room: row.room,
      available: Boolean(row.available),
      maxOccupants: Number(row.max_occupants),
      parkingSpaces: Number(row.parking_spaces),
      prices: {
        1: Number(row.price_one),
        ...(row.price_two ? { 2: Number(row.price_two) } : {}),
      },
      mediaItems: safeJson(row.media_items_json, []),
      sortOrder: Number(row.sort_order),
      updatedAt: row.updated_at,
    };
  }

  listProperties() {
    return this.db.prepare('SELECT * FROM properties WHERE deleted_at IS NULL ORDER BY sort_order, id').all()
      .map((row) => this.propertyFromRow(row));
  }

  getProperty(id) {
    return this.propertyFromRow(this.db.prepare('SELECT * FROM properties WHERE id = ? AND deleted_at IS NULL').get(id));
  }

  createProperty(payload = {}) {
    const property = normalizedProperty(payload);
    const id = crypto.randomUUID();
    const sortOrder = Number(this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM properties').get().value);
    const timestamp = nowIso();
    this.db.prepare(`INSERT INTO properties
      (id, address, room, available, max_occupants, parking_spaces, price_one, price_two,
       media_items_json, sort_order, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .run(id, property.address, property.room, property.available ? 1 : 0, property.maxOccupants,
        property.parkingSpaces, property.priceOne, property.priceTwo, JSON.stringify(property.mediaItems),
        sortOrder, timestamp);
    return this.getProperty(id);
  }

  updateProperty(id, payload = {}) {
    const current = this.getProperty(id);
    if (!current) return null;
    const property = normalizedProperty(payload, current);
    const timestamp = nowIso();
    this.db.prepare(`UPDATE properties SET address=?, room=?, available=?, max_occupants=?, parking_spaces=?,
      price_one=?, price_two=?, media_items_json=?, updated_at=? WHERE id=?`)
      .run(property.address, property.room, property.available ? 1 : 0, property.maxOccupants,
        property.parkingSpaces, property.priceOne, property.priceTwo, JSON.stringify(property.mediaItems), timestamp, id);
    return this.getProperty(id);
  }

  deleteProperty(id) {
    const current = this.getProperty(id);
    if (!current) return null;
    const timestamp = nowIso();
    this.db.prepare('UPDATE properties SET available=0, deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL')
      .run(timestamp, timestamp, id);
    return { ...current, available: false, deletedAt: timestamp };
  }

  appointmentFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      contactId: row.contact_id,
      propertyId: row.property_id,
      visitDate: row.visit_date,
      visitTime: row.visit_time || row.time_start,
      timeWindowId: row.time_window_id,
      timeStart: row.time_start,
      timeEnd: row.time_end,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cancelledAt: row.cancelled_at,
      address: row.address || '',
      room: row.room || '',
      contactName: row.display_name || '',
      phoneE164: row.phone_e164 || '',
    };
  }

  getActiveAppointment(contactId) {
    return this.appointmentFromRow(this.db.prepare(`SELECT appointments.*, properties.address, properties.room
      FROM appointments JOIN properties ON properties.id=appointments.property_id
      WHERE appointments.contact_id=? AND appointments.status='SCHEDULED' LIMIT 1`).get(contactId));
  }

  listAppointments({ status = 'SCHEDULED' } = {}) {
    const accepted = ['SCHEDULED', 'CANCELLED', 'SUPERSEDED', 'ALL'];
    if (!accepted.includes(status)) throw new Error('Estado de cita inválido.');
    const where = status === 'ALL' ? '' : 'WHERE appointments.status=?';
    const values = status === 'ALL' ? [] : [status];
    return this.db.prepare(`SELECT appointments.*, properties.address, properties.room,
      contacts.display_name, contacts.phone_e164
      FROM appointments
      JOIN properties ON properties.id=appointments.property_id
      JOIN contacts ON contacts.id=appointments.contact_id
      ${where}
      ORDER BY appointments.visit_date, appointments.visit_time, appointments.created_at`).all(...values)
      .map((row) => this.appointmentFromRow(row));
  }

  getAppointmentSettings() {
    const row = this.db.prepare('SELECT * FROM appointment_settings WHERE id=1').get();
    return {
      startDate: row.start_date,
      endDate: row.end_date,
      weekdays: safeJson(row.weekdays_json, []),
      timeWindows: safeJson(row.time_windows_json, []),
      timezone: row.timezone,
      updatedAt: row.updated_at,
    };
  }

  updateAppointmentSettings(payload = {}) {
    const settings = validateAppointmentSettings(payload, this.getAppointmentSettings());
    const timestamp = nowIso();
    this.db.prepare(`UPDATE appointment_settings SET start_date=?, end_date=?, weekdays_json=?,
      time_windows_json=?, timezone=?, updated_at=? WHERE id=1`)
      .run(settings.startDate, settings.endDate, JSON.stringify(settings.weekdays),
        JSON.stringify(settings.timeWindows), settings.timezone, timestamp);
    return this.getAppointmentSettings();
  }

  getAppointmentAvailability(excludeContactId = '') {
    const settings = this.getAppointmentSettings();
    const values = [];
    let contactFilter = '';
    if (excludeContactId) {
      contactFilter = 'AND contact_id<>?';
      values.push(excludeContactId);
    }
    const occupied = new Set(this.db.prepare(`SELECT visit_date, visit_time FROM appointments
      WHERE status='SCHEDULED' ${contactFilter}`).all(...values)
      .map((row) => `${row.visit_date}|${row.visit_time}`));
    return {
      dates: availableDates(settings).map((date) => ({
        date,
        times: availableTimes(settings, new Date(`${date}T12:00:00Z`).getUTCDay())
          .filter((slot) => !occupied.has(`${date}|${slot.time}`)),
      })).filter((entry) => entry.times.length > 0),
    };
  }

  bookAppointment(contactId, appointment, timestamp = nowIso()) {
    const property = this.getProperty(appointment?.propertyId);
    if (!property || !property.available) throw new Error('La oferta seleccionada ya no está disponible.');
    const settings = this.getAppointmentSettings();
    const availability = this.getAppointmentAvailability(contactId);
    const date = availability.dates.find((entry) => entry.date === String(appointment?.visitDate || ''));
    const slot = date?.times.find((entry) => entry.time === String(appointment?.visitTime || ''));
    if (!slot) throw new Error('La fecha u hora seleccionada ya no está disponible.');
    const window = settings.timeWindows.find((item) => item.id === slot.windowId);
    if (!window) throw new Error('El horario seleccionado ya no está disponible.');
    this.db.prepare("UPDATE appointments SET status='SUPERSEDED', updated_at=? WHERE contact_id=? AND status='SCHEDULED'")
      .run(timestamp, contactId);
    this.db.prepare(`INSERT INTO appointments
      (id, contact_id, property_id, visit_date, visit_time, time_window_id, time_start, time_end, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?)`)
      .run(crypto.randomUUID(), contactId, property.id, appointment.visitDate, slot.time, window.id,
        window.start, window.end, timestamp, timestamp);
    return this.getActiveAppointment(contactId);
  }

  cancelActiveAppointment(contactId, timestamp = nowIso()) {
    const active = this.getActiveAppointment(contactId);
    if (!active) return null;
    this.db.prepare("UPDATE appointments SET status='CANCELLED', updated_at=?, cancelled_at=? WHERE id=?")
      .run(timestamp, timestamp, active.id);
    return { ...active, status: 'CANCELLED', updatedAt: timestamp, cancelledAt: timestamp };
  }

  saveAnswers(contactId, answers, source, timestamp) {
    const previousRows = this.db.prepare('SELECT field_id, value_json FROM answers WHERE contact_id = ?').all(contactId);
    const previous = new Map(previousRows.map((row) => [row.field_id, row.value_json]));
    const upsert = this.db.prepare(`
      INSERT INTO answers (contact_id, field_id, value_json, source, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(contact_id, field_id) DO UPDATE SET value_json=excluded.value_json, source=excluded.source, updated_at=excluded.updated_at
    `);
    const history = this.db.prepare('INSERT INTO answer_history (contact_id, field_id, value_json, source, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const [fieldId, value] of Object.entries(answers || {})) {
      const json = JSON.stringify(value);
      upsert.run(contactId, fieldId, json, source, timestamp);
      if (previous.get(fieldId) !== json) history.run(contactId, fieldId, json, source, timestamp);
    }
  }

  enqueue(contactId, chatId, messages, timestamp) {
    const insert = this.db.prepare('INSERT INTO outgoing_messages (contact_id, chat_id, body, media_path, media_name, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const message of messages || []) {
      const item = typeof message === 'string' ? { body: message } : (message || {});
      insert.run(contactId, chatId, String(item.body || ''), String(item.mediaPath || ''), String(item.mediaName || ''), timestamp);
    }
  }

  activate({ chatId, phoneE164 = '', displayName = '', messageId = '', transition }) {
    if (this.isProcessed(messageId)) return { duplicate: true, contact: this.getContactByChat(chatId) };
    return this.transaction(() => {
      const timestamp = nowIso();
      const existing = this.db.prepare('SELECT id FROM contacts WHERE chat_id = ?').get(chatId);
      const id = existing?.id || crypto.randomUUID();
      if (existing) {
        const activationMatchIds = Array.isArray(transition.matches)
          ? transition.matches.map((item) => item.id)
          : (transition.matchIds || []);
        this.db.prepare("UPDATE outgoing_messages SET status='CANCELLED' WHERE contact_id=? AND status IN ('PENDING','ERROR')").run(id);
        this.db.prepare(`UPDATE contacts SET phone_e164=?, display_name=?, lead_status=?, conversation_status=?, current_field_id=?, language=?,
          match_ids_json=?, last_message=?, updated_at=?, last_message_at=? WHERE id=?`)
          .run(phoneE164, displayName, transition.leadStatus, transition.conversationStatus, transition.currentFieldId,
            transition.language || null, JSON.stringify(activationMatchIds), 'Bot iniciado por administrador', timestamp, timestamp, id);
        if (!transition.preserveConversationData) this.db.prepare('DELETE FROM answers WHERE contact_id = ?').run(id);
      } else {
        this.db.prepare(`INSERT INTO contacts
          (id, chat_id, phone_e164, display_name, lead_status, conversation_status, current_field_id, last_message, created_at, updated_at, last_message_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, chatId, phoneE164, displayName, transition.leadStatus, transition.conversationStatus, transition.currentFieldId, 'Bot iniciado por administrador', timestamp, timestamp, timestamp);
      }
      this.enqueue(id, chatId, transition.outgoing, timestamp);
      this.db.prepare('INSERT INTO audit_events (contact_id, event_type, message_text, created_at) VALUES (?, ?, ?, ?)').run(id, transition.auditType, 'Welcome!', timestamp);
      if (messageId) this.db.prepare('INSERT INTO processed_messages (message_id, processed_at) VALUES (?, ?)').run(messageId, timestamp);
      return { duplicate: false, contact: this.getContact(id) };
    });
  }

  applyIncoming({ contact, messageId, incomingText, transition }) {
    if (this.isProcessed(messageId)) return { duplicate: true, contact };
    return this.transaction(() => {
      const timestamp = nowIso();
      const matchIds = Array.isArray(transition.matches)
        ? transition.matches.map((item) => item.id)
        : (transition.matchIds || contact.matchIds || []);
      this.db.prepare(`UPDATE contacts SET lead_status=?, conversation_status=?, current_field_id=?, language=?, match_ids_json=?,
        last_message=?, updated_at=?, last_message_at=? WHERE id=?`)
        .run(transition.leadStatus, transition.conversationStatus, transition.currentFieldId, transition.language || null,
          JSON.stringify(matchIds), incomingText, timestamp, timestamp, contact.id);
      if (transition.resetConversationData) {
        this.db.prepare('DELETE FROM answers WHERE contact_id = ?').run(contact.id);
      } else {
        this.saveAnswers(contact.id, transition.answers, 'CHAT', timestamp);
      }
      let appointmentData = null;
      if (transition.appointmentAction?.type === 'BOOK') {
        appointmentData = this.bookAppointment(contact.id, transition.appointmentAction, timestamp);
      } else if (transition.appointmentAction?.type === 'CANCEL') {
        appointmentData = this.cancelActiveAppointment(contact.id, timestamp);
      }
      this.enqueue(contact.id, contact.chatId, transition.outgoing, timestamp);
      this.db.prepare('INSERT INTO audit_events (contact_id, event_type, message_text, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(contact.id, transition.auditType, incomingText, JSON.stringify({
          fieldId: contact.currentFieldId,
          appointment: appointmentData,
        }), timestamp);
      if (messageId) this.db.prepare('INSERT INTO processed_messages (message_id, processed_at) VALUES (?, ?)').run(messageId, timestamp);
      return { duplicate: false, contact: this.getContact(contact.id) };
    });
  }

  stopChat({ chatId, messageId = '' }) {
    if (this.isProcessed(messageId)) return { duplicate: true, contact: this.getContactByChat(chatId) };
    const contact = this.getContactByChat(chatId);
    if (!contact) return { duplicate: false, contact: null };
    return this.transaction(() => {
      const timestamp = nowIso();
      this.db.prepare(`UPDATE contacts SET lead_status='BOT_DETENIDO', conversation_status='STOPPED_BY_ADMIN',
        current_field_id=NULL, last_message='Stop bot', updated_at=?, last_message_at=? WHERE id=?`)
        .run(timestamp, timestamp, contact.id);
      this.db.prepare("UPDATE outgoing_messages SET status='CANCELLED' WHERE contact_id=? AND status IN ('PENDING','ERROR')").run(contact.id);
      this.db.prepare('INSERT INTO audit_events (contact_id, event_type, message_text, created_at) VALUES (?, ?, ?, ?)')
        .run(contact.id, 'BOT_STOPPED_BY_ADMIN', 'Stop bot', timestamp);
      if (messageId) this.db.prepare('INSERT INTO processed_messages (message_id, processed_at) VALUES (?, ?)').run(messageId, timestamp);
      return { duplicate: false, contact: this.getContact(contact.id) };
    });
  }

  listContacts({ status = '', search = '' } = {}) {
    const clauses = [];
    const values = [];
    if (status && LEAD_STATUSES.includes(status)) { clauses.push('lead_status = ?'); values.push(status); }
    if (search) { clauses.push('(display_name LIKE ? OR phone_e164 LIKE ? OR last_message LIKE ?)'); const term = `%${search}%`; values.push(term, term, term); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM contacts ${where} ORDER BY updated_at DESC`).all(...values).map((row) => this.contactFromRow(row));
  }

  deleteContact(id) {
    const contact = this.getContact(id);
    if (!contact) return null;
    const result = this.db.prepare('DELETE FROM contacts WHERE id=?').run(id);
    return result.changes ? contact : null;
  }

  stats() {
    const rows = this.db.prepare('SELECT lead_status, COUNT(*) AS total FROM contacts GROUP BY lead_status').all();
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0]));
    for (const row of rows) byStatus[row.lead_status] = Number(row.total);
    return {
      total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
      active: byStatus.NUEVO + byStatus.EN_CONVERSACION,
      interested: byStatus.INTERESADO + byStatus.CITA_AGENDADA + byStatus.CONVERTIDO,
      needsAttention: byStatus.REQUIERE_ATENCION + byStatus.ATENCION_HUMANA + byStatus.SEGUIMIENTO,
      byStatus,
    };
  }

  updateLeadStatus(id, status) {
    if (!LEAD_STATUSES.includes(status)) throw new Error('Estado de contacto inválido.');
    const timestamp = nowIso();
    const result = this.db.prepare('UPDATE contacts SET lead_status=?, updated_at=? WHERE id=?').run(status, timestamp, id);
    if (!result.changes) return null;
    this.db.prepare('INSERT INTO audit_events (contact_id, event_type, message_text, created_at) VALUES (?, ?, ?, ?)').run(id, 'STATUS_CHANGED_BY_ADMIN', status, timestamp);
    return this.getContact(id);
  }

  history(contactId) {
    return this.db.prepare('SELECT id, event_type AS eventType, message_text AS messageText, data_json AS dataJson, created_at AS createdAt FROM audit_events WHERE contact_id=? ORDER BY created_at DESC, id DESC').all(contactId)
      .map((row) => ({ ...row, data: safeJson(row.dataJson, {}) }));
  }

  pendingOutbox(limit = 20) {
    return this.db.prepare("SELECT id, contact_id AS contactId, chat_id AS chatId, body, media_path AS mediaPath, media_name AS mediaName, attempts FROM outgoing_messages WHERE status IN ('PENDING','ERROR') AND attempts < 5 ORDER BY id LIMIT ?").all(limit);
  }

  cancelQueuedOutbox(reason = 'SERVICE_RESTARTED') {
    return this.db.prepare("UPDATE outgoing_messages SET status='CANCELLED', last_error=? WHERE status IN ('PENDING','ERROR')")
      .run(String(reason || 'SERVICE_RESTARTED').slice(0, 1000)).changes;
  }

  isOutboxSendable(id) {
    return Boolean(this.db.prepare("SELECT 1 FROM outgoing_messages WHERE id=? AND status IN ('PENDING','ERROR') AND attempts < 5").get(id));
  }

  markOutboxSent(id) {
    const timestamp = nowIso();
    this.db.prepare("UPDATE outgoing_messages SET status='SENT', attempts=attempts+1, sent_at=?, last_error='' WHERE id=?").run(timestamp, id);
    const row = this.db.prepare('SELECT contact_id, body FROM outgoing_messages WHERE id=?').get(id);
    if (row) this.db.prepare('INSERT INTO audit_events (contact_id, event_type, message_text, created_at) VALUES (?, ?, ?, ?)').run(row.contact_id, 'OUTGOING_SENT', row.body, timestamp);
  }

  markOutboxError(id, error) {
    this.db.prepare("UPDATE outgoing_messages SET status='ERROR', attempts=attempts+1, last_error=? WHERE id=?").run(String(error || '').slice(0, 1000), id);
  }

  close() { this.db.close(); }
}

module.exports = { LEAD_STATUSES, NewCustomersStore };
