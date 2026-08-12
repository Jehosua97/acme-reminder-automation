'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const { createApp } = require('./web_server');
const { NewCustomersStore } = require('./modules/new-customers-info/store');
const { createNewCustomersService, isDirectChat } = require('./modules/new-customers-info/service');

async function testConversation(service) {
  const chatId = '14378781645@c.us';
  const sent = [];
  const client = { sendMessage: async (...args) => { sent.push(args); } };

  service.activateChat({ chatId, displayName: 'Cliente de prueba', messageId: 'admin-1' });
  await service.flushOutbox(client);
  assert.match(sent.at(-1)[1], /^Welcome to Confort Place\./);
  assert.match(sent.at(-1)[1], /English or Spanish/i);
  assert.doesNotMatch(sent.at(-1)[1], /Good morning|Buenos días/i);

  service.handleIncoming({ chatId, text: 'Español', messageId: 'client-1' });
  service.handleIncoming({ chatId, text: '1 persona', messageId: 'client-2' });
  service.handleIncoming({ chatId, text: 'no necesito parking', messageId: 'client-3' });
  service.handleIncoming({ chatId, text: '1 de septiembre', messageId: 'client-4' });
  await service.flushOutbox(client);

  const contact = service.store.getContactByChat(chatId);
  assert.equal(contact.conversationStatus, 'ACTIVE');
  assert.equal(contact.currentFieldId, 'property_interest');
  assert.equal(contact.leadStatus, 'OPCIONES_ENVIADAS');
  assert.equal(contact.answers.parking, false);
  assert.equal(contact.matchIds[0], '11-huntingwood', 'Las opciones con más parking deben aparecer primero');
  assert.ok(contact.matchIds.indexOf('17-hilldowntree-1') > contact.matchIds.indexOf('152-royal-palm-1'));
  assert.equal(sent.filter((entry) => typeof entry[1] === 'object').length, 0, 'No deben enviarse fotos antes de elegir ubicación');
  const locationMessage = sent.at(-1)[1];
  assert.match(locationMessage, /Cuál ubicación le interesa más/i);
  assert.match(locationMessage, /11 Huntingwood.+Para una persona o pareja/);
  assert.match(locationMessage, /14 Hayden.+Para una persona/);
  assert.match(locationMessage, /152 Royal Palm.+Para una persona.+#2/);
  assert.doesNotMatch(locationMessage, /\$|precio|CAD/i, 'La lista inicial debe contener ubicaciones sin precios');

  const beforeDuplicate = service.store.history(contact.id).length;
  const duplicate = service.handleIncoming({ chatId, text: 'mensaje duplicado', messageId: 'client-4' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(service.store.history(contact.id).length, beforeDuplicate);

  const sentCountBeforeSelection = sent.length;
  service.handleIncoming({ chatId, text: 'Me interesa la opción 2', messageId: 'client-5' });
  assert.equal(service.store.getContactByChat(chatId).currentFieldId, 'next_action');
  assert.equal(service.store.getContactByChat(chatId).answers.selected_property_id, '14-hayden');
  await service.flushOutbox(client);
  const roomPhotos = sent.filter((entry) => typeof entry[1] === 'object')
    .map((entry) => ({ filename: entry[1].filename, caption: entry[2].caption }));
  assert.equal(roomPhotos.length, 1, 'Solo debe enviarse la foto de la habitación seleccionada');
  assert.ok(roomPhotos[0].filename.endsWith('14-hayden.jpg'));
  assert.match(roomPhotos[0].caption, /14 Hayden.+850/s);
  assert.doesNotMatch(roomPhotos[0].caption, /152 Royal Palm|17 Hilldowntree|11 Huntingwood/);
  const selectedMessages = sent.slice(sentCountBeforeSelection)
    .filter((entry) => typeof entry[1] === 'string')
    .map((entry) => entry[1]);
  assert.equal(selectedMessages.length, 1, 'Con foto solo debe enviarse adicionalmente la pregunta para agendar');
  assert.match(selectedMessages[0], /agendar una visita/i);
  assert.doesNotMatch(selectedMessages[0], /14 Hayden|\$850|Precio:/,
    'La información de la propiedad no debe repetirse fuera de la foto');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(roomPhotos[0].filename)).digest('hex').toUpperCase();
  assert.equal(digest, 'DD01F3328162CAE03BBF37E8FCE7B48AA4F6092C997746E55C6689D70C2153A6');

  service.handleIncoming({ chatId, text: 'Sí', messageId: 'client-6' });
  assert.equal(service.store.getContactByChat(chatId).currentFieldId, 'appointment_date');
  service.handleIncoming({ chatId, text: '1', messageId: 'client-7' });
  assert.equal(service.store.getContactByChat(chatId).currentFieldId, 'appointment_time');
  service.handleIncoming({ chatId, text: '6 pm', messageId: 'client-8' });
  let scheduledContact = service.store.getContactByChat(chatId);
  assert.equal(scheduledContact.leadStatus, 'CITA_AGENDADA');
  assert.equal(scheduledContact.conversationStatus, 'COMPLETE');
  assert.equal(scheduledContact.appointment.propertyId, '14-hayden');
  assert.equal(scheduledContact.appointment.visitDate, '2026-08-18');
  assert.equal(scheduledContact.appointment.visitTime, '18:00');
  assert.equal(scheduledContact.appointment.timeWindowId, 'weekday-evening');

  service.handleIncoming({ chatId, text: 'Hola otra vez', messageId: 'client-9' });
  assert.equal(service.store.getContactByChat(chatId).appointment.id, scheduledContact.appointment.id);
  service.handleIncoming({ chatId, text: 'Modificar', messageId: 'client-10' });
  assert.equal(service.store.getContactByChat(chatId).currentFieldId, 'appointment_property');
  service.handleIncoming({ chatId, text: '1', messageId: 'client-11' });
  service.handleIncoming({ chatId, text: '2', messageId: 'client-12' });
  service.handleIncoming({ chatId, text: '1', messageId: 'client-13' });
  scheduledContact = service.store.getContactByChat(chatId);
  assert.equal(scheduledContact.appointment.propertyId, '11-huntingwood');
  assert.equal(scheduledContact.appointment.visitDate, '2026-08-19');
  assert.equal(scheduledContact.appointment.visitTime, '18:00');
  assert.equal(scheduledContact.appointment.timeWindowId, 'weekday-evening');
  assert.equal(service.store.listAppointments({ status: 'SUPERSEDED' }).length, 1);

  service.handleIncoming({ chatId, text: 'Cancelar', messageId: 'client-14' });
  assert.equal(service.store.getContactByChat(chatId).currentFieldId, 'appointment_cancel_confirmation');
  service.handleIncoming({ chatId, text: 'No', messageId: 'client-15' });
  assert.ok(service.store.getContactByChat(chatId).appointment, 'Responder No debe conservar la cita');

  service.store.enqueue(contact.id, chatId, [{
    body: 'Foto de prueba', mediaPath: __filename, mediaName: 'test.jpg',
  }], new Date().toISOString());
  await service.flushOutbox(client);
  assert.equal(sent.at(-1)[0], chatId);
  assert.deepEqual(sent.at(-1)[1], { filename: __filename });
  assert.equal(sent.at(-1)[2].caption, 'Foto de prueba');

  service.handleIncoming({ chatId, text: 'Stop bot', messageId: 'client-stop-1' });
  assert.equal(service.store.getContactByChat(chatId).conversationStatus, 'STOPPED_BY_ADMIN');
  assert.equal(service.store.getContactByChat(chatId).leadStatus, 'BOT_DETENIDO');
  assert.equal(service.handleIncoming({ chatId, text: 'Sí', messageId: 'client-stopped' }).reason, 'STOPPED_BY_ADMIN');
  service.handleIncoming({ chatId, text: 'inciair bot', messageId: 'admin-restart-1' });
  assert.equal(service.store.getContactByChat(chatId).currentFieldId, 'language');
  return contact.id;
}

function qualifyAndBook(service, chatId, prefix) {
  service.activateChat({ chatId, displayName: 'Cliente cita', messageId: `${prefix}-start` });
  service.handleIncoming({ chatId, text: 'Español', messageId: `${prefix}-1` });
  service.handleIncoming({ chatId, text: '1 persona', messageId: `${prefix}-2` });
  service.handleIncoming({ chatId, text: 'sí', messageId: `${prefix}-3` });
  service.handleIncoming({ chatId, text: '1 de septiembre', messageId: `${prefix}-4` });
  service.handleIncoming({ chatId, text: 'opción 1', messageId: `${prefix}-location` });
  service.handleIncoming({ chatId, text: 'sí', messageId: `${prefix}-schedule` });
  service.handleIncoming({ chatId, text: '1', messageId: `${prefix}-date` });
  service.handleIncoming({ chatId, text: '1', messageId: `${prefix}-time` });
  return service.store.getContactByChat(chatId);
}

function testHumanHandoffAndCancellation() {
  const store = new NewCustomersStore(':memory:');
  const service = createNewCustomersService({ store });
  const nonAdminChat = '14165557770@c.us';
  service.activateChat({ chatId: nonAdminChat, messageId: 'non-admin-start' });
  const nonAdminCommand = service.handleIncoming({ chatId: nonAdminChat, text: 'Stop bot', messageId: 'non-admin-stop' });
  assert.equal(nonAdminCommand.reason, undefined, 'Un texto reservado de un cliente debe procesarse como respuesta normal');
  assert.equal(store.getContactByChat(nonAdminChat).conversationStatus, 'ACTIVE');
  assert.equal(store.getContactByChat(nonAdminChat).currentFieldId, 'language');
  const handoffChat = '14165557771@c.us';
  service.activateChat({ chatId: handoffChat, messageId: 'handoff-start' });
  service.handleIncoming({ chatId: handoffChat, text: 'Quiero hablar con una persona', messageId: 'handoff-1' });
  const handoff = store.getContactByChat(handoffChat);
  assert.equal(handoff.conversationStatus, 'HANDOFF_REQUESTED');
  assert.equal(handoff.leadStatus, 'ATENCION_HUMANA');
  assert.equal(service.handleIncoming({ chatId: handoffChat, text: 'Hola', messageId: 'handoff-2' }).reason, 'HANDOFF_REQUESTED');
  service.activateChat({ chatId: handoffChat, messageId: 'handoff-restart' });
  assert.equal(store.getContactByChat(handoffChat).currentFieldId, 'language');

  const cancelChat = '14165557772@c.us';
  assert.ok(qualifyAndBook(service, cancelChat, 'cancel').appointment);
  service.handleIncoming({ chatId: cancelChat, text: 'Cancelar', messageId: 'cancel-8' });
  service.handleIncoming({ chatId: cancelChat, text: 'Sí', messageId: 'cancel-9' });
  const cancelled = store.getContactByChat(cancelChat);
  assert.equal(cancelled.appointment, null);
  assert.equal(cancelled.leadStatus, 'CITA_CANCELADA');
  assert.equal(cancelled.conversationStatus, 'COMPLETE');
  assert.equal(cancelled.language, null);
  assert.deepEqual(cancelled.answers, {}, 'Cancelar debe borrar todas las respuestas del flujo anterior');
  assert.deepEqual(cancelled.matchIds, [], 'Cancelar debe borrar las opciones del flujo anterior');
  assert.equal(store.listAppointments({ status: 'CANCELLED' }).length, 1);
  const cancellationMessage = store.pendingOutbox(100).filter((message) => message.contactId === cancelled.id).at(-1);
  assert.match(cancellationMessage.body, /visita fue cancelada/i);
  service.handleIncoming({ chatId: cancelChat, text: 'Hola de nuevo', messageId: 'cancel-10' });
  const restartedAfterCancellation = store.getContactByChat(cancelChat);
  assert.equal(restartedAfterCancellation.currentFieldId, 'language');
  assert.equal(restartedAfterCancellation.leadStatus, 'NUEVO');
  assert.equal(restartedAfterCancellation.appointment, null);
  assert.deepEqual(restartedAfterCancellation.answers, {});
  assert.deepEqual(restartedAfterCancellation.matchIds, []);
  const restartedMessage = store.pendingOutbox(100).filter((message) => message.contactId === cancelled.id).at(-1);
  assert.match(restartedMessage.body, /English or Spanish/i,
    'El primer mensaje después de cancelar debe mostrar el menú inicial');

  const reopenChat = '14165557773@c.us';
  service.activateChat({ chatId: reopenChat, messageId: 'reopen-start' });
  service.handleIncoming({ chatId: reopenChat, text: 'English', messageId: 'reopen-1' });
  service.handleIncoming({ chatId: reopenChat, text: '1 person', messageId: 'reopen-2' });
  service.handleIncoming({ chatId: reopenChat, text: 'no', messageId: 'reopen-3' });
  service.handleIncoming({ chatId: reopenChat, text: 'September 1', messageId: 'reopen-4' });
  service.handleIncoming({ chatId: reopenChat, text: '1', messageId: 'reopen-5' });
  service.handleIncoming({ chatId: reopenChat, text: 'no', messageId: 'reopen-6' });
  const closedContact = store.getContactByChat(reopenChat);
  assert.equal(closedContact.conversationStatus, 'COMPLETE');
  assert.equal(closedContact.leadStatus, 'NO_INTERESADO');
  const farewell = store.pendingOutbox(100).filter((message) => message.contactId === closedContact.id).at(-1);
  assert.match(farewell.body, /Thank you for contacting Confort Place/i);
  service.handleIncoming({ chatId: reopenChat, text: 'hi', messageId: 'reopen-7' });
  const restarted = store.getContactByChat(reopenChat);
  assert.equal(restarted.currentFieldId, 'language');
  assert.equal(restarted.leadStatus, 'NUEVO');
  assert.deepEqual(restarted.answers, {}, 'El nuevo contacto debe reiniciarse sin respuestas anteriores');
  assert.deepEqual(restarted.matchIds, [], 'El nuevo contacto debe reiniciarse sin opciones anteriores');
  service.handleIncoming({ chatId: reopenChat, text: 'English', messageId: 'reopen-8' });
  assert.equal(store.getContactByChat(reopenChat).currentFieldId, 'occupants');

  const englishChat = '14165557774@c.us';
  service.activateChat({ chatId: englishChat, messageId: 'english-start' });
  service.handleIncoming({ chatId: englishChat, text: 'English', messageId: 'english-1' });
  service.handleIncoming({ chatId: englishChat, text: '1 person', messageId: 'english-2' });
  service.handleIncoming({ chatId: englishChat, text: 'no', messageId: 'english-3' });
  service.handleIncoming({ chatId: englishChat, text: 'September 1', messageId: 'english-4' });
  const englishContact = store.getContactByChat(englishChat);
  const beforeSelection = store.pendingOutbox(100).filter((message) => message.contactId === englishContact.id);
  let englishMessages = beforeSelection.map((message) => message.body).join('\n');
  assert.match(englishMessages, /11 Huntingwood.+For one person or a couple/);
  assert.match(englishMessages, /14 Hayden.+For one person/);
  assert.match(englishMessages, /152 Royal Palm.+For one person.+Room #1/);
  assert.match(englishMessages, /Which location interests you most/);
  assert.doesNotMatch(englishMessages, /\$|Price:/i, 'Las ubicaciones deben mostrarse antes de revelar precios');
  assert.doesNotMatch(englishMessages, /Habitaci[oó]n|Para una persona/i, 'Los resultados en inglés no deben mezclar descripciones en español');
  const beforeSelectionIds = new Set(beforeSelection.map((message) => message.id));
  service.handleIncoming({ chatId: englishChat, text: '1', messageId: 'english-5' });
  englishMessages = store.pendingOutbox(100)
    .filter((message) => message.contactId === englishContact.id && !beforeSelectionIds.has(message.id))
    .map((message) => message.body).join('\n');
  const englishPropertyInfoMessages = store.pendingOutbox(100)
    .filter((message) => message.contactId === englishContact.id && !beforeSelectionIds.has(message.id))
    .filter((message) => /Price for one person/.test(message.body));
  assert.equal(englishPropertyInfoMessages.length, 1,
    'En inglés la información completa debe aparecer una sola vez, como descripción de la foto');
  assert.match(englishMessages, /11 Huntingwood Cres/);
  assert.match(englishMessages, /Price for one person: \*\$1,000 CAD\*/);
  assert.match(englishMessages, /Price for a couple: \*\$1,200 CAD\*/);
  assert.doesNotMatch(englishMessages, /14 Hayden|152 Royal Palm|17 Hilldowntree/,
    'Después de elegir solo debe compartirse la habitación seleccionada');
  assert.doesNotMatch(englishMessages, /Habitaci[oó]n|Precio para/i, 'La información de la habitación debe estar completamente en inglés');
  service.handleIncoming({ chatId: englishChat, text: 'yes', messageId: 'english-6' });
  service.handleIncoming({ chatId: englishChat, text: '1', messageId: 'english-7' });
  service.handleIncoming({ chatId: englishChat, text: '1', messageId: 'english-8' });
  englishMessages = store.pendingOutbox(100).filter((message) => message.contactId === englishContact.id).at(-1).body;
  assert.match(englishMessages, /Your visit is confirmed/);
  assert.doesNotMatch(englishMessages, /Habitaci[oó]n/i, 'La confirmación de cita debe estar completamente en inglés');
  assert.equal(store.getContactByChat(englishChat).appointment.visitTime, '18:00');
  const remainingTimes = store.getAppointmentAvailability().dates.find((entry) => entry.date === '2026-08-18').times.map((slot) => slot.time);
  assert.equal(remainingTimes.includes('18:00'), false, 'Una hora ya agendada no debe ofrecerse a otro cliente');
  store.close();
}

async function settleEvents() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function testWhatsAppEvents() {
  const store = new NewCustomersStore(':memory:');
  const service = createNewCustomersService({ store, testMode: true, allowedNumbers: ['4378781645'], allowMissingMessageTimestamp: true });
  const client = new EventEmitter();
  const sent = [];
  client.sendMessage = async (...args) => { sent.push(args); };
  client.getContactLidAndPhone = async () => [{ lid: '9991466@lid', pn: '14378781645@c.us' }];
  client.getContactById = async () => ({ number: '14378781645', isMyContact: true, name: 'Tester autorizado' });
  service.attach(client);

  const allowedChatId = '14378781645@c.us';
  const allowedContact = { number: '14378781645', isMyContact: true, name: 'Tester autorizado' };
  const directChat = { isGroup: false, name: 'Tester autorizado', getContact: async () => allowedContact };
  client.emit('message', {
    from: allowedChatId, fromMe: false, body: 'Hola', id: { _serialized: 'auto-allowed-1' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(allowedChatId).currentFieldId, 'language');
  assert.match(sent.at(-1)[1], /English or Spanish/i);

  const blockedChatId = '14165559999@c.us';
  client.emit('message', {
    from: blockedChatId, fromMe: false, body: 'Hola', id: { _serialized: 'auto-blocked-1' },
    getChat: async () => ({ isGroup: false, getContact: async () => ({ number: '14165559999', isMyContact: false }) }),
  });
  await settleEvents();
  assert.equal(store.getContactByChat(blockedChatId), null, 'Otro número no debe activar el bot durante las pruebas');

  const lidChatId = '9991466@lid';
  client.emit('message', {
    from: lidChatId, fromMe: false, body: 'Hola desde LID', id: { _serialized: 'auto-lid-1' }, getChat: async () => null,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(lidChatId).currentFieldId, 'language', 'Un LID directo nuevo no debe requerir un chat precargado');

  client.emit('message', {
    from: '14378781645@g.us', fromMe: false, body: 'Hola grupo', id: { _serialized: 'group-1' },
  });
  await settleEvents();
  assert.equal(store.getContactByChat('14378781645@g.us'), null, 'Los grupos siempre deben quedar excluidos');

  client.emit('message_create', {
    to: allowedChatId, fromMe: true, body: 'Stop bot', id: { _serialized: 'admin-stop-event' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(allowedChatId).conversationStatus, 'STOPPED_BY_ADMIN');
  assert.equal(store.getContactByChat(lidChatId).conversationStatus, 'STOPPED_BY_ADMIN', 'Stop bot debe detener la identidad LID del mismo número');

  client.emit('message', {
    from: lidChatId, fromMe: false, body: 'start bot', id: { _serialized: 'admin-start-from-lid' }, getChat: async () => null,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(lidChatId).currentFieldId, 'language', 'El 437 debe poder iniciar su propio bot desde la identidad LID');

  client.emit('message_create', {
    to: allowedChatId, fromMe: true, body: 'iniciar bot', id: { _serialized: 'admin-start-event' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(allowedChatId).currentFieldId, 'language');
  store.close();
}

async function testProductionWhatsAppEvents() {
  const store = new NewCustomersStore(':memory:');
  const service = createNewCustomersService({ store, testMode: false, allowMissingMessageTimestamp: true });
  const client = new EventEmitter();
  const sent = [];
  client.sendMessage = async (...args) => { sent.push(args); };
  service.attach(client);

  const historicalChatId = '14165556660@c.us';
  client.emit('message_create', {
    to: historicalChatId,
    fromMe: true,
    body: 'start bot',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    id: { _serialized: 'historical-admin-start' },
    getChat: async () => ({ isGroup: false, getContact: async () => ({ number: '14165556660', isMyContact: false }) }),
  });
  await settleEvents();
  assert.equal(store.getContactByChat(historicalChatId), null, 'Un start bot histórico no debe reabrir chats al vincular WhatsApp');

  const historicalIncomingChatId = '14165556659@c.us';
  client.emit('message', {
    from: historicalIncomingChatId,
    fromMe: false,
    body: 'Mensaje antiguo',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    id: { _serialized: 'historical-incoming-message' },
    getChat: async () => ({ isGroup: false, getContact: async () => ({ number: '14165556659', isMyContact: false }) }),
  });
  await settleEvents();
  assert.equal(store.getContactByChat(historicalIncomingChatId), null, 'Un mensaje entrante histórico no debe iniciar el bot al vincular WhatsApp');

  const savedChatId = '14165556661@c.us';
  client.emit('message', {
    from: savedChatId,
    fromMe: false,
    body: 'Hola',
    id: { _serialized: 'production-saved-1' },
    getChat: async () => ({ isGroup: false, getContact: async () => ({ number: '14165556661', isMyContact: true }) }),
  });
  await settleEvents();
  assert.equal(store.getContactByChat(savedChatId), null, 'Un contacto guardado no debe activar el bot en producción');

  const newChatId = '14165556662@c.us';
  const newDirectChat = { isGroup: false, getContact: async () => ({ number: '14165556662', isMyContact: false }) };
  client.emit('message', {
    from: newChatId,
    fromMe: false,
    body: 'Hello',
    id: { _serialized: 'production-new-1' },
    getChat: async () => newDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(newChatId).currentFieldId, 'language');
  assert.match(sent.at(-1)[1], /English or Spanish/i);

  const commandChatId = '14165556663@c.us';
  const commandDirectChat = { isGroup: false, getContact: async () => ({ number: '14165556663', isMyContact: false }) };
  client.emit('message', {
    from: commandChatId,
    fromMe: false,
    body: 'start bot',
    id: { _serialized: 'production-new-command-1' },
    getChat: async () => commandDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(commandChatId).currentFieldId, 'language', 'Cualquier texto de un contacto nuevo debe iniciar el bot');
  assert.match(sent.at(-1)[1], /English or Spanish/i);
  client.emit('message', {
    from: commandChatId,
    fromMe: false,
    body: 'Español',
    id: { _serialized: 'production-new-command-2' },
    getChat: async () => commandDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(commandChatId).currentFieldId, 'occupants', 'La respuesta de idioma debe avanzar después de la bienvenida');
  assert.match(sent.at(-1)[1], /una o dos personas/i);

  client.emit('message_create', {
    to: newChatId,
    fromMe: true,
    body: 'Stop bot',
    id: { _serialized: 'production-admin-stop' },
    getChat: async () => newDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(newChatId).conversationStatus, 'STOPPED_BY_ADMIN', 'El admin conectado debe conservar Stop bot en producción');
  store.close();
}

function testManagedInventory() {
  const store = new NewCustomersStore(':memory:');
  const properties = store.listProperties();
  assert.equal(properties.length, 6, 'El inventario debe contener exactamente las seis ofertas autorizadas');
  assert.deepEqual(properties.map((property) => property.id), [
    '14-hayden',
    '11-huntingwood',
    '152-royal-palm-1',
    '152-royal-palm-2',
    '17-hilldowntree-1',
    '17-hilldowntree-2',
  ]);
  const huntingwood = properties.find((property) => property.id === '11-huntingwood');
  assert.deepEqual(huntingwood.prices, { 1: 1000, 2: 1200 },
    '11 Huntingwood debe conservar $1,000 para una persona y $1,200 para una pareja');
  assert.equal(huntingwood.mediaItems.length, 1);
  assert.equal(huntingwood.mediaItems[0].mediaPath, 'web/assets/new-customers/11-huntingwood.jpg');

  const edited = store.updateProperty('14-hayden', { available: false, prices: { 1: 875 } });
  assert.equal(edited.available, false);
  assert.equal(edited.prices[1], 875);
  assert.equal(store.updateProperty('casa-no-autorizada', { available: true }), null);

  const service = createNewCustomersService({ store });
  const chatId = '14165558888@c.us';
  service.activateChat({ chatId, messageId: 'inventory-admin-start' });
  service.handleIncoming({ chatId, text: 'Español', messageId: 'inventory-1' });
  service.handleIncoming({ chatId, text: '1 persona', messageId: 'inventory-2' });
  service.handleIncoming({ chatId, text: 'sí', messageId: 'inventory-3' });
  service.handleIncoming({ chatId, text: '1 de septiembre', messageId: 'inventory-4' });
  assert.equal(store.getContactByChat(chatId).matchIds.includes('14-hayden'), false,
    'Una oferta no disponible nunca debe recomendarse');
  store.close();
}

async function testSelectedPropertyMedia() {
  const cases = [
    {
      option: '1',
      occupants: '1 persona',
      parking: 'no',
      propertyId: '11-huntingwood',
      filename: '11-huntingwood.jpg',
      price: '$1,000 CAD',
      hash: '8E978BDCEE3414690FF4B3DDB793755623A65FAE83BFBEF658F999F13290E7B9',
    },
    {
      option: '1',
      occupants: '2 personas',
      parking: 'sí',
      propertyId: '11-huntingwood',
      filename: '11-huntingwood.jpg',
      price: '$1,200 CAD',
      hash: '8E978BDCEE3414690FF4B3DDB793755623A65FAE83BFBEF658F999F13290E7B9',
    },
    {
      option: '3',
      occupants: '1 persona',
      parking: 'no',
      propertyId: '152-royal-palm-2',
      filename: '152-royal-palm-room-2.jpg',
      price: '$900 CAD',
      hash: '4B5AB51EE22074215182386873113344822D9AE1184BA6A1A5022ECF3BD45AEB',
    },
    {
      option: '4',
      occupants: '1 persona',
      parking: 'no',
      propertyId: '152-royal-palm-1',
      filename: '152-royal-palm-room-1.jpg',
      price: '$1,000 CAD',
      hash: '8F0BD87CF7602D763E0B25FBCA5173DFD329AE34D7348F4313F1AACD72A4C53B',
    },
  ];

  for (const [index, expected] of cases.entries()) {
    const store = new NewCustomersStore(':memory:');
    const service = createNewCustomersService({ store, mediaFactory: (filename) => ({ filename }) });
    const chatId = `1416555899${index}@c.us`;
    const sent = [];
    const client = { sendMessage: async (...args) => { sent.push(args); } };

    service.activateChat({ chatId, messageId: `media-${index}-start` });
    service.handleIncoming({ chatId, text: 'Español', messageId: `media-${index}-1` });
    service.handleIncoming({ chatId, text: expected.occupants, messageId: `media-${index}-2` });
    service.handleIncoming({ chatId, text: expected.parking, messageId: `media-${index}-3` });
    service.handleIncoming({ chatId, text: '1 de septiembre', messageId: `media-${index}-4` });
    await service.flushOutbox(client);

    assert.equal(sent.some((entry) => typeof entry[1] === 'object'), false,
      'No debe salir ninguna foto junto con la lista de ubicaciones');
    assert.doesNotMatch(sent.filter((entry) => typeof entry[1] === 'string').map((entry) => entry[1]).join('\n'), /\$|Precio:/i);

    const sentBeforeSelection = sent.length;
    service.handleIncoming({ chatId, text: expected.option, messageId: `media-${index}-5` });
    await service.flushOutbox(client);

    const contact = store.getContactByChat(chatId);
    assert.equal(contact.answers.selected_property_id, expected.propertyId);
    const selectedOutput = sent.slice(sentBeforeSelection);
    const photos = selectedOutput.filter((entry) => typeof entry[1] === 'object');
    assert.equal(photos.length, 1, 'Debe enviarse solamente la foto de la habitación seleccionada');
    const textMessages = selectedOutput.filter((entry) => typeof entry[1] === 'string').map((entry) => entry[1]);
    assert.equal(textMessages.length, 1, 'La información no debe duplicarse en un mensaje separado cuando existe foto');
    assert.match(textMessages[0], /agendar una visita/i);
    assert.doesNotMatch(textMessages[0], /Precio:|Precio para|\$|Huntingwood|Royal Palm/);
    assert.ok(photos[0][1].filename.endsWith(expected.filename));
    assert.match(photos[0][2].caption, new RegExp(expected.price.replace('$', '\\$')));
    if (expected.propertyId === '11-huntingwood') {
      const huntingwoodOutput = [
        ...selectedOutput.filter((entry) => typeof entry[1] === 'string').map((entry) => entry[1]),
        photos[0][2].caption,
      ].join('\n');
      assert.match(huntingwoodOutput, /Precio para una persona: \*\$1,000 CAD\*/);
      assert.match(huntingwoodOutput, /Precio para una pareja: \*\$1,200 CAD\*/);
      assert.doesNotMatch(huntingwoodOutput, /pareja\s*-\s*\$1,000/i,
        'El precio de una persona nunca debe parecer aplicable a una pareja');
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(photos[0][1].filename)).digest('hex').toUpperCase();
    assert.equal(digest, expected.hash, `La foto de ${expected.propertyId} debe corresponder a esa habitación`);
    store.close();
  }

  const textStore = new NewCustomersStore(':memory:');
  const textService = createNewCustomersService({ store: textStore });
  const textChatId = '14165558995@c.us';
  textService.activateChat({ chatId: textChatId, messageId: 'no-photo-start' });
  ['Español', '1 persona', 'no', '1 de septiembre', '5'].forEach((text, index) => {
    textService.handleIncoming({ chatId: textChatId, text, messageId: `no-photo-${index + 1}` });
  });
  const textContact = textStore.getContactByChat(textChatId);
  const noPhotoOutput = textStore.pendingOutbox(30).filter((message) => message.contactId === textContact.id).slice(-2);
  assert.equal(noPhotoOutput.filter((message) => message.mediaPath).length, 0);
  assert.match(noPhotoOutput[0].body, /17 Hilldowntree.+\$850 CAD/s,
    'Sin foto debe conservarse un mensaje de texto con la información de la habitación');
  assert.match(noPhotoOutput[1].body, /agendar una visita/i);
  textStore.close();
}

async function main() {
  const store = new NewCustomersStore(':memory:');
  const service = createNewCustomersService({ store, testMode: true, mediaFactory: (filename) => ({ filename }) });
  assert.equal(service.policyInfo().testMode, true);
  assert.deepEqual(service.policyInfo().allowedNumbers, ['4378781645']);
  assert.deepEqual(service.policyInfo().adminNumbers, ['4378781645']);
  assert.equal(service.isAdminIdentity('14378781645@c.us'), true);
  assert.equal(service.isAdminIdentity('14165550123@c.us'), false);
  assert.equal(service.shouldAutoActivate('14378781645@c.us', { isMyContact: true }), true);
  assert.equal(service.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), false);
  assert.equal(isDirectChat('14378781645@g.us'), false);
  assert.equal(isDirectChat('14378781645@lid'), true);

  const productionStore = new NewCustomersStore(':memory:');
  const productionService = createNewCustomersService({ store: productionStore, testMode: false });
  assert.equal(productionService.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), true);
  assert.equal(productionService.shouldAutoActivate('14165550123@c.us', { isMyContact: true }), false);
  productionStore.close();

  testManagedInventory();
  testHumanHandoffAndCancellation();
  await testSelectedPropertyMedia();
  await testWhatsAppEvents();
  await testProductionWhatsAppEvents();
  const contactId = await testConversation(service);
  const server = createApp({ newCustomersService: service }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const checks = [
    ['/', 'text/html'], ['/reminders', 'text/html'], ['/new-customers-info', 'text/html'],
    ['/api/reminders', 'application/json'], ['/api/settings', 'application/json'], ['/api/status', 'application/json'],
    ['/api/new-customers-info/status', 'application/json'], ['/api/new-customers-info/stats', 'application/json'],
    ['/api/new-customers-info/contacts', 'application/json'], ['/api/new-customers-info/properties', 'application/json'],
    ['/api/new-customers-info/appointment-settings', 'application/json'], ['/api/new-customers-info/appointments', 'application/json'],
    ['/assets/new-customers/14-hayden.jpg', 'image/jpeg'],
    ['/assets/new-customers/11-huntingwood.jpg', 'image/jpeg'],
  ];
  try {
    for (const [route, expectedType] of checks) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 200, `${route} debe responder HTTP 200`);
      assert.match(response.headers.get('content-type') || '', new RegExp(expectedType), `${route} debe responder ${expectedType}`);
      if (route === '/') {
        const page = await response.text();
        assert.match(page, /Confort Place New Customers Info/);
        assert.match(page, /Disponibilidad de casas/);
        assert.match(page, /Disponibilidad para visitas/);
        assert.match(page, /addAppointmentWindowButton/);
        assert.match(page, /Agregar horario/);
      }
      if (route === '/reminders') assert.match(await response.text(), /Reminder Control/);
    }
    const policyResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/status`);
    const policy = await policyResponse.json();
    assert.deepEqual(policy.policy.allowedNumbers, ['4378781645']);
    assert.deepEqual(policy.policy.adminNumbers, ['4378781645']);
    assert.equal(policy.stopCommand, 'stop bot');
    assert.equal(policy.activationCommand, 'start bot');
    assert.deepEqual(policy.activationCommands, ['start bot', 'iniciar bot']);
    const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/settings`);
    const persistedSettings = await settingsResponse.json();
    assert.equal(persistedSettings.newCustomersTestMode, false);

    const update = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/contacts/${contactId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SEGUIMIENTO' }),
    });
    assert.equal(update.status, 200);
    assert.equal(service.store.getContact(contactId).leadStatus, 'SEGUIMIENTO');

    const propertiesResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties`);
    const inventory = await propertiesResponse.json();
    assert.equal(inventory.properties.length, 6);
    const propertyUpdate = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties/11-huntingwood`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available: true, prices: { 1: 1050, 2: 1250 } }),
    });
    assert.equal(propertyUpdate.status, 200);
    const updatedProperty = (await propertyUpdate.json()).property;
    assert.equal(updatedProperty.prices[1], 1050);
    assert.equal(updatedProperty.prices[2], 1250);
    const invalidProperty = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties/casa-no-autorizada`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: true }),
    });
    assert.equal(invalidProperty.status, 404);
    const createProperty = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: 'Otra casa' }),
    });
    assert.equal(createProperty.status, 404, 'No debe existir una ruta para crear casas adicionales');

    const settingsUpdate = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/appointment-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2026-08-18', endDate: '2026-08-31', weekdays: [0, 1, 2, 3, 4, 5, 6],
        timeWindows: [
          { id: 'weekday-evening', start: '18:00', end: '21:00', weekdays: [1, 2, 3, 4, 5] },
          { id: 'weekend-afternoon', start: '13:00', end: '18:00', weekdays: [0, 6] },
        ],
      }),
    });
    assert.equal(settingsUpdate.status, 200);
    const savedSettings = (await settingsUpdate.json()).settings;
    assert.deepEqual(savedSettings.weekdays, [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(savedSettings.timeWindows, [
      { id: 'weekday-evening', start: '18:00', end: '21:00', weekdays: [1, 2, 3, 4, 5] },
      { id: 'weekend-afternoon', start: '13:00', end: '18:00', weekdays: [0, 6] },
    ]);
    const daySpecificAvailability = service.store.getAppointmentAvailability();
    const thursdayTimes = daySpecificAvailability.dates.find((entry) => entry.date === '2026-08-20').times.map((slot) => slot.time);
    const saturdayTimes = daySpecificAvailability.dates.find((entry) => entry.date === '2026-08-22').times.map((slot) => slot.time);
    assert.deepEqual(thursdayTimes, ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30']);
    assert.deepEqual(saturdayTimes, ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']);
    const appointmentsResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/appointments?status=SCHEDULED`);
    const appointments = (await appointmentsResponse.json()).appointments;
    assert.equal(appointments.length, 1);
    assert.equal(appointments[0].contactId, contactId);

    const clearWindowsResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/appointment-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeWindows: [] }),
    });
    assert.equal(clearWindowsResponse.status, 200, 'El dashboard debe permitir borrar todos los horarios');
    assert.deepEqual((await clearWindowsResponse.json()).settings.timeWindows, []);
    assert.deepEqual(service.store.getAppointmentAvailability().dates, [],
      'Sin horarios guardados el bot no debe ofrecer fechas ni horas de visita');

    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/contacts/${contactId}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    assert.equal(service.store.getContact(contactId), null);
    assert.equal(service.store.listAppointments({ status: 'SCHEDULED' }).length, 0, 'Borrar el contacto también debe retirar su cita');
    console.log(`${checks.length} rutas, inventario fijo, agenda, borrado, atención humana, Stop bot, medios y flujo conversacional verificados correctamente.`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
