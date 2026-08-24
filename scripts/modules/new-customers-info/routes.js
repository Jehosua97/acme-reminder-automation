'use strict';

const express = require('express');
const { LEAD_STATUSES } = require('./store');
const { START_COMMAND, STOP_COMMAND, RESTART_COMMANDS, KOALENDAR_URL } = require('./engine');

function createNewCustomersInfoRouter(service) {
  const router = express.Router();

  router.get('/status', (req, res) => res.json({
    module: 'new-customers-info',
    enabled: true,
    activationCommand: START_COMMAND,
    activationCommands: [START_COMMAND],
    stopCommand: STOP_COMMAND,
    restartCommands: [...RESTART_COMMANDS],
    schedulingUrl: KOALENDAR_URL,
    leadStatuses: LEAD_STATUSES,
    policy: service.policyInfo(),
  }));

  router.patch('/mode', (req, res) => {
    try {
      if (typeof req.body?.testMode !== 'boolean') {
        return res.status(400).json({ error: 'testMode debe ser true o false.' });
      }
      return res.json({ ok: true, policy: service.setTestMode(req.body.testMode) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.patch('/pause', (req, res) => {
    try {
      if (typeof req.body?.paused !== 'boolean') {
        return res.status(400).json({ error: 'paused debe ser true o false.' });
      }
      return res.json({ ok: true, policy: service.setPaused(req.body.paused) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.get('/stats', (req, res) => {
    try { res.json(service.store.stats()); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/contacts', (req, res) => {
    try { res.json({ contacts: service.store.listContacts({ status: req.query.status, search: req.query.search }) }); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get('/contacts/:id', (req, res) => {
    try {
      const contact = service.store.getContact(req.params.id);
      if (!contact) return res.status(404).json({ error: 'Contacto no encontrado.' });
      return res.json({ contact, history: service.store.history(contact.id) });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.patch('/contacts/:id/status', (req, res) => {
    try {
      const contact = service.store.updateLeadStatus(req.params.id, String(req.body?.status || ''));
      if (!contact) return res.status(404).json({ error: 'Contacto no encontrado.' });
      return res.json({ ok: true, contact });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  router.delete('/contacts/:id', (req, res) => {
    try {
      const contact = service.store.deleteContact(req.params.id);
      if (!contact) return res.status(404).json({ error: 'Contacto no encontrado.' });
      return res.json({ ok: true, deletedId: contact.id });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.get('/properties', (req, res) => {
    try { res.json({ properties: service.store.listProperties(), writable: true }); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post('/properties', (req, res) => {
    try { return res.status(201).json({ ok: true, property: service.store.createProperty(req.body || {}) }); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });

  router.patch('/properties/:id', (req, res) => {
    try {
      const property = service.store.updateProperty(req.params.id, req.body || {});
      if (!property) return res.status(404).json({ error: 'Oferta no encontrada.' });
      return res.json({ ok: true, property });
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  router.delete('/properties/:id', (req, res) => {
    try {
      const property = service.store.deleteProperty(req.params.id);
      if (!property) return res.status(404).json({ error: 'Oferta no encontrada.' });
      return res.json({ ok: true, deletedId: property.id });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  });

  router.get('/appointment-settings', (req, res) => {
    try { res.json({ settings: service.store.getAppointmentSettings() }); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.patch('/appointment-settings', (req, res) => {
    try { res.json({ ok: true, settings: service.store.updateAppointmentSettings(req.body || {}) }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.get('/appointments', (req, res) => {
    try { res.json({ appointments: service.store.listAppointments({ status: String(req.query.status || 'SCHEDULED') }) }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  return router;
}

module.exports = { createNewCustomersInfoRouter };
