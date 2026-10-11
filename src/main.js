import '@fontsource-variable/manrope';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter-tight';
import './style.css';
import INTENTIONS from '../lib/intentions-pape.json';

const CALENDAR_LABELS = { philippines: 'Philippines', france: 'France' };
const COLOR_LABELS = { WHITE: 'Blanc', RED: 'Rouge', GREEN: 'Vert', PURPLE: 'Violet', ROSE: 'Rose', BLACK: 'Noir', GOLD: 'Or' };
const THEME_COLORS = { lumiere: '#f3ecdc', missel: '#f7f4ed', nuit: '#0b0b0c' };
const ROMAN = { WEEK_1: 'I', WEEK_2: 'II', WEEK_3: 'III', WEEK_4: 'IV' };
const DAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const SEASON_WEEK = {
  ADVENT: (n) => `${ordinal(n)} semaine de l’Avent`,
  LENT: (n) => (n === 6 ? 'Semaine sainte' : `${ordinal(n)} semaine de Carême`),
  EASTER_TIME: (n) => (n === 1 ? 'Octave de Pâques' : `${ordinal(n)} semaine de Pâques`),
  ORDINARY_TIME: (n) => `${ordinal(n)} semaine du Temps ordinaire`,
};
// « lundi de la vingt-huitième semaine du Temps Ordinaire » → « Férie » : la semaine est déjà en en-tête.
const FERIA_SUFFIX = { ORDINARY_TIME: '', ADVENT: ' de l’Avent', LENT: ' de Carême', EASTER_TIME: ' du Temps pascal' };

const fmt = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts });
const dowShortFmt = fmt({ weekday: 'short' });
const dowLongFmt = fmt({ weekday: 'long' });
const dayMonthFmt = fmt({ day: 'numeric', month: 'long' });
const monthLongFmt = fmt({ month: 'long' });
const MOON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>';

const $ = (id) => document.getElementById(id);
const state = {
  calendar: readStorage('calendar') ?? 'philippines',
  weekStart: sundayOf(todayIso()),
  selected: todayIso(),
  days: [],
};
const yearCache = new Map();

// ── Utilitaires ─────────────────────────────
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible : réglage non mémorisé */ }
}
function ordinal(n) { return n === 1 ? '1ʳᵉ' : `${n}ᵉ`; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function toDate(iso) { return new Date(`${iso}T00:00:00Z`); }
function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function sundayOf(iso) { return addDays(iso, -toDate(iso).getUTCDay()); }

function splitObit(name) {
  const m = name.match(/^(.*?)\s*\((†[^)]*)\)\s*$/);
  return m ? { text: m[1], obit: m[2] } : { text: name, obit: '' };
}
function shortName(c, day) {
  if (c.rank === 'WEEKDAY' && /^(lundi|mardi|mercredi|jeudi|vendredi|samedi) de la .* semaine/i.test(c.name) && day.season in FERIA_SUFFIX) {
    return `Férie${FERIA_SUFFIX[day.season]}`;
  }
  return capitalize(splitObit(c.name).text);
}
// Nom compact pour la liste : « Sainte Thérèse de Jésus (d’Avila), vierge… » → « Sainte Thérèse de Jésus (d’Avila) ».
function listName(c, day) {
  return shortName(c, day).replace(/\s*\(†[^)]*\)/g, '').split(',')[0];
}
function colorLabel(colors) { return colors.map((c) => COLOR_LABELS[c] ?? c).join(' ou '); }
function isFeria(day) { return day.celebrations[0].rank === 'WEEKDAY' && !day.major; }
function isKeyDay(day) { return day.major || (day.obligation && toDate(day.date).getUTCDay() !== 0); }

// ── Données ─────────────────────────────────
async function loadYear(calendar, year) {
  const key = `${calendar}-${year}`;
  if (!yearCache.has(key)) {
    yearCache.set(key, fetch(`data/${calendar}/${year}.json`).then((r) => {
      if (!r.ok) throw new Error(`données ${year} introuvables`);
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

// ── En-tête de semaine ──────────────────────
function weekRangeLabel(startIso) {
  const start = toDate(startIso);
  const end = toDate(addDays(startIso, 6));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const left = sameMonth ? String(start.getUTCDate()) : dayMonthFmt.format(start);
  return `${left} – ${dayMonthFmt.format(end)}`;
}

function seasonLine(days) {
  const sunday = days[0];
  const label = SEASON_WEEK[sunday.season]?.(sunday.weekOfSeason) ?? sunday.seasonLabel;
  if (days.some((d) => d.season === 'PASCHAL_TRIDUUM')) return `${label} · Triduum pascal`;
  const change = days.find((d) => d.season !== sunday.season);
  return change ? `${label} → ${change.seasonLabel} le ${dowLongFmt.format(toDate(change.date))}` : label;
}

function cyclesLine(day) {
  return [
    day.sundayCycle && `Année ${day.sundayCycle.slice(-1)}`,
    day.weekdayCycle && (day.weekdayCycle === 'YEAR_2' ? 'année paire' : 'année impaire'),
    day.psalterWeek && `psautier ${ROMAN[day.psalterWeek]}`,
  ].filter(Boolean).join(' · ');
}

// ── Rendu ───────────────────────────────────
function renderStrip(days, today) {
  $('strip').innerHTML = days.map((d) => {
    const date = toDate(d.date);
    const main = d.celebrations[0];
    const classes = ['strip-day'];
    if (d.date === state.selected) classes.push('is-selected');
    if (d.date === today) classes.push('is-today');
    if (isKeyDay(d)) classes.push('is-key');
    return `<button type="button" class="${classes.join(' ')}" data-date="${d.date}" data-color="${main.colors[0]}"
        aria-pressed="${d.date === state.selected}" aria-label="${escapeHtml(capitalize(dowLongFmt.format(date)))} ${date.getUTCDate()} : ${escapeHtml(shortName(main, d))}">
      <span class="strip-letter">${DAY_LETTERS[date.getUTCDay()]}</span>
      <span class="strip-num">${date.getUTCDate()}</span>
      <span class="dot"></span>
    </button>`;
  }).join('');
}

const PLURAL_LABELS = { 'Mémoire facultative': 'Mémoires facultatives', 'Commémoraison': 'Commémoraisons' };
function othersLabel(others) {
  const label = others[0].rankLabel;
  if (!others.every((o) => o.rankLabel === label)) return 'Également';
  return others.length > 1 ? (PLURAL_LABELS[label] ?? label) : label;
}

function renderHero(day, today, hero = $('hero')) {
  const [main, ...others] = day.celebrations;
  const date = toDate(day.date);
  const { obit } = splitObit(main.name);
  const title = isFeria(day) ? capitalize(splitObit(main.name).text) : shortName(main, day);

  const tags = [];
  if (!isFeria(day) || main.rankLabel !== 'Férie') tags.push(`<span class="tag tag-rank">${escapeHtml(main.rankLabel)}</span>`);
  if (day.obligation) tags.push('<span class="tag tag-oblig">Obligation</span>');

  const othersHtml = others.length
    ? `<div class="hero-others">
        <p class="hero-label">${escapeHtml(othersLabel(others))}</p>
        <ul>${others.map((o) => `<li><span class="dot" data-color="${o.colors[0]}"></span>${escapeHtml(capitalize(splitObit(o.name).text))}</li>`).join('')}</ul>
      </div>`
    : '';

  hero.dataset.color = main.colors[0];
  hero.className = `hero${day.major ? ' is-major' : ''}${main.rank === 'SOLEMNITY' ? ' is-solemnity' : ''}`;
  hero.innerHTML = `
    <div class="hero-top">
      <p class="hero-date">${day.date === today ? '<span class="today-chip">Aujourd’hui</span>' : ''}${escapeHtml(capitalize(dowLongFmt.format(date)))} ${escapeHtml(dayMonthFmt.format(date))}</p>
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    </div>
    <h2 class="hero-title">${escapeHtml(title)}</h2>
    ${obit ? `<p class="hero-obit">${escapeHtml(obit)}</p>` : ''}
    ${main.note ? `<p class="hero-note">${escapeHtml(main.note)}</p>` : ''}
    <div class="hero-color">
      <span class="swatches">${main.colors.map((c) => `<span class="swatch" data-color="${c}"></span>`).join('')}</span>
      <span><span class="hero-label">Couleur liturgique</span><strong>${escapeHtml(colorLabel(main.colors))}</strong></span>
    </div>
    ${othersHtml}
    ${vespersHtml(day, today)}`;
}

// « Ce soir : 1res Vêpres de… » — l'oubli classique la veille des dimanches et solennités.
function vespersHtml(day, today) {
  if (!day.firstVespers) return '';
  const when = day.date === today ? 'Ce soir' : 'Le soir';
  return `<div class="hero-vespers">
      <span class="vespers-icon">${MOON_ICON}</span>
      <span><span class="hero-label">${when} · 1ʳᵉˢ Vêpres</span><strong>${escapeHtml(capitalize(splitObit(day.firstVespers.name).text))}</strong></span>
    </div>`;
}

function renderKey(days) {
  const keyDays = days.filter(isKeyDay);
  $('key').hidden = keyDays.length === 0;
  $('key').innerHTML = `
    <h2 class="section-title">À retenir</h2>
    <ul class="key-list">${keyDays.map((d) => {
      const main = d.celebrations[0];
      const date = toDate(d.date);
      return `<li><button type="button" data-date="${d.date}" data-color="${main.colors[0]}">
        <span class="dot"></span>
        <span class="key-day">${escapeHtml(capitalize(dowShortFmt.format(date).replace('.', '')))} ${date.getUTCDate()}</span>
        <span class="key-name">${escapeHtml(shortName(main, d))}</span>
        <span class="key-rank">${escapeHtml(main.rankLabel)}</span>
      </button></li>`;
    }).join('')}</ul>`;
}

// Intention de prière du Pape pour le mois de la semaine affichée (celui du mercredi).
function renderIntention(days) {
  const date = toDate(days[3].date);
  const key = days[3].date.slice(0, 7);
  const intention = INTENTIONS[key];
  $('intention').hidden = !intention;
  if (!intention) return;
  $('intention').innerHTML = `
    <h2 class="section-title">Intention du Pape · ${escapeHtml(monthLongFmt.format(date))}</h2>
    <p class="intention-title">${escapeHtml(intention.title)}</p>
    <p class="intention-text">${escapeHtml(intention.text)}</p>`;
}

function renderList(days, today) {
  $('week-list').innerHTML = days.map((d) => {
    const [main, ...others] = d.celebrations;
    const date = toDate(d.date);
    const meta = [];
    if (!isFeria(d)) meta.push(main.rankLabel);
    if (d.obligation) meta.push('Obligation');
    if (others.length) meta.push(others.map((o) => capitalize(splitObit(o.name).text).split(',')[0]).join(' · '));
    const solemnityEve = d.firstVespers?.rank === 'SOLEMNITY';
    const classes = ['row', `rank-${main.rank.toLowerCase().replace('_', '-')}`];
    if (d.major) classes.push('is-major');
    if (isFeria(d)) classes.push('is-feria');
    if (d.date === state.selected) classes.push('is-selected');
    if (d.date === today) classes.push('is-today');
    return `<li><button type="button" class="${classes.join(' ')}" data-date="${d.date}" data-color="${main.colors[0]}">
      <span class="row-date"><span class="row-dow">${escapeHtml(dowShortFmt.format(date).replace('.', ''))}</span><span class="row-num">${date.getUTCDate()}</span></span>
      <span class="row-body">
        <span class="row-name">${escapeHtml(listName(main, d))}</span>
        ${meta.length ? `<span class="row-meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
        ${solemnityEve ? `<span class="row-vespers">${MOON_ICON}1ʳᵉˢ Vêpres le soir</span>` : ''}
      </span>
      <span class="dot"></span>
    </button></li>`;
  }).join('');
}

function renderSelection() {
  const today = todayIso();
  const day = state.days.find((d) => d.date === state.selected) ?? state.days[0];
  renderStrip(state.days, today);
  renderHero(day, today);
  renderList(state.days, today);
}

let renderToken = 0;
async function render(direction = 0) {
  const token = ++renderToken;
  const today = todayIso();
  $('footer-calendar').textContent = CALENDAR_LABELS[state.calendar];
  $('week-range').textContent = weekRangeLabel(state.weekStart);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  if (!weekDates.includes(state.selected)) state.selected = weekDates.includes(today) ? today : state.weekStart;
  $('today').disabled = state.selected === today;

  try {
    const days = await loadWeek(state.calendar, state.weekStart);
    if (token !== renderToken) return;
    if (days.some((d) => !d)) throw new Error('semaine hors des années disponibles');
    state.days = days;
    $('season').textContent = seasonLine(days);
    $('cycles').textContent = cyclesLine(days[0]);
    renderKey(days);
    renderIntention(days);
    renderSelection();
    if (direction) {
      const content = $('content');
      content.classList.remove('slide-next', 'slide-prev');
      void content.offsetWidth;
      content.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
    }
  } catch (err) {
    if (token !== renderToken) return;
    $('hero').className = 'hero';
    $('hero').innerHTML = `<p class="error">Impossible d’afficher cette semaine (${escapeHtml(err.message)}). Vérifie ta connexion puis réessaie.</p>`;
    $('week-list').innerHTML = '';
    $('key').hidden = true;
  }
}

function goWeeks(n) {
  state.weekStart = addDays(state.weekStart, 7 * n);
  state.selected = '';
  render(n);
}

function select(iso) {
  state.selected = iso;
  $('today').disabled = iso === todayIso();
  renderSelection();
}

// ── Fiche du jour (téléphone) ───────────────
const isPhone = () => window.matchMedia('(max-width: 999px)').matches;
const daySheet = $('day-sheet');

function renderSheet() {
  const day = state.days.find((d) => d.date === state.selected);
  if (day) renderHero(day, todayIso(), $('sheet-hero'));
}

function openDaySheet(iso) {
  select(iso);
  renderSheet();
  if (!daySheet.open) daySheet.showModal();
}

// Jour précédent / suivant depuis la fiche, en changeant de semaine si besoin.
async function shiftDay(n) {
  const iso = addDays(state.selected, n);
  if (sundayOf(iso) !== state.weekStart) {
    state.weekStart = sundayOf(iso);
    state.selected = iso;
    await render(n);
  } else {
    select(iso);
  }
  renderSheet();
}

$('sheet-prev').addEventListener('click', () => shiftDay(-1));
$('sheet-next').addEventListener('click', () => shiftDay(1));
$('sheet-close').addEventListener('click', () => daySheet.close());
daySheet.addEventListener('click', (e) => {
  if (e.target === daySheet) daySheet.close();
});
// Glisser la fiche vers le bas pour la fermer, sur les côtés pour changer de jour.
let sheetTouch = null;
daySheet.addEventListener('touchstart', (e) => {
  sheetTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
daySheet.addEventListener('touchend', (e) => {
  if (!sheetTouch) return;
  const dx = e.changedTouches[0].clientX - sheetTouch.x;
  const dy = e.changedTouches[0].clientY - sheetTouch.y;
  sheetTouch = null;
  if (dy > 90 && dy > Math.abs(dx)) daySheet.close();
  else if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftDay(dx < 0 ? 1 : -1);
});

// ── Interactions ────────────────────────────
$('prev').addEventListener('click', () => goWeeks(-1));
$('next').addEventListener('click', () => goWeeks(1));
$('today').addEventListener('click', () => {
  const today = todayIso();
  const sameWeek = sundayOf(today) === state.weekStart;
  state.weekStart = sundayOf(today);
  state.selected = today;
  if (sameWeek) select(today);
  else render();
});
for (const id of ['strip', 'week-list', 'key']) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    if (isPhone()) openDaySheet(btn.dataset.date);
    else select(btn.dataset.date);
  });
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('dialog')) return;
  if (e.key === 'ArrowLeft') goWeeks(-1);
  if (e.key === 'ArrowRight') goWeeks(1);
});

// Balayage gauche/droite sur téléphone pour changer de semaine.
let touchStart = null;
$('content').addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
$('content').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) goWeeks(dx < 0 ? 1 : -1);
});

// ── Réglages ────────────────────────────────
const settings = $('settings');

function readAppearance() {
  try { return JSON.parse(readStorage('appearance') ?? '{}'); } catch { return {}; }
}
function applyAppearance(prefs) {
  const root = document.documentElement;
  root.dataset.style = prefs.style || 'lumiere';
  if (prefs.size) root.dataset.size = prefs.size;
  else delete root.dataset.size;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[root.dataset.style];
}
function openSettings(sectionId) {
  const prefs = readAppearance();
  settings.querySelector(`input[name="calendar"][value="${state.calendar}"]`).checked = true;
  settings.querySelector(`input[name="style"][value="${prefs.style || 'lumiere'}"]`).checked = true;
  settings.querySelector(`input[name="size"][value="${prefs.size || ''}"]`).checked = true;
  settings.showModal();
  if (sectionId) $(sectionId).scrollIntoView({ block: 'start' });
}

$('open-settings').addEventListener('click', () => openSettings());
settings.addEventListener('click', (e) => {
  if (e.target === settings) settings.close();
});
settings.addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'calendar') {
    state.calendar = value;
    writeStorage('calendar', value);
    render();
    return;
  }
  const prefs = { ...readAppearance(), [name]: value };
  if (!value) delete prefs[name];
  writeStorage('appearance', JSON.stringify(prefs));
  applyAppearance(prefs);
});

applyAppearance(readAppearance());

// Revenir sur l'app un autre jour : on recale sur la bonne semaine.
let lastSeenDay = todayIso();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || todayIso() === lastSeenDay) return;
  lastSeenDay = todayIso();
  state.weekStart = sundayOf(lastSeenDay);
  state.selected = lastSeenDay;
  render();
});

render();

// Précharge l'année en cours et la suivante pour un usage hors ligne.
const year = Number(todayIso().slice(0, 4));
for (const cal of Object.keys(CALENDAR_LABELS)) {
  loadYear(cal, year).catch(() => {});
  loadYear(cal, year + 1).catch(() => {});
}
