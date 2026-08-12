'use strict';

const express = require('express');

function createSystemRouter(service) {
  const router = express.Router();
  router.get('/status', (req, res) => { try { res.json(service.info()); } catch (error) { res.status(500).json({ error: error.message }); } });
  router.post('/system/pause', (req, res) => { try { service.pause(); res.json({ ok: true, message: 'Sistema pausado.', status: service.info() }); } catch (error) { res.status(500).json({ error: error.message }); } });
  router.post('/system/resume', (req, res) => { try { service.resume(); res.json({ ok: true, message: 'Sistema reanudado.', status: service.info() }); } catch (error) { res.status(500).json({ error: error.message }); } });
  router.post('/service/start', (req, res) => {
    const current = service.info();
    if (current.running) return res.json({ ok: true, message: 'Servicio ya esta corriendo.', status: current });
    const result = service.start();
    if (result.status !== 0) return res.status(500).json({ ok: false, message: 'No se pudo iniciar el servicio.', stdout: result.stdout, stderr: result.stderr });
    return res.json({ ok: true, message: 'Servicio iniciado.', stdout: result.stdout, status: service.info() });
  });
  router.post('/service/stop', (req, res) => { const result = service.stop(); res.json({ ok: result.status === 0, stdout: result.stdout, stderr: result.stderr }); });
  router.post('/service/restart', (req, res) => { service.stop(); const result = service.start(); res.json({ ok: result.status === 0, message: result.status === 0 ? 'Servicio reiniciado.' : 'No se pudo reiniciar el servicio.', stdout: result.stdout, stderr: result.stderr }); });
  return router;
}

module.exports = { createSystemRouter };
