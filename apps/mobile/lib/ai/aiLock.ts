// ✒️ 123ECRITURE — lib/ai/aiLock.ts — dossiers et fichiers verrouillés pour l'IA
//////////////////////////////////////////////////////////////////////////////
//
// Verrouillage (v0.4.100) : un dossier ou un fichier marqué « verrouillé »
// est INACCESSIBLE à l'IA (passerelle locale à venir) : ni listé, ni lu,
// ni cherché, ni modifié. Un dossier verrouillé verrouille toute sa
// sous-arborescence (héritage).
//
// Invariants du fichier :
//   • Module PUR (aucun import React/RN) — partagé desktop / Android /
//     serveur de la passerelle, testé dans aiLock.test.ts.
//   • La liste vit dans les préférences (`aiLockedPaths`), répliquées
//     dans le coffre (.123ecriture/preferences.json) donc SYNCHRONISÉES.
//   • Comparaison casse ignorée, séparateurs normalisés, limite de
//     segment respectée (`Privé` ne couvre pas `Privé-bis`).
//   • En cas de doute (chemin vide, `..`), on considère VERROUILLÉ.
//
//////////////////////////////////////////////////////////////////////////////

export function normalizeLockPath(relPath: string): string {
  return relPath.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.?\/+|\/+$/g, '');
}

function key(relPath: string): string {
  return normalizeLockPath(relPath).normalize('NFC').toLowerCase();
}

// Lecture tolérante du réglage : chaînes non vides, dédoublonnées.
export function normalizeLockedPaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const p = normalizeLockPath(item);
    if (!p || seen.has(key(p))) continue;
    seen.add(key(p));
    out.push(p);
  }
  return out;
}

// L'élément est-il verrouillé, directement ou par un dossier parent ?
// Renvoie le chemin verrouillé responsable (ou null).
export function lockingPath(relPath: string, locked: readonly string[]): string | null {
  const target = key(relPath);
  if (!target || target.split('/').includes('..')) return locked.length ? '(chemin invalide)' : null;
  for (const raw of locked) {
    const l = key(raw);
    if (!l) continue;
    if (target === l || target.startsWith(`${l}/`)) return normalizeLockPath(raw);
  }
  return null;
}

export function isAiLocked(relPath: string, locked: readonly string[]): boolean {
  return lockingPath(relPath, locked) !== null;
}

// Verrouillé DIRECTEMENT (présent dans la liste) — pour le menu
// « Déverrouiller » et l'icône pleine.
export function isDirectlyLocked(relPath: string, locked: readonly string[]): boolean {
  const target = key(relPath);
  return locked.some((l) => key(l) === target);
}

export function toggleAiLock(locked: readonly string[], relPath: string): string[] {
  const p = normalizeLockPath(relPath);
  if (!p) return [...locked];
  return isDirectlyLocked(p, locked) ? locked.filter((l) => key(l) !== key(p)) : [...locked, p];
}

// Renommage / déplacement de `oldPath` (fichier ou dossier) vers `newPath` :
// les verrous sur l'élément ET sur tout ce qui est dessous suivent. Même
// tableau renvoyé si rien ne change (pas d'écriture inutile).
export function remapAiLocks(locked: readonly string[], oldPath: string, newPath: string): readonly string[] {
  const o = key(oldPath);
  const n = normalizeLockPath(newPath);
  if (!o || !n || o === key(n)) return locked;
  let changed = false;
  const next = locked.map((raw) => {
    const k = key(raw);
    if (k === o) {
      changed = true;
      return n;
    }
    if (k.startsWith(`${o}/`)) {
      changed = true;
      return `${n}${normalizeLockPath(raw).slice(o.length)}`;
    }
    return raw;
  });
  return changed ? normalizeLockedPaths(next) : locked;
}

// Entrée du menu contextuel (explorateur, ⋯ de l'éditeur). Hérité d'un
// dossier parent : entrée informative (sans action) qui nomme ce dossier.
export function aiLockMenuItem(relPath: string, locked: readonly string[]): { id: string; label: string } {
  if (isDirectlyLocked(relPath, locked)) return { id: 'toggle-ai-lock', label: '🔓 Déverrouiller pour l’IA' };
  const by = lockingPath(relPath, locked);
  if (by) return { id: 'ai-lock-inherited', label: `🔒 Verrouillé pour l’IA (dossier « ${by} »)` };
  return { id: 'toggle-ai-lock', label: '🔒 Verrouiller pour l’IA' };
}
