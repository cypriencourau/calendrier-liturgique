import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/600.css';
import './style.css';

const CALENDAR_LABELS = { philippines: 'Philippines', france: 'France' };
const COLOR_LABELS = { WHITE: 'Blanc', RED: 'Rouge', GREEN: 'Vert', PURPLE: 'Violet', ROSE: 'Rose', BLACK: 'Noir', GOLD: 'Or' };
const ROMAN = { WEEK_1: 'I', WEEK_2: 'II', WEEK_3: 'III', WEEK_4: 'IV' };
const SEASON_WEEK = {
  ADVENT: (n) => `${ordinal(n)} semaine de l’Avent`,
  LENT: (n) => (n === 6 ? 'Semaine sainte' : `${ordinal(n)} semaine de Carême`),
  EASTER_TIME: (n) => (n === 1 ? 'Octave de Pâques' : `${ordinal(n)} semaine de Pâques`),
  ORDINARY_TIME: (n) => `${ordinal(n)} semaine du Temps ordinaire`,
};

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const longDayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

const $ = (id) => document.getElementById(id);
const state = {
  calendar: readStorage('calendar') ?? 'philippines',
  weekStart: sundayOf(todayIso()),
};
const yearCache = new Map();

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible : réglage non mémorisé */ }
}

function ordinal(n) {
  return n === 1 ? '1ʳᵉ' : `${n}ᵉ`;
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function toDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}
function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function sundayOf(iso) {
  return addDays(iso, -toDate(iso).getUTCDay());
}

async function loadYear(calendar, year) {
  const key = `${calendar}-${year}`;
  if (!yearCache.has(key)) {
    yearCache.set(key, fetch(`data/${calendar}/${year}.json`).then((r) => {
      if (!r.ok) throw new Error(`Données ${year} introuvables`);
      return r.json();
    }));
  }
  try {
    return await yearCache.get(key);
  } catch (err) {
    yearCache.delete(key);
    throw err;
  }
}

async function loadWeek(calendar, startIso) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(startIso, i);
    const year = await loadYear(calendar, Number(iso.slice(0, 4)));
    days.push(year[iso]);
  }
  return days;
}

function weekRangeLabel(startIso) {
  const start = toDate(startIso);
  const end = toDate(addDays(startIso, 6));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const opts = { timeZone: 'UTC', day: 'numeric', month: 'long' };
  const left = new Intl.DateTimeFormat('fr-FR', sameMonth ? { timeZone: 'UTC', day: 'numeric' } : { ...opts, ...(sameYear ? {} : { year: 'numeric' }) }).format(start);
  const right = new Intl.DateTimeFormat('fr-FR', { ...opts, year: 'numeric' }).format(end);
  return `${left} – ${right}`;
}

function seasonLine(sunday, days) {
  const weekLabel = SEASON_WEEK[sunday.season]?.(sunday.weekOfSeason) ?? sunday.seasonLabel;
  const later = days.find((d) => d.season !== sunday.season && d.season !== 'PASCHAL_TRIDUUM');
  const triduum = days.some((d) => d.season === 'PASCHAL_TRIDUUM');
  let line = weekLabel;
  if (triduum) line += ' · Triduum pascal';
  else if (later) line += ` → ${later.seasonLabel} le ${longDayFmt.format(toDate(later.date)).split(' ')[0]}`;
  return line;
}

function cyclesLine(sunday) {
  const parts = [];
  if (sunday.sundayCycle) parts.push(`Année ${sunday.sundayCycle.slice(-1)}`);
  if (sunday.weekdayCycle) parts.push(sunday.weekdayCycle === 'YEAR_2' ? 'année paire' : 'année impaire');
  if (sunday.psalterWeek) parts.push(`psautier semaine ${ROMAN[sunday.psalterWeek]}`);
  return parts.join(' · ');
}

// « lundi de la vingt-huitième semaine du Temps Ordinaire » → « Férie » : la semaine est déjà en en-tête.
const FERIA_SUFFIX = { ORDINARY_TIME: '', ADVENT: ' de l’Avent', LENT: ' de Carême', EASTER_TIME: ' du Temps pascal' };
function displayName(c, day) {
  if (c.rank === 'WEEKDAY' && /^(lundi|mardi|mercredi|jeudi|vendredi|samedi) de la .* semaine/i.test(c.name) && day.season in FERIA_SUFFIX) {
    return `Férie${FERIA_SUFFIX[day.season]}`;
  }
  return c.name;
}

function splitObit(name) {
  const m = name.match(/^(.*?)\s*\((†[^)]*)\)\s*$/);
  return m ? { text: m[1], obit: m[2] } : { text: name, obit: '' };
}

function colorSwatches(colors) {
  return colors.map((c) => `<span class="swatch" data-color="${c}"></span>`).join('');
}
function colorLabel(colors) {
  return colors.map((c) => COLOR_LABELS[c] ?? c).join(' ou ');
}

function renderSummary(days) {
  const sunday = days[0];
  const keyDays = days.filter((d) => d.major || (d.obligation && toDate(d.date).getUTCDay() !== 0));
  const highlights = keyDays.length
    ? `<ul class="highlights">${keyDays.map((d) => {
        const c = d.celebrations[0];
        return `<li><span class="swatch" data-color="${c.colors[0]}"></span><span class="hl-day">${capitalize(dayFmt.format(toDate(d.date)).replace('.', ''))} ${toDate(d.date).getUTCDate()}</span><span class="hl-name">${escapeHtml(capitalize(splitObit(c.name).text))}</span></li>`;
      }).join('')}</ul>`
    : '<p class="highlights-empty">Pas de solennité ni de fête cette semaine.</p>';

  $('summary').innerHTML = `
    <p class="season">${escapeHtml(seasonLine(sunday, days))}</p>
    <p class="cycles">${escapeHtml(cyclesLine(sunday))}</p>
    <div class="highlights-block">
      <h3>À retenir</h3>
      ${highlights}
    </div>`;
}

function renderDay(day, today) {
  const [main, ...others] = day.celebrations;
  const date = toDate(day.date);
  const isSunday = date.getUTCDay() === 0;
  const { text, obit } = splitObit(displayName(main, day));
  const isFeria = main.rank === 'WEEKDAY' && !day.major;
  const classes = ['day', `rank-${main.rank.toLowerCase()}`];
  if (day.major) classes.push('major');
  if (isSunday) classes.push('sunday');
  if (day.date === today) classes.push('today');
  if (isFeria) classes.push('feria');

  const tags = [];
  if (!isFeria || main.note) tags.push(`<span class="rank">${escapeHtml(main.rankLabel)}</span>`);
  if (day.obligation) tags.push('<span class="oblig">Obligation</span>');
  if (day.date === today) tags.push('<span class="today-tag">Aujourd’hui</span>');

  const othersHtml = others.length
    ? `<ul class="others">${others.map((o) => {
        const s = splitObit(o.name);
        return `<li><span class="swatch small" data-color="${o.colors[0]}"></span><span>${escapeHtml(capitalize(s.text))} <em>${escapeHtml(o.rankLabel.toLowerCase())}</em></span></li>`;
      }).join('')}</ul>`
    : '';

  return `
    <article class="${classes.join(' ')}" data-color="${main.colors[0]}">
      <div class="day-date">
        <span class="dow">${dayFmt.format(date).replace('.', '')}</span>
        <span class="num">${date.getUTCDate()}</span>
        <span class="mon">${monthFmt.format(date).replace('.', '')}</span>
      </div>
      <div class="day-body">
        ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
        <h3 class="title">${escapeHtml(capitalize(text))}${obit ? ` <span class="obit">${escapeHtml(obit)}</span>` : ''}</h3>
        ${main.note ? `<p class="note">${escapeHtml(main.note)}</p>` : ''}
        ${othersHtml}
      </div>
      <div class="day-color" title="Couleur liturgique">
        <span class="swatches">${colorSwatches(main.colors)}</span>
        <span class="color-name">${escapeHtml(colorLabel(main.colors))}</span>
      </div>
    </article>`;
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const today = todayIso();
  $('week-range').textContent = weekRangeLabel(state.weekStart);
  $('today').hidden = state.weekStart === sundayOf(today);
  $('calendar-name').textContent = CALENDAR_LABELS[state.calendar];
  $('footer-calendar').textContent = CALENDAR_LABELS[state.calendar];

  try {
    const days = await loadWeek(state.calendar, state.weekStart);
    if (token !== renderToken) return;
    if (days.some((d) => !d)) throw new Error('Semaine hors des années disponibles');
    renderSummary(days);
    $('days').innerHTML = days.map((d) => renderDay(d, today)).join('');
  } catch (err) {
    if (token !== renderToken) return;
    $('summary').innerHTML = '';
    $('days').innerHTML = `<p class="error">Impossible d’afficher cette semaine (${escapeHtml(err.message)}). Vérifie ta connexion puis réessaie.</p>`;
  }
}

function goWeeks(n) {
  state.weekStart = addDays(state.weekStart, 7 * n);
  render();
}

$('prev').addEventListener('click', () => goWeeks(-1));
$('next').addEventListener('click', () => goWeeks(1));
$('today').addEventListener('click', () => {
  state.weekStart = sundayOf(todayIso());
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('dialog')) return;
  if (e.key === 'ArrowLeft') goWeeks(-1);
  if (e.key === 'ArrowRight') goWeeks(1);
});

// Balayage gauche/droite sur téléphone pour changer de semaine.
let touchStart = null;
$('days').addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
$('days').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) goWeeks(dx < 0 ? 1 : -1);
});

// ── Réglages : calendrier + apparence ──────────
const APPEARANCE_KEYS = ['theme', 'accent', 'size', 'font', 'density'];
const settings = $('settings');

function readAppearance() {
  try { return JSON.parse(readStorage('appearance') ?? '{}'); } catch { return {}; }
}

function applyAppearance(prefs) {
  const root = document.documentElement;
  for (const key of APPEARANCE_KEYS) {
    if (prefs[key]) root.dataset[key] = prefs[key];
    else delete root.dataset[key];
  }
}

function syncSettingsForm() {
  settings.querySelector(`input[name="calendar"][value="${state.calendar}"]`).checked = true;
  const prefs = readAppearance();
  for (const key of APPEARANCE_KEYS) {
    const input = settings.querySelector(`input[name="${key}"][value="${prefs[key] ?? ''}"]`);
    if (input) input.checked = true;
  }
}

function openSettings(sectionId) {
  syncSettingsForm();
  settings.showModal();
  if (sectionId) $(sectionId).scrollIntoView({ block: 'start' });
}

$('open-settings').addEventListener('click', () => openSettings('section-calendar'));
$('open-appearance').addEventListener('click', () => openSettings('section-appearance'));
settings.addEventListener('click', (e) => {
  if (e.target === settings) settings.close();
});
settings.querySelectorAll('input[name="calendar"]').forEach((input) => {
  input.addEventListener('change', () => {
    state.calendar = input.value;
    writeStorage('calendar', input.value);
    render();
  });
});
for (const key of APPEARANCE_KEYS) {
  settings.querySelectorAll(`input[name="${key}"]`).forEach((input) => {
    input.addEventListener('change', () => {
      const prefs = { ...readAppearance(), [key]: input.value };
      if (!input.value) delete prefs[key];
      writeStorage('appearance', JSON.stringify(prefs));
      applyAppearance(prefs);
    });
  });
}
$('reset-appearance').addEventListener('click', () => {
  writeStorage('appearance', '{}');
  applyAppearance({});
  syncSettingsForm();
});
applyAppearance(readAppearance());

// Revenir sur l'app un autre jour : on recale sur la bonne semaine.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});

render();

// Précharge l'année en cours et la suivante pour un usage hors ligne.
const year = Number(todayIso().slice(0, 4));
for (const cal of Object.keys(CALENDAR_LABELS)) {
  loadYear(cal, year).catch(() => {});
  loadYear(cal, year + 1).catch(() => {});
}
