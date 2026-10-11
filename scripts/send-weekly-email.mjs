// Envoie le récap de la semaine liturgique à venir (du lundi au dimanche suivant).
//
// Variables d'environnement :
//   GMAIL_USER          adresse Gmail qui envoie (et reçoit, sauf si MAIL_TO est défini)
//   GMAIL_APP_PASSWORD  mot de passe d'application Gmail
//   MAIL_TO             destinataire (facultatif)
//   START_DATE          date de départ forcée AAAA-MM-JJ (facultatif, pour tester)
//
// Sans identifiants, le mail est écrit dans mail-preview.html au lieu d'être envoyé.

import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { getDays, CALENDARS, COLOR_LABELS } from '../lib/liturgie.mjs';

const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const INTENTIONS = JSON.parse(await readFile(new URL('../lib/intentions-pape.json', import.meta.url), 'utf8'));

// Palette du style Lumière (mêmes jetons que l'app).
const C = { bg: '#f3ecdc', surface: '#fffdf8', ink: '#141210', muted: '#6e675b', faint: '#a69e90', line: '#ebe4d3' };
const FONT = "'Manrope', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const LIT = { WHITE: '#f6efdc', RED: '#c23a33', GREEN: '#2f8a57', PURPLE: '#6a46a8', ROSE: '#e08aa4', BLACK: '#2b2b2b', GOLD: '#d4a93c' };
const LIT_EDGE = { ...LIT, WHITE: '#c8a24a' };
// Teinte douce de la carte héros selon la couleur du jour.
const HERO_TINT = { WHITE: '#fbf3df', RED: '#fbe9e6', GREEN: '#e8f3ec', PURPLE: '#efe9f7', ROSE: '#fcedf1', BLACK: '#ececec', GOLD: '#fbf1d9' };
const RANK_ORDER = ['SOLEMNITY', 'FEAST', 'SUNDAY', 'MEMORIAL', 'OPTIONAL_MEMORIAL', 'WEEKDAY'];
const ROMAN = { WEEK_1: 'I', WEEK_2: 'II', WEEK_3: 'III', WEEK_4: 'IV' };
const FERIA_SUFFIX = { ORDINARY_TIME: '', ADVENT: ' de l’Avent', LENT: ' de Carême', EASTER_TIME: ' du Temps pascal' };
const SEASON_WEEK = {
  ADVENT: (n) => `${ordinal(n)} semaine de l’Avent`,
  LENT: (n) => (n === 6 ? 'Semaine sainte' : `${ordinal(n)} semaine de Carême`),
  EASTER_TIME: (n) => (n === 1 ? 'Octave de Pâques' : `${ordinal(n)} semaine de Pâques`),
  ORDINARY_TIME: (n) => `${ordinal(n)} semaine du Temps ordinaire`,
};

const fmt = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...opts });
const dowFmt = fmt({ weekday: 'long' });
const dayMonthFmt = fmt({ day: 'numeric', month: 'long' });
const monthLongFmt = fmt({ month: 'long' });

function ordinal(n) { return n === 1 ? '1ʳᵉ' : `${n}ᵉ`; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function toDate(iso) { return new Date(`${iso}T00:00:00Z`); }
function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Date du jour dans le fuseau configuré (Manille, puis Paris).
function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Lundi qui suit (le lendemain si on est dimanche).
function nextMonday(iso) {
  const dow = toDate(iso).getUTCDay();
  return addDays(iso, ((8 - dow) % 7) || 7);
}

function stripObit(name) { return name.replace(/\s*\(†[^)]*\)\s*$/, ''); }

function displayName(c, day) {
  if (c.rank === 'WEEKDAY' && /^(lundi|mardi|mercredi|jeudi|vendredi|samedi) de la .* semaine/i.test(c.name) && day.season in FERIA_SUFFIX) {
    return `Férie${FERIA_SUFFIX[day.season]}`;
  }
  return stripObit(capitalize(c.name));
}

function colorLabel(colors) { return colors.map((c) => COLOR_LABELS[c] ?? c).join(' ou '); }

function seasonLine(days) {
  // L'en-tête suit le dimanche qui ouvre la semaine liturgique du lundi.
  const ref = days.find((d) => toDate(d.date).getUTCDay() === 1) ?? days[0];
  const label = SEASON_WEEK[ref.season]?.(ref.weekOfSeason) ?? ref.seasonLabel;
  const change = days.find((d) => d.season !== ref.season && d.season !== 'PASCHAL_TRIDUUM');
  if (days.some((d) => d.season === 'PASCHAL_TRIDUUM')) return `${label} · Triduum pascal`;
  return change ? `${label} → ${change.seasonLabel} le ${dowFmt.format(toDate(change.date))}` : label;
}

function cyclesLine(day) {
  return [
    day.sundayCycle && `Année ${day.sundayCycle.slice(-1)}`,
    day.weekdayCycle && (day.weekdayCycle === 'YEAR_2' ? 'année paire' : 'année impaire'),
    day.psalterWeek && `psautier ${ROMAN[day.psalterWeek]}`,
  ].filter(Boolean).join(' · ');
}

function isKeyDay(d) {
  return d.major || (d.obligation && toDate(d.date).getUTCDay() !== 0);
}

// Le temps fort de la semaine : la célébration de plus haut rang (le dimanche à défaut).
function highlightDay(days) {
  const score = (d) => RANK_ORDER.indexOf(d.celebrations[0].rank) - (d.major ? 10 : 0);
  return [...days].sort((a, b) => score(a) - score(b) || a.date.localeCompare(b.date))[0];
}

// ── Morceaux de HTML (tables + styles en ligne, pour tous les clients mail) ──

function dot(color, size = 10) {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${LIT[color]};border:1px solid ${LIT_EDGE[color]};vertical-align:middle;line-height:0;font-size:0;">&nbsp;</span>`;
}

function pill(text, dark) {
  const look = dark
    ? `background:${C.ink};color:${C.surface};`
    : `background:${C.surface};color:${C.ink};border:1px solid #ddd5c4;`;
  return `<span style="display:inline-block;padding:4px 11px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.2;${look}">${escapeHtml(text)}</span>`;
}

function label(text) {
  return `<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${escapeHtml(text)}</div>`;
}

function renderHero(day) {
  const main = day.celebrations[0];
  const color = main.colors[0];
  const tags = [];
  if (!(main.rank === 'WEEKDAY' && !day.major)) tags.push(pill(main.rankLabel, false));
  if (day.obligation) tags.push(pill('Obligation', true));
  const date = toDate(day.date);

  return `<tr><td style="padding:0 0 14px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${HERO_TINT[color]};border-radius:28px;border:1px solid ${C.line};">
      <tr><td style="padding:22px 22px 20px;">
        ${label(`Temps fort · ${capitalize(dowFmt.format(date))} ${dayMonthFmt.format(date)}`)}
        ${tags.length ? `<div style="margin-top:12px;">${tags.join('&nbsp;')}</div>` : ''}
        <div style="margin-top:16px;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${C.ink};">${escapeHtml(displayName(main, day))}</div>
        ${main.note ? `<div style="margin-top:8px;font-size:14px;color:${C.muted};">${escapeHtml(main.note)}</div>` : ''}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;border-top:1px solid rgba(20,18,16,.08);">
          <tr>
            <td style="padding-top:14px;width:40px;">${main.colors.map((c) => dot(c, 34)).join('')}</td>
            <td style="padding-top:14px;padding-left:12px;">
              <div style="font-size:12px;font-weight:600;color:${C.muted};">Couleur liturgique</div>
              <div style="font-size:17px;font-weight:700;color:${C.ink};">${escapeHtml(colorLabel(main.colors))}</div>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`;
}

function renderKey(keyDays) {
  const rows = keyDays.map((d, i) => {
    const c = d.celebrations[0];
    const border = i ? `border-top:1px solid ${C.line};` : '';
    return `<tr>
      <td style="${border}padding:9px 10px 9px 0;width:12px;">${dot(c.colors[0])}</td>
      <td style="${border}padding:9px 10px 9px 0;font-size:14px;font-weight:700;white-space:nowrap;color:${C.ink};">${escapeHtml(capitalize(dowFmt.format(toDate(d.date)).slice(0, 3)))} ${toDate(d.date).getUTCDate()}</td>
      <td style="${border}padding:9px 0;font-size:14px;font-weight:600;color:${C.ink};">${escapeHtml(displayName(c, d))}</td>
      <td style="${border}padding:9px 0 9px 8px;font-size:12px;font-weight:600;color:${C.muted};text-align:right;white-space:nowrap;">${escapeHtml(c.rankLabel)}</td>
    </tr>`;
  }).join('');

  return `<tr><td style="padding:0 0 14px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.surface};border-radius:22px;border:1px solid ${C.line};">
      <tr><td style="padding:16px 18px 8px;">
        ${label('À retenir')}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:4px;">${rows}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

function renderRow(d) {
  const [main, ...others] = d.celebrations;
  const date = toDate(d.date);
  const feria = main.rank === 'WEEKDAY' && !d.major;
  const meta = [];
  if (!feria) meta.push(main.rankLabel);
  if (d.obligation) meta.push('Obligation');
  if (others.length) meta.push(others.map((o) => stripObit(capitalize(o.name)).split(',')[0]).join(' · '));
  const nameStyle = feria
    ? `font-size:15px;font-weight:500;color:${C.muted};`
    : `font-size:${d.major ? 17 : 15}px;font-weight:700;color:${C.ink};`;

  return `<tr><td style="padding:0 0 6px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${d.major ? C.surface : '#f9f4e8'};border-radius:16px;${d.major ? `border:1px solid ${C.line};` : ''}">
      <tr>
        <td style="width:46px;padding:12px 0 12px 12px;text-align:center;vertical-align:middle;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};">${escapeHtml(dowFmt.format(date).slice(0, 3))}</div>
          <div style="font-size:19px;font-weight:700;line-height:1.1;color:${C.ink};">${date.getUTCDate()}</div>
        </td>
        <td style="padding:12px;vertical-align:middle;">
          <div style="${nameStyle}line-height:1.3;">${escapeHtml(displayName(main, d))}</div>
          ${meta.length ? `<div style="font-size:12px;color:${C.muted};margin-top:2px;">${escapeHtml(meta.join(' · '))}</div>` : ''}
          ${d.firstVespers?.rank === 'SOLEMNITY' ? `<div style="font-size:12px;font-weight:700;color:${C.ink};margin-top:3px;">☾ 1ʳᵉˢ Vêpres le soir : ${escapeHtml(stripObit(capitalize(d.firstVespers.name)))}</div>` : ''}
        </td>
        <td style="width:30px;padding:12px 16px 12px 0;text-align:right;vertical-align:middle;">${dot(main.colors[0], d.major ? 14 : 10)}</td>
      </tr>
    </table>
  </td></tr>`;
}

// Intention du Pape du mois qui couvre l'essentiel de la semaine (celui du jeudi).
function intentionFor(days) {
  const key = days[3].date.slice(0, 7);
  return INTENTIONS[key] ? { ...INTENTIONS[key], month: monthLongFmt.format(toDate(days[3].date)) } : null;
}

function renderIntention(intention) {
  return `<tr><td style="padding:12px 0 0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.surface};border-radius:22px;border:1px solid ${C.line};">
      <tr><td style="padding:16px 18px;">
        ${label(`Intention du Pape · ${intention.month}`)}
        <div style="margin-top:8px;font-size:16px;font-weight:700;line-height:1.3;color:${C.ink};">${escapeHtml(intention.title)}</div>
        <div style="margin-top:6px;font-size:14px;line-height:1.5;color:${C.muted};">${escapeHtml(intention.text)}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

function renderHtml(days, appUrl) {
  const first = toDate(days[0].date);
  const last = toDate(days[days.length - 1].date);
  const range = first.getUTCMonth() === last.getUTCMonth()
    ? `${first.getUTCDate()} – ${dayMonthFmt.format(last)}`
    : `${dayMonthFmt.format(first)} – ${dayMonthFmt.format(last)}`;
  const hero = highlightDay(days);
  const keyDays = days.filter(isKeyDay);
  const showKey = keyDays.some((d) => d !== hero);

  const link = appUrl
    ? `<tr><td style="padding:18px 0 0;text-align:center;">
        <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:15px 34px;border-radius:999px;background:${C.ink};color:${C.surface};text-decoration:none;font-size:15px;font-weight:700;">Ouvrir l’app</a>
      </td></tr>`
    : '';

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">
<title>Semaine liturgique</title></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${FONT};color:${C.ink};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${C.bg}" style="background-color:${C.bg};background-image:radial-gradient(70% 40% at 0% 0%, #fffaf0 0%, rgba(255,250,240,0) 70%), radial-gradient(60% 35% at 100% 18%, #efdcae 0%, rgba(239,220,174,0) 70%);">
    <tr><td align="center" style="padding:28px 14px 32px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;font-family:${FONT};">
        <tr><td style="padding:0 4px;">${label('Semaine liturgique')}</td></tr>
        <tr><td style="padding:14px 4px 0;font-size:34px;line-height:1.05;font-weight:700;letter-spacing:-0.03em;color:${C.ink};">${escapeHtml(range)}</td></tr>
        <tr><td style="padding:10px 4px 0;font-size:15px;font-weight:600;color:${C.ink};">${escapeHtml(seasonLine(days))}</td></tr>
        <tr><td style="padding:2px 4px 22px;font-size:13px;color:${C.muted};">${escapeHtml(cyclesLine(days[0]))}</td></tr>
        ${renderHero(hero)}
        ${showKey ? renderKey(keyDays) : ''}
        <tr><td style="padding:10px 4px;">${label('La semaine')}</td></tr>
        ${days.map(renderRow).join('')}
        ${intentionFor(days) ? renderIntention(intentionFor(days)) : ''}
        ${link}
        <tr><td style="padding:22px 0 0;text-align:center;font-size:11px;color:${C.faint};">Forme ordinaire du rite romain · calendrier ${escapeHtml(CALENDARS[config.calendar].label)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(days, appUrl) {
  const lines = [`Semaine liturgique — ${seasonLine(days)}`, cyclesLine(days[0]), ''];
  const keyDays = days.filter(isKeyDay);
  if (keyDays.length) {
    lines.push('À RETENIR');
    for (const d of keyDays) lines.push(`  • ${capitalize(dowFmt.format(toDate(d.date)))} ${toDate(d.date).getUTCDate()} : ${displayName(d.celebrations[0], d)}`);
    lines.push('');
  }
  for (const d of days) {
    const [main, ...others] = d.celebrations;
    const date = toDate(d.date);
    const rank = main.rank === 'WEEKDAY' && !d.major ? '' : `${main.rankLabel}, `;
    lines.push(`${capitalize(dowFmt.format(date))} ${dayMonthFmt.format(date)} — ${displayName(main, d)} (${rank}${colorLabel(main.colors).toLowerCase()})${d.obligation ? ' · obligation' : ''}`);
    for (const o of others) lines.push(`    ${stripObit(capitalize(o.name))} (${o.rankLabel.toLowerCase()})`);
    if (d.firstVespers?.rank === 'SOLEMNITY') lines.push(`    Le soir : 1res Vêpres — ${stripObit(capitalize(d.firstVespers.name))}`);
  }
  const intention = intentionFor(days);
  if (intention) lines.push('', `INTENTION DU PAPE (${intention.month}) : ${intention.title}`, intention.text);
  if (appUrl) lines.push('', `App : ${appUrl}`);
  return lines.join('\n');
}

const start = process.env.START_DATE || nextMonday(todayIn(config.timezone));
const days = await getDays(config.calendar, start, 7);
const html = renderHtml(days, config.appUrl);
const text = renderText(days, config.appUrl);
const subject = `Semaine liturgique du ${dayMonthFmt.format(toDate(days[0].date))} au ${dayMonthFmt.format(toDate(days[6].date))}`
  + (days.some(isKeyDay) ? ` · ${days.filter(isKeyDay).map((d) => displayName(d.celebrations[0], d)).join(', ')}` : '');

const { GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_TO } = process.env;
if ((!GMAIL_USER || !GMAIL_APP_PASSWORD) && process.env.CI) {
  console.error('Identifiants Gmail manquants : ajoute les secrets GMAIL_USER et GMAIL_APP_PASSWORD dans GitHub.');
  process.exit(1);
} else if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  await writeFile(new URL('../mail-preview.html', import.meta.url), html);
  console.log(`Aperçu écrit dans mail-preview.html (pas d'identifiants Gmail, rien n'a été envoyé).\nSujet : ${subject}\n\n${text}`);
} else {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const info = await transporter.sendMail({
    from: `"Semaine liturgique" <${GMAIL_USER}>`,
    to: MAIL_TO || GMAIL_USER,
    subject,
    text,
    html,
  });
  console.log(`Mail envoyé : ${subject} (${info.messageId})`);
}
