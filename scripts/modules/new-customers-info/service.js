'use strict';

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { NewCustomersStore } = require('./store');
const { START_COMMAND, STOP_COMMAND, activate, handleText, normalize } = require('./engine');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function messageIdOf(message) {
  return message?.id?._serialized || message?.id?.id || '';
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneFromChat(chatId) {
  const digits = normalizePhone(String(chatId || '').split('@')[0]);
  return digits ? `+${digits}` : '';
}

function isDirectChat(chatId) {
  const value = String(chatId || '');
  return /@(c\.us|lid|s\.whatsapp\.net)$/.test(value);
}

function numberMatches(candidate, allowed) {
  const left = normalizePhone(candidate);
  const right = normalizePhone(allowed);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function maskedIdentity(value) {
  const raw = String(value || '');
  const [user, server = ''] = raw.split('@');
  const digits = normalizePhone(user);
  return `${digits ? `***${digits.slice(-4)}` : 'unknown'}${server ? `@${server}` : ''}`;
}

function createNewCustomersService(options = {}) {
  const filename = options.filename || path.resolve(PROJECT_ROOT, 'data/new-customers-info.sqlite');
  const store = options.store || new NewCustomersStore(filename);
  let configuredTestMode = false;
  if (process.env.NEW_CUSTOMERS_TEST_MODE !== undefined) {
    configuredTestMode = String(process.env.NEW_CUSTOMERS_TEST_MODE).toLowerCase() !== 'false';
  } else {
    try {
      const settings = JSON.parse(fs.readFileSync(path.resolve(PROJECT_ROOT, 'data/settings.json'), 'utf8'));
      configuredTestMode = settings.newCustomersTestMode === true;
    } catch {}
  }
  const testMode = options.testMode ?? configuredTestMode;
  const allowedInput = Array.isArray(options.allowedNumbers)
    ? options.allowedNumbers
    : String(options.allowedNumbers || process.env.NEW_CUSTOMERS_TEST_NUMBERS || '4378781645').split(',');
  const allowedNumbers = allowedInput
    .map(normalizePhone)
    .filter(Boolean);
  const adminInput = Array.isArray(options.adminNumbers)
    ? options.adminNumbers
    : String(options.adminNumbers || process.env.NEW_CUSTOMERS_ADMIN_NUMBERS || '4378781645').split(',');
  const adminNumbers = adminInput.map(normalizePhone).filter(Boolean);
  const mediaFactory = options.mediaFactory || ((filenameValue) => MessageMedia.fromFilePath(filenameValue));
  let flushQueue = Promise.resolve();

  function policyInfo() {
    return {
      testMode,
      allowedNumbers: testMode ? [...allowedNumbers] : [],
      adminNumbers: [...adminNumbers],
      automaticTrigger: testMode ? 'TEST_ALLOWLIST' : 'UNSAVED_DIRECT_CONTACTS',
      directChatsOnly: true,
    };
  }

  function isAllowedForTesting(chatId, whatsappContact = null) {
    if (!testMode) return true;
    const candidates = [
      phoneFromChat(chatId),
      whatsappContact?.number,
      whatsappContact?.phoneNumber,
      whatsappContact?.pn,
      whatsappContact?.id?.user,
      whatsappContact?.id?._serialized,
    ];
    return allowedNumbers.some((allowed) => candidates.some((candidate) => numberMatches(candidate, allowed)));
  }

  function isAdminIdentity(chatId, whatsappContact = null) {
    const candidates = [
      phoneFromChat(chatId),
      whatsappContact?.phoneE164,
      whatsappContact?.number,
      whatsappContact?.phoneNumber,
      whatsappContact?.pn,
      whatsappContact?.id?.user,
      whatsappContact?.id?._serialized,
    ];
    return adminNumbers.some((admin) => candidates.some((candidate) => numberMatches(candidate, admin)));
  }

  function shouldAutoActivate(chatId, whatsappContact = null) {
    if (!isDirectChat(chatId) || !isAllowedForTesting(chatId, whatsappContact)) return false;
    if (testMode) return true;
    return whatsappContact?.isMyContact === false;
  }

  async function resolveWhatsappContact(client, chat, chatId) {
    let contact = typeof chat?.getContact === 'function'
      ? await chat.getContact().catch(() => null)
      : null;
    if (!contact && typeof client.getContactById === 'function') {
      contact = await client.getContactById(chatId).catch(() => null);
    }
    if (!String(chatId).endsWith('@lid') || typeof client.getContactLidAndPhone !== 'function') return contact;
    const mappings = await client.getContactLidAndPhone([chatId]).catch(() => []);
    const phoneId = mappings?.[0]?.pn || '';
    if (!phoneId) return contact;
    const phoneContact = typeof client.getContactById === 'function'
      ? await client.getContactById(phoneId).catch(() => null)
      : null;
    contact = phoneContact || contact || {};
    contact.phoneNumber = phoneId;
    return contact;
  }

  function e164FromContact(chatId, whatsappContact) {
    const digits = normalizePhone(whatsappContact?.phoneNumber || whatsappContact?.number || whatsappContact?.id?.user);
    return digits ? `+${digits}` : phoneFromChat(chatId);
  }

  function activateChat({ chatId, phoneE164 = '', displayName = '', messageId = '' }) {
    return store.activate({
      chatId,
      phoneE164: phoneE164 || phoneFromChat(chatId),
      displayName,
      messageId,
      transition: activate(),
    });
  }

  function stopChat({ chatId, phoneE164 = '', messageId = '' }) {
    const phoneIdentity = phoneE164 || phoneFromChat(chatId);
    const exact = store.getContactByChat(chatId);
    const matches = store.listContacts().filter((contact) => (
      contact.id === exact?.id || numberMatches(contact.phoneE164, phoneIdentity)
    ));
    if (!matches.length) return store.stopChat({ chatId, messageId });
    let result = null;
    matches.forEach((contact, index) => {
      const stopped = store.stopChat({ chatId: contact.chatId, messageId: index === 0 ? messageId : '' });
      if (!result || contact.id === exact?.id) result = stopped;
    });
    return result;
  }

  function handleIncoming({ chatId, text, messageId = '' }) {
    const contact = store.getContactByChat(chatId);
    if (!contact) return { ignored: true, reason: 'CONTACT_NOT_ACTIVATED' };
    if (normalize(text) === START_COMMAND) {
      if (!isAdminIdentity(chatId, contact)) return { ignored: true, reason: 'ADMIN_REQUIRED', contact };
      return activateChat({
        chatId: contact.chatId,
        phoneE164: contact.phoneE164,
        displayName: contact.displayName,
        messageId,
      });
    }
    if (normalize(text) === STOP_COMMAND) {
      if (!isAdminIdentity(chatId, contact)) return { ignored: true, reason: 'ADMIN_REQUIRED', contact };
      return stopChat({ chatId, phoneE164: contact.phoneE164, messageId });
    }
    if (contact.conversationStatus === 'STOPPED_BY_ADMIN') return { ignored: true, reason: 'STOPPED_BY_ADMIN', contact };
    if (contact.conversationStatus === 'HANDOFF_REQUESTED') return { ignored: true, reason: 'HANDOFF_REQUESTED', contact };
    if (contact.conversationStatus === 'COMPLETE' && contact.leadStatus === 'NO_INTERESADO' && !contact.appointment) {
      return activateChat({
        chatId: contact.chatId,
        phoneE164: contact.phoneE164,
        displayName: contact.displayName,
        messageId,
      });
    }
    return store.applyIncoming({
      contact,
      messageId,
      incomingText: String(text || '').trim(),
      transition: handleText(contact, text, store.listProperties(), store.getAppointmentAvailability(contact.id)),
    });
  }

  function flushOutbox(client) {
    const run = flushQueue.then(async () => {
      for (const outgoing of store.pendingOutbox()) {
        try {
          if (!store.isOutboxSendable(outgoing.id)) continue;
          if (outgoing.mediaPath) {
            const mediaFile = path.isAbsolute(outgoing.mediaPath)
              ? outgoing.mediaPath
              : path.join(PROJECT_ROOT, outgoing.mediaPath);
            if (!fs.existsSync(mediaFile)) throw new Error(`No existe la foto configurada: ${mediaFile}`);
            const media = mediaFactory(mediaFile);
            await client.sendMessage(outgoing.chatId, media, { caption: outgoing.body || '' });
          } else {
            await client.sendMessage(outgoing.chatId, outgoing.body);
          }
          store.markOutboxSent(outgoing.id);
        } catch (error) {
          store.markOutboxError(outgoing.id, error.message || error);
        }
      }
    });
    flushQueue = run.catch(() => {});
    return run;
  }

  function attach(client) {
    const chatLocks = new Map();
    const serialize = (chatId, work) => {
      const previous = chatLocks.get(chatId) || Promise.resolve();
      const next = previous.catch(() => {}).then(work).finally(() => {
        if (chatLocks.get(chatId) === next) chatLocks.delete(chatId);
      });
      chatLocks.set(chatId, next);
      return next;
    };

    async function processIncomingMessage(message, recovered = false) {
      const chatId = message?.from || '';
      if (message?.fromMe || !isDirectChat(chatId)) return;
      console.log(`New Customers Info: mensaje directo ${recovered ? 'recuperado' : 'recibido'} de ${maskedIdentity(chatId)}.`);
      const chat = await message.getChat().catch(() => null);
      if (chat?.isGroup) {
        console.log(`New Customers Info: ${maskedIdentity(chatId)} omitido porque no es chat directo.`);
        return;
      }
      const whatsappContact = await resolveWhatsappContact(client, chat, chatId);
      const allowed = isAllowedForTesting(chatId, whatsappContact);
      console.log(
        `New Customers Info: identidad ${maskedIdentity(whatsappContact?.phoneNumber || whatsappContact?.number || chatId)} `
        + `guardado=${whatsappContact?.isMyContact === true ? 'si' : 'no'} permitido=${allowed ? 'si' : 'no'}.`
      );
      if (!allowed) return;

      const existing = store.getContactByChat(chatId);
      const incomingCommand = normalize(message?.body);
      if (incomingCommand === START_COMMAND) {
        if (!isAdminIdentity(chatId, whatsappContact)) {
          console.log(`New Customers Info: comando administrativo rechazado para ${maskedIdentity(chatId)}.`);
          return;
        }
        activateChat({
          chatId,
          phoneE164: e164FromContact(chatId, whatsappContact),
          displayName: whatsappContact?.name || whatsappContact?.pushname || chat?.name || existing?.displayName || '',
          messageId: messageIdOf(message),
        });
        console.log(`New Customers Info: bot iniciado por administrador ${maskedIdentity(chatId)}.`);
        await flushOutbox(client);
        return;
      }
      if (incomingCommand === STOP_COMMAND) {
        if (!isAdminIdentity(chatId, whatsappContact)) {
          console.log(`New Customers Info: comando administrativo rechazado para ${maskedIdentity(chatId)}.`);
        } else if (existing) {
          stopChat({ chatId, phoneE164: e164FromContact(chatId, whatsappContact), messageId: messageIdOf(message) });
          console.log(`New Customers Info: bot detenido por comando recibido de ${maskedIdentity(chatId)}.`);
        }
        return;
      }
      if (!existing) {
        if (!shouldAutoActivate(chatId, whatsappContact)) return;
        activateChat({
          chatId,
          phoneE164: e164FromContact(chatId, whatsappContact),
          displayName: whatsappContact?.name || whatsappContact?.pushname || chat?.name || '',
          messageId: messageIdOf(message),
        });
        console.log(`New Customers Info: conversación activada para ${maskedIdentity(chatId)}.`);
      } else {
        const result = handleIncoming({ chatId, text: message.body, messageId: messageIdOf(message) });
        if (result?.reason === 'STOPPED_BY_ADMIN') {
          console.log(`New Customers Info: ${maskedIdentity(chatId)} permanece detenido por administrador.`);
        } else if (result?.reason === 'HANDOFF_REQUESTED') {
          console.log(`New Customers Info: ${maskedIdentity(chatId)} está en atención humana; el bot permanece pausado.`);
        }
      }
      await flushOutbox(client);
    }

    async function recoverAllowedMessages() {
      if (!testMode || typeof client.getChats !== 'function') return;
      if (typeof client.getNumberId === 'function') {
        for (const allowed of allowedNumbers) {
          const lookup = allowed.length === 10 ? `1${allowed}` : allowed;
          const registeredId = await client.getNumberId(lookup).catch(() => null);
          console.log(
            registeredId
              ? `New Customers Info: número autorizado ***${allowed.slice(-4)} registrado en WhatsApp como ${maskedIdentity(registeredId._serialized || registeredId)}.`
              : `New Customers Info: número autorizado ***${allowed.slice(-4)} no pudo validarse en WhatsApp.`
          );
        }
      }
      const allChats = await client.getChats().catch(() => []);
      const directChats = allChats.filter((chat) => !chat.isGroup && isDirectChat(chat?.id?._serialized || ''));
      let allowedChatsFound = 0;
      console.log(`New Customers Info: recuperación revisando ${directChats.length} chats directos recientes.`);
      for (const chat of directChats) {
        const canonicalId = chat.id?._serialized || '';
        const whatsappContact = await resolveWhatsappContact(client, chat, canonicalId);
        if (!isAllowedForTesting(canonicalId, whatsappContact)) continue;
        allowedChatsFound += 1;
        console.log(`New Customers Info: chat autorizado localizado como ${maskedIdentity(canonicalId)}.`);
        if (typeof chat.fetchMessages !== 'function') continue;
        const messages = await chat.fetchMessages({ limit: 10, fromMe: false }).catch(() => []);
        const recentCutoff = Math.floor(Date.now() / 1000) - (2 * 60 * 60);
        const pending = messages
          .filter((message) => Number(message.timestamp || 0) >= recentCutoff)
          .filter((message) => !store.isProcessed(messageIdOf(message)))
          .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
        if (!pending.length) continue;
        const existing = store.getContactByChat(canonicalId);
        const messagesToProcess = existing ? pending : [pending[pending.length - 1]];
        for (const message of messagesToProcess) {
          await serialize(message.from || canonicalId, () => processIncomingMessage(message, true));
        }
      }
      if (!allowedChatsFound) {
        console.log(`New Customers Info: no se encontró un chat directo para el número autorizado ***${allowedNumbers[0]?.slice(-4) || '----'}.`);
      }
    }

    client.on('message_create', (message) => {
      const rawChatId = message?.to || message?.id?.remote || message?.from || '';
      const chatId = typeof rawChatId === 'string' ? rawChatId : (rawChatId?._serialized || '');
      const command = normalize(message?.body);
      if (!message?.fromMe || !isDirectChat(chatId) || ![START_COMMAND, STOP_COMMAND].includes(command)) return;
      serialize(chatId, async () => {
        const chat = await message.getChat().catch(() => null);
        if (chat?.isGroup) return;
        const whatsappContact = await resolveWhatsappContact(client, chat, chatId);
        if (!isAllowedForTesting(chatId, whatsappContact)) return;
        if (command === STOP_COMMAND) {
          stopChat({
            chatId,
            phoneE164: e164FromContact(chatId, whatsappContact),
            messageId: messageIdOf(message),
          });
          console.log(`New Customers Info: bot detenido por administrador para ${maskedIdentity(chatId)}.`);
          return;
        }
        activateChat({
          chatId,
          phoneE164: e164FromContact(chatId, whatsappContact),
          displayName: whatsappContact?.name || whatsappContact?.pushname || chat?.name || '',
          messageId: messageIdOf(message),
        });
        await flushOutbox(client);
      }).catch((error) => console.error(`New Customers Info: ${error.message}`));
    });

    client.on('message', (message) => {
      const chatId = message?.from || '';
      if (message?.fromMe || !isDirectChat(chatId)) return;
      serialize(chatId, () => processIncomingMessage(message)).catch((error) => console.error(`New Customers Info: ${error.message}`));
    });

    client.on('ready', async () => {
      try {
        await recoverAllowedMessages();
        await flushOutbox(client);
      } catch (error) {
        console.error(`New Customers Info recovery: ${error.message}`);
      }
    });
    return { store };
  }

  return {
    store,
    policyInfo,
    isAllowedForTesting,
    isAdminIdentity,
    shouldAutoActivate,
    activateChat,
    stopChat,
    handleIncoming,
    flushOutbox,
    attach,
  };
}

module.exports = { createNewCustomersService, isDirectChat, normalizePhone, numberMatches };
