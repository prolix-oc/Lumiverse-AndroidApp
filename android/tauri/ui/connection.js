const server = document.getElementById('server');
const status = document.getElementById('status');
const controls = [...document.querySelectorAll('button, input')];
const invoke = (action, server) => window.__TAURI_INTERNALS__.invoke('mobile_connection', { action, server: server ?? null });
const remoteEnabled = document.getElementById('remote-enabled');
const remotePort = document.getElementById('remote-port');
let remoteState = { enabled: false };
let busy = true;
controls.forEach(control => { control.disabled = true; });
function updateRemoteAccess(state) {
  remoteState = state || { enabled: false };
  remoteEnabled.checked = !!remoteState.enabled;
  if (remoteState.enabled) remotePort.value = remoteState.port;
  remotePort.disabled = busy || !!remoteState.enabled;
  document.getElementById('close-frontend').hidden = !remoteState.enabled || !remoteState.ready;
  document.getElementById('remote-status').textContent = remoteState.enabled
    ? (remoteState.ready ? (remoteState.urls || []).join('\n') : 'Starting remote access…')
      + (remoteState.networkChanged ? '\nNetwork changed. Turn remote access off and on to update its addresses.' : '')
    : 'Only this device can connect.';
}
async function refreshRemoteAccess() {
  if (!busy && !document.hidden) {
    try { const state = await invoke('remote-access-info'); if (!busy) updateRemoteAccess(state); } catch { /* Keep the last confirmed state. */ }
  }
}
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
    updateRemoteAccess(remoteState);
  }
}

document.getElementById('local').addEventListener('click', () => { void connect('local'); });
document.getElementById('connection-form').addEventListener('submit', event => {
  event.preventDefault();
  void connect('remote');
});
remoteEnabled.addEventListener('change', async () => {
  if (busy) return;
  const enabled = remoteEnabled.checked;
  if (enabled && !remotePort.reportValidity()) { remoteEnabled.checked = false; return; }
  busy = true;
  controls.forEach(control => { control.disabled = true; });
  historyPicker.setBusy(true);
  status.textContent = enabled ? 'Enabling remote access…' : 'Returning to device-only access…';
  try {
    await window.__TAURI_INTERNALS__.invoke('mobile_connection', {
      action: enabled ? 'remote-on' : 'remote-off', server: null,
      ...(enabled ? { port: Number(remotePort.value) } : {}),
    });
    status.textContent = enabled ? 'Remote access enabled. You can close the frontend.' : 'Remote access disabled.';
  } catch (error) {
    status.textContent = typeof error === 'string' ? error : (error?.message || 'Could not change remote access.');
  } finally {
    busy = false;
    controls.forEach(control => { control.disabled = false; });
    historyPicker.setBusy(false);
    updateRemoteAccess(remoteState);
    await refreshRemoteAccess();
  }
});
document.getElementById('close-frontend').addEventListener('click', () => {
  if (!busy) void invoke('close').catch(error => { status.textContent = String(error); });
});
document.getElementById('battery-settings').addEventListener('click', () => {
  void invoke('battery-settings').catch(error => { status.textContent = String(error); });
});
invoke('info').then(info => {
  server.value = info.server || '';
  historyPicker.update(info.history);
  remotePort.value = info.port || 7860;
  busy = false;
  controls.forEach(control => { control.disabled = false; });
  updateRemoteAccess(info.remoteAccess);
  if (!new URLSearchParams(location.search).has('changeServer') && info.mode) void connect(info.mode);
}).catch(() => {
  busy = false;
  controls.forEach(control => { control.disabled = false; });
  updateRemoteAccess(remoteState);
  status.textContent = 'Could not restore your connection. Choose an option to continue.';
});
setInterval(() => { void refreshRemoteAccess(); }, 3000);
