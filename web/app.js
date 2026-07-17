const state = {
  reminders: [],
  cleaningRotations: [],
  houses: [],
  categories: [],
  selectedHouses: new Set(),
  modalRow: null,
  modalMode: 'edit',
  categoryMenuOpen: false,
  houseMenuOpen: false,
  saveTimers: new Map(),
  savingRows: new Set(),
  selectedRows: new Set(),
  refreshPaused: false,
  sort: { key: 'group', direction: 'asc' },
  settings: { mode: 'production', timeStepMinutes: 30 },
  columnWidths: {},
  lastTableAutoFitSignature: '',
};

const $ = (id) => document.getElementById(id);
const DEFAULT_TIME_STEP_MINUTES = 30;
const SORT_COLUMNS = [
  { index: 1, key: 'group', label: 'Casa' },
  { index: 2, key: 'category', label: 'Categoría' },
  { index: 3, key: 'schedule', label: 'Días' },
  { index: 4, key: 'hora', label: 'Hora' },
  { index: 5, key: 'activo', label: 'Estado' },
  { index: 6, key: 'estado', label: 'Resultado' },
  { index: 7, key: 'proximoEnvio', label: 'Próximo envío' },
  { index: 8, key: 'ultimoEnvio', label: 'Último envío' },
  { index: 9, key: 'mensaje', label: 'Mensaje' },
  { index: 10, key: 'notas', label: 'Notas' },
];
const DAY_LABELS = {
  lun: 'Lunes',
  mar: 'Martes',
  mie: 'Miércoles',
  jue: 'Jueves',
  vie: 'Viernes',
  sab: 'Sábado',
  dom: 'Domingo',
};
const COLUMN_WIDTHS_STORAGE_KEY = 'confortPlaceReminderColumnWidths';
const MIN_COLUMN_WIDTH = 46;
const AUTO_FIT_LIMITS = {
  1: { min: 42, max: 54 },
  2: { min: 120, max: 280 },
  3: { min: 110, max: 220 },
  4: { min: 120, max: 260 },
  5: { min: 92, max: 130 },
  6: { min: 120, max: 170 },
  7: { min: 105, max: 150 },
  8: { min: 145, max: 245 },
  9: { min: 140, max: 260 },
  10: { min: 150, max: 245 },
  11: { min: 130, max: 220 },
  12: { min: 120, max: 155 },
};

function normalizePlain(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isCleaningCategory(value) {
  const normalized = normalizePlain(value);
  return normalized === 'limpieza rotativa' || normalized === 'liempieza rotativa';
}

function cleaningResponsibleRoom(cleaning = {}) {
  const roomCount = Math.max(1, Number(cleaning.roomCount || 1));
  const savedResponsible = Number(cleaning.currentResponsibleRoom || cleaning.lastSentRoom || 0);
  if (Number.isInteger(savedResponsible) && savedResponsible >= 1 && savedResponsible <= roomCount) {
    return savedResponsible;
  }
  const nextNotificationRoom = Math.max(1, Math.min(roomCount, Number(cleaning.currentRoom || 1)));
  return nextNotificationRoom <= 1 ? roomCount : nextNotificationRoom - 1;
}

function cleaningNotesUi(reminder, override = {}) {
  const cleaning = reminder?.cleaning || {};
  const responsible = cleaningResponsibleRoom(cleaning);
  const roomCount = Math.max(1, Number(override.roomCount || cleaning.roomCount || 1));
  const nextNotificationRoom = Math.max(1, Math.min(
    roomCount,
    Number(override.currentRoom || cleaning.currentRoom || 1)
  ));
  const lines = [
    `Esta semana el responsable es el cuarto #${responsible}.`,
    nextNotificationRoom === responsible
      ? `La próxima notificación se enviará OTRA VEZ para el cuarto #${nextNotificationRoom}.`
      : `La próxima notificación se enviará para el cuarto #${nextNotificationRoom}.`,
    'Si necesitas ajustar, usa el lápiz y cambia "Enviar próxima ejecución desde".',
  ];
  if (cleaning.lastSentAt && cleaning.lastSentRoom) {
    lines.push(`Último envío: ${cleaning.lastSentAt} | cuarto #${cleaning.lastSentRoom}.`);
  }
  return lines.join('\n');
}

function defaultCleaningTemplateUi() {
  return [
    '*🌞 Good morning everyone.*',
    '',
    'As a reminder, this weekend the cleaning is assigned to room #{{room}}.',
    'The cleaning must be done on Saturday or Sunday. If it isn’t completed on those days, you’ll need to do it later and you’ll also be responsible again next week for not following the assigned schedule.',
    'If you’d like the Clean & Clear team to handle the cleaning, the cost is *$60 CAD*. Please confirm on Saturday so it can be scheduled for Sunday.',
    'From now on, cleanings will no longer be done on Mondays.',
    '',
    'Thank you for your cooperation!',
    '',
    '-----------------------',
    '',
    '*🌞 Buenos días a todos.*',
    '',
    'Como recordatorio, este fin de semana la limpieza le corresponde a la habitación #{{room}}.',
    'La limpieza debe realizarse *el sábado o domingo*. Si no se hace en esos días, deberán realizarla después y *también les tocará nuevamente la siguiente semana* por no respetar el horario asignado.',
    'Si desean que el equipo de Clean & Clear realice la limpieza, el costo es de *$60 CAD*. Deberán confirmarlo *el sábado* para programarla el domingo.',
    'A partir de ahora ya no se realizarán limpiezas los lunes.',
    '',
    '¡Gracias por su cooperación!',
  ].join('\n');
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shortText(value, max = 95) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function timeStepMinutes() {
  const step = Number(state.settings?.timeStepMinutes || DEFAULT_TIME_STEP_MINUTES);
  return Number.isInteger(step) && step >= 1 && step <= 60 ? step : DEFAULT_TIME_STEP_MINUTES;
}

function normalizeHoraUi(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const h = Math.max(0, Math.min(23, Number(match[1])));
  const m = Math.max(0, Math.min(59, Number(match[2])));
  const total = h * 60 + m;
  const step = timeStepMinutes();
  const rounded = Math.min(23 * 60 + (60 - step), Math.max(0, Math.round(total / step) * step));
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

function timeOptions(selectedValue = '', { includeBlank = true } = {}) {
  const selected = normalizeHoraUi(selectedValue);
  const options = [];
  if (includeBlank) options.push('<option value="">Sin hora</option>');
  const step = timeStepMinutes();
  for (let total = 0; total <= 23 * 60 + (60 - step); total += step) {
    const value = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    options.push(`<option value="${value}" ${value === selected ? 'selected' : ''}>${value} hrs</option>`);
  }
  return options.join('');
}

function fillModalTimeOptions(selectedValue = '') {
  $('modalHora').innerHTML = timeOptions(selectedValue);
}

function renderFilters() {
  const current = new Set(state.selectedHouses);
  state.selectedHouses = new Set([...current].filter((h) => state.houses.includes(h)));

  $('houseFilter').innerHTML = state.houses.map((h) => `
    <label class="check-option">
      <input type="checkbox" value="${escapeHtml(h)}" ${state.selectedHouses.has(h) ? 'checked' : ''} />
      <span>${escapeHtml(h)}</span>
    </label>
  `).join('');

  const category = $('categoryFilter');
  const selectedCategory = category.value;
  category.innerHTML = '<option value="">Todas</option>' + state.categories.map((c) =>
    `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
  ).join('');
  category.value = selectedCategory;
}

function captureFilters() {
  return {
    houses: new Set(state.selectedHouses),
    category: $('categoryFilter')?.value || '',
    status: $('statusFilter')?.value || '',
    active: $('activeFilter')?.value || '',
    search: $('searchBox')?.value || '',
  };
}

function restoreFilters(filters) {
  if (!filters) return;
  state.selectedHouses = new Set([...filters.houses].filter((h) => state.houses.includes(h)));
  if ($('categoryFilter')) $('categoryFilter').value = state.categories.includes(filters.category) ? filters.category : '';
  if ($('statusFilter')) $('statusFilter').value = filters.status || '';
  if ($('activeFilter')) $('activeFilter').value = filters.active || '';
  if ($('searchBox')) $('searchBox').value = filters.search || '';
}

function scheduleSortValue(r) {
  if (r.scheduleType === 'monthly') {
    return `monthly ${(r.monthly?.weekday || '')} ${(r.monthly?.ordinals || []).join('-')}`;
  }
  if (r.scheduleType === 'interval') {
    return `interval ${r.interval?.startDate || ''} ${r.interval?.everyWeeks || ''}`;
  }
  return `weekly ${Object.entries(r.days || {})
    .filter(([, enabled]) => enabled)
    .map(([day]) => day)
    .join('-')}`;
}

function sortValue(r, key) {
  if (key === 'schedule') return scheduleSortValue(r);
  if (key === 'hora') return normalizeHoraUi(r.hora) || '99:99';
  if (key === 'activo') return r.activo === 'SI' ? 'Activo' : 'Desactivado';
  return String(r[key] ?? '').toLowerCase();
}

function sortReminders(reminders) {
  const { key, direction } = state.sort;
  const multiplier = direction === 'desc' ? -1 : 1;
  return [...reminders].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    return left.localeCompare(right, 'es', { numeric: true, sensitivity: 'base' }) * multiplier;
  });
}

function filteredReminders() {
  const category = $('categoryFilter').value;
  const status = $('statusFilter').value;
  const active = $('activeFilter').value;
  const search = $('searchBox').value.trim().toLowerCase();

  const filtered = state.reminders.filter((r) => {
    if (state.selectedHouses.size && !state.selectedHouses.has(r.filtrarCasa || r.group)) return false;
    if (category && r.category !== category) return false;
    if (status && r.estado !== status) return false;
    if (active && r.activo !== active) return false;
    if (search) {
      const haystack = `${r.group} ${r.category} ${r.mensaje} ${r.notas}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  return sortReminders(filtered);
}

function tableAutoFitSignature(reminders) {
  return JSON.stringify({
    rows: reminders.map((r) => r.row),
    houses: [...state.selectedHouses].sort(),
    category: $('categoryFilter')?.value || '',
    status: $('statusFilter')?.value || '',
    active: $('activeFilter')?.value || '',
    search: $('searchBox')?.value || '',
    sort: state.sort,
  });
}

function setModalCategory(value) {
  $('modalCategory').value = value || '';
  $('categoryComboLabel').textContent = value || 'Seleccionar categoría';
  applyModalCategoryMode();
}

function setModalHouse(value) {
  $('modalGroup').value = value || '';
  $('houseComboLabel').textContent = value || 'Seleccionar casa';
}

function renderHouseCombo() {
  const selected = $('modalGroup').value;
  const houses = [...new Set(state.houses.filter(Boolean))].sort();
  $('houseComboMenu').innerHTML = `
    <button type="button" class="combo-item add-category" data-house-action="add">+ Agregar nueva casa</button>
    ${houses.map((house) => `
      <div class="combo-row ${house === selected ? 'selected' : ''}">
        <button type="button" class="combo-item" data-house-action="select" data-house="${escapeHtml(house)}">
          ${escapeHtml(house)}
        </button>
        <button type="button" class="combo-delete" title="Eliminar casa" data-house-action="delete" data-house="${escapeHtml(house)}">🗑️</button>
      </div>
    `).join('')}
  `;
  $('houseCombo').classList.toggle('open', state.houseMenuOpen);
}

function toggleHouseCombo(force) {
  state.houseMenuOpen = typeof force === 'boolean' ? force : !state.houseMenuOpen;
  renderHouseCombo();
}

function renderCategoryCombo() {
  const selected = $('modalCategory').value;
  const categories = [...new Set(state.categories.filter(Boolean))].sort();
  $('categoryComboMenu').innerHTML = `
    <button type="button" class="combo-item add-category" data-category-action="add">+ Agregar nueva categoría</button>
    ${categories.map((category) => `
      <div class="combo-row ${category === selected ? 'selected' : ''}">
        <button type="button" class="combo-item" data-category-action="select" data-category="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
        <button type="button" class="combo-delete" title="Eliminar categoría" data-category-action="delete" data-category="${escapeHtml(category)}">🗑️</button>
      </div>
    `).join('')}
  `;
  $('categoryCombo').classList.toggle('open', state.categoryMenuOpen);
}

function toggleCategoryCombo(force) {
  state.categoryMenuOpen = typeof force === 'boolean' ? force : !state.categoryMenuOpen;
  renderCategoryCombo();
}

function dayCheckbox(r, key, label) {
  return `
    <label class="day tiny">
      <input type="checkbox" name="${key}" data-autosave ${r.days[key] ? 'checked' : ''} />
      ${label}
    </label>`;
}

function ordinalLabel(value) {
  return {
    1: '1er',
    2: '2do',
    3: '3er',
    4: '4to',
    5: '5to',
  }[Number(value)] || String(value);
}

function scheduleCell(r) {
  if (r.scheduleType === 'cleaningRotation') {
    const day = DAY_LABELS[r.cleaning?.sendDay] || DAY_LABELS.sab;
    return `<span class="schedule-pill schedule-edit" data-action="edit" title="Editar rotación de limpieza">Rotación semanal: ${escapeHtml(day)}</span>`;
  }
  if (r.scheduleType === 'interval') {
    const everyWeeks = Number(r.interval?.everyWeeks || 0);
    const startDate = r.interval?.startDate || 'fecha pendiente';
    const label = everyWeeks === 1 ? 'cada semana' : `cada ${everyWeeks || '?'} semanas`;
    return `<span class="schedule-pill schedule-edit" data-action="edit" title="Editar programacion">Intervalo: ${escapeHtml(label)} desde ${escapeHtml(startDate)}</span>`;
  }
  if (r.scheduleType === 'monthly') {
    const ordinals = (r.monthly?.ordinals || []).map(ordinalLabel).join(' y ');
    const day = DAY_LABELS[r.monthly?.weekday] || 'día pendiente';
    return `<span class="schedule-pill schedule-edit" data-action="edit" title="Editar programacion">Mensual: ${escapeHtml(ordinals || '?')} ${escapeHtml(day)}</span>`;
  }

  return `
    ${dayCheckbox(r, 'lun', 'L')}
    ${dayCheckbox(r, 'mar', 'M')}
    ${dayCheckbox(r, 'mie', 'X')}
    ${dayCheckbox(r, 'jue', 'J')}
    ${dayCheckbox(r, 'vie', 'V')}
    ${dayCheckbox(r, 'sab', 'S')}
    ${dayCheckbox(r, 'dom', 'D')}
  `;
}

function activeToggle(r) {
  const isActive = r.activo === 'SI';
  return `
    <label class="state-toggle ${isActive ? 'is-active' : 'is-disabled'}" title="${isActive ? 'Activo' : 'Desactivado'}">
      <input type="checkbox" name="activoToggle" data-autosave ${isActive ? 'checked' : ''} />
      <span class="toggle-track"><span class="toggle-knob"></span></span>
      <span class="toggle-label">${isActive ? 'Activo' : 'Desactivado'}</span>
    </label>`;
}

function setModalActive(value) {
  const isActive = value === 'SI';
  const input = $('modalActivo');
  const wrapper = $('modalActivoToggle');
  const label = $('modalActivoLabel');
  input.checked = isActive;
  wrapper.classList.toggle('is-active', isActive);
  wrapper.classList.toggle('is-disabled', !isActive);
  wrapper.title = isActive ? 'Activo' : 'Desactivado';
  label.textContent = isActive ? 'Activo' : 'Desactivado';
}

function setModalScheduleType(value) {
  const scheduleType = ['weekly', 'monthly', 'interval'].includes(value) ? value : 'weekly';
  $('modalScheduleType').value = scheduleType;
  $('weeklyScheduleFields').classList.toggle('hidden', scheduleType !== 'weekly');
  $('monthlyScheduleFields').classList.toggle('hidden', scheduleType !== 'monthly');
  $('intervalScheduleFields').classList.toggle('hidden', scheduleType !== 'interval');
  $('cleaningRotationFields').classList.add('hidden');
}

function setModalMonthly(monthly = {}) {
  const ordinals = new Set((monthly.ordinals || []).map(Number));
  document.querySelectorAll('.monthly-ordinal').forEach((input) => {
    input.checked = ordinals.has(Number(input.value));
  });
  $('modalMonthlyWeekday').value = monthly.weekday || '';
}

function setModalInterval(interval = {}) {
  $('modalIntervalStartDate').value = interval.startDate || '';
  const everyWeeks = Number(interval.everyWeeks || 2);
  const option = [...$('modalIntervalWeeks').options].find((item) => Number(item.value) === everyWeeks);
  $('modalIntervalWeeks').value = option ? String(everyWeeks) : '2';
}

function setModalWeeklyDay(dayKey = 'sab') {
  const selected = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].includes(dayKey) ? dayKey : 'sab';
  $('modalLun').checked = selected === 'lun';
  $('modalMar').checked = selected === 'mar';
  $('modalMie').checked = selected === 'mie';
  $('modalJue').checked = selected === 'jue';
  $('modalVie').checked = selected === 'vie';
  $('modalSab').checked = selected === 'sab';
  $('modalDom').checked = selected === 'dom';
}

function selectedModalWeeklyDay() {
  if ($('modalLun').checked) return 'lun';
  if ($('modalMar').checked) return 'mar';
  if ($('modalMie').checked) return 'mie';
  if ($('modalJue').checked) return 'jue';
  if ($('modalVie').checked) return 'vie';
  if ($('modalDom').checked) return 'dom';
  return 'sab';
}

function setModalCleaningRotation(cleaning = {}) {
  const roomCount = Math.max(1, Number(cleaning.roomCount || 1));
  const currentRoom = Math.max(1, Math.min(roomCount, Number(cleaning.currentRoom || 1)));
  $('modalCleaningRoomCount').value = roomCount;
  $('modalCleaningCurrentRoom').innerHTML = Array.from({ length: roomCount }, (_, index) => {
    const room = index + 1;
    return `<option value="${room}" ${room === currentRoom ? 'selected' : ''}>Habitación #${room}</option>`;
  }).join('');

  setModalWeeklyDay(cleaning.sendDay || 'sab');
  $('weeklyScheduleFields').classList.remove('hidden');
  $('monthlyScheduleFields').classList.add('hidden');
  $('intervalScheduleFields').classList.add('hidden');
  $('cleaningRotationFields').classList.remove('hidden');
}

function refreshCleaningRoomOptions() {
  const roomCount = Math.max(1, Math.min(30, Number($('modalCleaningRoomCount').value || 1)));
  const currentRoom = Math.max(1, Math.min(roomCount, Number($('modalCleaningCurrentRoom').value || 1)));
  $('modalCleaningRoomCount').value = roomCount;
  $('modalCleaningCurrentRoom').innerHTML = Array.from({ length: roomCount }, (_, index) => {
    const room = index + 1;
    return `<option value="${room}" ${room === currentRoom ? 'selected' : ''}>Habitación #${room}</option>`;
  }).join('');
  updateModalCleaningNotes();
}

function updateModalCleaningNotes() {
  if (state.modalMode !== 'cleaning') return;
  const reminder = reminderByRow(state.modalRow);
  if (!reminder?.isCleaningRotation) return;
  $('modalNotes').value = cleaningNotesUi(reminder, {
    roomCount: Number($('modalCleaningRoomCount').value || reminder.cleaning?.roomCount || 1),
    currentRoom: Number($('modalCleaningCurrentRoom').value || reminder.cleaning?.currentRoom || 1),
  });
}

function applyModalCategoryMode() {
  if (state.modalMode !== 'add') return;
  const cleaning = isCleaningCategory($('modalCategory').value);
  if (cleaning) {
    $('modalScheduleType').value = 'weekly';
    $('modalScheduleType').disabled = true;
    setModalCleaningRotation({ roomCount: Number($('modalCleaningRoomCount').value || 3), currentRoom: 1, sendDay: 'sab' });
    if (!$('modalMessage').value.trim()) $('modalMessage').value = defaultCleaningTemplateUi();
    $('modalNotes').value = 'Las notas se generan por el sistema después de enviar.';
  } else {
    $('modalScheduleType').disabled = false;
    setModalScheduleType($('modalScheduleType').value || 'weekly');
  }
}

function renderRemindersLegacyUnused() {
  const body = $('reminderGrid');
  const reminders = filteredReminders();
  state.selectedRows = new Set([...state.selectedRows].filter((row) => state.reminders.some((r) => r.row === row)));
  updateBulkDeleteControls(reminders);
  renderSortIndicators();

  if (!reminders.length) {
    body.innerHTML = '<tr><td colspan="12" class="empty">No hay recordatorios con esos filtros.</td></tr>';
    return;
  }

  body.innerHTML = reminders.map((r) => `
    <tr data-row="${r.row}" class="${[
      state.savingRows.has(r.row) ? 'saving' : '',
      r.activo === 'NO' ? 'disabled-reminder' : '',
    ].filter(Boolean).join(' ')}">
      <td class="select-cell">
        <input type="checkbox" class="row-select" data-row-select value="${r.row}" ${state.selectedRows.has(r.row) ? 'checked' : ''} />
      </td>
      <td class="house-cell">${escapeHtml(r.group)}</td>
      <td class="category-readonly">${escapeHtml(r.category || 'Sin categoría')}</td>
      <td class="days-cell">${scheduleCell(r)}</td>
      <td><select class="time-input" name="hora" data-autosave>${timeOptions(r.hora)}</select></td>
      <td>${activeToggle(r)}</td>
      <td><span class="badge ${escapeHtml(r.estado)}">${escapeHtml(r.estado || 'SIN ESTADO')}</span></td>
      <td class="date-cell">${escapeHtml(r.proximoEnvio || 'Sin próximo envío')}</td>
      <td class="date-cell">${escapeHtml(r.ultimoEnvio || 'Sin envíos')}</td>
      <td class="message-preview">${escapeHtml(shortText(r.mensaje))}</td>
      <td class="notes-preview">${escapeHtml(shortText(r.notas || 'Sin notas', 75))}</td>
      <td class="actions-cell">
        <button type="button" class="icon-button" title="Editar" data-action="edit">✏️</button>
        <button type="button" class="icon-button danger-icon" title="Eliminar" data-action="delete">🗑️</button>
        <span class="row-save-state" data-save-state>${state.savingRows.has(r.row) ? 'Guardando...' : ''}</span>
      </td>
    </tr>
  `).join('');
  updateBulkDeleteControls(reminders);
}

function updateBulkDeleteControls(visibleReminders = filteredReminders()) {
  const selectedCount = state.selectedRows.size;
  const bulkDeleteButton = $('bulkDeleteBtn');
  const bulkActivateButton = $('bulkActivateBtn');
  const bulkDeactivateButton = $('bulkDeactivateBtn');

  if (bulkDeleteButton) {
    bulkDeleteButton.classList.toggle('hidden', selectedCount === 0);
    bulkDeleteButton.textContent = selectedCount === 1
      ? 'Eliminar 1 seleccionado'
      : `Eliminar ${selectedCount} seleccionados`;
  }

  if (bulkActivateButton) {
    bulkActivateButton.classList.toggle('hidden', selectedCount === 0);
    bulkActivateButton.textContent = selectedCount === 1
      ? 'Activar 1 recordatorio'
      : `Activar ${selectedCount} recordatorios`;
  }

  if (bulkDeactivateButton) {
    bulkDeactivateButton.classList.toggle('hidden', selectedCount === 0);
    bulkDeactivateButton.textContent = selectedCount === 1
      ? 'Desactivar 1 recordatorio'
      : `Desactivar ${selectedCount} recordatorios`;
  }

  const selectVisible = $('selectVisibleRows');
  if (selectVisible) {
    const visibleRows = visibleReminders.map((r) => r.row);
    const selectedVisible = visibleRows.filter((row) => state.selectedRows.has(row));
    selectVisible.checked = visibleRows.length > 0 && selectedVisible.length === visibleRows.length;
    selectVisible.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleRows.length;
  }
}

function renderReminders() {
  const body = $('reminderGrid');
  const reminders = filteredReminders();
  state.selectedRows = new Set([...state.selectedRows].filter((row) => (
    state.reminders.some((r) => r.row === row)
  )));
  updateBulkDeleteControls(reminders);
  renderSortIndicators();

  if (!reminders.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty">No hay recordatorios con esos filtros.</td></tr>';
    return;
  }

  body.innerHTML = reminders.map((r) => {
    const cleaning = Boolean(r.isCleaningRotation);
    const rowValue = escapeHtml(r.row);
    const selectCell = `<input type="checkbox" class="row-select" data-row-select value="${rowValue}" ${state.selectedRows.has(r.row) ? 'checked' : ''} />`;
    const hourCell = `<select class="time-input" name="hora" data-autosave>${timeOptions(r.hora)}</select>`;
    const activeCell = activeToggle(r);
    const notesText = cleaning ? cleaningNotesUi(r) : (r.notas || 'Sin notas');

    return `
      <tr data-row="${rowValue}" class="${[
        state.savingRows.has(r.row) ? 'saving' : '',
        r.activo === 'NO' ? 'disabled-reminder' : '',
      ].filter(Boolean).join(' ')}">
        <td class="select-cell">${selectCell}</td>
        <td class="house-cell">${escapeHtml(r.group)}</td>
        <td class="category-readonly">${escapeHtml(r.category || 'Sin categoría')}</td>
        <td class="days-cell">${scheduleCell(r)}</td>
        <td>${hourCell}</td>
        <td>${activeCell}</td>
        <td><span class="badge ${escapeHtml(r.estado)}">${escapeHtml(r.estado || 'SIN ESTADO')}</span></td>
        <td class="date-cell">${escapeHtml(r.proximoEnvio || 'Sin próximo envío')}</td>
        <td class="date-cell">${escapeHtml(r.ultimoEnvio || 'Sin envíos')}</td>
        <td class="message-preview">${escapeHtml(shortText(r.mensaje))}</td>
        <td class="notes-preview">${escapeHtml(shortText(notesText, 75))}</td>
        <td class="actions-cell">
          <button type="button" class="icon-button" title="${cleaning ? 'Ajustar rotacion' : 'Editar'}" data-action="edit">&#9999;&#65039;</button>
          <button type="button" class="icon-button danger-icon" title="Eliminar" data-action="delete">&#128465;&#65039;</button>
          <span class="row-save-state" data-save-state>${state.savingRows.has(r.row) ? 'Guardando...' : ''}</span>
        </td>
      </tr>
    `;
  }).join('');
  updateBulkDeleteControls(reminders);
  const autoFitSignature = tableAutoFitSignature(reminders);
  const shouldRecalculateWidths = autoFitSignature !== state.lastTableAutoFitSignature;
  autoFitVisibleColumns({ includeManual: shouldRecalculateWidths });
  state.lastTableAutoFitSignature = autoFitSignature;
}

function initializeSortHeaders() {
  const headers = document.querySelectorAll('.reminders-table thead th');
  SORT_COLUMNS.forEach(({ index, key, label }) => {
    const th = headers[index];
    if (!th) return;
    th.innerHTML = `
      <button type="button" class="sort-header" data-sort="${key}">
        <span>${escapeHtml(label)}</span>
        <span class="sort-arrow" data-sort-arrow="${key}">-</span>
      </button>
    `;
  });

  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.sort.key === key) {
        state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { key, direction: 'asc' };
      }
      renderReminders();
    });
  });
  renderSortIndicators();
  setupResizableColumns();
}

function renderSortIndicators() {
  document.querySelectorAll('[data-sort-arrow]').forEach((arrow) => {
    const key = arrow.dataset.sortArrow;
    arrow.textContent = state.sort.key === key
      ? (state.sort.direction === 'asc' ? '^' : 'v')
      : '-';
    arrow.closest('.sort-header')?.classList.toggle('active-sort', state.sort.key === key);
  });
}

function loadColumnWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) || '{}');
    state.columnWidths = saved && typeof saved === 'object' ? saved : {};
  } catch {
    state.columnWidths = {};
  }
}

function saveColumnWidths() {
  localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(state.columnWidths));
}

function columnLimit(index) {
  return AUTO_FIT_LIMITS[index] || { min: MIN_COLUMN_WIDTH, max: 260 };
}

function textForColumnMeasurement(cell) {
  if (!cell) return '';
  const select = cell.querySelector('select');
  if (select) return select.options[select.selectedIndex]?.textContent || select.value || '';
  const input = cell.querySelector('input');
  if (input) {
    if (input.type === 'checkbox') return '☑';
    return input.value || '';
  }
  return cell.textContent || '';
}

function measureColumnText(text, font = '13px Segoe UI') {
  if (!measureColumnText.canvas) measureColumnText.canvas = document.createElement('canvas');
  const context = measureColumnText.canvas.getContext('2d');
  context.font = font;
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  return Math.ceil(context.measureText(normalized).width);
}

function setColumnWidth(index, width) {
  const table = document.querySelector('#remindersView .reminders-table');
  if (!table) return;
  const safeWidth = Math.max(MIN_COLUMN_WIDTH, Number(width || 0));
  table.querySelectorAll(`tr > *:nth-child(${index})`).forEach((cell) => {
    cell.style.width = `${safeWidth}px`;
    cell.style.minWidth = `${safeWidth}px`;
  });
}

function applyColumnWidths() {
  const table = document.querySelector('#remindersView .reminders-table');
  if (!table) return;
  Object.entries(state.columnWidths).forEach(([index, width]) => {
    const safeWidth = Math.max(MIN_COLUMN_WIDTH, Number(width || 0));
    setColumnWidth(index, safeWidth);
  });
}

function autoFitColumn(index, { clearManual = false } = {}) {
  const table = document.querySelector('#remindersView .reminders-table');
  if (!table) return;
  if (!clearManual && state.columnWidths[index]) return;
  if (clearManual) {
    delete state.columnWidths[index];
    saveColumnWidths();
  }

  const limit = columnLimit(Number(index));
  const header = table.querySelector(`thead tr > *:nth-child(${index})`);
  const cells = [...table.querySelectorAll(`tbody tr > *:nth-child(${index})`)];
  const font = window.getComputedStyle(table).font || '13px Segoe UI';
  const values = [
    header?.innerText || '',
    ...cells.map(textForColumnMeasurement),
  ];
  const widest = values.reduce((max, value) => Math.max(max, measureColumnText(value, font)), 0);
  const width = Math.min(limit.max, Math.max(limit.min, widest + 28));
  setColumnWidth(index, width);
}

function autoFitVisibleColumns({ includeManual = false } = {}) {
  const table = document.querySelector('#remindersView .reminders-table');
  if (!table) return;
  const columnCount = table.querySelectorAll('thead th').length;
  if (includeManual) {
    state.columnWidths = {};
    saveColumnWidths();
  }
  for (let index = 1; index <= columnCount; index += 1) {
    autoFitColumn(index, { clearManual: includeManual });
  }
}

function setupResizableColumns() {
  const table = document.querySelector('#remindersView .reminders-table');
  if (!table) return;
  const headers = table.querySelectorAll('thead th');

  headers.forEach((th, zeroIndex) => {
    const index = zeroIndex + 1;
    if (th.querySelector('.column-resizer')) return;
    th.classList.add('resizable-column');
    const handle = document.createElement('span');
    handle.className = 'column-resizer';
    handle.title = 'Arrastra para cambiar el ancho. Doble clic para resetear.';
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = th.getBoundingClientRect().width;

      const onMove = (moveEvent) => {
        const width = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + moveEvent.clientX - startX));
        state.columnWidths[index] = width;
        applyColumnWidths();
      };
      const onUp = () => {
        document.body.classList.remove('resizing-column');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveColumnWidths();
      };

      document.body.classList.add('resizing-column');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      autoFitColumn(index, { clearManual: true });
    });
    th.appendChild(handle);
  });

  applyColumnWidths();
}

function rowElement(row) {
  return document.querySelector(`tr[data-row="${CSS.escape(String(row))}"]`);
}

function reminderByRow(row) {
  return state.reminders.find((r) => r.row === row);
}

function rowIdFromDataset(value) {
  return isCleaningRow(value) ? value : Number(value);
}

function payloadFromRow(row) {
  const tr = rowElement(row);
  const current = reminderByRow(row);
  if (current?.isCleaningRotation) {
    return {
      enabled: tr.querySelector('[name="activoToggle"]').checked,
      currentRoom: current.cleaning?.currentRoom || 1,
      currentResponsibleRoom: cleaningResponsibleRoom(current.cleaning),
      hora: tr.querySelector('[name="hora"]').value,
      roomCount: current.cleaning?.roomCount || 1,
      sendDay: current.cleaning?.sendDay || 'sab',
      language: current.cleaning?.language || 'both',
      messageTemplate: current.cleaning?.messageTemplate || current.mensaje,
    };
  }
  const scheduleType = current.scheduleType || 'weekly';
  const isWeekly = scheduleType === 'weekly';
  return {
    group: current.group,
    category: current.category,
    scheduleType,
    monthly: current.monthly || { ordinals: [], weekday: '' },
    interval: current.interval || { startDate: '', everyWeeks: 0 },
    hora: tr.querySelector('[name="hora"]').value,
    activo: tr.querySelector('[name="activoToggle"]').checked ? 'SI' : 'NO',
    enviarManual: current.enviarManual || 'NO',
    mensaje: current.mensaje,
    days: !isWeekly ? current.days : {
      lun: tr.querySelector('[name="lun"]').checked,
      mar: tr.querySelector('[name="mar"]').checked,
      mie: tr.querySelector('[name="mie"]').checked,
      jue: tr.querySelector('[name="jue"]').checked,
      vie: tr.querySelector('[name="vie"]').checked,
      sab: tr.querySelector('[name="sab"]').checked,
      dom: tr.querySelector('[name="dom"]').checked,
    },
  };
}

function payloadFromModal() {
  const current = state.modalMode === 'edit' ? reminderByRow(state.modalRow) : null;
  const scheduleType = $('modalScheduleType').value;
  return {
    group: $('modalGroup').value.trim(),
    category: $('modalCategory').value.trim(),
    scheduleType,
    monthly: {
      ordinals: [...document.querySelectorAll('.monthly-ordinal:checked')].map((input) => Number(input.value)),
      weekday: $('modalMonthlyWeekday').value,
    },
    interval: {
      startDate: $('modalIntervalStartDate').value,
      everyWeeks: Number($('modalIntervalWeeks').value),
    },
    hora: $('modalHora').value,
    activo: $('modalActivo').checked ? 'SI' : 'NO',
    enviarManual: current ? current.enviarManual : 'NO',
    mensaje: $('modalMessage').value,
    days: {
      lun: $('modalLun').checked,
      mar: $('modalMar').checked,
      mie: $('modalMie').checked,
      jue: $('modalJue').checked,
      vie: $('modalVie').checked,
      sab: $('modalSab').checked,
      dom: $('modalDom').checked,
    },
  };
}

function updateStateFromWorkbook(workbook, filters = captureFilters()) {
  state.reminders = workbook.reminders;
  state.cleaningRotations = workbook.cleaningRotations || [];
  state.houses = workbook.houses;
  state.categories = workbook.categories;
  state.selectedRows = new Set([...state.selectedRows].filter((row) => state.reminders.some((r) => r.row === row)));
  if (filters) state.selectedHouses = new Set([...filters.houses].filter((h) => state.houses.includes(h)));
  renderFilters();
  restoreFilters(filters);
  renderFilters();
  renderReminders();
  renderCleaningRotations();
}

function languageLabel(value) {
  if (value === 'en') return 'Inglés';
  if (value === 'es') return 'Español';
  return 'Inglés + Español';
}

function roomOptions(roomCount, selected) {
  const count = Math.max(1, Number(roomCount || 1));
  const current = Math.max(1, Math.min(count, Number(selected || 1)));
  return Array.from({ length: count }, (_, index) => {
    const room = index + 1;
    return `<option value="${room}" ${room === current ? 'selected' : ''}>Habitación #${room}</option>`;
  }).join('');
}

function renderCleaningRotations() {
  const body = $('cleaningRotationGrid');
  if (!body) return;

  const rotations = [...(state.cleaningRotations || [])]
    .sort((a, b) => a.house.localeCompare(b.house, 'es', { numeric: true, sensitivity: 'base' }));

  if (!rotations.length) {
    body.innerHTML = '<tr><td colspan="9" class="empty">No hay rotaciones de limpieza configuradas.</td></tr>';
    return;
  }

  body.innerHTML = rotations.map((r) => `
    <tr data-cleaning-house="${escapeHtml(r.house)}" class="${r.enabled ? '' : 'disabled-reminder'}">
      <td class="house-cell">${escapeHtml(r.house)}</td>
      <td>${Number(r.roomCount || 0)}</td>
      <td><strong>Habitación #${Number(r.currentRoom || 1)}</strong></td>
      <td>Habitación #${Number(r.nextRoom || 1)}</td>
      <td><select name="currentRoom" class="room-select">${roomOptions(r.roomCount, r.currentRoom)}</select></td>
      <td><select name="hora" class="time-input">${timeOptions(r.hora, { includeBlank: false })}</select></td>
      <td>${escapeHtml(DAY_LABELS[r.sendDay] || r.sendDay || 'Sábado')}</td>
      <td>${escapeHtml(languageLabel(r.language))}</td>
      <td class="date-cell">${escapeHtml(r.proximoEnvio || 'Sin próximo envío')}</td>
    </tr>
  `).join('');
}

function isCleaningRow(row) {
  return String(row || '').startsWith('cleaning:');
}

async function saveRow(row, payload, { quiet = false } = {}) {
  const tr = rowElement(row);
  const filters = captureFilters();
  state.savingRows.add(row);
  if (tr) {
    tr.classList.add('saving');
    const indicator = tr.querySelector('[data-save-state]');
    if (indicator) indicator.textContent = 'Guardando...';
  }

  try {
    const current = reminderByRow(row);
    const endpoint = current?.isCleaningRotation
      ? `/api/cleaning-rotations/${encodeURIComponent(current.group)}`
      : `/api/reminders/${row}`;
    const data = await api(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    state.savingRows.delete(row);
    updateStateFromWorkbook(data.workbook, filters);
    if (!quiet) toast('Guardado.');
  } catch (error) {
    state.savingRows.delete(row);
    renderReminders();
    toast(`Error guardando fila ${row}: ${error.message}`);
  }
}

function scheduleAutoSave(row) {
  if (state.saveTimers.has(row)) clearTimeout(state.saveTimers.get(row));
  const timer = setTimeout(() => {
    state.saveTimers.delete(row);
    const tr = rowElement(row);
    if (!tr) return;
    saveRow(row, payloadFromRow(row), { quiet: true });
  }, 650);
  state.saveTimers.set(row, timer);
}

function openEditModal(row) {
  const reminder = reminderByRow(row);
  if (!reminder) return;

  if (reminder.isCleaningRotation) {
    state.modalMode = 'cleaning';
    state.modalRow = row;
    state.refreshPaused = true;
    $('modalTitle').textContent = `Ajustar rotación de limpieza`;
    $('modalSubtitle').textContent = `${reminder.group} · responsable esta semana cuarto #${cleaningResponsibleRoom(reminder.cleaning)}`;
    $('houseComboButton').disabled = true;
    $('categoryComboButton').disabled = true;
    $('modalScheduleType').disabled = true;
    $('modalMessage').readOnly = false;
    setModalHouse(reminder.group || '');
    state.houseMenuOpen = false;
    renderHouseCombo();
    setModalCategory(reminder.category || 'Limpieza rotativa');
    state.categoryMenuOpen = false;
    renderCategoryCombo();
    fillModalTimeOptions(reminder.hora || '');
    setModalScheduleType('weekly');
    setModalCleaningRotation(reminder.cleaning || {});
    setModalActive(reminder.activo || 'NO');
    $('modalMessage').value = reminder.cleaning?.messageTemplate || reminder.mensaje || defaultCleaningTemplateUi();
    $('modalNotes').value = cleaningNotesUi(reminder);
    $('editModal').showModal();
    return;
  }

  state.modalMode = 'edit';
  state.modalRow = row;
  state.refreshPaused = true;
  $('houseComboButton').disabled = false;
  $('categoryComboButton').disabled = false;
  $('modalScheduleType').disabled = false;
  $('modalMessage').readOnly = false;
  $('modalTitle').textContent = `Editar fila ${row}`;
  $('modalSubtitle').textContent = 'Estos cambios se guardan automáticamente.';
  setModalHouse(reminder.group || '');
  state.houseMenuOpen = false;
  renderHouseCombo();
  setModalCategory(reminder.category || '');
  state.categoryMenuOpen = false;
  renderCategoryCombo();
  fillModalTimeOptions(reminder.hora || '');
  setModalScheduleType(reminder.scheduleType || 'weekly');
  setModalMonthly(reminder.monthly || {});
  setModalInterval(reminder.interval || {});
  setModalActive(reminder.activo || 'NO');
  $('modalMessage').value = reminder.mensaje || '';
  $('modalNotes').value = reminder.notas || '';
  $('modalLun').checked = Boolean(reminder.days.lun);
  $('modalMar').checked = Boolean(reminder.days.mar);
  $('modalMie').checked = Boolean(reminder.days.mie);
  $('modalJue').checked = Boolean(reminder.days.jue);
  $('modalVie').checked = Boolean(reminder.days.vie);
  $('modalSab').checked = Boolean(reminder.days.sab);
  $('modalDom').checked = Boolean(reminder.days.dom);
  $('editModal').showModal();
}

function openAddModal() {
  state.modalMode = 'add';
  state.modalRow = null;
  state.refreshPaused = true;
  $('houseComboButton').disabled = false;
  $('categoryComboButton').disabled = false;
  $('modalScheduleType').disabled = false;
  $('modalMessage').readOnly = false;
  $('modalTitle').textContent = 'Agregar recordatorio';
  $('modalSubtitle').textContent = 'Se creará un nuevo recordatorio.';
  setModalHouse(state.houses[0] || '');
  state.houseMenuOpen = false;
  renderHouseCombo();
  setModalCategory(state.categories[0] || '');
  state.categoryMenuOpen = false;
  renderCategoryCombo();
  fillModalTimeOptions('');
  setModalScheduleType('weekly');
  setModalMonthly({});
  setModalInterval({});
  setModalActive('SI');
  $('modalMessage').value = '';
  $('modalNotes').value = 'Las notas se generan por el sistema después de enviar.';
  $('modalLun').checked = false;
  $('modalMar').checked = false;
  $('modalMie').checked = false;
  $('modalJue').checked = false;
  $('modalVie').checked = false;
  $('modalSab').checked = false;
  $('modalDom').checked = false;
  $('editModal').showModal();
}

async function saveModal() {
  if (state.modalMode === 'cleaning') {
    const reminder = reminderByRow(state.modalRow);
    if (!reminder?.isCleaningRotation) {
      toast('No se encontró la rotación de limpieza.');
      return;
    }

    $('editModal').close();
    state.refreshPaused = false;
    await saveCleaningRotation(reminder.group, {
      enabled: $('modalActivo').checked,
      currentRoom: Number($('modalCleaningCurrentRoom').value),
      hora: $('modalHora').value,
      roomCount: Number($('modalCleaningRoomCount').value || reminder.cleaning?.roomCount || 1),
      currentResponsibleRoom: cleaningResponsibleRoom(reminder.cleaning),
      sendDay: selectedModalWeeklyDay(),
      language: reminder.cleaning?.language || 'both',
      messageTemplate: $('modalMessage').value,
    });
    return;
  }

  const payload = payloadFromModal();
  if (!payload.group) {
    toast('La casa / grupo exacto no puede quedar vacío.');
    return;
  }
  if (!payload.mensaje.trim()) {
    toast('El mensaje no puede quedar vacío.');
    return;
  }
  if (state.modalMode === 'add' && isCleaningCategory(payload.category)) {
    if (!/\{\{\s*room\s*\}\}/i.test(payload.mensaje)) {
      toast('El mensaje de limpieza rotativa debe incluir {{room}}.');
      return;
    }
    $('editModal').close();
    state.refreshPaused = false;
    const filters = captureFilters();
    try {
      const data = await api('/api/cleaning-rotations', {
        method: 'POST',
        body: JSON.stringify({
          house: payload.group,
          enabled: payload.activo === 'SI',
          roomCount: Number($('modalCleaningRoomCount').value || 1),
          currentRoom: Number($('modalCleaningCurrentRoom').value || 1),
          currentResponsibleRoom: cleaningResponsibleRoom({
            roomCount: Number($('modalCleaningRoomCount').value || 1),
            currentRoom: Number($('modalCleaningCurrentRoom').value || 1),
          }),
          sendDay: selectedModalWeeklyDay(),
          hora: payload.hora,
          language: 'both',
          messageTemplate: payload.mensaje,
        }),
      });
      updateStateFromWorkbook(data.workbook, filters);
      toast('Rotación de limpieza agregada.');
    } catch (error) {
      toast(`Error agregando rotación: ${error.message}`);
    }
    return;
  }

  if (payload.scheduleType === 'monthly') {
    if (!payload.monthly.ordinals.length) {
      toast('Selecciona al menos una semana del mes.');
      return;
    }
    if (!payload.monthly.weekday) {
      toast('Selecciona el día mensual.');
      return;
    }
  }
  if (payload.scheduleType === 'interval') {
    if (!payload.interval.startDate) {
      toast('Selecciona la fecha base del intervalo.');
      return;
    }
    if (!payload.interval.everyWeeks) {
      toast('Selecciona cada cuantas semanas se repite.');
      return;
    }
  }
  $('editModal').close();
  state.refreshPaused = false;

  if (state.modalMode === 'add') {
    const filters = captureFilters();
    try {
      const data = await api('/api/reminders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      updateStateFromWorkbook(data.workbook, filters);
      toast('Recordatorio agregado.');
    } catch (error) {
      toast(`Error agregando recordatorio: ${error.message}`);
    }
    return;
  }

  const row = state.modalRow;
  if (row) await saveRow(row, payload);
}

async function deleteRow(row) {
  const reminder = reminderByRow(row);
  if (!reminder) return;
  const filters = captureFilters();
  const ok = window.confirm(`Vas a eliminar el recordatorio ${row}:\n\n${reminder.group}\n${reminder.category}\n\nEsta acción no se puede deshacer automáticamente. ¿Continuar?`);
  if (!ok) return;

  try {
    const data = await api(`/api/reminders/${row}`, { method: 'DELETE' });
    updateStateFromWorkbook(data.workbook, filters);
    toast('Recordatorio eliminado.');
  } catch (error) {
    toast(`Error eliminando fila ${row}: ${error.message}`);
  }
}

async function deleteSelectedRows() {
  const rows = [...state.selectedRows].sort((a, b) => a - b);
  if (!rows.length) return;

  const selected = rows
    .map((row) => reminderByRow(row))
    .filter(Boolean);
  const preview = selected
    .slice(0, 12)
    .map((r) => `- ${r.row}: ${r.group} [${r.category || 'Sin categoría'}]`)
    .join('\n');
  const extra = selected.length > 12 ? `\n... y ${selected.length - 12} más.` : '';
  const ok = window.confirm(
    `Vas a eliminar ${rows.length} recordatorio(s):\n\n${preview}${extra}\n\nEsta acción no se puede deshacer automáticamente. ¿Continuar?`
  );
  if (!ok) return;

  const filters = captureFilters();
  try {
    const data = await api('/api/reminders/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
    state.selectedRows.clear();
    updateStateFromWorkbook(data.workbook, filters);
    toast(`Eliminados ${rows.length} recordatorio(s).`);
  } catch (error) {
    toast(`Error eliminando seleccionados: ${error.message}`);
  }
}

async function deleteRow(row) {
  const reminder = reminderByRow(row);
  if (!reminder) return;
  const filters = captureFilters();
  const label = reminder.isCleaningRotation ? 'rotación de limpieza' : `recordatorio ${row}`;
  const ok = window.confirm(`Vas a eliminar ${label}:\n\n${reminder.group}\n${reminder.category}\n\nEsta acción no se puede deshacer automáticamente. ¿Continuar?`);
  if (!ok) return;

  try {
    const endpoint = reminder.isCleaningRotation
      ? `/api/cleaning-rotations/${encodeURIComponent(reminder.group)}`
      : `/api/reminders/${row}`;
    const data = await api(endpoint, { method: 'DELETE' });
    updateStateFromWorkbook(data.workbook, filters);
    toast(reminder.isCleaningRotation ? 'Rotación eliminada.' : 'Recordatorio eliminado.');
  } catch (error) {
    toast(`Error eliminando fila ${row}: ${error.message}`);
  }
}

async function setSelectedRowsActive(activo) {
  const rows = [...state.selectedRows].sort((a, b) => a - b);
  if (!rows.length) return;

  const selected = rows
    .map((row) => reminderByRow(row))
    .filter(Boolean);
  const accion = activo === 'SI' ? 'activar' : 'desactivar';
  const accionPasado = activo === 'SI' ? 'activados' : 'desactivados';
  const preview = selected
    .slice(0, 12)
    .map((r) => `- ${r.row}: ${r.group} [${r.category || 'Sin categoría'}]`)
    .join('\n');
  const extra = selected.length > 12 ? `\n... y ${selected.length - 12} más.` : '';
  const ok = window.confirm(
    `Vas a ${accion} ${rows.length} recordatorio(s):\n\n${preview}${extra}\n\n¿Continuar?`
  );
  if (!ok) return;

  const filters = captureFilters();
  try {
    const data = await api('/api/reminders/bulk-active', {
      method: 'POST',
      body: JSON.stringify({ rows, activo }),
    });
    updateStateFromWorkbook(data.workbook, filters);
    toast(`${rows.length} recordatorio(s) ${accionPasado}.`);
  } catch (error) {
    toast(`Error actualizando seleccionados: ${error.message}`);
  }
}

function selectedRowsSorted() {
  return [...state.selectedRows].sort((a, b) => String(a).localeCompare(String(b), 'es', {
    numeric: true,
    sensitivity: 'base',
  }));
}

function splitSelectedRows(rows) {
  const normalRows = [];
  const cleaningRows = [];
  rows.forEach((row) => {
    const reminder = reminderByRow(row);
    if (!reminder) return;
    if (reminder.isCleaningRotation) cleaningRows.push(reminder);
    else normalRows.push(row);
  });
  return { normalRows, cleaningRows };
}

async function deleteSelectedRows() {
  const rows = selectedRowsSorted();
  if (!rows.length) return;

  const selected = rows.map((row) => reminderByRow(row)).filter(Boolean);
  const preview = selected
    .slice(0, 12)
    .map((r) => `- ${r.row}: ${r.group} [${r.category || 'Sin categoría'}]`)
    .join('\n');
  const extra = selected.length > 12 ? `\n... y ${selected.length - 12} más.` : '';
  const ok = window.confirm(
    `Vas a eliminar ${rows.length} recordatorio(s):\n\n${preview}${extra}\n\nEsta acción no se puede deshacer automáticamente. ¿Continuar?`
  );
  if (!ok) return;

  const filters = captureFilters();
  const { normalRows, cleaningRows } = splitSelectedRows(rows);

  try {
    let workbook = null;
    if (normalRows.length) {
      const data = await api('/api/reminders/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ rows: normalRows }),
      });
      workbook = data.workbook;
    }

    for (const reminder of cleaningRows) {
      const data = await api(`/api/cleaning-rotations/${encodeURIComponent(reminder.group)}`, {
        method: 'DELETE',
      });
      workbook = data.workbook;
    }

    state.selectedRows.clear();
    if (workbook) updateStateFromWorkbook(workbook, filters);
    else await loadReminders();
    toast(`Eliminados ${rows.length} recordatorio(s).`);
  } catch (error) {
    toast(`Error eliminando seleccionados: ${error.message}`);
  }
}

async function setSelectedRowsActive(activo) {
  const rows = selectedRowsSorted();
  if (!rows.length) return;

  const selected = rows.map((row) => reminderByRow(row)).filter(Boolean);
  const accion = activo === 'SI' ? 'activar' : 'desactivar';
  const accionPasado = activo === 'SI' ? 'activados' : 'desactivados';
  const preview = selected
    .slice(0, 12)
    .map((r) => `- ${r.row}: ${r.group} [${r.category || 'Sin categoría'}]`)
    .join('\n');
  const extra = selected.length > 12 ? `\n... y ${selected.length - 12} más.` : '';
  const ok = window.confirm(
    `Vas a ${accion} ${rows.length} recordatorio(s):\n\n${preview}${extra}\n\n¿Continuar?`
  );
  if (!ok) return;

  const filters = captureFilters();
  const { normalRows, cleaningRows } = splitSelectedRows(rows);

  try {
    let workbook = null;
    if (normalRows.length) {
      const data = await api('/api/reminders/bulk-active', {
        method: 'POST',
        body: JSON.stringify({ rows: normalRows, activo }),
      });
      workbook = data.workbook;
    }

    for (const reminder of cleaningRows) {
      const cleaning = reminder.cleaning || {};
      const data = await api(`/api/cleaning-rotations/${encodeURIComponent(reminder.group)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: activo === 'SI',
          currentRoom: cleaning.currentRoom || 1,
          currentResponsibleRoom: cleaningResponsibleRoom(cleaning),
          hora: reminder.hora,
          roomCount: cleaning.roomCount || 1,
          sendDay: cleaning.sendDay || 'sab',
          language: cleaning.language || 'both',
          messageTemplate: cleaning.messageTemplate || reminder.mensaje,
        }),
      });
      workbook = data.workbook;
    }

    if (workbook) updateStateFromWorkbook(workbook, filters);
    else await loadReminders();
    toast(`${rows.length} recordatorio(s) ${accionPasado}.`);
  } catch (error) {
    toast(`Error actualizando seleccionados: ${error.message}`);
  }
}

async function saveCleaningRotation(house, payload) {
  const row = document.querySelector(`tr[data-cleaning-house="${CSS.escape(house)}"]`);
  if (row) row.classList.add('saving');
  try {
    const data = await api(`/api/cleaning-rotations/${encodeURIComponent(house)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    updateStateFromWorkbook(data.workbook);
    toast('Rotación de limpieza actualizada.');
  } catch (error) {
    toast(`Error actualizando rotación: ${error.message}`);
    renderCleaningRotations();
  }
}

async function loadReminders() {
  if (state.refreshPaused || state.savingRows.size) return;
  const filters = captureFilters();
  const data = await api('/api/reminders');
  state.reminders = data.reminders;
  state.cleaningRotations = data.cleaningRotations || [];
  state.houses = data.houses;
  state.categories = data.categories;
  state.selectedHouses = new Set([...filters.houses].filter((h) => state.houses.includes(h)));
  renderFilters();
  restoreFilters(filters);
  renderFilters();
  renderReminders();
  renderCleaningRotations();
}

async function loadSettings() {
  state.settings = await api('/api/settings');
}

async function loadStatus() {
  const s = await api('/api/status');
  if (s.settings) state.settings = s.settings;
  const pill = $('servicePill');
  const pauseButton = $('pauseToggle');
  if (!s.running) {
    pill.textContent = 'Servicio: detenido';
    pauseButton.textContent = '▶';
    pauseButton.title = 'Servicio detenido. Inícialo desde Estado del sistema.';
  } else if (s.paused) {
    pill.textContent = `Sistema pausado (PID ${s.pid})`;
    pauseButton.textContent = '▶';
    pauseButton.title = 'Reanudar envíos';
  } else {
    pill.textContent = `Servicio: corriendo (PID ${s.pid})`;
    pauseButton.textContent = '⏸';
    pauseButton.title = 'Pausar envíos';
  }
  pill.classList.toggle('ok', s.running && !s.paused);
  pill.classList.toggle('paused', s.running && s.paused);
  pill.classList.toggle('bad', !s.running);
  pauseButton.classList.toggle('paused', s.running && s.paused);
  pauseButton.disabled = !s.running;

  $('serviceStatus').textContent = JSON.stringify({
    running: s.running,
    paused: s.paused,
    pid: s.pid,
    lock: s.lock,
  }, null, 2);
  $('statusFile').textContent = s.status || 'Sin estado.';
  $('serviceLog').textContent = s.serviceLog || 'Sin log.';
  $('resultsLog').textContent = s.results || 'Sin resultados.';
  $('sentLog').textContent = s.sentLog || 'Sin envíos registrados.';
}

async function togglePause() {
  try {
    const status = await api('/api/status');
    if (!status.running) {
      toast('El servicio está detenido. Inícialo desde Estado del sistema.');
      return;
    }
    await api(status.paused ? '/api/system/resume' : '/api/system/pause', {
      method: 'POST',
      body: '{}',
    });
    await loadStatus();
    toast(status.paused ? 'Sistema reanudado.' : 'Sistema pausado.');
  } catch (error) {
    toast(`Error cambiando pausa: ${error.message}`);
  }
}

async function serviceAction(path, message) {
  const buttons = ['startService', 'stopService', 'restartService'].map((id) => $(id));
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await api(path, { method: 'POST', body: '{}' });
    toast(message);
    setTimeout(loadStatus, 1200);
    setTimeout(loadStatus, 7000);
  } catch (error) {
    toast(`Error: ${error.message}`);
  } finally {
    setTimeout(() => {
      buttons.forEach((button) => { button.disabled = false; });
    }, 1500);
  }
}

async function activateMode(mode) {
  const isDebug = mode === 'debug';
  const settings = isDebug
    ? { mode: 'debug', timeStepMinutes: 1, serviceIntervalMs: 120000, sendWindowMinutes: 3 }
    : { mode: 'production', timeStepMinutes: 30, serviceIntervalMs: 300000, sendWindowMinutes: 10 };
  const buttons = ['debugMode', 'productionMode', 'restartService'].map((id) => $(id)).filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
    state.settings = result.settings;
    await api('/api/service/restart', { method: 'POST', body: '{}' });
    await loadStatus();
    await loadReminders();
    toast(isDebug
      ? 'Modo Debug activado: revision 2 min, ventana 3 min, hora cada minuto.'
      : 'Modo Produccion activado: revision 5 min, ventana 10 min, hora cada 30 min.');
  } catch (error) {
    toast(`Error activando modo: ${error.message}`);
  } finally {
    setTimeout(() => {
      buttons.forEach((button) => { button.disabled = false; });
    }, 1500);
  }
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $(`${btn.dataset.view}View`).classList.add('active');
    if (btn.dataset.view === 'system') loadStatus();
  });
});

$('houseFilter').addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  if (checkbox.checked) state.selectedHouses.add(checkbox.value);
  else state.selectedHouses.delete(checkbox.value);
  renderReminders();
});

['categoryFilter', 'statusFilter', 'activeFilter', 'searchBox'].forEach((id) => {
  $(id).addEventListener('input', renderReminders);
});

$('reminderGrid').addEventListener('click', (event) => {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement) return;

  const tr = event.target.closest('tr[data-row]');
  if (!tr) return;
  const row = rowIdFromDataset(tr.dataset.row);

  if (actionElement.dataset.action === 'edit') openEditModal(row);
  if (actionElement.dataset.action === 'delete') deleteRow(row);
});

$('reminderGrid').addEventListener('change', (event) => {
  const selected = event.target.closest('[data-row-select]');
  if (selected) {
    const row = rowIdFromDataset(selected.value);
    if (selected.checked) state.selectedRows.add(row);
    else state.selectedRows.delete(row);
    updateBulkDeleteControls();
    return;
  }

  const field = event.target.closest('[data-autosave]');
  if (!field) return;
  const tr = event.target.closest('tr[data-row]');
  scheduleAutoSave(rowIdFromDataset(tr.dataset.row));
});

$('reminderGrid').addEventListener('focusout', (event) => {
  const field = event.target.closest('[data-autosave]');
  if (!field || field.type === 'checkbox' || field.tagName === 'SELECT') return;
  const tr = event.target.closest('tr[data-row]');
  scheduleAutoSave(rowIdFromDataset(tr.dataset.row));
});

$('cleaningRotationGrid').addEventListener('change', (event) => {
  const field = event.target.closest('select');
  if (!field) return;
  const tr = event.target.closest('tr[data-cleaning-house]');
  if (!tr) return;
  const house = tr.dataset.cleaningHouse;
  const rotation = state.cleaningRotations.find((r) => r.house === house);
  if (!rotation) return;
  saveCleaningRotation(house, {
    ...rotation,
    currentRoom: Number(tr.querySelector('[name="currentRoom"]').value),
    hora: tr.querySelector('[name="hora"]').value,
  });
});

$('editModalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  saveModal();
});
$('modalActivo').addEventListener('change', () => {
  setModalActive($('modalActivo').checked ? 'SI' : 'NO');
});
$('modalScheduleType').addEventListener('change', () => {
  setModalScheduleType($('modalScheduleType').value);
});
$('modalCleaningRoomCount').addEventListener('input', refreshCleaningRoomOptions);
$('modalCleaningCurrentRoom').addEventListener('change', updateModalCleaningNotes);
$('modalHora').addEventListener('change', updateModalCleaningNotes);
$('weeklyScheduleFields').addEventListener('change', (event) => {
  if (state.modalMode !== 'cleaning') return;
  const changed = event.target.closest('input[type="checkbox"]');
  if (!changed) return;
  document.querySelectorAll('#weeklyScheduleFields input[type="checkbox"]').forEach((input) => {
    input.checked = input === changed;
  });
  updateModalCleaningNotes();
});
$('houseComboButton').addEventListener('click', () => toggleHouseCombo());
$('houseComboMenu').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-house-action]');
  if (!button) return;
  const action = button.dataset.houseAction;

  if (action === 'select') {
    setModalHouse(button.dataset.house || '');
    toggleHouseCombo(false);
    return;
  }

  if (action === 'add') {
    const nueva = window.prompt('Nueva casa / grupo exacto:');
    const value = (nueva || '').trim();
    if (!value) return;
    if (!state.houses.includes(value)) state.houses.push(value);
    setModalHouse(value);
    toggleHouseCombo(false);
    toast('Casa agregada al selector. Se guardará cuando guardes el recordatorio.');
    return;
  }

  if (action === 'delete') {
    const house = button.dataset.house || '';
    const usos = state.reminders.filter((r) => (r.filtrarCasa || r.group) === house || r.group === house).length;
    const ok = window.confirm(
      usos
        ? `La casa "${house}" está usada en ${usos} recordatorio(s).\n\nSi continúas, se quitará esa casa de esas filas y se marcarán como Desactivado para evitar envíos accidentales. ¿Continuar?`
        : `¿Eliminar la casa "${house}" del selector?`
    );
    if (!ok) return;

    if (usos) {
      try {
        const data = await api(`/api/houses/${encodeURIComponent(house)}`, { method: 'DELETE' });
        updateStateFromWorkbook(data.workbook);
        setModalHouse('');
        renderHouseCombo();
        toast('Casa eliminada y filas desactivadas.');
      } catch (error) {
        toast(`Error eliminando casa: ${error.message}`);
      }
      return;
    }

    state.houses = state.houses.filter((h) => h !== house);
    if ($('modalGroup').value === house) setModalHouse('');
    renderHouseCombo();
    toast('Casa removida del selector.');
  }
});
$('categoryComboButton').addEventListener('click', () => toggleCategoryCombo());
$('categoryComboMenu').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-category-action]');
  if (!button) return;
  const action = button.dataset.categoryAction;

  if (action === 'select') {
    setModalCategory(button.dataset.category || '');
    toggleCategoryCombo(false);
    return;
  }

  if (action === 'add') {
    const nueva = window.prompt('Nueva categoría:');
    const value = (nueva || '').trim();
    if (!value) return;
    if (!state.categories.includes(value)) state.categories.push(value);
    setModalCategory(value);
    toggleCategoryCombo(false);
    toast('Categoría agregada al selector. Se guardará cuando guardes el recordatorio.');
    return;
  }

  if (action === 'delete') {
    const category = button.dataset.category || '';
    const usos = state.reminders.filter((r) => r.category === category).length;
    const ok = window.confirm(
      usos
        ? `La categoría "${category}" está usada en ${usos} recordatorio(s).\n\nSi continúas, esa categoría se quitará de esas filas. ¿Continuar?`
        : `¿Eliminar la categoría "${category}" del selector?`
    );
    if (!ok) return;

    if (usos) {
      try {
        const data = await api(`/api/categories/${encodeURIComponent(category)}`, { method: 'DELETE' });
        updateStateFromWorkbook(data.workbook);
        setModalCategory('');
        renderCategoryCombo();
        toast('Categoría eliminada.');
      } catch (error) {
        toast(`Error eliminando categoría: ${error.message}`);
      }
      return;
    }

    state.categories = state.categories.filter((c) => c !== category);
    if ($('modalCategory').value === category) setModalCategory('');
    renderCategoryCombo();
    toast('Categoría removida del selector.');
  }
});
$('closeModal').addEventListener('click', () => $('editModal').close());
$('discardModal').addEventListener('click', () => {
  $('editModal').close();
  state.modalRow = null;
  state.modalMode = 'edit';
  state.refreshPaused = false;
});

$('editModal').addEventListener('close', () => {
  state.refreshPaused = false;
});
$('addBtn').addEventListener('click', openAddModal);
$('bulkActivateBtn').addEventListener('click', () => setSelectedRowsActive('SI'));
$('bulkDeactivateBtn').addEventListener('click', () => setSelectedRowsActive('NO'));
$('bulkDeleteBtn').addEventListener('click', deleteSelectedRows);
$('selectVisibleRows').addEventListener('change', (event) => {
  const visibleRows = filteredReminders().map((r) => r.row);
  if (event.target.checked) {
    visibleRows.forEach((row) => state.selectedRows.add(row));
  } else {
    visibleRows.forEach((row) => state.selectedRows.delete(row));
  }
  renderReminders();
});
$('pauseToggle').addEventListener('click', togglePause);
$('refreshStatus').addEventListener('click', () => loadStatus().then(() => toast('Estado actualizado.')));
$('startService').addEventListener('click', () => serviceAction('/api/service/start', 'Servicio iniciado.'));
$('stopService').addEventListener('click', () => serviceAction('/api/service/stop', 'Servicio detenido.'));
$('restartService').addEventListener('click', () => serviceAction('/api/service/restart', 'Servicio reiniciado.'));
$('debugMode').addEventListener('click', () => activateMode('debug'));
$('productionMode').addEventListener('click', () => activateMode('production'));

loadColumnWidths();
initializeSortHeaders();
loadSettings()
  .then(loadReminders)
  .catch((e) => toast(e.message));
loadStatus().catch(() => {});
setInterval(loadStatus, 15000);
setInterval(() => {
  const active = document.activeElement;
  const editingInline = active && active.closest && active.closest('#reminderGrid');
  if (!editingInline) loadReminders().catch(() => {});
}, 20000);
