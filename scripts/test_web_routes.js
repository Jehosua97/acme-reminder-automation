'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const { createApp } = require('./web_server');
const { NewCustomersStore } = require('./modules/new-customers-info/store');
const { createNewCustomersService, isDirectChat } = require('./modules/new-customers-info/service');
const {
  isNavigationContextError,
  makeInjectionNavigationResilient,
} = require('./navigation_resilient_client');

async function testNavigationResilience() {
  assert.equal(isNavigationContextError(new Error('Execution context was destroyed.')), true);
  assert.equal(isNavigationContextError(new Error('Un error permanente')), false);

  let injectCalls = 0;
  let waitCalls = 0;
  const client = {
    pupPage: {
      isClosed: () => false,
      waitForFunction: async () => { waitCalls += 1; },
    },
    inject: async () => {
      injectCalls += 1;
      if (injectCalls === 1) throw new Error('Execution context was destroyed.');
      return 'ready';
    },
  };
  makeInjectionNavigationResilient(client, { retryDelayMs: 0, maxAttempts: 3 });
  const first = client.inject();
  const coalesced = client.inject();
  assert.equal(first, coalesced, 'Las inyecciones simultaneas deben compartir la misma recuperacion');
  assert.equal(await first, 'ready');
  assert.equal(injectCalls, 2);
  assert.equal(waitCalls, 2);
}

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
  assert.match(selectedMessages[0], /ver esta propiedad en persona/i);
  assert.doesNotMatch(selectedMessages[0], /14 Hayden|\$850|Precio:/,
    'La información de la propiedad no debe repetirse fuera de la foto');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(roomPhotos[0].filename)).digest('hex').toUpperCase();
  assert.equal(digest, 'DD01F3328162CAE03BBF37E8FCE7B48AA4F6092C997746E55C6689D70C2153A6');

  service.handleIncoming({ chatId, text: 'Sí', messageId: 'client-6' });
  let completedContact = service.store.getContactByChat(chatId);
  assert.equal(completedContact.currentFieldId, null);
  assert.equal(completedContact.conversationStatus, 'COMPLETE');
  assert.equal(completedContact.leadStatus, 'INTERESADO');
  assert.equal(completedContact.appointment, null, 'Koalendar reemplaza por completo la agenda interna');
  await service.flushOutbox(client);
  assert.match(sent.at(-1)[1], /https:\/\/koalendar\.com\/e\/meet-with-confort/);
  assert.match(sent.at(-1)[1], /iniciar de nuevo/i);
  assert.doesNotMatch(sent.at(-1)[1], /Seleccione una fecha|hora disponible/i);
  assert.equal(service.handleIncoming({ chatId, text: 'Hola otra vez', messageId: 'client-7' }).reason, 'COMPLETE_AWAITING_ADMIN');

  const firstId = completedContact.id;
  service.handleIncoming({ chatId, text: 'start again', messageId: 'client-restart-en' });
  let restarted = service.store.getContactByChat(chatId);
  assert.notEqual(restarted.id, firstId, 'start again debe crear un expediente limpio');
  assert.equal(service.store.getContact(firstId), null);
  assert.equal(restarted.currentFieldId, 'language');
  assert.equal(restarted.leadStatus, 'NUEVO');
  assert.deepEqual(restarted.answers, {});
  assert.deepEqual(restarted.matchIds, []);
  assert.equal(service.store.listAppointments({ status: 'ALL' }).length, 0);
  assert.equal(service.store.history(restarted.id).length, 1, 'El expediente reiniciado no debe conservar historial anterior');

  service.handleIncoming({ chatId, text: 'Español', messageId: 'client-restart-language' });
  const secondId = restarted.id;
  service.handleIncoming({ chatId, text: 'iniciar de nuevo', messageId: 'client-restart-es' });
  restarted = service.store.getContactByChat(chatId);
  assert.notEqual(restarted.id, secondId, 'iniciar de nuevo también debe borrar el expediente anterior');
  assert.equal(restarted.currentFieldId, 'language');
  assert.deepEqual(restarted.answers, {});
  return restarted.id;
}

function testHumanHandoffAndRestart() {
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
  assert.equal(service.handleIncoming({ chatId: handoffChat, text: 'start again', messageId: 'handoff-restart-client' }).reason,
    'HANDOFF_REQUESTED');
  service.activateChat({ chatId: handoffChat, messageId: 'handoff-restart' });
  assert.equal(store.getContactByChat(handoffChat).currentFieldId, 'language');

  const resetChat = '14165557772@c.us';
  service.activateChat({ chatId: resetChat, messageId: 'reset-start' });
  service.handleIncoming({ chatId: resetChat, text: 'Español', messageId: 'reset-language' });
  const resetBefore = store.getContactByChat(resetChat);
  const availability = store.getAppointmentAvailability(resetBefore.id);
  const firstDate = availability.dates.find((entry) => entry.times.length);
  store.bookAppointment(resetBefore.id, {
    propertyId: '14-hayden', visitDate: firstDate.date, visitTime: firstDate.times[0].time,
  });
  service.handleIncoming({ chatId: resetChat, text: 'iniciar de nuevo', messageId: 'reset-command' });
  const resetAfter = store.getContactByChat(resetChat);
  assert.notEqual(resetAfter.id, resetBefore.id);
  assert.equal(store.getContact(resetBefore.id), null);
  assert.equal(store.listAppointments({ status: 'ALL' }).length, 0);
  assert.deepEqual(resetAfter.answers, {});
  assert.equal(store.history(resetAfter.id).length, 1);

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
  assert.equal(store.getContactByChat(reopenChat).conversationStatus, 'COMPLETE', 'Un mensaje nuevo no debe reiniciar una conversaciÃ³n terminada');
  service.handleIncoming({ chatId: reopenChat, text: 'start again', messageId: 'reopen-start-again' });
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
  englishMessages = store.pendingOutbox(100).filter((message) => message.contactId === englishContact.id).at(-1).body;
  assert.match(englishMessages, /https:\/\/koalendar\.com\/e\/meet-with-confort/);
  assert.match(englishMessages, /Once you have booked your visit/);
  assert.match(englishMessages, /start again/);
  assert.doesNotMatch(englishMessages, /Seleccione|Habitación|agendado su visita/i,
    'El cierre en inglés no debe mezclar información en español');
  assert.equal(store.getContactByChat(englishChat).appointment, null);
  assert.equal(store.getContactByChat(englishChat).conversationStatus, 'COMPLETE');
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
  assert.equal(store.getContactByChat(allowedChatId), null, 'El cliente no debe iniciar el bot sin el saludo del admin');
  client.emit('message', {
    from: allowedChatId, fromMe: false, body: 'Welcome!', id: { _serialized: 'client-welcome-incoming-1' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(allowedChatId), null, 'Welcome! recibido nunca debe iniciar el bot');
  client.emit('message_create', {
    to: allowedChatId, fromMe: true, body: 'Welcome!', id: { _serialized: 'admin-welcome-outgoing-1' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(allowedChatId).currentFieldId, 'language');
  assert.match(sent.at(-1)[1], /English or Spanish/i);
  const sentBeforeEmptyEvent = sent.length;
  client.emit('message', {
    from: allowedChatId, fromMe: false, body: '', id: { _serialized: 'empty-sync-event' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(sent.length, sentBeforeEmptyEvent, 'Un evento vacÃ­o de sincronizaciÃ³n no debe generar respuestas');

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
  assert.equal(store.getContactByChat(lidChatId), null, 'Un mensaje normal por LID no debe iniciar el bot');
  client.emit('message', {
    from: lidChatId, fromMe: false, body: 'Welcome!', id: { _serialized: 'client-welcome-lid-1' }, getChat: async () => null,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(lidChatId), null, 'Welcome! entrante por LID tampoco debe iniciar');
  client.emit('message_create', {
    to: lidChatId, fromMe: true, body: 'Welcome!', id: { _serialized: 'admin-welcome-lid-1' }, getChat: async () => null,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(lidChatId).currentFieldId, 'language', 'Welcome! enviado por el admin debe iniciar un chat LID directo');

  client.emit('message', {
    from: '14378781645@g.us', fromMe: false, body: 'Welcome!', id: { _serialized: 'group-1' },
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
    from: lidChatId, fromMe: false, body: 'Welcome!', id: { _serialized: 'client-start-from-lid' }, getChat: async () => null,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(lidChatId).conversationStatus, 'STOPPED_BY_ADMIN', 'Welcome! entrante no debe reiniciar un bot detenido');

  client.emit('message_create', {
    to: allowedChatId, fromMe: true, body: 'Welcome!', id: { _serialized: 'admin-start-event' }, getChat: async () => directChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(allowedChatId).currentFieldId, 'language');
  store.close();
}

async function testProductionWhatsAppEvents() {
  const restartStore = new NewCustomersStore(':memory:');
  const restartService = createNewCustomersService({ store: restartStore, testMode: false });
  restartService.activateChat({ chatId: '14165550000@c.us', phoneE164: '+14165550000' });
  assert.equal(restartStore.pendingOutbox().length, 1);
  restartService.attach(new EventEmitter());
  assert.equal(restartStore.pendingOutbox().length, 0, 'Un reinicio no debe enviar mensajes pendientes de una ejecuciÃ³n anterior');
  restartStore.close();

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
    body: 'Welcome!',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    id: { _serialized: 'historical-admin-start' },
    getChat: async () => ({ isGroup: false, getContact: async () => ({ number: '14165556660', isMyContact: false }) }),
  });
  await settleEvents();
  assert.equal(store.getContactByChat(historicalChatId), null, 'Un saludo histórico no debe reabrir chats al vincular WhatsApp');

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
  assert.equal(store.getContactByChat(newChatId), null, 'Un contacto nuevo no debe iniciar el bot por sí solo');
  client.emit('message', {
    from: newChatId,
    fromMe: false,
    body: 'start again',
    id: { _serialized: 'production-new-restart-without-record' },
    getChat: async () => newDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(newChatId), null, 'start again no debe activar un número sin expediente');
  client.emit('message_create', {
    to: newChatId,
    fromMe: true,
    body: 'Welcome to Confort Place',
    id: { _serialized: 'production-admin-welcome-1' },
    getChat: async () => newDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(newChatId), null, 'Cualquier texto distinto de Welcome! debe ignorarse');
  client.emit('message_create', {
    to: newChatId,
    fromMe: true,
    body: 'Welcome!',
    id: { _serialized: 'production-admin-welcome-exact-1' },
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
    body: 'Welcome!',
    id: { _serialized: 'production-new-command-1' },
    getChat: async () => commandDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(commandChatId), null, 'Un cliente que envÃ­e Welcome! nunca debe iniciar el bot');
  client.emit('message_create', {
    to: commandChatId,
    fromMe: true,
    body: 'Welcome to Confort Place!',
    id: { _serialized: 'production-admin-welcome-2' },
    getChat: async () => commandDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(commandChatId), null, 'Welcome to Confort Place! no debe aceptarse como alias');
  client.emit('message_create', {
    to: commandChatId,
    fromMe: true,
    body: 'Welcome!',
    id: { _serialized: 'production-admin-welcome-exact-2' },
    getChat: async () => commandDirectChat,
  });
  await settleEvents();
  assert.equal(store.getContactByChat(commandChatId).currentFieldId, 'language', 'El saludo enviado por el admin debe iniciar el bot');
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

  const groupChatId = '120363000000000000@g.us';
  client.emit('message_create', {
    to: groupChatId,
    fromMe: true,
    body: 'Welcome!',
    id: { _serialized: 'production-admin-group-welcome' },
    getChat: async () => ({ isGroup: true }),
  });
  await settleEvents();
  assert.equal(store.getContactByChat(groupChatId), null, 'El saludo del admin nunca debe activar un grupo');

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
  assert.equal(properties.length, 7, 'El inventario inicial debe contener las siete ofertas configuradas');
  assert.deepEqual(properties.map((property) => property.id), [
    '14-hayden',
    '11-huntingwood',
    '152-royal-palm-1',
    '152-royal-palm-2',
    '17-hilldowntree-1',
    '17-hilldowntree-2',
    '26-lincoln',
  ]);
  const huntingwood = properties.find((property) => property.id === '11-huntingwood');
  assert.deepEqual(huntingwood.prices, { 1: 1000, 2: 1200 },
    '11 Huntingwood debe conservar $1,000 para una persona y $1,200 para una pareja');
  assert.equal(huntingwood.mediaItems.length, 1);
  assert.equal(huntingwood.mediaItems[0].mediaPath, 'web/assets/new-customers/11-huntingwood.jpg');
  const lincoln = properties.find((property) => property.id === '26-lincoln');
  assert.equal(lincoln.address, '26 Lincoln Ct, Brampton, ON L6T 3Z2');
  assert.equal(lincoln.maxOccupants, 1);
  assert.equal(lincoln.parkingSpaces, 1);
  assert.deepEqual(lincoln.prices, { 1: 1000 });
  assert.deepEqual(lincoln.mediaItems, [], 'Lincoln debe permanecer sin foto hasta que el admin seleccione una');

  const edited = store.updateProperty('14-hayden', { available: false, prices: { 1: 875 } });
  assert.equal(edited.available, false);
  assert.equal(edited.prices[1], 875);
  assert.equal(store.updateProperty('casa-no-autorizada', { available: true }), null);

  const created = store.createProperty({
    address: '99 Test Ave, Brampton, ON',
    room: 'Habitación de prueba',
    available: true,
    maxOccupants: 1,
    parkingSpaces: 0,
    prices: { 1: 700 },
    mediaItems: [],
  });
  assert.ok(created.id);
  assert.equal(store.listProperties().length, 8, 'El admin debe poder agregar cuartos');
  assert.equal(store.deleteProperty(created.id).id, created.id);
  assert.equal(store.getProperty(created.id), null, 'Un cuarto eliminado ya no debe estar disponible');

  const service = createNewCustomersService({ store });
  const chatId = '14165558888@c.us';
  service.activateChat({ chatId, messageId: 'inventory-admin-start' });
  service.handleIncoming({ chatId, text: 'Español', messageId: 'inventory-1' });
  service.handleIncoming({ chatId, text: '1 persona', messageId: 'inventory-2' });
  service.handleIncoming({ chatId, text: 'sí', messageId: 'inventory-3' });
  service.handleIncoming({ chatId, text: '1 de septiembre', messageId: 'inventory-4' });
  assert.equal(store.getContactByChat(chatId).matchIds.includes('14-hayden'), false,
    'Una oferta no disponible nunca debe recomendarse');
  assert.equal(store.deleteProperty('17-hilldowntree-1').id, '17-hilldowntree-1');
  store.migrate();
  assert.equal(store.getProperty('17-hilldowntree-1'), null,
    'Una oferta eliminada no debe reaparecer al migrar o reiniciar');
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
    const service = createNewCustomersService({ store, testMode: false, mediaFactory: (filename) => ({ filename }) });
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
    assert.match(textMessages[0], /ver esta propiedad en persona/i);
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
  ['Español', '1 persona', 'no', '1 de septiembre', '6'].forEach((text, index) => {
    textService.handleIncoming({ chatId: textChatId, text, messageId: `no-photo-${index + 1}` });
  });
  const textContact = textStore.getContactByChat(textChatId);
  const noPhotoOutput = textStore.pendingOutbox(30).filter((message) => message.contactId === textContact.id).slice(-2);
  assert.equal(noPhotoOutput.filter((message) => message.mediaPath).length, 0);
  assert.match(noPhotoOutput[0].body, /17 Hilldowntree.+\$850 CAD/s,
    'Sin foto debe conservarse un mensaje de texto con la información de la habitación');
  assert.match(noPhotoOutput[1].body, /ver esta propiedad en persona/i);
  textStore.close();
}

async function main() {
  await testNavigationResilience();
  const store = new NewCustomersStore(':memory:');
  const service = createNewCustomersService({
    store,
    testMode: true,
    mediaFactory: (filename) => ({ filename }),
    readSettings: () => ({ newCustomersTestMode: true }),
    writeSettings: (settings) => settings,
  });
  assert.equal(service.policyInfo().testMode, true);
  assert.deepEqual(service.policyInfo().allowedNumbers, ['4378781645']);
  assert.deepEqual(service.policyInfo().adminNumbers, ['4378781645']);
  assert.equal(service.isAdminIdentity('14378781645@c.us'), true);
  assert.equal(service.isAdminIdentity('14165550123@c.us'), false);
  assert.equal(service.shouldAutoActivate('14378781645@c.us', { isMyContact: true }), false);
  assert.equal(service.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), false);
  service.setTestMode(false, { persist: false });
  assert.equal(service.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), false);
  service.setTestMode(true, { persist: false });
  assert.equal(service.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), false);
  assert.equal(service.policyInfo().paused, false);
  service.setPaused(true, { persist: false });
  assert.equal(service.policyInfo().paused, true);
  assert.equal(
    service.handleIncoming({ chatId: '14165550123@c.us', text: 'hello', messageId: 'paused-message' }).reason,
    'GLOBAL_PAUSED'
  );
  assert.equal(store.isProcessed('paused-message'), true, 'Un mensaje recibido durante la pausa no debe recuperarse despues');
  service.setPaused(false, { persist: false });
  assert.equal(service.policyInfo().paused, false);
  assert.equal(isDirectChat('14378781645@g.us'), false);
  assert.equal(isDirectChat('14378781645@lid'), true);

  const productionStore = new NewCustomersStore(':memory:');
  const productionService = createNewCustomersService({ store: productionStore, testMode: false });
  assert.equal(productionService.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), false);
  assert.equal(productionService.shouldAutoActivate('14165550123@c.us', { isMyContact: true }), false);
  productionStore.close();

  testManagedInventory();
  testHumanHandoffAndRestart();
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
    ['/api/new-customers-info/whatsapp/status', 'application/json'],
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
        assert.match(page, /addPropertyButton/);
        assert.match(page, /Agregar cuarto/);
        assert.match(page, /Disponibilidad para visitas/);
        assert.match(page, /addAppointmentWindowButton/);
        assert.match(page, /Agregar horario/);
        assert.match(page, /customerModeToggle/);
        assert.match(page, /customerBotPauseToggle/);
        assert.match(page, /Pausar bot/);
        assert.match(page, /adminHelpButton/);
        assert.match(page, /adminHelpDialog/);
        assert.match(page, /CÃ³mo funciona el bot de clientes nuevos|Cómo funciona el bot de clientes nuevos/);
        assert.match(page, /Welcome!/);
        assert.match(page, /Stop bot/);
        assert.match(page, /koalendar\.com\/e\/meet-with-confort/);
      }
      if (route === '/reminders') assert.match(await response.text(), /Reminder Control/);
    }
    const policyResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/status`);
    const policy = await policyResponse.json();
    assert.deepEqual(policy.policy.allowedNumbers, ['4378781645']);
    assert.deepEqual(policy.policy.adminNumbers, ['4378781645']);
    assert.equal(policy.stopCommand, 'stop bot');
    assert.equal(policy.activationCommand, 'Welcome!');
    assert.deepEqual(policy.activationCommands, ['Welcome!']);
    assert.deepEqual(policy.restartCommands, ['start again', 'iniciar de nuevo']);
    assert.equal(policy.schedulingUrl, 'https://koalendar.com/e/meet-with-confort');
    assert.equal(policy.policy.automaticTrigger, 'ADMIN_OUTBOUND_WELCOME_COMMAND');
    const developmentMode = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testMode: true }),
    });
    assert.equal(developmentMode.status, 200);
    assert.equal((await developmentMode.json()).policy.testMode, true);
    assert.equal(service.shouldAutoActivate('14165550123@c.us', { isMyContact: false }), false);
    const pauseMode = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/pause`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(pauseMode.status, 200);
    assert.equal((await pauseMode.json()).policy.paused, true);
    const pausedStatus = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/status`);
    assert.equal((await pausedStatus.json()).policy.paused, true);
    const resumeMode = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/pause`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: false }),
    });
    assert.equal(resumeMode.status, 200);
    assert.equal((await resumeMode.json()).policy.paused, false);

    const update = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/contacts/${contactId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SEGUIMIENTO' }),
    });
    assert.equal(update.status, 200);
    assert.equal(service.store.getContact(contactId).leadStatus, 'SEGUIMIENTO');

    const propertiesResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties`);
    const inventory = await propertiesResponse.json();
    assert.equal(inventory.properties.length, 7);
    const lincoln = inventory.properties.find((property) => property.id === '26-lincoln');
    assert.equal(lincoln.prices[1], 1000);
    assert.equal(lincoln.parkingSpaces, 1);
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
    const createPropertyResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '99 Test Ave, Brampton, ON', room: 'Habitación de prueba', available: true,
        maxOccupants: 1, parkingSpaces: 0, prices: { 1: 700 }, mediaItems: [],
      }),
    });
    assert.equal(createPropertyResponse.status, 201, 'El dashboard debe poder crear cuartos adicionales');
    const createdProperty = (await createPropertyResponse.json()).property;
    assert.equal(createdProperty.address, '99 Test Ave, Brampton, ON');
    const deletePropertyResponse = await fetch(`http://127.0.0.1:${port}/api/new-customers-info/properties/${createdProperty.id}`, {
      method: 'DELETE',
    });
    assert.equal(deletePropertyResponse.status, 200, 'El dashboard debe poder eliminar cuartos');
    assert.equal(service.store.getProperty(createdProperty.id), null);

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
    assert.equal(appointments.length, 0, 'El bot ya no debe crear citas internas al usar Koalendar');

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
    console.log(`${checks.length} rutas, inventario administrable, Koalendar, reinicio limpio, borrado, atención humana, Stop bot, medios y flujo conversacional verificados correctamente.`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
