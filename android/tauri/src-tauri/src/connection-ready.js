// Error pages never acknowledge a connection. No account or session data is saved.
(() => {
  if (window !== window.top) return;
  function ready() {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation?.responseStatus !== undefined && (navigation.responseStatus < 200 || navigation.responseStatus >= 400)) return;
    window.lumiverseConnectionHistory?.postMessage('ready');
  }
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
})();
