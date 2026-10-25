const server = document.getElementById('server');
const status = document.getElementById('status');
const controls = [...document.querySelectorAll('button, input')];
const invoke = (action, server) => window.__TAURI_INTERNALS__.invoke('mobile_connection', { action, server: server ?? null });
let busy = false;
const historyPicker = createConnectionHistory({
  select: entry => {
    server.value = entry.server;
    status.textContent = 'Server selected. Tap Connect to continue.';
    document.getElementById('connect').focus();
  },
  forget: server => invoke('forget', server),
  report: message => { status.textContent = message; },
});

async function connect(action) {
  if (busy || historyPicker.isBusy()) return;
  busy = true;
  controls.forEach(control => { control.disabled = true; });
  historyPicker.setBusy(true);
  status.textContent = action === 'local' ? 'Preparing your local backend…' : 'Connecting to your server…';
  try {
    await invoke(action, server.value);
  } catch (error) {
    status.textContent = typeof error === 'string' ? error : (error?.message || 'Could not connect. Try again.');
  } finally {
    controls.forEach(control => { control.disabled = false; });
    historyPicker.setBusy(false);
    busy = false;
  }
}

document.getElementById('local').addEventListener('click', () => { void connect('local'); });
document.getElementById('connection-form').addEventListener('submit', event => {
  event.preventDefault();
  void connect('remote');
});
invoke('info').then(info => {
  server.value = info.server || '';
  historyPicker.update(info.history);
  if (!new URLSearchParams(location.search).has('changeServer') && info.mode) void connect(info.mode);
}).catch(() => { status.textContent = 'Could not restore your connection. Choose an option to continue.'; });
