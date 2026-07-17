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

function setModalCategory(value) {
  $('modalCategory').value = value || '';
  $('categoryComboLabel').textContent = value || 'Seleccionar categoría';
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

function renderReminders() {
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

function rowElement(row) {
  return document.querySelector(`tr[data-row="${row}"]`);
}

function reminderByRow(row) {
  return state.reminders.find((r) => r.row === row);
}

function payloadFromRow(row) {
  const tr = rowElement(row);
  const current = reminderByRow(row);
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
    const data = await api(`/api/reminders/${row}`, {
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

  state.modalMode = 'edit';
  state.modalRow = row;
  state.refreshPaused = true;
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
  const payload = payloadFromModal();
  if (!payload.group) {
    toast('La casa / grupo exacto no puede quedar vacío.');
    return;
  }
  if (!payload.mensaje.trim()) {
    toast('El mensaje no puede quedar vacío.');
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
    .map((r) => `- ${r.row}: ${r.group} [${r.category || 'Sin categorÃ­a'}]`)
    .join('\n');
  const extra = selected.length > 12 ? `\n... y ${selected.length - 12} mÃ¡s.` : '';
  const ok = window.confirm(
    `Vas a ${accion} ${rows.length} recordatorio(s):\n\n${preview}${extra}\n\nÂ¿Continuar?`
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
  const row = Number(tr.dataset.row);

  if (actionElement.dataset.action === 'edit') openEditModal(row);
  if (actionElement.dataset.action === 'delete') deleteRow(row);
});

$('reminderGrid').addEventListener('change', (event) => {
  const selected = event.target.closest('[data-row-select]');
  if (selected) {
    const row = Number(selected.value);
    if (selected.checked) state.selectedRows.add(row);
    else state.selectedRows.delete(row);
    updateBulkDeleteControls();
    return;
  }

  const field = event.target.closest('[data-autosave]');
  if (!field) return;
  const tr = event.target.closest('tr[data-row]');
  scheduleAutoSave(Number(tr.dataset.row));
});

$('reminderGrid').addEventListener('focusout', (event) => {
  const field = event.target.closest('[data-autosave]');
  if (!field || field.type === 'checkbox' || field.tagName === 'SELECT') return;
  const tr = event.target.closest('tr[data-row]');
  scheduleAutoSave(Number(tr.dataset.row));
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
