// ✒️ 123ECRITURE — lib/sync/conflictQueue.ts — file des conflits de nom/chemin à trancher par l'humain
//////////////////////////////////////////////////////////////////////////////
//
// Quand l'indexation, un import ou un pull de synchro rencontre un fichier
// au MÊME chemin qu'un fichier existant (identique, ou ne différant que par
// la casse / la forme Unicode NFC-NFD, ou au nom refusé par le stockage),
// on ne tranche JAMAIS en silence : le conflit entre dans cette file
// persistée (.123ecriture/pending-conflicts.json) et la feuille de conflit
// (components/ConflictSheet.tsx) propose Fusionner / Renommer / Remplacer /
// Garder les deux / Annuler. Tant qu'un conflit est en attente, la synchro
// ne touche à AUCUN des chemins concernés.
//
// Invariants du fichier :
//   • Pur (aucun accès disque/réseau) : détection, file, plan d'actions.
//   • Les décisions sont traduites en un PLAN explicite (ConflictAction[])
//     exécuté par conflictResolver.ts — testable sans pont.
//
//////////////////////////////////////////////////////////////////////////////

export const PENDING_CONFLICTS_REL_PATH = '.123ecriture/pending-conflicts.json';
export const STAGED_CONFLICTS_DIR = '.123ecriture/conflicts-staged';

export type ConflictOrigin = 'index' | 'import' | 'pull';
// same-path : chemin identique ; case : ne diffère que par la casse ;
// unicode : NFC/NFD ; invalid-name : le stockage refuse/modifie le nom (E_NAME).
export type ConflictReason = 'same-path' | 'case' | 'unicode' | 'invalid-name';

export type ConflictSide = {
  relPath: string;
  sizeBytes: number | null;
  modifiedAt: string | null; // ISO
  device: string; // « cet appareil », « cloud (autre appareil) », « import »
  contentHash?: string;
};

export type PendingConflict = {
  id: string;
  origin: ConflictOrigin;
  reason: ConflictReason;
  existing: ConflictSide;
  // Côté entrant : pour un import, le contenu est mis de côté dans
  // `stagedRelPath` ; pour un pull, il reste dans le cloud (storageObjectPath) ;
  // pour l'indexation, c'est le second fichier déjà présent sur le disque.
  incoming: ConflictSide & { stagedRelPath?: string; storageObjectPath?: string; remoteVaultId?: string };
  isText: boolean;
  diffSummary?: { addedChars: number; removedChars: number } | null;
  createdAt: string;
};

export type ConflictChoice = 'merge' | 'rename' | 'replace' | 'keep-both' | 'cancel';
export type ConflictDecision = { choice: ConflictChoice; newName?: string };

// `ignoredRemote` : lignes distantes volontairement écartées (relPath → hash).
export type ConflictQueue = { conflicts: PendingConflict[]; ignoredRemote?: Record<string, string> };

//////// 1. Détection (casse, NFC/NFD) ///////////////////////////////////////

export function foldPathKey(relPath: string): string {
  return relPath.normalize('NFC').toLocaleLowerCase('fr');
}

export function collisionReason(a: string, b: string): ConflictReason | null {
  if (a === b) return 'same-path';
  if (a.normalize('NFC') === b.normalize('NFC')) return 'unicode';
  if (foldPathKey(a) === foldPathKey(b)) return 'case';
  return null;
}

// Cherche dans `existing` un chemin DIFFÉRENT qui entre en collision avec
// `relPath` (casse ou Unicode). Le chemin identique n'est pas une collision
// ici : c'est le cas normal d'une mise à jour, géré par le diff 3 voies.
export function findFoldedCollision(
  relPath: string,
  existing: Iterable<string>,
): { existingRelPath: string; reason: ConflictReason } | null {
  const key = foldPathKey(relPath);
  for (const other of existing) {
    if (other === relPath) continue;
    if (foldPathKey(other) !== key) continue;
    const reason = collisionReason(relPath, other);
    if (reason) return { existingRelPath: other, reason };
  }
  return null;
}

// Groupes de chemins distincts qui se replient sur la même clé (indexation).
export function findPathCollisions(paths: Iterable<string>): { a: string; b: string; reason: ConflictReason }[] {
  const byKey = new Map<string, string[]>();
  for (const p of paths) {
    const key = foldPathKey(p);
    const list = byKey.get(key) ?? [];
    if (!list.includes(p)) list.push(p);
    byKey.set(key, list);
  }
  const out: { a: string; b: string; reason: ConflictReason }[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const [a, ...rest] = [...list].sort();
    for (const b of rest) out.push({ a, b, reason: collisionReason(a, b) ?? 'case' });
  }
  return out;
}

//////// 2. Noms proposés ///////////////////////////////////////////////////

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i >= 0 ? relPath.slice(0, i) : '';
}

function nameOf(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

// « nom (2).md », « nom (3).md »… libre même en repliant casse/NFC.
export function suggestRenamedPath(relPath: string, taken: Iterable<string>, label?: string): string {
  const takenKeys = new Set([...taken].map(foldPathKey));
  const parent = parentOf(relPath);
  const [rawBase, ext] = splitExt(nameOf(relPath));
  const base = rawBase.replace(/ \((\d+|conflit[^)]*)\)$/u, '');
  const make = (suffix: string) => `${parent ? `${parent}/` : ''}${base} (${suffix})${ext}`;
  if (label) {
    const first = make(label);
    if (!takenKeys.has(foldPathKey(first))) return first;
    for (let n = 2; ; n++) {
      const c = make(`${label} ${n}`);
      if (!takenKeys.has(foldPathKey(c))) return c;
    }
  }
  for (let n = 2; ; n++) {
    const c = make(String(n));
    if (!takenKeys.has(foldPathKey(c))) return c;
  }
}

// Caractères refusés par les stockages FAT/Windows : proposés en remplacement.
export function sanitizeName(name: string): string {
  return name.replace(/[:*?"<>|]/g, (c) => (c === ':' ? '꞉' : '_'));
}

//////// 3. La file (ajout dédupliqué, retrait, chemins gelés) ///////////////

export function conflictKey(c: Pick<PendingConflict, 'origin' | 'existing' | 'incoming'>): string {
  return `${c.origin}|${c.existing.relPath}|${c.incoming.relPath}`;
}

export function enqueueConflict(queue: ConflictQueue, conflict: PendingConflict): ConflictQueue {
  const key = conflictKey(conflict);
  const others = queue.conflicts.filter((c) => conflictKey(c) !== key);
  const previous = queue.conflicts.find((c) => conflictKey(c) === key);
  // Même conflit re-détecté : on garde l'id (la feuille ne « saute » pas)
  // mais on rafraîchit l'aperçu.
  const merged = previous ? { ...conflict, id: previous.id, createdAt: previous.createdAt } : conflict;
  return { ...queue, conflicts: [...others, merged].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
}

export function removeConflict(queue: ConflictQueue, id: string): ConflictQueue {
  return { ...queue, conflicts: queue.conflicts.filter((c) => c.id !== id) };
}

// Chemins que la synchro NE DOIT PAS toucher tant que la file n'est pas vide.
export function frozenPaths(queue: ConflictQueue): Set<string> {
  const out = new Set<string>();
  for (const c of queue.conflicts) {
    out.add(c.existing.relPath);
    out.add(c.incoming.relPath);
  }
  return out;
}

export function parseConflictQueue(raw: string | null | undefined): ConflictQueue {
  if (!raw) return { conflicts: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ConflictQueue>;
    return {
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.filter((c) => c && c.id && c.existing && c.incoming) : [],
      ignoredRemote: parsed.ignoredRemote && typeof parsed.ignoredRemote === 'object' ? parsed.ignoredRemote : {},
    };
  } catch {
    return { conflicts: [] };
  }
}

//////// 4. Choix disponibles et plan d'actions //////////////////////////////

export function availableChoices(c: PendingConflict): ConflictChoice[] {
  const out: ConflictChoice[] = [];
  if (c.isText && c.reason !== 'invalid-name') out.push('merge');
  out.push('rename');
  if (c.reason !== 'invalid-name') out.push('replace', 'keep-both');
  out.push('cancel');
  return out;
}

export function choiceLabel(choice: ConflictChoice, origin: ConflictOrigin): string {
  switch (choice) {
    case 'merge':
      return 'Fusionner';
    case 'rename':
      return 'Renommer';
    case 'replace':
      return 'Remplacer';
    case 'keep-both':
      return 'Garder les deux';
    case 'cancel':
      return origin === 'import' ? 'Annuler l’upload' : origin === 'pull' ? 'Annuler la réception' : 'Ignorer';
  }
}

export type ConflictAction =
  // Fusion 3 voies (merge.ts) de l'entrant dans l'existant ; échec = erreur visible.
  | { type: 'merge'; target: string }
  // Écrire le contenu ENTRANT à `to` (pull : téléchargé ; import : copie mise de côté ; index : fichier source).
  | { type: 'write-incoming'; to: string }
  // Corbeille (jamais de destruction) pour le second fichier de l'indexation.
  | { type: 'trash'; relPath: string }
  // Supprimer la copie mise de côté d'un import.
  | { type: 'drop-staged' }
  // Pull : enregistrer le hash distant comme référence de `relPath` → au
  // prochain cycle, le local (fusionné/conservé) repart ; pour une variante
  // de casse dont le contenu a été rapatrié, l'absence locale la tombstone.
  | { type: 'adopt-remote-reference'; relPath: string; contentHash: string }
  // Pull : ignorer cette ligne distante tant que son hash ne change pas
  // (nom refusé ici, ou réception annulée d'une variante de casse).
  | { type: 'ignore-remote'; relPath: string; contentHash: string };

export function planResolution(c: PendingConflict, decision: ConflictDecision, taken: Iterable<string>): ConflictAction[] {
  if (!availableChoices(c).includes(decision.choice)) {
    throw new Error(`Choix « ${decision.choice} » indisponible pour ce conflit.`);
  }
  const plan: ConflictAction[] = [];
  const target = c.existing.relPath;
  const takenList = [...taken, c.existing.relPath, c.incoming.relPath];
  const renamedTo = (label?: string) => {
    if (decision.newName && decision.newName.trim()) {
      const parent = parentOf(target);
      const clean = decision.newName.trim().replace(/[\\/]/g, '_');
      const p = `${parent ? `${parent}/` : ''}${clean}`;
      if (takenList.some((t) => foldPathKey(t) === foldPathKey(p) && t !== c.incoming.relPath)) {
        throw new Error(`« ${clean} » existe déjà dans ce dossier.`);
      }
      return p;
    }
    return suggestRenamedPath(target, takenList, label);
  };
  switch (decision.choice) {
    case 'merge':
      plan.push({ type: 'merge', target });
      break;
    case 'replace':
      plan.push({ type: 'write-incoming', to: target });
      break;
    case 'rename':
      // Nom refusé : la cible proposée (assainie) est déjà libre.
      plan.push({
        type: 'write-incoming',
        to:
          c.reason === 'invalid-name' && !decision.newName && ![...taken].some((t) => foldPathKey(t) === foldPathKey(target))
            ? target
            : renamedTo(),
      });
      break;
    case 'keep-both':
      plan.push({ type: 'write-incoming', to: renamedTo('conflit') });
      break;
    case 'cancel':
      break;
  }
  // Nettoyage de la source selon l'origine.
  if (c.origin === 'import') plan.push({ type: 'drop-staged' });
  if (c.origin === 'index' && decision.choice !== 'cancel') {
    const last = plan[plan.length - 1];
    const wroteOverSource = last?.type === 'write-incoming' && last.to === c.incoming.relPath;
    if (!wroteOverSource) plan.push({ type: 'trash', relPath: c.incoming.relPath });
  }
  if (c.origin === 'pull') {
    const hash = c.incoming.contentHash ?? '';
    if (c.reason === 'same-path') {
      plan.push({ type: 'adopt-remote-reference', relPath: c.incoming.relPath, contentHash: hash });
    } else if (c.reason === 'invalid-name' || decision.choice === 'cancel') {
      plan.push({ type: 'ignore-remote', relPath: c.incoming.relPath, contentHash: hash });
    } else {
      plan.push({ type: 'adopt-remote-reference', relPath: c.incoming.relPath, contentHash: hash });
    }
  }
  return plan;
}

// « Appliquer à tous les conflits restants » : même choix pour chacun ; un
// choix indisponible (ex. Fusionner un binaire) laisse le conflit EN FILE.
export function decisionsForAll(
  queue: ConflictQueue,
  decision: ConflictDecision,
): { apply: { conflict: PendingConflict; decision: ConflictDecision }[]; remaining: PendingConflict[] } {
  const apply: { conflict: PendingConflict; decision: ConflictDecision }[] = [];
  const remaining: PendingConflict[] = [];
  for (const conflict of queue.conflicts) {
    if (availableChoices(conflict).includes(decision.choice)) {
      // Un nom saisi ne vaut que pour le premier : les suivants reçoivent « nom (n) ».
      apply.push({ conflict, decision: { choice: decision.choice } });
    } else {
      remaining.push(conflict);
    }
  }
  return { apply, remaining };
}

export function reasonLabel(reason: ConflictReason): string {
  switch (reason) {
    case 'same-path':
      return 'Même nom et même chemin';
    case 'case':
      return 'Noms identiques à la casse près';
    case 'unicode':
      return 'Noms identiques (accents encodés différemment, NFC/NFD)';
    case 'invalid-name':
      return 'Nom refusé par le stockage de cet appareil';
  }
}

export function newConflictId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
