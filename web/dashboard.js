'use strict';

const state = {
  contacts: [],
  properties: [],
  appointments: [],
  appointmentSettings: null,
  propertyMedia: [],
  inventoryWritable: false,
  appointmentsWritable: false,
  searchTimer: null,
};
const STATUS_LABELS = {
  NUEVO: 'Nuevo',
  EN_CONVERSACION: 'En conversación',
  OPCIONES_ENVIADAS: 'Opciones enviadas',
  INTERESADO: 'Interesado',
  CITA_AGENDADA: 'Cita agendada',
  ATENCION_HUMANA: 'Atención humana',
  NO_INTERESADO: 'No interesado',
  SEGUIMIENTO: 'Seguimiento',
  CONVERTIDO: 'Convertido',
  REQUIERE_ATENCION: 'Requiere atención',
  BOT_DETENIDO: 'Bot detenido',
};
const FIELD_LABELS = {
  language: 'Esperando idioma',
  occupants: 'Esperando personas',
  parking: 'Esperando parking',
  move_in_date: 'Esperando fecha',
  next_action: 'Esperando decisión',
  appointment_property: 'Eligiendo habitación',
  appointment_date: 'Eligiendo fecha de visita',
  appointment_time: 'Eligiendo hora exacta',
  appointment_window: 'Eligiendo hora exacta',
  appointment_cancel_confirmation: 'Confirmando cancelación',
};
const EVENT_LABELS = {
  BOT_STARTED: 'Bot iniciado',
  ANSWER_SAVED: 'Respuesta guardada',
  INVALID_ANSWER: 'Respuesta no reconocida',
  OPTIONS_MATCHED: 'Opciones enviadas',
  LEAD_INTERESTED: 'Marcado como interesado',
  LEAD_NOT_INTERESTED: 'Marcado como no interesado',
  STAFF_REVIEW_REQUESTED: 'Requiere atención',
  STATUS_CHANGED_BY_ADMIN: 'Estado actualizado manualmente',
  OUTGOING_SENT: 'Mensaje enviado',
  BOT_STOPPED_BY_ADMIN: 'Bot detenido por administrador',
  APPOINTMENT_STARTED: 'Inicio de agenda',
  APPOINTMENT_PROPERTY_SELECTED: 'Habitación seleccionada',
  APPOINTMENT_DATE_SELECTED: 'Fecha seleccionada',
  APPOINTMENT_BOOKED: 'Cita agendada',
  APPOINTMENT_MODIFIED: 'Cita modificada',
  APPOINTMENT_REMINDER_SENT: 'Recordatorio de cita',
  APPOINTMENT_CANCELLATION_REQUESTED: 'Cancelación solicitada',
  APPOINTMENT_CANCELLATION_DECLINED: 'Cita conservada',
  APPOINTMENT_CANCELLED: 'Cita cancelada',
  HUMAN_HANDOFF_REQUESTED: 'Atención humana solicitada',
};
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}

function dateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function visitDate(value) {
  if (!value) return '--';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-CA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function clockTime(value) {
  const [hourText, minute] = String(value || '').split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour) || minute === undefined) return value || '--';
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}

function formatVisitTime(appointment) {
  return clockTime(appointment.visitTime || appointment.timeStart);
}

function contactName(contact) {
  return contact.displayName || contact.phoneE164 || 'Cliente sin nombre';
}

function statusOptions(selected) {
  return Object.entries(STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function conversationStage(contact) {
  if (contact.conversationStatus === 'STOPPED_BY_ADMIN') return 'Bot detenido';
  if (contact.conversationStatus === 'HANDOFF_REQUESTED') return 'Atención humana';
  if (contact.appointment) return 'Cita agendada';
  if (contact.conversationStatus === 'COMPLETE') return 'Cuestionario completo';
  return FIELD_LABELS[contact.currentFieldId] || 'Revisión manual';
}

function valueOrPending(value) {
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  return value ?? 'Pendiente';
}

function renderContacts() {
  $('resultCount').textContent = `${state.contacts.length} expediente${state.contacts.length === 1 ? '' : 's'}.`;
  if (!state.contacts.length) {
    $('contactsTable').innerHTML = '<tr class="empty-contact-row"><td colspan="12">Todavía no hay contactos. Durante las pruebas, solo 4378781645 puede activar el bot.</td></tr>';
    return;
  }

  $('contactsTable').innerHTML = state.contacts.map((contact) => {
    const appointment = contact.appointment
      ? `<div class="contact-appointment-cell"><strong>${escapeHtml(visitDate(contact.appointment.visitDate))}</strong><span>${escapeHtml(`${contact.appointment.address} · ${formatVisitTime(contact.appointment)}`)}</span></div>`
      : '<span class="property-no-photo">Sin cita</span>';
    return `<tr data-id="${escapeHtml(contact.id)}">
    <td class="client-name">${escapeHtml(contactName(contact))}</td>
    <td>${escapeHtml(contact.phoneE164 || '--')}</td>
    <td>${contact.language === 'en' ? 'English' : contact.language === 'es' ? 'Español' : 'Pendiente'}</td>
    <td>${escapeHtml(valueOrPending(contact.answers.occupants))}</td>
    <td>${escapeHtml(valueOrPending(contact.answers.parking))}</td>
    <td>${escapeHtml(valueOrPending(contact.answers.move_in_date))}</td>
    <td><select class="lead-status" data-id="${escapeHtml(contact.id)}">${statusOptions(contact.leadStatus)}</select></td>
    <td><span class="stage-pill">${escapeHtml(conversationStage(contact))}</span></td>
    <td>${appointment}</td>
    <td><span class="last-message" title="${escapeHtml(contact.lastMessage || '')}">${escapeHtml(contact.lastMessage || '--')}</span></td>
    <td>${escapeHtml(dateTime(contact.updatedAt))}</td>
    <td><div class="contact-actions"><button type="button" class="small view-contact" data-id="${escapeHtml(contact.id)}">Ver detalle</button><button type="button" class="small delete-contact" data-id="${escapeHtml(contact.id)}" ${state.appointmentsWritable ? '' : 'disabled'}>Borrar</button></div></td>
  </tr>`;
  }).join('');

  document.querySelectorAll('.lead-status').forEach((select) => {
    select.addEventListener('change', () => updateStatus(select.dataset.id, select.value));
  });
  document.querySelectorAll('.view-contact').forEach((button) => {
    button.addEventListener('click', () => openContact(button.dataset.id));
  });
  document.querySelectorAll('.delete-contact').forEach((button) => {
    button.addEventListener('click', () => deleteContact(button.dataset.id));
  });
}

function money(value) {
  return Number(value) > 0 ? `$${Number(value).toLocaleString('en-CA')} CAD` : '--';
}

function renderProperties() {
  const available = state.properties.filter((property) => property.available).length;
  const imageCount = state.properties.reduce((total, property) => total + (property.mediaItems || []).length, 0);
  $('metricAvailableProperties').textContent = available;
  $('metricUnavailableProperties').textContent = state.properties.length - available;
  $('metricPropertyImages').textContent = imageCount;

  if (!state.properties.length) {
    $('propertiesTable').innerHTML = '<tr class="empty-contact-row"><td colspan="10">No se pudo cargar el inventario autorizado.</td></tr>';
    return;
  }

  $('propertiesTable').innerHTML = state.properties.map((property) => {
    const photos = (property.mediaItems || []).slice(0, 3)
      .map((media) => `<img class="property-photo-thumb" src="${escapeHtml(media.mediaUrl)}" alt="${escapeHtml(media.mediaName || property.room)}" loading="lazy" />`)
      .join('');
    return `<tr data-id="${escapeHtml(property.id)}">
      <td><label class="property-availability"><input class="property-available-toggle" data-id="${escapeHtml(property.id)}" type="checkbox" ${property.available ? 'checked' : ''} ${state.inventoryWritable ? '' : 'disabled'} />${property.available ? 'Sí' : 'No'}</label></td>
      <td class="property-address-cell">${escapeHtml(property.address)}</td>
      <td>${escapeHtml(property.room)}</td>
      <td>${escapeHtml(property.maxOccupants)}</td>
      <td>${property.parkingSpaces ? escapeHtml(property.parkingSpaces) : 'Sin parking'}</td>
      <td>${escapeHtml(money(property.prices[1]))}</td>
      <td>${escapeHtml(money(property.prices[2]))}</td>
      <td><div class="property-photo-stack">${photos || '<span class="property-no-photo">Sin fotos</span>'}</div></td>
      <td>${escapeHtml(dateTime(property.updatedAt))}</td>
      <td><button type="button" class="small edit-property" data-id="${escapeHtml(property.id)}" ${state.inventoryWritable ? '' : 'disabled'}>Editar</button></td>
    </tr>`;
  }).join('');

  document.querySelectorAll('.property-available-toggle').forEach((input) => {
    input.addEventListener('change', () => updatePropertyAvailability(input.dataset.id, input.checked));
  });
  document.querySelectorAll('.edit-property').forEach((button) => {
    button.addEventListener('click', () => openProperty(button.dataset.id));
  });
}

async function loadProperties() {
  try {
    const data = await request('/api/new-customers-info/properties');
    const properties = Array.isArray(data.properties) ? data.properties : [];
    state.inventoryWritable = properties.length > 0
      && properties.every((property) => Object.prototype.hasOwnProperty.call(property, 'available'));
    state.properties = properties.map((property) => ({
      ...property,
      available: property.available !== false,
      mediaItems: Array.isArray(property.mediaItems) ? property.mediaItems : [],
    }));
    $('propertiesRuntimeNotice').classList.toggle('hidden', state.inventoryWritable);
    renderProperties();
  } catch (error) {
    showToast(error.message);
  }
}

function setAppointmentFormDisabled(disabled) {
  $('appointmentSettingsForm').querySelectorAll('input, button').forEach((element) => { element.disabled = disabled; });
}

function renderAppointmentSettings() {
  const settings = state.appointmentSettings;
  if (!settings) return;
  $('appointmentStartDate').value = settings.startDate;
  $('appointmentEndDate').value = settings.endDate;
  document.querySelectorAll('input[name="appointmentWeekday"]').forEach((input) => {
    input.checked = settings.weekdays.includes(Number(input.value));
  });
  const first = settings.timeWindows[0] || { start: '', end: '' };
  const second = settings.timeWindows[1] || { start: '', end: '' };
  $('appointmentWindowOneStart').value = first.start;
  $('appointmentWindowOneEnd').value = first.end;
  $('appointmentWindowTwoStart').value = second.start;
  $('appointmentWindowTwoEnd').value = second.end;
  $('metricAppointmentRange').textContent = `${settings.startDate.slice(5)} — ${settings.endDate.slice(5)}`;
  const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  $('metricAppointmentDays').textContent = settings.weekdays.map((day) => dayLabels[day]).join(', ');
  $('metricAppointmentWindows').textContent = settings.timeWindows.length;
}

function renderAppointments() {
  $('metricScheduledAppointments').textContent = state.appointments.length;
  if (!state.appointments.length) {
    $('appointmentsTable').innerHTML = '<tr class="empty-contact-row"><td colspan="8">Todavía no hay visitas agendadas.</td></tr>';
    return;
  }
  $('appointmentsTable').innerHTML = state.appointments.map((appointment) => `<tr>
    <td class="client-name">${escapeHtml(appointment.contactName || 'Cliente sin nombre')}</td>
    <td>${escapeHtml(appointment.phoneE164 || '--')}</td>
    <td class="appointment-property-cell">${escapeHtml(appointment.address)}</td>
    <td>${escapeHtml(appointment.room)}</td>
    <td>${escapeHtml(visitDate(appointment.visitDate))}</td>
    <td>${escapeHtml(formatVisitTime(appointment))}</td>
    <td><span class="stage-pill">Agendada</span></td>
    <td>${escapeHtml(dateTime(appointment.createdAt))}</td>
  </tr>`).join('');
}

async function loadAppointmentDashboard() {
  try {
    const [settingsData, appointmentsData] = await Promise.all([
      request('/api/new-customers-info/appointment-settings'),
      request('/api/new-customers-info/appointments?status=SCHEDULED'),
    ]);
    state.appointmentSettings = settingsData.settings;
    state.appointments = appointmentsData.appointments;
    state.appointmentsWritable = true;
    $('appointmentsRuntimeNotice').classList.add('hidden');
    $('contactsRuntimeNotice').classList.add('hidden');
    setAppointmentFormDisabled(false);
    renderAppointmentSettings();
    renderAppointments();
    renderContacts();
  } catch (error) {
    state.appointmentsWritable = false;
    $('appointmentsRuntimeNotice').classList.remove('hidden');
    $('contactsRuntimeNotice').classList.remove('hidden');
    setAppointmentFormDisabled(true);
    $('appointmentsTable').innerHTML = '<tr class="empty-contact-row"><td colspan="8">Reinicia el servicio web para cargar las citas.</td></tr>';
    renderContacts();
    showToast(error.message);
  }
}

async function saveAppointmentSettings(event) {
  event.preventDefault();
  if (!state.appointmentsWritable) return;
  const weekdays = Array.from(document.querySelectorAll('input[name="appointmentWeekday"]:checked')).map((input) => Number(input.value));
  const button = $('saveAppointmentSettingsButton');
  button.disabled = true;
  button.textContent = 'Guardando...';
  try {
    const data = await request('/api/new-customers-info/appointment-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: $('appointmentStartDate').value,
        endDate: $('appointmentEndDate').value,
        weekdays,
        timeWindows: [
          { id: 'morning', start: $('appointmentWindowOneStart').value, end: $('appointmentWindowOneEnd').value },
          { id: 'evening', start: $('appointmentWindowTwoStart').value, end: $('appointmentWindowTwoEnd').value },
        ],
        timezone: state.appointmentSettings?.timezone || 'America/Toronto',
      }),
    });
    state.appointmentSettings = data.settings;
    renderAppointmentSettings();
    showToast('Disponibilidad de visitas actualizada.');
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Guardar disponibilidad';
  }
}

function selectAdminView(name) {
  const views = ['contacts', 'properties', 'appointments'];
  views.forEach((view) => {
    const selected = name === view;
    $(`${view}View`).classList.toggle('active', selected);
    const button = $(`show${view[0].toUpperCase()}${view.slice(1)}Button`);
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  if (name === 'properties') loadProperties();
  if (name === 'appointments') loadAppointmentDashboard();
}

function syncPriceTwoField() {
  const forTwo = $('propertyMaxOccupants').value === '2';
  $('propertyPriceTwoField').classList.toggle('hidden', !forTwo);
  $('propertyPriceTwo').required = forTwo;
}

function renderPropertyImages() {
  $('propertyImagesPreview').innerHTML = state.propertyMedia.length
    ? state.propertyMedia.map((media, index) => `<article class="property-image-card">
        <img src="${escapeHtml(media.mediaUrl)}" alt="${escapeHtml(media.mediaName || 'Foto de la oferta')}" />
        <span title="${escapeHtml(media.mediaName || '')}">${escapeHtml(media.mediaName || 'Foto')}</span>
        <button type="button" class="remove-property-image" data-index="${index}">Quitar</button>
      </article>`).join('')
    : '<div class="property-images-empty">Esta oferta todavía no tiene fotos.</div>';
  document.querySelectorAll('.remove-property-image').forEach((button) => {
    button.addEventListener('click', () => {
      state.propertyMedia.splice(Number(button.dataset.index), 1);
      renderPropertyImages();
    });
  });
}

function openProperty(id) {
  const property = state.properties.find((item) => item.id === id);
  if (!property) return;
  $('propertyId').value = property.id;
  $('propertyAddress').value = property.address;
  $('propertyRoom').value = property.room;
  $('propertyAvailable').value = String(property.available);
  $('propertyMaxOccupants').value = String(property.maxOccupants);
  $('propertyParkingSpaces').value = String(property.parkingSpaces);
  $('propertyPriceOne').value = String(property.prices[1] || '');
  $('propertyPriceTwo').value = String(property.prices[2] || '');
  $('propertyImages').value = '';
  $('propertyDialogTitle').textContent = property.address;
  $('propertyDialogSubtitle').textContent = `${property.room} · Oferta fija ${property.id}`;
  state.propertyMedia = (property.mediaItems || []).map((media) => ({ ...media }));
  syncPriceTwoField();
  renderPropertyImages();
  $('propertyDialog').showModal();
}

function closePropertyDialog() {
  $('propertyDialog').close();
  $('propertyImages').value = '';
  state.propertyMedia = [];
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function uploadPropertyImages(files) {
  const uploaded = [];
  for (const file of files) {
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name} supera el máximo de 12 MB.`);
    const dataUrl = await fileAsDataUrl(file);
    const result = await request('/api/uploads/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, dataUrl }),
    });
    uploaded.push(result.image);
  }
  return uploaded;
}

async function saveProperty(event) {
  event.preventDefault();
  const saveButton = $('savePropertyButton');
  const files = Array.from($('propertyImages').files || []);
  if (state.propertyMedia.length + files.length > 8) {
    showToast('Puedes configurar hasta 8 fotos por oferta.');
    return;
  }
  saveButton.disabled = true;
  saveButton.textContent = files.length ? 'Subiendo fotos...' : 'Guardando...';
  try {
    const uploaded = await uploadPropertyImages(files);
    const maxOccupants = Number($('propertyMaxOccupants').value);
    const payload = {
      address: $('propertyAddress').value.trim(),
      room: $('propertyRoom').value.trim(),
      available: $('propertyAvailable').value === 'true',
      maxOccupants,
      parkingSpaces: Number($('propertyParkingSpaces').value),
      prices: {
        1: Number($('propertyPriceOne').value),
        2: maxOccupants === 2 ? Number($('propertyPriceTwo').value) : null,
      },
      mediaItems: [...state.propertyMedia, ...uploaded],
    };
    const data = await request(`/api/new-customers-info/properties/${encodeURIComponent($('propertyId').value)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const index = state.properties.findIndex((property) => property.id === data.property.id);
    if (index >= 0) state.properties[index] = data.property;
    renderProperties();
    closePropertyDialog();
    showToast('Oferta actualizada. El bot ya usará estos datos.');
  } catch (error) {
    showToast(error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Guardar cambios';
  }
}

async function updatePropertyAvailability(id, available) {
  try {
    const data = await request(`/api/new-customers-info/properties/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available }),
    });
    const index = state.properties.findIndex((property) => property.id === id);
    if (index >= 0) state.properties[index] = data.property;
    renderProperties();
    showToast(available ? 'Oferta activada.' : 'Oferta retirada de las recomendaciones.');
  } catch (error) {
    showToast(error.message);
    await loadProperties();
  }
}

function renderDetail(contact, history) {
  const propertyById = new Map(state.properties.map((property) => [property.id, property]));
  const matches = contact.matchIds.map((id) => propertyById.get(id)).filter(Boolean);
  $('detailTitle').textContent = contactName(contact);
  $('detailSubtitle').textContent = `${contact.phoneE164 || 'Sin teléfono'} · Creado ${dateTime(contact.createdAt)}`;
  const appointmentCard = contact.appointment
    ? `<div class="appointment-detail-card"><strong>Visita agendada: ${escapeHtml(`${contact.appointment.address} · ${contact.appointment.room}`)}</strong><span>${escapeHtml(`${visitDate(contact.appointment.visitDate)} · ${formatVisitTime(contact.appointment)}`)}</span></div>`
    : '';
  $('detailContent').innerHTML = `
    <div class="customer-detail-grid">
      <div class="customer-detail-item"><span>Estado</span><strong>${escapeHtml(STATUS_LABELS[contact.leadStatus] || contact.leadStatus)}</strong></div>
      <div class="customer-detail-item"><span>Idioma</span><strong>${contact.language === 'en' ? 'English' : contact.language === 'es' ? 'Español' : 'Pendiente'}</strong></div>
      <div class="customer-detail-item"><span>Personas</span><strong>${escapeHtml(valueOrPending(contact.answers.occupants))}</strong></div>
      <div class="customer-detail-item"><span>Parking</span><strong>${escapeHtml(valueOrPending(contact.answers.parking))}</strong></div>
      <div class="customer-detail-item"><span>Fecha de entrada</span><strong>${escapeHtml(valueOrPending(contact.answers.move_in_date))}</strong></div>
      <div class="customer-detail-item"><span>Etapa</span><strong>${escapeHtml(conversationStage(contact))}</strong></div>
      <div class="customer-detail-item"><span>Último mensaje</span><strong>${escapeHtml(contact.lastMessage || '--')}</strong></div>
      <div class="customer-detail-item"><span>Actualizado</span><strong>${escapeHtml(dateTime(contact.updatedAt))}</strong></div>
    </div>
    ${appointmentCard}
    <h3>Opciones enviadas (${matches.length})</h3>
    <div class="customer-options">${matches.length ? matches.map((property) => {
      const price = property.prices[String(contact.answers.occupants)] || property.prices[contact.answers.occupants];
      const images = (property.mediaItems || []).map((media) => `<img class="customer-option-image" src="${escapeHtml(media.mediaUrl)}" alt="${escapeHtml(`${property.address} ${property.room}`)}" loading="lazy" />`).join('');
      return `<article class="customer-option">${images}<strong>${escapeHtml(property.address)} · ${escapeHtml(property.room)}</strong><span>${price ? `$${Number(price).toLocaleString('en-CA')} CAD` : 'Precio pendiente'} · ${property.parkingSpaces ? `${property.parkingSpaces} parking` : 'Sin parking'}</span></article>`;
    }).join('') : '<article class="customer-option"><span>Aún no se han calculado opciones.</span></article>'}</div>
    <h3>Actividad reciente</h3>
    <div class="customer-activity">${history.length ? history.slice(0, 20).map((event) => `<div class="customer-event"><strong>${escapeHtml(EVENT_LABELS[event.eventType] || event.eventType)}</strong><span>${escapeHtml(event.messageText || '--')}</span><time>${escapeHtml(dateTime(event.createdAt))}</time></div>`).join('') : '<div class="customer-event"><span>Sin actividad registrada.</span></div>'}</div>`;
}

async function openContact(id) {
  try {
    const data = await request(`/api/new-customers-info/contacts/${encodeURIComponent(id)}`);
    renderDetail(data.contact, data.history);
    $('contactDetailDialog').showModal();
  } catch (error) {
    showToast(error.message);
  }
}

async function updateStatus(id, status) {
  try {
    await request(`/api/new-customers-info/contacts/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    showToast('Estado actualizado.');
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
    await loadDashboard();
  }
}

async function deleteContact(id) {
  const contact = state.contacts.find((item) => item.id === id);
  const label = contactName(contact || {});
  const appointmentWarning = contact?.appointment ? ' También se borrará su cita agendada.' : '';
  if (!window.confirm(`¿Borrar a ${label} del dashboard? Se eliminarán sus respuestas y actividad.${appointmentWarning}`)) return;
  try {
    await request(`/api/new-customers-info/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Contacto borrado del dashboard.');
    await Promise.all([loadDashboard(), state.appointmentsWritable ? loadAppointmentDashboard() : Promise.resolve()]);
  } catch (error) {
    showToast(error.message);
  }
}

async function loadDashboard() {
  const params = new URLSearchParams();
  if ($('statusFilter').value) params.set('status', $('statusFilter').value);
  if ($('searchInput').value.trim()) params.set('search', $('searchInput').value.trim());
  try {
    const [contactsData, stats] = await Promise.all([
      request(`/api/new-customers-info/contacts?${params}`),
      request('/api/new-customers-info/stats'),
    ]);
    state.contacts = contactsData.contacts;
    $('metricTotal').textContent = stats.total;
    $('metricActive').textContent = stats.active;
    $('metricInterested').textContent = stats.interested;
    $('metricAttention').textContent = stats.needsAttention;
    renderContacts();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadSystemStatus() {
  const pill = $('workerStatus');
  try {
    const status = await request('/api/status');
    pill.className = 'status-pill';
    if (status.paused) {
      pill.textContent = 'Sistema pausado';
      pill.classList.add('paused');
    } else if (status.running) {
      pill.textContent = `Servicio: corriendo (PID ${status.pid || '--'})`;
      pill.classList.add('ok');
    } else {
      pill.textContent = 'Servicio: detenido';
      pill.classList.add('bad');
    }
  } catch {
    pill.textContent = 'Servicio: estado no disponible';
    pill.className = 'status-pill bad';
  }
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}

$('refreshButton').addEventListener('click', () => { loadDashboard(); loadSystemStatus(); });
$('statusFilter').addEventListener('change', loadDashboard);
$('searchInput').addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadDashboard, 250);
});
$('showContactsButton').addEventListener('click', () => selectAdminView('contacts'));
$('showPropertiesButton').addEventListener('click', () => selectAdminView('properties'));
$('showAppointmentsButton').addEventListener('click', () => selectAdminView('appointments'));
$('refreshPropertiesButton').addEventListener('click', loadProperties);
$('refreshAppointmentsButton').addEventListener('click', loadAppointmentDashboard);
$('appointmentSettingsForm').addEventListener('submit', saveAppointmentSettings);
$('propertyMaxOccupants').addEventListener('change', syncPriceTwoField);
$('propertyForm').addEventListener('submit', saveProperty);
$('closePropertyDialog').addEventListener('click', closePropertyDialog);
$('cancelPropertyButton').addEventListener('click', closePropertyDialog);

Promise.all([loadProperties(), loadAppointmentDashboard(), loadDashboard(), loadSystemStatus()])
  .catch((error) => showToast(error.message));
setInterval(() => { loadDashboard(); loadSystemStatus(); }, 30000);
