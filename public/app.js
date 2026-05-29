const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

let selected = new Date().getDay();

const navEl = document.getElementById('days');
const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');

function isSocial(name) {
  return /social|baile/i.test(name);
}

function card(ev) {
  const acts = ev.activities
    .map(
      (a) =>
        `<li class="${isSocial(a.name) ? 'social' : ''}"><span class="time">${a.time}</span><span class="name">${a.name}</span></li>`
    )
    .join('');
  const venue = ev.venue
    ? `<div class="venue">📍 ${ev.mapUrl ? `<a href="${ev.mapUrl}" target="_blank" rel="noopener">${ev.venue}</a>` : ev.venue}</div>`
    : '';
  return `<article class="card">
      <h2>${ev.title || ev.venue || 'Soirée'}</h2>
      ${venue}
      <ul class="acts">${acts}</ul>
    </article>`;
}

async function render() {
  navEl.innerHTML = DAYS.map(
    (d, i) => `<button data-day="${i}" class="${i === selected ? 'active' : ''}">${d}</button>`
  ).join('');

  listEl.innerHTML = '<p class="loading">Chargement…</p>';
  try {
    const res = await fetch(`/api/events?day=${selected}`);
    const data = await res.json();
    if (!data.events.length) {
      listEl.innerHTML = `<p class="empty">Aucune soirée connue pour ${FULL[selected]}.<br/>Le bot ajoutera dès qu'un message tombe dans le groupe.</p>`;
    } else {
      listEl.innerHTML = data.events.map(card).join('');
    }
    statusEl.textContent = `Maj : ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch {
    listEl.innerHTML = '<p class="empty">Serveur injoignable.</p>';
  }
}

navEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  selected = Number(btn.dataset.day);
  render();
});

render();
setInterval(render, 60000); // rafraichit chaque minute
