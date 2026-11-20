// Runs in the native host before the application's modules, including when a
// stale worker serves an old HTML document whose application script cannot boot.
(() => {
  if (window !== window.top) return;
  const local = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  if (local) {
    Object.defineProperty(window, '__LUMIVERSE_ANDROID_LOCAL__', { value: true });
    const worker = navigator.serviceWorker;
    if (worker) void (async () => {
      const registrations = await worker.getRegistrations();
      const ours = registrations.filter(registration => {
        const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
        return script === `${location.origin}/sw.js`;
      });
      if (!ours.length) return;
      const controlled = worker.controller?.scriptURL === `${location.origin}/sw.js`;
      const removed = await Promise.all(ours.map(registration => registration.unregister()));
      // Keep image caches, extension storage, cookies, and all account data.
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith('workbox-precache-') && name.endsWith(`${location.origin}/`))
          .map(name => caches.delete(name)));
      }
      if (controlled && removed.some(Boolean)) {
        // Storage may be unavailable. In that case leave a manual reload path
        // instead of risking an automatic reload loop.
        const key = 'lumiverse:android-worker-recovery:v1';
        const previous = Number(sessionStorage.getItem(key));
        if (!previous || Math.abs(Date.now() - previous) > 30000) {
          sessionStorage.setItem(key, String(Date.now()));
          location.reload();
        }
      }
    })().catch(error => console.warn('[android] Frontend cache recovery failed', error));
  }

  function recover() {
    const root = document.getElementById('root');
    if (!root || root.childElementCount || document.getElementById('lumiverse-startup-recovery')) return;
    const panel = document.createElement('div');
    panel.id = 'lumiverse-startup-recovery';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;background:#17151f;color:#f2eefb;font:16px/1.5 system-ui;text-align:center';
    const message = document.createElement('p');
    message.textContent = 'Lumiverse could not finish loading. Reload the interface to try again. Your saved data is still on the server.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reload interface';
    button.style.cssText = 'padding:12px 24px;border:0;border-radius:12px;background:#b39ae6;color:#17151f;font:inherit';
    button.addEventListener('click', () => location.reload());
    const hint = document.createElement('p');
    hint.textContent = 'You can also press Android Back to open connection controls.';
    panel.append(message, button, hint);
    document.body.append(panel);
  }
  function watch() { setTimeout(recover, 30000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
})();
