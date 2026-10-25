function createConnectionHistory({ select, forget, report }) {
  const disclosure = document.getElementById('connection-history');
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const count = document.getElementById('history-count');
  let entries = [];
  let busy = false;
  disclosure.open = new URLSearchParams(location.search).has('history');

  function setBusy(value) {
    busy = value;
    list.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }

  function update(history) {
    entries = Array.isArray(history) ? history : [];
    list.replaceChildren();
    count.textContent = entries.length ? ` (${entries.length})` : '';
    empty.hidden = entries.length > 0;
    entries.forEach(entry => {
      const row = document.createElement('li');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'history-server';
      const hostname = document.createElement('span');
      hostname.className = 'history-hostname';
      try { hostname.textContent = new URL(entry.server).host; } catch { hostname.textContent = entry.server; }
      const address = document.createElement('span');
      address.className = 'history-address';
      address.textContent = entry.server;
      choose.append(hostname, address);
      choose.setAttribute('aria-label', `Use ${entry.server}`);
      choose.addEventListener('click', () => { if (!busy) select(entry); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'history-remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${entry.server} from history`);
      remove.addEventListener('click', async () => {
        if (busy) return;
        setBusy(true);
        try {
          const info = await forget(entry.server);
          update(info.history);
          disclosure.querySelector('summary').focus();
          report('Server removed from history.');
        } catch { report('Could not remove this server from history. Try again.'); }
        finally { setBusy(false); }
      });
      row.append(choose, remove);
      list.append(row);
    });
    setBusy(busy);
  }
  update([]);
  return { update, setBusy, isBusy: () => busy };
}
