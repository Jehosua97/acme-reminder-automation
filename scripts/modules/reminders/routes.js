'use strict';

const express = require('express');

function parseRow(value) {
  const row = Number(value);
  return Number.isInteger(row) && row >= 1 ? row : null;
}

function createReminderRouter(store) {
  const router = express.Router();

  router.get('/reminders', (req, res) => {
    try { res.json(store.readWorkbookLike()); } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/settings', (req, res) => {
    try { res.json(store.readSettings()); } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/settings', (req, res) => {
    try { res.json({ ok: true, settings: store.writeSettings(req.body || {}) }); } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/reminders', (req, res) => {
    try { res.json({ ok: true, workbook: store.createReminder(req.body || {}) }); } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/cleaning-rotations', (req, res) => {
    try { res.json({ ok: true, workbook: store.createCleaningRotation(req.body || {}) }); } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.patch('/reminders/:row', (req, res) => {
    try {
      const row = parseRow(req.params.row);
      if (!row) return res.status(400).json({ error: 'Id de recordatorio invalido.' });
      return res.json({ ok: true, workbook: store.updateReminder(row, req.body || {}) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.delete('/reminders/:row', (req, res) => {
    try {
      const row = parseRow(req.params.row);
      if (!row) return res.status(400).json({ error: 'Id de recordatorio invalido.' });
      return res.json({ ok: true, workbook: store.deleteReminder(row) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.post('/reminders/bulk-delete', (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      res.json({ ok: true, workbook: store.deleteReminders(rows) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/reminders/bulk-active', (req, res) => {
    try {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const activo = req.body?.activo === 'SI' ? 'SI' : 'NO';
      res.json({ ok: true, workbook: store.updateRemindersActive(rows, activo) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.patch('/cleaning-rotations/:house', (req, res) => {
    try {
      const house = decodeURIComponent(req.params.house || '').trim();
      if (!house) return res.status(400).json({ error: 'Casa / grupo invalido.' });
      return res.json({ ok: true, workbook: store.updateCleaningRotation(house, req.body || {}) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.delete('/cleaning-rotations/:house', (req, res) => {
    try {
      const house = decodeURIComponent(req.params.house || '').trim();
      if (!house) return res.status(400).json({ error: 'Casa / grupo invalido.' });
      return res.json({ ok: true, workbook: store.deleteCleaningRotation(house) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.delete('/categories/:category', (req, res) => {
    try {
      const category = decodeURIComponent(req.params.category || '').trim();
      if (!category) return res.status(400).json({ error: 'Categoria invalida.' });
      return res.json({ ok: true, workbook: store.deleteCategory(category) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.delete('/houses/:house', (req, res) => {
    try {
      const house = decodeURIComponent(req.params.house || '').trim();
      if (!house) return res.status(400).json({ error: 'Casa / grupo invalido.' });
      return res.json({ ok: true, workbook: store.deleteHouse(house) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  return router;
}

module.exports = { createReminderRouter };
