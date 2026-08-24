'use strict';

function isNavigationContextError(error) {
  const message = String(error?.stack || error || '');
  return /execution context was destroyed|cannot find context with specified id|frame was detached/i.test(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeInjectionNavigationResilient(client, options = {}) {
  if (!client || typeof client.inject !== 'function') {
    throw new TypeError('Se requiere un cliente de WhatsApp con el metodo inject().');
  }

  const originalInject = client.inject.bind(client);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 12));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs || 1500));
  const pageReadyTimeoutMs = Math.max(1000, Number(options.pageReadyTimeoutMs || 60000));
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : () => {};
  let activeInjection = null;

  client.inject = (...args) => {
    // WhatsApp can emit several navigation events for the same reload. Sharing one
    // injection prevents duplicate listeners and repeated ready/auth events.
    if (activeInjection) return activeInjection;

    activeInjection = (async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const page = client.pupPage;
          if (page && typeof page.waitForFunction === 'function') {
            if (typeof page.isClosed === 'function' && page.isClosed()) {
              throw new Error('La pagina de WhatsApp Web esta cerrada.');
            }
            // Puppeteer's WaitTask survives a destroyed execution context and
            // resumes automatically after WhatsApp Web finishes navigating.
            await page.waitForFunction(
              'window.Debug?.VERSION != undefined',
              { timeout: pageReadyTimeoutMs },
            );
          }
          return await originalInject(...args);
        } catch (error) {
          if (!isNavigationContextError(error) || attempt >= maxAttempts) throw error;
          onRetry(error, attempt, maxAttempts);
          await delay(retryDelayMs);
        }
      }
      return undefined;
    })().finally(() => {
      activeInjection = null;
    });

    return activeInjection;
  };

  return client;
}

module.exports = {
  isNavigationContextError,
  makeInjectionNavigationResilient,
};
