// Génère les données JSON utilisées par l'app (public/data/<calendrier>/<année>.json).
import { mkdir, writeFile } from 'node:fs/promises';
import { buildYear, CALENDARS } from '../lib/liturgie.mjs';

const FIRST_YEAR = 2025;
const LAST_YEAR = 2035;

for (const calendarKey of Object.keys(CALENDARS)) {
  const dir = new URL(`../public/data/${calendarKey}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const data = await buildYear(calendarKey, year);
    await writeFile(new URL(`${year}.json`, dir), JSON.stringify(data));
  }
  console.log(`✓ ${CALENDARS[calendarKey].label} : ${FIRST_YEAR}–${LAST_YEAR}`);
}
