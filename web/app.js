const state = {
  reminders: [],
  houses: [],
  categories: [],
  selectedHouses: new Set(),
  modalRow: null,
  modalMode: 'edit',
  categoryMenuOpen: false,
  houseMenuOpen: false,
  saveTimers: new Map(),
  savingRows: new Set(),
  refreshPaused: false,
};

const $ = (id) => document.getElementById(id);

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

function filteredReminders() {
  const category = $('categoryFilter').value;
  const status = $('statusFilter').value;
  const active = $('activeFilter').value;
  const search = $('searchBox').value.trim().toLowerCase();

  return state.reminders.filter((r) => {
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

function renderReminders() {
  const body = $('reminderGrid');
  const reminders = filteredReminders();

  if (!reminders.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty">No hay recordatorios con esos filtros.</td></tr>';
    return;
  }

  body.innerHTML = reminders.map((r) => `
    <tr data-row="${r.row}" class="${state.savingRows.has(r.row) ? 'saving' : ''}">
      <td class="mono">${r.row}</td>
      <td class="house-cell">${escapeHtml(r.group)}</td>
      <td class="category-readonly">${escapeHtml(r.category || 'Sin categoría')}</td>
      <td class="days-cell">
        ${dayCheckbox(r, 'lun', 'L')}
        ${dayCheckbox(r, 'mar', 'M')}
        ${dayCheckbox(r, 'mie', 'X')}
        ${dayCheckbox(r, 'jue', 'J')}
        ${dayCheckbox(r, 'vie', 'V')}
        ${dayCheckbox(r, 'sab', 'S')}
        ${dayCheckbox(r, 'dom', 'D')}
      </td>
      <td><input class="time-input" name="hora" data-autosave value="${escapeHtml(r.hora)}" placeholder="10:20 hrs" /></td>
      <td>
        <select name="activo" data-autosave>
          <option ${r.activo === 'SI' ? 'selected' : ''}>SI</option>
          <option ${r.activo === 'NO' ? 'selected' : ''}>NO</option>
        </select>
      </td>
      <td>
        <select name="enviarManual" data-autosave>
          <option ${r.enviarManual === 'NO' ? 'selected' : ''}>NO</option>
          <option ${r.enviarManual === 'SI' ? 'selected' : ''}>SI</option>
        </select>
      </td>
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
  return {
    group: current.group,
    category: current.category,
    hora: tr.querySelector('[name="hora"]').value,
    activo: tr.querySelector('[name="activo"]').value,
    enviarManual: tr.querySelector('[name="enviarManual"]').value,
    mensaje: current.mensaje,
    days: {
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
  return {
    group: $('modalGroup').value.trim(),
    category: $('modalCategory').value.trim(),
    hora: $('modalHora').value.trim(),
    activo: $('modalActivo').value,
    enviarManual: $('modalManual').value,
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
  state.houses = workbook.houses;
  state.categories = workbook.categories;
  if (filters) state.selectedHouses = new Set([...filters.houses].filter((h) => state.houses.includes(h)));
  renderFilters();
  restoreFilters(filters);
  renderFilters();
  renderReminders();
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
    if (!quiet) toast('Guardado en Excel.');
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
  $('modalSubtitle').textContent = 'Estos cambios se guardan directamente en Excel.';
  setModalHouse(reminder.group || '');
  state.houseMenuOpen = false;
  renderHouseCombo();
  setModalCategory(reminder.category || '');
  state.categoryMenuOpen = false;
  renderCategoryCombo();
  $('modalHora').value = reminder.hora || '';
  $('modalActivo').value = reminder.activo || 'NO';
  $('modalManual').value = reminder.enviarManual || 'NO';
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
  $('modalSubtitle').textContent = 'Se creará una nueva fila en Excel.';
  setModalHouse(state.houses[0] || '');
  state.houseMenuOpen = false;
  renderHouseCombo();
  setModalCategory(state.categories[0] || '');
  state.categoryMenuOpen = false;
  renderCategoryCombo();
  $('modalHora').value = '';
  $('modalActivo').value = 'SI';
  $('modalManual').value = 'NO';
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
      toast('Recordatorio agregado en Excel.');
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
  const ok = window.confirm(`Vas a eliminar la fila ${row} de Excel:\n\n${reminder.group}\n${reminder.category}\n\nEsta acción no se puede deshacer automáticamente. ¿Continuar?`);
  if (!ok) return;

  try {
    const data = await api(`/api/reminders/${row}`, { method: 'DELETE' });
    updateStateFromWorkbook(data.workbook, filters);
    toast('Recordatorio eliminado de Excel.');
  } catch (error) {
    toast(`Error eliminando fila ${row}: ${error.message}`);
  }
}

async function loadReminders() {
  if (state.refreshPaused || state.savingRows.size) return;
  const filters = captureFilters();
  const data = await api('/api/reminders');
  state.reminders = data.reminders;
  state.houses = data.houses;
  state.categories = data.categories;
  state.selectedHouses = new Set([...filters.houses].filter((h) => state.houses.includes(h)));
  renderFilters();
  restoreFilters(filters);
  renderFilters();
  renderReminders();
}

async function loadStatus() {
  const s = await api('/api/status');
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
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const tr = event.target.closest('tr[data-row]');
  const row = Number(tr.dataset.row);

  if (button.dataset.action === 'edit') openEditModal(row);
  if (button.dataset.action === 'delete') deleteRow(row);
});

$('reminderGrid').addEventListener('change', (event) => {
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

$('editModalForm').addEventListener('submit', (event) => {
  event.preventDefault();
  saveModal();
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
        ? `La casa "${house}" está usada en ${usos} recordatorio(s).\n\nSi continúas, se quitará esa casa de esas filas y se marcarán como Activo = NO para evitar envíos accidentales. ¿Continuar?`
        : `¿Eliminar la casa "${house}" del selector?`
    );
    if (!ok) return;

    if (usos) {
      try {
        const data = await api(`/api/houses/${encodeURIComponent(house)}`, { method: 'DELETE' });
        updateStateFromWorkbook(data.workbook);
        setModalHouse('');
        renderHouseCombo();
        toast('Casa eliminada de Excel y filas desactivadas.');
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
        ? `La categoría "${category}" está usada en ${usos} recordatorio(s).\n\nSi continúas, esa categoría se quitará de esas filas en Excel. ¿Continuar?`
        : `¿Eliminar la categoría "${category}" del selector?`
    );
    if (!ok) return;

    if (usos) {
      try {
        const data = await api(`/api/categories/${encodeURIComponent(category)}`, { method: 'DELETE' });
        updateStateFromWorkbook(data.workbook);
        setModalCategory('');
        renderCategoryCombo();
        toast('Categoría eliminada de Excel.');
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
$('pauseToggle').addEventListener('click', togglePause);
$('refreshStatus').addEventListener('click', () => loadStatus().then(() => toast('Estado actualizado.')));
$('startService').addEventListener('click', () => serviceAction('/api/service/start', 'Servicio iniciado.'));
$('stopService').addEventListener('click', () => serviceAction('/api/service/stop', 'Servicio detenido.'));
$('restartService').addEventListener('click', () => serviceAction('/api/service/restart', 'Servicio reiniciado.'));

loadReminders().catch((e) => toast(e.message));
loadStatus().catch(() => {});
setInterval(loadStatus, 15000);
setInterval(() => {
  const active = document.activeElement;
  const editingInline = active && active.closest && active.closest('#reminderGrid');
  if (!editingInline) loadReminders().catch(() => {});
}, 20000);
