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

const SWATCH = { WHITE: '#fbf8f0', RED: '#b3262e', GREEN: '#2e7a4d', PURPLE: '#5b3a8c', ROSE: '#d4849a', BLACK: '#2a2a2a', GOLD: '#c9a54a' };
const TINT = { WHITE: '#faf4e2', RED: '#f8e3e4', GREEN: '#e5f1ea', PURPLE: '#ece6f4', ROSE: '#f9e9ee', BLACK: '#e8e8e8', GOLD: '#f6efd9' };
const BAR = { ...SWATCH, WHITE: '#c9a54a' };
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
const fullFmt = fmt({ day: 'numeric', month: 'long', year: 'numeric' });

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

function displayName(c, day) {
  if (c.rank === 'WEEKDAY' && /^(lundi|mardi|mercredi|jeudi|vendredi|samedi) de la .* semaine/i.test(c.name) && day.season in FERIA_SUFFIX) {
    return `Férie${FERIA_SUFFIX[day.season]}`;
  }
  return stripObit(capitalize(c.name));
}

function stripObit(name) { return name.replace(/\s*\(†[^)]*\)\s*$/, ''); }

function colorLabel(colors) { return colors.map((c) => COLOR_LABELS[c] ?? c).join(' ou '); }

function dot(color, size = 12) {
  const border = color === 'WHITE' ? '1.5px solid #c9a54a' : '1px solid rgba(0,0,0,.12)';
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${SWATCH[color]};border:${border};vertical-align:middle;"></span>`;
}

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
    day.psalterWeek && `psautier semaine ${ROMAN[day.psalterWeek]}`,
  ].filter(Boolean).join(' · ');
}

function isKeyDay(d) {
  return d.major || (d.obligation && toDate(d.date).getUTCDay() !== 0);
}

function renderHtml(days, appUrl) {
  const first = days[0];
  const last = days[days.length - 1];
  const keyDays = days.filter(isKeyDay);

  const highlights = keyDays.length
    ? keyDays.map((d) => {
        const c = d.celebrations[0];
        return `<tr>
          <td style="padding:3px 8px 3px 0;width:14px;">${dot(c.colors[0])}</td>
          <td style="padding:3px 10px 3px 0;font-weight:600;white-space:nowrap;font-size:14px;">${capitalize(dowFmt.format(toDate(d.date)))} ${toDate(d.date).getUTCDate()}</td>
          <td style="padding:3px 0;font-family:Georgia,serif;font-size:15px;">${escapeHtml(displayName(c, d))}${d.obligation ? ' <span style="color:#7a1f2b;font-family:Arial,sans-serif;font-size:11px;font-weight:600;">· OBLIGATION</span>' : ''}</td>
        </tr>`;
      }).join('')
    : '<tr><td style="color:#6f665b;font-size:14px;">Pas de solennité ni de fête cette semaine.</td></tr>';

  const rows = days.map((d) => {
    const [main, ...others] = d.celebrations;
    const color = main.colors[0];
    const date = toDate(d.date);
    const isFeria = main.rank === 'WEEKDAY' && !d.major;
    const bg = d.major ? TINT[color] : '#fffdf9';
    const tags = [];
    if (!isFeria) tags.push(`<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;${d.major ? `background:${BAR[color]};color:${color === 'WHITE' ? '#3d2f0c' : '#fff'};` : 'border:1px solid #e6dfd3;color:#6f665b;'}">${escapeHtml(main.rankLabel)}</span>`);
    if (d.obligation) tags.push('<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid #7a1f2b;color:#7a1f2b;">Obligation</span>');
    const title = isFeria
      ? `<div style="font-size:14px;color:#6f665b;">${escapeHtml(displayName(main, d))}</div>`
      : `<div style="font-family:Georgia,serif;font-size:${d.major ? 18 : 16}px;font-weight:${d.major ? 700 : 400};color:#1f1b16;line-height:1.25;">${escapeHtml(displayName(main, d))}</div>`;
    const note = main.note ? `<div style="font-size:12px;color:#6f665b;font-style:italic;margin-top:3px;">${escapeHtml(main.note)}</div>` : '';
    const othersHtml = others.map((o) => `<div style="font-size:13px;color:#6f665b;margin-top:3px;">${dot(o.colors[0], 8)}&nbsp; ${escapeHtml(stripObit(capitalize(o.name)))} <i style="color:#a39a8d;font-size:12px;">${escapeHtml(o.rankLabel.toLowerCase())}</i></div>`).join('');

    return `<tr><td style="padding:0 0 8px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:${bg};border:1px solid #e6dfd3;border-left:${d.major ? 7 : 5}px solid ${BAR[color]};border-radius:10px;">
        <tr>
          <td style="width:52px;padding:10px 0 10px 10px;text-align:center;vertical-align:top;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6f665b;">${dowFmt.format(date).slice(0, 3)}</div>
            <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;line-height:1.1;color:#1f1b16;">${date.getUTCDate()}</div>
          </td>
          <td style="padding:10px 10px;vertical-align:top;">
            ${tags.length ? `<div style="margin-bottom:4px;">${tags.join(' ')}</div>` : ''}
            ${title}${note}${othersHtml}
          </td>
          <td style="width:58px;padding:10px 10px 10px 0;text-align:center;vertical-align:top;">
            ${main.colors.map((c) => dot(c, isFeria ? 14 : 20)).join(' ')}
            <div style="font-size:11px;color:#6f665b;margin-top:3px;">${escapeHtml(colorLabel(main.colors))}</div>
          </td>
        </tr>
      </table>
    </td></tr>`;
  }).join('');

  const link = appUrl
    ? `<p style="text-align:center;margin:18px 0 0;"><a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#1f1b16;color:#f7f3ec;text-decoration:none;font-size:14px;font-weight:600;">Ouvrir l’app</a></p>`
    : '';

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Semaine liturgique</title></head>
<body style="margin:0;padding:0;background:#f7f3ec;font-family:Arial,Helvetica,sans-serif;color:#1f1b16;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3ec;"><tr><td align="center" style="padding:20px 12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
      <tr><td style="text-align:center;padding-bottom:4px;font-family:Georgia,serif;color:#7a1f2b;font-size:15px;font-weight:700;">Semaine liturgique</td></tr>
      <tr><td style="text-align:center;font-family:Georgia,serif;font-size:20px;font-weight:700;">Du ${escapeHtml(dowFmt.format(toDate(first.date)))} ${escapeHtml(dayMonthFmt.format(toDate(first.date)))} au ${escapeHtml(dowFmt.format(toDate(last.date)))} ${escapeHtml(fullFmt.format(toDate(last.date)))}</td></tr>
      <tr><td style="text-align:center;font-family:Georgia,serif;font-style:italic;font-size:16px;padding-top:6px;">${escapeHtml(seasonLine(days))}</td></tr>
      <tr><td style="text-align:center;font-size:13px;color:#6f665b;padding:2px 0 14px;">${escapeHtml(cyclesLine(days[0]))}</td></tr>
      <tr><td style="padding-bottom:14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fffdf9;border:1px solid #e6dfd3;border-radius:10px;">
          <tr><td style="padding:12px 14px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6f665b;padding-bottom:6px;">À retenir</div>
            <table role="presentation" cellspacing="0" cellpadding="0">${highlights}</table>
          </td></tr>
        </table>
      </td></tr>
      ${rows}
      <tr><td>${link}
        <p style="text-align:center;font-size:11px;color:#a39a8d;margin:16px 0 0;">Forme ordinaire du rite romain · calendrier ${escapeHtml(CALENDARS[config.calendar].label)}</p>
      </td></tr>
    </table>
  </td></tr></table>
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
  }
  if (appUrl) lines.push('', `App : ${appUrl}`);
  return lines.join('\n');
}

const start = process.env.START_DATE || nextMonday(todayIn(config.timezone));
const days = await getDays(config.calendar, start, 7);
const html = renderHtml(days, config.appUrl);
const text = renderText(days, config.appUrl);
const subject = `Semaine liturgique du ${dayMonthFmt.format(toDate(days[0].date))} au ${dayMonthFmt.format(toDate(days[6].date))}`
  + (days.some(isKeyDay) ? ` · ${days.filter(isKeyDay).map((d) => stripObit(displayName(d.celebrations[0], d))).join(', ')}` : '');

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
