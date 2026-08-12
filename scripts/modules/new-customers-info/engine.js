'use strict';

const { matchProperties } = require('./catalog');
const { formatClock, formatDate } = require('./appointment-schedule');

const START_COMMAND = 'start bot';
const START_COMMAND_ALIASES = Object.freeze([START_COMMAND, 'iniciar bot', 'inciair bot', 'inicia bot']);
const STOP_COMMAND = 'stop bot';

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function languageFrom(value) {
  const text = normalize(value);
  if (/^(1|en|english|ingles)$/.test(text) || text.includes('english') || text.includes('ingles')) return 'en';
  if (/^(2|es|spanish|espanol)$/.test(text) || text.includes('spanish') || text.includes('espanol')) return 'es';
  return null;
}

function occupantsFrom(value) {
  const text = normalize(value);
  if (/\b(2|two|dos|couple|pareja)\b/.test(text)) return 2;
  if (/\b(1|one|uno|una)\b/.test(text)) return 1;
  return null;
}

function booleanFrom(value) {
  const text = normalize(value);
  if (/^(no|n|0)$/.test(text) || /\b(no necesito|dont need|do not need|without|sin parking)\b/.test(text)) return false;
  if (/^(si|s|yes|y|1)$/.test(text) || /\b(si|yes|necesito|need)\b/.test(text)) return true;
  return null;
}

function isPositiveInterest(value) {
  return /\b(me interesa|interesado|interesada|i am interested|im interested|quiero verla|quiero ver|agendar|reservar|book|visita|appointment)\b/.test(normalize(value));
}

function isNegativeInterest(value) {
  return /\b(no me interesa|not interested|ninguna|none|no gracias|no thanks)\b/.test(normalize(value));
}

function isHumanRequest(value) {
  const text = normalize(value);
  return /^(persona|person|human|humano|staff|equipo|agente|asesor|asesora)$/.test(text)
    || /\b(hablar|comunicar|contactar|speak|talk)\b.*\b(persona|equipo|asesor|asesora|agente|humano|human|staff|team|representative|someone)\b/.test(text)
    || /\b(miembro del equipo|team member|atencion humana|human assistance)\b/.test(text);
}

function isModifyRequest(value) {
  return /\b(modificar|cambiar|reagendar|change|modify|reschedule)\b/.test(normalize(value));
}

function isCancelRequest(value) {
  return /\b(cancelar|cancela|cancelacion|cancel|remove appointment)\b/.test(normalize(value));
}

function prompt(language, key) {
  const messages = {
    occupants: {
      es: 'Todas nuestras casas se encuentran en Brampton. Vamos a hacerle unas preguntas para ofrecerle las opciones que cumplan con sus necesidades; después le compartiremos precios y fotos.\n\n1. ¿La habitación es para una o dos personas?',
      en: 'All our houses are located in Brampton. We will ask a few questions so we can offer the options that fit your needs; then we will share prices and photos.\n\n1. Is the room for one or two people?',
    },
    parking: {
      es: '2. ¿Necesita espacio de estacionamiento? Responda Sí o No.',
      en: '2. Do you need a parking space? Please answer Yes or No.',
    },
    moveIn: {
      es: '3. ¿En qué fecha necesita mudarse? Por ejemplo: 1 de septiembre.',
      en: '3. What date do you need to move in? For example: September 1.',
    },
  };
  return messages[key][language];
}

function welcome() {
  return 'Welcome to Confort Place. Would you like to be attended in English or Spanish?\n\nBienvenido a Confort Place. ¿Gusta atención en inglés o español?\n\nReply / Responda: English o Español.';
}

function invalid(language, key) {
  const es = {
    language: 'Por favor responda English o Español.',
    occupants: 'Por favor indique si la habitación es para 1 o 2 personas.',
    parking: 'Por favor responda Sí o No.',
    moveIn: 'Por favor escriba la fecha en la que necesita mudarse.',
  };
  const en = {
    language: 'Please reply English or Español.',
    occupants: 'Please tell us whether the room is for 1 or 2 people.',
    parking: 'Please answer Yes or No.',
    moveIn: 'Please type the date when you need to move in.',
  };
  return (language === 'en' ? en : es)[key];
}

function localizedRoom(room, language) {
  const original = String(room || '').trim();
  const key = normalize(original);
  const number = key.match(/^(?:habitacion|room)\s*#?\s*(\d+)$/)?.[1];
  if (number) return language === 'en' ? `Room #${number}` : `Habitación #${number}`;
  if (['habitacion disponible', 'available room'].includes(key)) {
    return language === 'en' ? 'Available room' : 'Habitación disponible';
  }
  if (['habitacion para una persona o pareja', 'room for one person or a couple'].includes(key)) {
    return language === 'en' ? 'Room for one person or a couple' : 'Habitación para una persona o pareja';
  }
  if (language === 'en') return original.replace(/^Habitaci[oó]n\b/i, 'Room');
  return original.replace(/^Room\b/i, 'Habitación');
}

function localizedCapacity(property, language) {
  if (Number(property?.maxOccupants) >= 2) {
    return language === 'en' ? 'For one person or a couple' : 'Para una persona o pareja';
  }
  return language === 'en' ? 'For one person' : 'Para una persona';
}

function locationOption(property, language) {
  const room = localizedRoom(property.room, language);
  const numberedRoom = /#\s*\d+/.test(room) ? ` - ${room}` : '';
  return `${property.address} - ${localizedCapacity(property, language)}${numberedRoom}`;
}

function locationOptionsPrompt(language, matches) {
  if (!matches.length) {
    return language === 'en'
      ? 'Thank you. We do not currently have an exact match for those requirements.'
      : 'Gracias. Por el momento no tenemos una opción que coincida exactamente con esos requisitos.';
  }
  const intro = language === 'en'
    ? 'These are the available locations that match your needs:'
    : 'Estas son las ubicaciones disponibles que cumplen con sus necesidades:';
  const items = matches.map((property, index) => `${index + 1}. ${locationOption(property, language)}`);
  const question = language === 'en'
    ? 'Which location interests you most? Reply with its number.'
    : '¿Cuál ubicación le interesa más? Responda con su número.';
  return [intro, '', ...items, '', question].join('\n');
}

function propertyPricing(language, answers, property) {
  const price = (occupants) => `$${property.prices[occupants].toLocaleString('en-CA')} CAD`;
  if (Number(property.maxOccupants) >= 2 && property.prices[1] && property.prices[2]) {
    return language === 'en'
      ? `Price for one person: *${price(1)}*\nPrice for a couple: *${price(2)}*`
      : `Precio para una persona: *${price(1)}*\nPrecio para una pareja: *${price(2)}*`;
  }
  return language === 'en'
    ? `Price for one person: *${price(answers.occupants)}*`
    : `Precio para una persona: *${price(answers.occupants)}*`;
}

function selectedPropertyDetails(language, answers, property) {
  const pricing = propertyPricing(language, answers, property);
  return language === 'en'
    ? `Here is the information for the room you selected:\n\n*${property.address}*\n${localizedRoom(property.room, 'en')}\n${pricing}`
    : `Esta es la información de la habitación que seleccionó:\n\n*${property.address}*\n${localizedRoom(property.room, 'es')}\n${pricing}`;
}

function mediaForProperty(language, answers, property) {
  return (property.mediaItems || []).map((media, index) => ({
    mediaPath: media.mediaPath,
    mediaName: media.mediaName,
    body: index === 0
      ? `${property.address}\n${localizedRoom(property.room, language)}\n${propertyPricing(language, answers, property)}`
      : '',
  }));
}

function nextActionPrompt(language, hasMatches) {
  if (!hasMatches) {
    return language === 'en'
      ? 'Would you like to speak with a member of our team here in the chat? Reply PERSON.'
      : '¿Desea hablar con un miembro de nuestro equipo aquí en el chat? Responda PERSONA.';
  }
  return language === 'en'
    ? 'Would you like to schedule a visit to this room?\n\nReply YES to schedule, NO to finish, or PERSON to speak with a team member here in the chat.'
    : '¿Le gustaría agendar una visita a esta habitación?\n\nResponda SÍ para agendar, NO para finalizar o PERSONA para hablar con un miembro del equipo aquí en el chat.';
}

function matchingOptions(contact, properties) {
  const byId = new Map((properties || []).filter((property) => property.available !== false).map((property) => [property.id, property]));
  return (contact.matchIds || []).map((id) => byId.get(id)).filter(Boolean);
}

function propertyPrompt(language, options) {
  const list = options.map((property, index) => `${index + 1}. ${locationOption(property, language)}`).join('\n');
  return language === 'en'
    ? `Which room would you like to visit? Reply with its number:\n\n${list}`
    : `¿Qué habitación desea visitar? Responda con su número:\n\n${list}`;
}

function propertyChoice(value, options) {
  const text = normalize(value);
  const match = text.match(/(?:^|\b)(?:opcion|option|numero|number|#)\s*#?\s*(\d+)\b/) || text.match(/^\s*(\d+)\s*$/);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return options[index] || null;
}

function datePrompt(language, availability) {
  const dates = (availability?.dates || []).map((entry) => entry.date);
  if (!dates.length) return null;
  const list = dates.map((date, index) => `${index + 1}. ${formatDate(date, language)}`).join('\n');
  return language === 'en'
    ? `Select an available visit date by replying with its number:\n\n${list}`
    : `Seleccione una fecha disponible para la visita respondiendo con su número:\n\n${list}`;
}

function dateChoice(value, availability) {
  const dates = (availability?.dates || []).map((entry) => entry.date);
  const text = normalize(value);
  if (dates.includes(text)) return text;
  const exactNumber = text.match(/^\s*(\d+)\s*$/);
  if (exactNumber) {
    const number = Number(exactNumber[1]);
    if (number >= 1 && number <= dates.length) return dates[number - 1];
    const byDay = dates.find((date) => Number(date.slice(-2)) === number);
    if (byDay) return byDay;
  }
  const dayMatch = text.match(/\b([0-3]?\d)(?:\s+de)?\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (dayMatch) {
    const monthNames = ['enero january', 'febrero february', 'marzo march', 'abril april', 'mayo may', 'junio june', 'julio july', 'agosto august', 'septiembre september', 'octubre october', 'noviembre november', 'diciembre december'];
    const month = monthNames.findIndex((names) => names.includes(dayMatch[2])) + 1;
    const byDate = dates.find((date) => Number(date.slice(5, 7)) === month && Number(date.slice(-2)) === Number(dayMatch[1]));
    if (byDate) return byDate;
  }
  return null;
}

function timePrompt(language, availability, date) {
  const slots = availability?.dates?.find((entry) => entry.date === date)?.times || [];
  if (!slots.length) return null;
  const list = slots.map((slot, index) => `${index + 1}. ${formatClock(slot.time)}`).join('\n');
  return language === 'en'
    ? `What exact time would you like to visit? Reply with the number of an available time:\n\n${list}`
    : `¿A qué hora exacta desea realizar la visita? Responda con el número de una hora disponible:\n\n${list}`;
}

function timeChoice(value, availability, date) {
  const slots = availability?.dates?.find((entry) => entry.date === date)?.times || [];
  const text = normalize(value);
  const clock = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] || 0);
    const suffix = String(clock[3] || '').replace(/[.\s]/g, '');
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    const candidates = [`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`];
    if (!suffix && hour >= 1 && hour <= 8) candidates.push(`${String(hour + 12).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    const byClock = slots.find((slot) => candidates.includes(slot.time));
    if (byClock) return byClock;
  }
  const exact = text.match(/^\s*(\d+)\s*$/);
  if (exact && slots[Number(exact[1]) - 1]) return slots[Number(exact[1]) - 1];
  return null;
}

function appointmentSummary(appointment, language) {
  const place = `${appointment.address} - ${localizedRoom(appointment.room, language)}`;
  const visitTime = formatClock(appointment.visitTime || appointment.timeStart);
  return language === 'en'
    ? `You currently have a visit scheduled for *${place}* on *${formatDate(appointment.visitDate, 'en')}* at *${visitTime}*.\n\nReply MODIFY to reschedule, CANCEL to cancel it, or PERSON to speak with our team.`
    : `Actualmente tiene una visita agendada para *${place}* el *${formatDate(appointment.visitDate, 'es')}* a las *${visitTime}*.\n\nResponda MODIFICAR para reagendar, CANCELAR para cancelarla o PERSONA para hablar con nuestro equipo.`;
}

function handoffTransition(contact, answers, language) {
  return {
    ...contact,
    answers,
    currentFieldId: null,
    conversationStatus: 'HANDOFF_REQUESTED',
    leadStatus: 'ATENCION_HUMANA',
    outgoing: [language === 'en'
      ? 'Of course. The bot is now paused for this chat. A member of our team will continue with you here as soon as possible.'
      : 'Claro. El bot queda pausado para este chat. Un miembro de nuestro equipo continuará la conversación aquí lo antes posible.'],
    auditType: 'HUMAN_HANDOFF_REQUESTED',
  };
}

function beginAppointment(contact, answers, language, properties, availability, initialText = '', preferredPropertyId = '') {
  const options = matchingOptions(contact, properties);
  if (!options.length) return handoffTransition(contact, answers, language);
  const selected = options.find((property) => property.id === preferredPropertyId)
    || propertyChoice(initialText, options)
    || (options.length === 1 ? options[0] : null);
  if (!selected) {
    return { ...contact, answers, currentFieldId: 'appointment_property', conversationStatus: 'ACTIVE', leadStatus: 'INTERESADO', outgoing: [propertyPrompt(language, options)], auditType: 'APPOINTMENT_STARTED' };
  }
  answers.appointment_property_id = selected.id;
  const datesMessage = datePrompt(language, availability);
  if (!datesMessage) return handoffTransition(contact, answers, language);
  return { ...contact, answers, currentFieldId: 'appointment_date', conversationStatus: 'ACTIVE', leadStatus: 'INTERESADO', outgoing: [datesMessage], auditType: 'APPOINTMENT_PROPERTY_SELECTED' };
}

function activate() {
  return {
    currentFieldId: 'language', conversationStatus: 'ACTIVE', leadStatus: 'NUEVO', answers: {},
    outgoing: [welcome()], auditType: 'BOT_STARTED', matches: [],
  };
}

function handleText(contact, incomingText, properties, appointmentAvailability) {
  const availability = appointmentAvailability;
  const answers = { ...(contact.answers || {}) };
  const language = contact.language || answers.language || 'es';
  const field = contact.currentFieldId;

  if (isHumanRequest(incomingText)) return handoffTransition(contact, answers, language);

  if (field === 'appointment_cancel_confirmation') {
    const confirmed = booleanFrom(incomingText);
    if (confirmed === null) {
      return { ...contact, answers, outgoing: [language === 'en' ? 'Please reply YES to cancel the visit or NO to keep it.' : 'Responda SÍ para cancelar la visita o NO para conservarla.'], auditType: 'INVALID_ANSWER' };
    }
    if (!confirmed) {
      return { ...contact, answers, currentFieldId: null, conversationStatus: 'COMPLETE', leadStatus: 'CITA_AGENDADA', outgoing: [appointmentSummary(contact.appointment, language)], auditType: 'APPOINTMENT_CANCELLATION_DECLINED' };
    }
    return {
      ...contact, answers: {}, matches: [], language: null, currentFieldId: null,
      conversationStatus: 'COMPLETE', leadStatus: 'CITA_CANCELADA',
      appointmentAction: { type: 'CANCEL' },
      resetConversationData: true,
      outgoing: [language === 'en' ? 'Your visit has been cancelled. If you need anything else, write to us again.' : 'Su visita fue cancelada. Si necesita algo más, puede volver a escribirnos.'],
      auditType: 'APPOINTMENT_CANCELLED',
    };
  }

  if (field === 'property_interest') {
    const options = matchingOptions(contact, properties);
    const selected = propertyChoice(incomingText, options);
    if (!selected) {
      return { ...contact, answers, outgoing: [locationOptionsPrompt(language, options)], auditType: 'INVALID_ANSWER' };
    }
    answers.selected_property_id = selected.id;
    const media = mediaForProperty(language, answers, selected);
    return {
      ...contact,
      answers,
      currentFieldId: 'next_action',
      conversationStatus: 'ACTIVE',
      leadStatus: 'INTERESADO',
      outgoing: [
        ...(media.length ? media : [selectedPropertyDetails(language, answers, selected)]),
        nextActionPrompt(language, true),
      ],
      auditType: 'PROPERTY_INTEREST_SELECTED',
    };
  }

  if (field === 'appointment_property') {
    const options = matchingOptions(contact, properties);
    const selected = propertyChoice(incomingText, options);
    if (!selected) return { ...contact, answers, outgoing: [propertyPrompt(language, options)], auditType: 'INVALID_ANSWER' };
    answers.appointment_property_id = selected.id;
    const datesMessage = datePrompt(language, availability);
    if (!datesMessage) return handoffTransition(contact, answers, language);
    return { ...contact, answers, currentFieldId: 'appointment_date', leadStatus: 'INTERESADO', outgoing: [datesMessage], auditType: 'APPOINTMENT_PROPERTY_SELECTED' };
  }

  if (field === 'appointment_date') {
    const selected = dateChoice(incomingText, availability);
    if (!selected) return { ...contact, answers, outgoing: [datePrompt(language, availability)], auditType: 'INVALID_ANSWER' };
    answers.appointment_date = selected;
    return { ...contact, answers, currentFieldId: 'appointment_time', leadStatus: 'INTERESADO', outgoing: [timePrompt(language, availability, selected)], auditType: 'APPOINTMENT_DATE_SELECTED' };
  }

  if (field === 'appointment_time' || field === 'appointment_window') {
    const selected = timeChoice(incomingText, availability, answers.appointment_date);
    if (!selected) return { ...contact, answers, outgoing: [timePrompt(language, availability, answers.appointment_date)], auditType: 'INVALID_ANSWER' };
    const property = (properties || []).find((item) => item.id === answers.appointment_property_id);
    if (!property) return handoffTransition(contact, answers, language);
    answers.appointment_time = selected.time;
    const scheduled = {
      address: property.address,
      room: localizedRoom(property.room, language),
      visitDate: answers.appointment_date,
      visitTime: selected.time,
    };
    const confirmation = language === 'en'
      ? `Your visit is confirmed for *${property.address} - ${localizedRoom(property.room, 'en')}* on *${formatDate(answers.appointment_date, 'en')}* at *${formatClock(selected.time)}*. We look forward to seeing you!`
      : `Su visita quedó confirmada para *${property.address} - ${localizedRoom(property.room, 'es')}* el *${formatDate(answers.appointment_date, 'es')}* a las *${formatClock(selected.time)}*. ¡Le esperamos!`;
    return {
      ...contact, answers, currentFieldId: null, conversationStatus: 'COMPLETE', leadStatus: 'CITA_AGENDADA',
      appointmentAction: { type: 'BOOK', propertyId: property.id, visitDate: answers.appointment_date, visitTime: selected.time },
      outgoing: [confirmation], auditType: contact.appointment ? 'APPOINTMENT_MODIFIED' : 'APPOINTMENT_BOOKED',
      appointment: scheduled,
    };
  }

  if (!field && contact.appointment) {
    if (isCancelRequest(incomingText)) {
      return {
        ...contact, answers, currentFieldId: 'appointment_cancel_confirmation', conversationStatus: 'ACTIVE', leadStatus: 'CITA_AGENDADA',
        outgoing: [language === 'en' ? 'Are you sure you want to cancel your scheduled visit? Reply YES or NO.' : '¿Está seguro de que desea cancelar su visita agendada? Responda SÍ o NO.'],
        auditType: 'APPOINTMENT_CANCELLATION_REQUESTED',
      };
    }
    if (isModifyRequest(incomingText)) return beginAppointment(contact, answers, language, properties, availability);
    return { ...contact, answers, outgoing: [appointmentSummary(contact.appointment, language)], auditType: 'APPOINTMENT_REMINDER_SENT' };
  }

  if (field === 'language') {
    const selected = languageFrom(incomingText);
    if (!selected) return { ...contact, answers, outgoing: [invalid('es', 'language')], auditType: 'INVALID_ANSWER' };
    answers.language = selected;
    return { ...contact, language: selected, answers, currentFieldId: 'occupants', leadStatus: 'EN_CONVERSACION', outgoing: [prompt(selected, 'occupants')], auditType: 'ANSWER_SAVED' };
  }

  if (field === 'occupants') {
    const occupants = occupantsFrom(incomingText);
    if (!occupants) return { ...contact, answers, outgoing: [invalid(language, 'occupants')], auditType: 'INVALID_ANSWER' };
    answers.occupants = occupants;
    return { ...contact, answers, currentFieldId: 'parking', leadStatus: 'EN_CONVERSACION', outgoing: [prompt(language, 'parking')], auditType: 'ANSWER_SAVED' };
  }

  if (field === 'parking') {
    const parking = booleanFrom(incomingText);
    if (parking === null) return { ...contact, answers, outgoing: [invalid(language, 'parking')], auditType: 'INVALID_ANSWER' };
    answers.parking = parking;
    return { ...contact, answers, currentFieldId: 'move_in_date', leadStatus: 'EN_CONVERSACION', outgoing: [prompt(language, 'moveIn')], auditType: 'ANSWER_SAVED' };
  }

  if (field === 'move_in_date') {
    const moveInDate = String(incomingText || '').trim();
    if (moveInDate.length < 3) return { ...contact, answers, outgoing: [invalid(language, 'moveIn')], auditType: 'INVALID_ANSWER' };
    answers.move_in_date = moveInDate;
    const matches = matchProperties(answers, properties);
    if (!matches.length) {
      return {
        ...contact, answers, currentFieldId: 'next_action', conversationStatus: 'ACTIVE',
        leadStatus: 'REQUIERE_ATENCION', matches,
        outgoing: [locationOptionsPrompt(language, matches), nextActionPrompt(language, false)],
        auditType: 'OPTIONS_MATCHED',
      };
    }
    return {
      ...contact, answers, currentFieldId: 'property_interest', conversationStatus: 'ACTIVE',
      leadStatus: 'OPCIONES_ENVIADAS', matches,
      outgoing: [locationOptionsPrompt(language, matches)],
      auditType: 'OPTIONS_MATCHED',
    };
  }

  if (field === 'next_action') {
    if (isNegativeInterest(incomingText) || booleanFrom(incomingText) === false) {
      return { ...contact, answers, currentFieldId: null, conversationStatus: 'COMPLETE', leadStatus: 'NO_INTERESADO', outgoing: [language === 'en' ? 'Thank you for contacting Confort Place. We are here if you need us later.' : 'Gracias por contactar a Confort Place. Aquí estaremos si nos necesita más adelante.'], auditType: 'LEAD_NOT_INTERESTED' };
    }
    if (isPositiveInterest(incomingText) || booleanFrom(incomingText) === true || propertyChoice(incomingText, matchingOptions(contact, properties))) {
      return beginAppointment(contact, answers, language, properties, availability, incomingText, answers.selected_property_id);
    }
    return { ...contact, answers, outgoing: [nextActionPrompt(language, (contact.matchIds || []).length > 0)], auditType: 'INVALID_ANSWER' };
  }

  if (contact.conversationStatus === 'COMPLETE') {
    if (isPositiveInterest(incomingText)) return beginAppointment(contact, answers, language, properties, availability, incomingText);
    return {
      ...contact,
      answers,
      currentFieldId: 'next_action',
      conversationStatus: 'ACTIVE',
      outgoing: [nextActionPrompt(language, (contact.matchIds || []).length > 0)],
      auditType: 'CONVERSATION_REOPENED',
    };
  }

  return { ...contact, answers, leadStatus: 'REQUIERE_ATENCION', outgoing: [], auditType: 'STAFF_REVIEW_REQUESTED' };
}

module.exports = { START_COMMAND, START_COMMAND_ALIASES, STOP_COMMAND, activate, handleText, normalize };
