// Fixe versionName / versionCode de l'APK AVANT `expo prebuild`.
// versionName : tag (vX.Y.Z[-pre]) si déclenché par tag, sinon app.json
// (aligné sur apps/mobile/package.json). versionCode : même formule que
// versionCodeFor() de lib/updaterAndroid.ts — (maj*10000+min*100+patch)*100
// + rang (stable 99, prérelease = dernier numéro, borné à 98) — toujours
// croissant : 0.4.95 → 49599 < 0.4.96-test.2 → 49602 < 0.4.96 → 49699.
import { readFileSync, writeFileSync } from 'node:fs';
const appPath = 'apps/mobile/app.json';
const app = JSON.parse(readFileSync(appPath, 'utf8'));
const ref = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '';
const version = (ref || app.expo.version).replace(/^v/i, '');
const [coreStr, preStr = ''] = version.split('+')[0].split(/-(.*)/s);
const [M = 0, m = 0, p = 0] = coreStr.split('.').map((x) => parseInt(x, 10) || 0);
const pre = preStr ? preStr.split('.') : [];
const last = pre.length ? pre[pre.length - 1] : null;
const rank = pre.length ? (/^\d+$/.test(last) ? Math.min(98, parseInt(last, 10)) : 1) : 99;
const code = (M * 10000 + m * 100 + p) * 100 + rank;
app.expo.version = version;
app.expo.android = { ...(app.expo.android ?? {}), versionCode: code };
writeFileSync(appPath, JSON.stringify(app, null, 2) + '\n');
console.log(`versionName=${version} versionCode=${code}`);
