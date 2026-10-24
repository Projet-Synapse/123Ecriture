// ✒️ 123ECRITURE — lib/sync/threeWay.ts — le moteur de décision À TROIS ÉTATS
//////////////////////////////////////////////////////////////////////////////
//
// Comme Obsidian Sync : pour chaque chemin, on compare TROIS versions —
//   L = ce qu'il y a sur CET appareil (le disque fait foi),
//   R = ce qu'il y a dans le cloud (une simple copie),
//   B = la BASE : ce qui était synchronisé ici à la fin du dernier cycle
//       réussi (persistée par appareil).
//
// Règle d'or : une ABSENCE ne vaut suppression QUE si le chemin était dans
// la base. Sinon c'est un nouveau fichier de l'autre côté.
//
//   L R B │ décision
//   ──────┼──────────────────────────────────────────────────────────────
//   ✓ · · │ push (nouveau local) ; tombstone distante sans base → review
//   · ✓ · │ pull (nouveau distant)
//   ✓ · ✓ │ supprimé ailleurs : L==B → delete-local ; L≠B → review
//         │   (fichier conservé, l'utilisatrice tranche)
//   · ✓ ✓ │ supprimé ici : R==B → tombstone-remote ; R≠B → pull (modifié
//         │   ailleurs entre-temps : on ne détruit jamais une modification)
//   · · ✓ │ disparu des deux côtés → drop-base
//   ✓ ✓ * │ L==R → noop ; R==B → push ; L==B → pull ; sinon conflict
//         │   (copie de conflit, jamais d'écrasement silencieux)
//
// GARDE-FOU : si le cycle supprimerait trop (> maxDeletions ou > ratio de la
// base), ou si le dossier local est VIDE alors que la base ne l'est pas,
// TOUTES les suppressions sont suspendues (`guard.suspended`) et attendent
// une confirmation humaine. Les ajouts (push/pull) continuent : ils ne
// détruisent rien.
//
// Module PUR, sans réseau ni disque (tests : threeWay.test.ts).
//
//////////////////////////////////////////////////////////////////////////////

export type EntryKind = 'file' | 'folder';

export type LocalEntry = { relPath: string; hash: string; size?: number; mtime?: number; kind?: EntryKind };
export type RemoteEntry = {
  relPath: string;
  hash: string;
  size?: number;
  updatedAt?: string;
  version?: number | null;
  deleted: boolean;
  kind?: EntryKind;
};
export type BaseEntry = { hash: string; version?: number | null; mtime?: number; size?: number; kind?: EntryKind };
export type SyncBase = Record<string, BaseEntry>;

export type PlanActionKind =
  | 'push'
  | 'pull'
  | 'delete-local'
  | 'tombstone-remote'
  | 'conflict'
  | 'noop'
  | 'review'
  | 'drop-base';

export type PlanAction = {
  kind: PlanActionKind;
  relPath: string;
  entryKind: EntryKind;
  // push sur une ligne tombstonée : restore_file avant push_file.
  restore?: boolean;
  // Version distante attendue (verrou optimiste push_file / tombstone_file).
  expectedVersion?: number | null;
  reason: string;
};

export type GuardOptions = { maxDeletions?: number; maxDeletionRatio?: number };

export type SyncPlan = {
  actions: PlanAction[];
  guard: { suspended: boolean; reason: string | null; deletions: string[] };
};

export const DEFAULT_MAX_DELETIONS = 20;
export const DEFAULT_MAX_DELETION_RATIO = 0.3;

export function planSync(args: {
  local: LocalEntry[];
  remote: RemoteEntry[];
  base: SyncBase;
  allow?: (relPath: string) => boolean;
  guard?: GuardOptions;
}): SyncPlan {
  const allow = args.allow ?? (() => true);
  const L = new Map(args.local.filter((e) => allow(e.relPath)).map((e) => [e.relPath, e]));
  const Rall = new Map(args.remote.filter((e) => allow(e.relPath)).map((e) => [e.relPath, e]));
  const B = new Map(Object.entries(args.base).filter(([p]) => allow(p)));
  const paths = new Set<string>([...L.keys(), ...Rall.keys(), ...B.keys()]);

  const actions: PlanAction[] = [];
  for (const relPath of paths) {
    const l = L.get(relPath);
    const rRow = Rall.get(relPath);
    const r = rRow && !rRow.deleted ? rRow : undefined;
    const tomb = rRow?.deleted === true;
    const b = B.get(relPath);
    const entryKind: EntryKind = l?.kind ?? rRow?.kind ?? b?.kind ?? 'file';
    const push = (reason: string): PlanAction => ({
      kind: 'push', relPath, entryKind, reason,
      restore: tomb || undefined,
      expectedVersion: r ? (r.version ?? null) : null,
    });

    if (l && !r && !b) {
      // Une tombstone distante sur un fichier jamais synchronisé ici (ex.
      // vieux dossier rouvert contenant des doublons supprimés ailleurs) :
      // on ne ressuscite RIEN en silence — conservé localement, en revue.
      if (tomb) actions.push({ kind: 'review', relPath, entryKind, reason: 'supprimé dans le cloud, jamais synchronisé ici — conservé, à valider' });
      else actions.push(push('nouveau ici'));
    }
    else if (!l && r && !b) actions.push({ kind: 'pull', relPath, entryKind, reason: 'nouveau dans le cloud' });
    else if (l && !r && b) {
      if (l.hash === b.hash) actions.push({ kind: 'delete-local', relPath, entryKind, reason: 'supprimé sur un autre appareil' });
      else if (tomb) actions.push({ kind: 'review', relPath, entryKind, reason: 'modifié ici, supprimé ailleurs — conservé, à valider' });
      else actions.push(push('modifié ici, disparu du cloud — renvoyé'));
    } else if (!l && r && b) {
      if (entryKind === 'folder') {
        // Un DOSSIER du cloud absent ici est RECRÉÉ, jamais tombstoné : le
        // parcours local peut l'avoir manqué (index partiel) et un dossier
        // vide ne coûte rien — le cloud n'est jamais vidé de ses dossiers.
        actions.push({ kind: 'pull', relPath, entryKind, reason: 'dossier du cloud absent ici — recréé' });
      } else if (r.hash === b.hash) {
        actions.push({ kind: 'tombstone-remote', relPath, entryKind, expectedVersion: r.version ?? null, reason: 'supprimé ici' });
      } else actions.push({ kind: 'pull', relPath, entryKind, reason: 'supprimé ici mais modifié ailleurs — rapatrié' });
    } else if (!l && !r && b) actions.push({ kind: 'drop-base', relPath, entryKind, reason: 'disparu des deux côtés' });
    else if (l && r) {
      if (l.hash === r.hash) actions.push({ kind: 'noop', relPath, entryKind, reason: 'identique' });
      else if (b && r.hash === b.hash) actions.push(push('modifié ici'));
      else if (b && l.hash === b.hash) actions.push({ kind: 'pull', relPath, entryKind, reason: 'modifié ailleurs' });
      else
        actions.push({
          kind: 'conflict', relPath, entryKind, expectedVersion: r.version ?? null,
          reason: b ? 'modifié des deux côtés' : 'contenus différents sans base commune',
        });
    }
  }
  actions.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // ---- GARDE-FOU ----
  const deletions = actions
    .filter((a) => (a.kind === 'delete-local' || a.kind === 'tombstone-remote') && a.entryKind === 'file')
    .map((a) => a.relPath);
  const baseFiles = [...B.values()].filter((e) => (e.kind ?? 'file') === 'file').length;
  const localFiles = [...L.values()].filter((e) => (e.kind ?? 'file') === 'file').length;
  const maxDel = args.guard?.maxDeletions ?? DEFAULT_MAX_DELETIONS;
  const ratio = args.guard?.maxDeletionRatio ?? DEFAULT_MAX_DELETION_RATIO;
  let reason: string | null = null;
  if (localFiles === 0 && baseFiles > 0) {
    reason = `Le dossier local est vide alors que ${baseFiles} fichier(s) y étaient synchronisés — aucune suppression sans confirmation.`;
  } else if (deletions.length > maxDel) {
    reason = `${deletions.length} suppression(s) d'un coup (seuil ${maxDel}) — confirmation requise.`;
  } else if (baseFiles > 0 && deletions.length >= 5 && deletions.length / baseFiles > ratio) {
    reason = `${deletions.length} suppression(s) sur ${baseFiles} fichiers (> ${Math.round(ratio * 100)} %) — confirmation requise.`;
  }
  const suspended = reason !== null && (deletions.length > 0 || (localFiles === 0 && baseFiles > 0));
  if (suspended) {
    // Les suppressions (fichiers ET dossiers) sont retirées du plan.
    for (let i = actions.length - 1; i >= 0; i -= 1) {
      const k = actions[i].kind;
      if (k === 'delete-local' || k === 'tombstone-remote') actions.splice(i, 1);
    }
  }
  return { actions, guard: { suspended, reason: suspended ? reason : null, deletions: suspended ? deletions : [] } };
}

// Nouvelle base après application : `applied` = chemins réellement traités
// avec leur état final (hash/version) ; les chemins non traités gardent
// leur ancienne entrée (le cycle suivant réessaiera).
export function nextBase(
  previous: SyncBase,
  plan: SyncPlan,
  outcome: Map<string, BaseEntry | null>,
): SyncBase {
  const next: SyncBase = { ...previous };
  for (const [relPath, entry] of outcome) {
    if (entry === null) delete next[relPath];
    else next[relPath] = entry;
  }
  void plan;
  return next;
}
