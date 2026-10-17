// Garde de cohérence des versions (v0.4.76, inspiré du patron 123Creez) :
// les trois sources de version DOIVENT être identiques —
//   apps/mobile/package.json + apps/mobile/app.json (versionName Android)
//   + apps/desktop/package.json.
// Vécu 17/10 : un tag v0.4.75 poussé SANS bump → electron-builder a rebuild
// la 0.4.74, trouvé la release existante et sauté la publication (release
// incomplète détectée par le garde publish-release). Exécuté par la CI
// (`pnpm verify:versions`) avant chaque build.
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const read = (path) => readJson(path).version;
// app.json (Expo) niche la version sous `expo.version`.
const mobileApp = readJson('apps/mobile/app.json').expo?.version ?? readJson('apps/mobile/app.json').version;

const mobilePkg = read('apps/mobile/package.json');
const desktopPkg = read('apps/desktop/package.json');

const versions = new Map([
  ['apps/mobile/package.json', mobilePkg],
  ['apps/mobile/app.json (expo.version)', mobileApp],
  ['apps/desktop/package.json', desktopPkg],
]);

const distinct = new Set(versions.values());
if (distinct.size !== 1) {
  console.error('::error::Versions incohérentes :');
  for (const [file, version] of versions) console.error(`  ${file} = ${version}`);
  console.error('Bump les trois ensemble avant de taguer (voir CLAUDE.md).');
  process.exit(1);
}
console.log(`Versions cohérentes : ${mobilePkg} ✓`);
