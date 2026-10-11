// Calcul du calendrier liturgique (forme ordinaire) à partir de Romcal,
// avec les corrections nécessaires pour les Philippines et la France.
// Utilisé au moment du build (données JSON de l'app) et par le script du mail.

import { Romcal } from 'romcal';
import { Philippines_Fr } from '@romcal/calendar.philippines';
import { France_Fr } from '@romcal/calendar.france';

export const CALENDARS = {
  philippines: {
    label: 'Philippines',
    bundle: Philippines_Fr,
    // Aux Philippines, Épiphanie, Ascension et Saint-Sacrement sont célébrés le dimanche.
    options: { epiphanyOnSunday: true, ascensionOnSunday: true, corpusChristiOnSunday: true },
    // Jours d'obligation hors dimanches (CBCP).
    obligations: ['mary_mother_of_god', 'immaculate_conception_of_the_blessed_virgin_mary', 'nativity_of_the_lord'],
  },
  france: {
    label: 'France',
    bundle: France_Fr,
    options: {},
    // Les quatre fêtes d'obligation en France.
    obligations: ['nativity_of_the_lord', 'ascension_of_the_lord', 'assumption_of_the_blessed_virgin_mary', 'all_saints'],
  },
};

export const RANK_LABELS = {
  SOLEMNITY: 'Solennité',
  SUNDAY: 'Dimanche',
  FEAST: 'Fête',
  MEMORIAL: 'Mémoire',
  OPTIONAL_MEMORIAL: 'Mémoire facultative',
  WEEKDAY: 'Férie',
};

export const COLOR_LABELS = {
  WHITE: 'Blanc',
  RED: 'Rouge',
  GREEN: 'Vert',
  PURPLE: 'Violet',
  ROSE: 'Rose',
  BLACK: 'Noir',
  GOLD: 'Or',
};

const RANK_ORDER = ['SOLEMNITY', 'SUNDAY', 'FEAST', 'MEMORIAL', 'OPTIONAL_MEMORIAL', 'WEEKDAY'];

// Jours de semaine qui ne sont pas des fêtes mais qu'il faut voir venir.
const MAJOR_PRECEDENCES = ['TRIDUUM_1', 'ASH_WEDNESDAY_2', 'WEEKDAY_OF_HOLY_WEEK_2'];
const MAJOR_IDS = ['holy_thursday'];

// Noms français pour les célébrations propres aux Philippines que Romcal ne traduit pas.
const NAME_OVERRIDES = {
  philippines: {
    immaculate_conception_of_the_blessed_virgin_mary: 'Immaculée Conception de la Vierge Marie, patronne des Philippines',
    our_lady_of_guadalupe: 'Notre-Dame de Guadalupe, patronne des Philippines',
    ezequiel_moreno_bishop: 'Saint Ezequiel Moreno, évêque († 1906)',
  },
  france: {},
};

// Note pratique affichée sous certaines célébrations.
const NOTES = {
  holy_saturday: 'Pas de messe le jour ; Vigile pascale la nuit (blanc)',
  advent_3_sunday: 'Gaudete : rose ou violet',
  lent_4_sunday: 'Laetare : rose ou violet',
};

const SEASON_LABELS = {
  ADVENT: 'Temps de l’Avent',
  CHRISTMAS_TIME: 'Temps de Noël',
  LENT: 'Carême',
  PASCHAL_TRIDUUM: 'Triduum pascal',
  EASTER_TIME: 'Temps pascal',
  ORDINARY_TIME: 'Temps ordinaire',
};

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const dayOfWeek = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function thirdSundayOfJanuary(year) {
  const firstDow = dayOfWeek(isoDate(year, 1, 1));
  const firstSunday = 1 + ((7 - firstDow) % 7);
  return isoDate(year, 1, firstSunday + 14);
}

function celebration(entry, calendarKey) {
  const c = {
    id: entry.id,
    name: (NAME_OVERRIDES[calendarKey][entry.id] ?? entry.name).replace(/ and /g, ' et ').replace(/Temps Ordinaire/g, 'Temps ordinaire'),
    rank: entry.rank,
    colors: entry.colors ?? [],
    optional: Boolean(entry.isOptional),
    note: NOTES[entry.id],
    precedence: entry.precedence,
  };
  if (entry.id === 'holy_saturday') c.colors = ['PURPLE'];
  if (entry.id === 'thursday_of_the_lords_supper') c.rankLabel = 'Messe du soir';
  // Sans couleur propre, une mémoire tombant en Carême ou en fin d'Avent n'est
  // qu'une commémoraison : on garde la couleur du jour.
  if (!c.colors.length && ['MEMORIAL', 'OPTIONAL_MEMORIAL'].includes(c.rank)) {
    Object.assign(c, { rank: 'OPTIONAL_MEMORIAL', optional: true, rankLabel: 'Commémoraison' });
  }
  return c;
}

// Une fête propre ne remplace que les féries et les mémoires (jamais un dimanche
// ordinaire, sauf autorisation explicite comme pour le Santo Niño).
function placeFeast(day, feast, { replaceSunday = false } = {}) {
  if (!day) return;
  const principal = day.celebrations[0];
  const canReplace =
    ['WEEKDAY', 'MEMORIAL', 'OPTIONAL_MEMORIAL'].includes(principal.rank) ||
    (replaceSunday && principal.rank === 'SUNDAY' && principal.precedence === 'UNPRIVILEGED_SUNDAY_6');
  if (!canReplace || MAJOR_PRECEDENCES.includes(principal.precedence)) return;
  day.celebrations = [feast];
}

function applyPhilippinesProper(days, year) {
  // Saint Pedro Calungsod : déplacé au 21 octobre et élevé au rang de fête (depuis l'Avent 2024).
  for (const day of Object.values(days)) {
    day.celebrations = day.celebrations.filter((c) => c.id !== 'pedro_calungsod_martyr');
    if (!day.celebrations.length) day.celebrations = [day.fallback];
  }
  placeFeast(days[isoDate(year, 10, 21)], {
    id: 'pedro_calungsod_martyr', name: 'Saint Pedro Calungsod, martyr († 1672)',
    rank: 'FEAST', colors: ['RED'], optional: false,
  });

  // Saint Lorenzo Ruiz et ses compagnons : élevé au rang de fête.
  const ruizDay = days[isoDate(year, 9, 28)];
  const ruiz = ruizDay?.celebrations.find((c) => c.id === 'lawrence_ruiz_and_companions_martyrs');
  if (ruiz) {
    placeFeast(ruizDay, {
      ...ruiz, name: 'Saint Lorenzo Ruiz et ses compagnons, martyrs († 1633-1637)', rank: 'FEAST', optional: false,
    });
  }

  // Notre-Seigneur Jésus le Nazaréen (Traslación), 9 janvier : fête.
  placeFeast(days[isoDate(year, 1, 9)], {
    id: 'black_nazarene', name: 'Notre-Seigneur Jésus le Nazaréen (Traslación)',
    rank: 'FEAST', colors: ['WHITE'], optional: false,
  });

  // Santo Niño, 3ᵉ dimanche de janvier : fête qui remplace le dimanche ordinaire.
  placeFeast(days[thirdSundayOfJanuary(year)], {
    id: 'santo_nino', name: 'Le Saint Enfant Jésus (Santo Niño)',
    rank: 'FEAST', colors: ['WHITE'], optional: false,
  }, { replaceSunday: true });

  // Saint Ezequiel Moreno : mémoire facultative.
  for (const day of Object.values(days)) {
    for (const c of day.celebrations) if (c.id === 'ezequiel_moreno_bishop') { c.rank = 'OPTIONAL_MEMORIAL'; c.optional = true; }
  }
}

function finalizeDay(day, calendarKey) {
  // Mémoires facultatives : elles ne s'affichent que si le jour est une férie.
  day.celebrations.sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
  const principal = day.celebrations[0];
  if (!['WEEKDAY', 'OPTIONAL_MEMORIAL'].includes(principal.rank)) {
    day.celebrations = [principal];
  }
  // La férie passe en premier, les mémoires facultatives en dessous.
  if (principal.rank === 'OPTIONAL_MEMORIAL' && day.fallback.rank === 'WEEKDAY') {
    day.celebrations = [day.fallback, ...day.celebrations.filter((c) => c.optional)];
  }
  for (const c of day.celebrations) if (!c.colors.length) c.colors = day.fallback.colors.length ? day.fallback.colors : ['WHITE'];
  const main = day.celebrations[0];
  const isSunday = dayOfWeek(day.date) === 0;
  return {
    date: day.date,
    celebrations: day.celebrations.map(({ precedence, ...c }) => ({ ...c, rankLabel: c.rankLabel ?? RANK_LABELS[c.rank] })),
    obligation: isSunday || CALENDARS[calendarKey].obligations.includes(main.id),
    major: ['SOLEMNITY', 'FEAST'].includes(main.rank) || MAJOR_PRECEDENCES.includes(main.precedence) || MAJOR_IDS.includes(main.id),
    season: day.season,
    seasonLabel: SEASON_LABELS[day.season] ?? '',
    weekOfSeason: day.weekOfSeason,
    sundayCycle: day.sundayCycle,
    weekdayCycle: day.weekdayCycle,
    psalterWeek: day.psalterWeek,
  };
}

const cache = new Map();

export async function buildYear(calendarKey, year) {
  const key = `${calendarKey}-${year}`;
  if (cache.has(key)) return cache.get(key);
  const cal = CALENDARS[calendarKey];
  if (!cal) throw new Error(`Calendrier inconnu : ${calendarKey}`);

  const romcal = new Romcal({ localizedCalendar: cal.bundle, ...cal.options });
  const raw = await romcal.generateCalendar(year);

  const days = {};
  for (const [date, entries] of Object.entries(raw)) {
    const first = entries[0];
    const proper = entries.find((e) => e.fromCalendarId === 'ProperOfTime') ?? first;
    days[date] = {
      date,
      celebrations: entries.map((e) => celebration(e, calendarKey)),
      fallback: celebration(proper, calendarKey),
      season: first.calendar?.seasons?.[0] ?? first.seasons?.[0],
      weekOfSeason: first.calendar?.weekOfSeason,
      sundayCycle: first.cycles?.sundayCycle,
      weekdayCycle: first.cycles?.weekdayCycle,
      psalterWeek: first.cycles?.psalterWeek,
    };
  }

  if (calendarKey === 'philippines') applyPhilippinesProper(days, year);

  const result = {};
  for (const date of Object.keys(days).sort()) result[date] = finalizeDay(days[date], calendarKey);
  cache.set(key, result);
  return result;
}

// Renvoie les jours de `startIso` à `startIso + count - 1`, à cheval sur deux années si besoin.
export async function getDays(calendarKey, startIso, count = 7) {
  const out = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const year = await buildYear(calendarKey, d.getUTCFullYear());
    out.push(year[iso]);
  }
  return out;
}
