const requirements = document.querySelector('#requirements');
const form = document.querySelector('#install-form');
const error = document.querySelector('#install-error');

async function checkRequirements() {
  try {
    const response = await fetch('/api/install/status', { headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (data.installed) {
      location.reload();
      return;
    }
    const labels = { php:`PHP 8.2 oder neuer · ${data.phpVersion || ''}`, pdoSqlite:'SQLite-Unterstützung', json:'JSON-Unterstützung', mbstring:'Mehrbyte-Zeichen', openssl:'Verschlüsselung', writableStorage:'Beschreibbarer Datenspeicher' };
    const checks = data.checks || {};
    requirements.innerHTML = Object.entries(checks).map(([name, ok]) => `<p class="${ok ? 'ok' : 'fail'}">${ok ? '✓' : '×'} ${labels[name] || name}</p>`).join('');
    if (data.ready) form.hidden = false;
    else requirements.insertAdjacentHTML('beforeend', '<p class="fail">Behebe die markierten Punkte und lade diese Seite neu.</p>');
  } catch {
    requirements.innerHTML = '<p class="fail">Die Systemprüfung konnte nicht ausgeführt werden.</p>';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  const values = Object.fromEntries(new FormData(form));
  if (values.adminPassword !== values.confirmPassword) {
    error.textContent = 'Die Passwörter stimmen nicht überein.';
    return;
  }
  delete values.confirmPassword;
  values.demoData = form.elements.demoData.checked;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/api/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Die Einrichtung ist fehlgeschlagen.');
    location.replace('/');
  } catch (failure) {
    error.textContent = failure.message;
    button.disabled = false;
  }
});

checkRequirements();
