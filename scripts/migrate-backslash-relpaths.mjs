#!/usr/bin/env node
// ✒️ 123ECRITURE — migration des rel_path Windows (`\`) vers POSIX (`/`).
//
// ⚠️ DRY-RUN PAR DÉFAUT : n'écrit RIEN sans `--apply`. Jamais lancé
// automatiquement (ni CI, ni client). À exécuter à la main, après sauvegarde.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/migrate-backslash-relpaths.mjs [--vault <id>] [--apply]
//
// Pour chaque ligne app_123ecriture.vault_files dont rel_path contient `\` :
//  - jumelle POSIX existante  → SKIP (signalée ; la ligne POSIX fait foi,
//    la ligne héritée est déjà masquée par les clients) ;
//  - ligne `.trash\…`          → SKIP (la corbeille n'est plus synchronisée) ;
//  - sinon : 1) COPIE de l'objet Storage <vault>/<base64url(rel_path brut)>
//    (ou storage_object_path) vers <vault>/<base64url(rel_path POSIX)> ;
//    2) PUIS update de la ligne (rel_path + storage_object_path), conditionné
//    à rel_path = valeur brute. L'ancien objet n'est PAS supprimé.
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const vaultArg = args.includes('--vault') ? args[args.indexOf('--vault') + 1] : null;
const BUCKET = process.env.VAULT_FILES_BUCKET || '123ecriture-vaults';
const SCHEMA = 'app_123ecriture';

const normalizeRelPath = (p) =>
  p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
// Doit rester IDENTIQUE à apps/mobile/lib/sync/storageKeys.ts (vaultStorageObjectKey).
const storageKey = (relPath) => Buffer.from(relPath, 'utf8').toString('base64url');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function allRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db.schema(SCHEMA).from('vault_files').select('vault_id, rel_path, storage_object_path, deleted').range(from, from + 999);
    if (vaultArg) q = q.eq('vault_id', vaultArg);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const rows = await allRows();
const posix = new Set(rows.filter((r) => !r.rel_path.includes('\\')).map((r) => `${r.vault_id}|${r.rel_path}`));
const stats = { candidates: 0, twin: 0, trash: 0, migrated: 0, failed: 0 };
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows.length} ligne(s) lues`);

for (const row of rows.filter((r) => r.rel_path.includes('\\'))) {
  stats.candidates += 1;
  const target = normalizeRelPath(row.rel_path);
  const id = `${row.vault_id}|${target}`;
  if (target === '.trash' || target.startsWith('.trash/')) { stats.trash += 1; continue; }
  if (posix.has(id)) { stats.twin += 1; console.log(`SKIP jumelle  ${row.vault_id} ${JSON.stringify(row.rel_path)}`); continue; }
  posix.add(id); // deux lignes brutes → même cible : la 2e devient « jumelle »
  const from = row.storage_object_path || `${row.vault_id}/${storageKey(row.rel_path)}`;
  const to = `${row.vault_id}/${storageKey(target)}`;
  console.log(`${APPLY ? 'MIGRE' : 'MIGRERAIT'} ${row.vault_id} ${JSON.stringify(row.rel_path)} → ${JSON.stringify(target)}${row.deleted ? ' (tombstone)' : ''}`);
  if (!APPLY) continue;
  try {
    if (!row.deleted) {
      const { error: copyErr } = await db.storage.from(BUCKET).copy(from, to);
      if (copyErr && !/exists/i.test(copyErr.message)) throw copyErr;
    }
    const { error: upErr, count } = await db.schema(SCHEMA).from('vault_files')
      .update({ rel_path: target, storage_object_path: row.deleted ? row.storage_object_path : to }, { count: 'exact' })
      .eq('vault_id', row.vault_id).eq('rel_path', row.rel_path);
    if (upErr) throw upErr;
    if (count !== 1) throw new Error(`update inattendu (count=${count})`);
    stats.migrated += 1;
  } catch (e) {
    stats.failed += 1;
    console.error(`ÉCHEC ${JSON.stringify(row.rel_path)} : ${e.message}`);
  }
}
console.log(JSON.stringify(stats));
if (!APPLY) console.log('Rien n’a été écrit. Relancer avec --apply après sauvegarde.');
