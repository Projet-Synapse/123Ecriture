// ✒️ 123ECRITURE — lib/sync/diff.ts — décisions de synchronisation (push/pull/conflit)
//////////////////////////////////////////////////////////////////////////////
//
// Logique PURE de décision d'un cycle : compare l'état local (hashé côté
// process main) à l'état distant connu (une ligne `vault_files` par note)
// et décide, PAR note, de pousser, tirer, ne rien faire ou déclarer un
// conflit. Volontairement sans Electron ni réseau — c'est la zone la plus
// sensible du moteur de synchronisation (sauvegarde et gestion des
// données), donc celle qui mérite le plus de tests unitaires indépendants
// de toute fenêtre ou session Supabase (diff.test.ts).
//
// Invariants du fichier :
//   • Cette fonction ne fait AUCUN effet de bord : elle ne fait que
//     DÉCIDER — l'application des décisions (et la sauvegarde du perdant
//     d'un conflit avant écrasement) vit dans syncEngine.ts.
//   • Une modification d'un SEUL côté n'est jamais un conflit : la
//     référence du dernier cycle (`lastSynced`, le sync-state) tranche —
//     cloud == référence → modification locale pure → push, symétriquement
//     local == référence → pull.
//   • Seule une divergence des DEUX côtés depuis la référence reste un
//     conflit, tranché par le timestamp le plus récent.
//   • Ordre de sortie déterministe (alphabétique) : tests et résumés de
//     synchro reproductibles.
//
// SOMMAIRE :
//   1. Les types du contrat (note locale, ligne distante, décision)
//   2. diffVault — la décision, note par note
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Les types du contrat (note locale, ligne distante, décision) ///////////

export type LocalHashedNote = {
  relPath: string;
  contentHash: string;
  sizeBytes: number;
  modifiedAt: number; // epoch ms
};

export type RemoteVaultFile = {
  relPath: string;
  contentHash: string;
  sizeBytes: number;
  updatedAt: string; // ISO 8601
  deleted: boolean;
  // Clé d'objet Storage EFFECTIVEMENT enregistrée au moment du push (encodée
  // base64url — les noms bruts avec émojis/accents sont rejetés par Storage,
  // voir storageKeys.ts). Optionnel : les lignes anciennes peuvent
  // l'omettre, le moteur recalcule alors.
  storageObjectPath?: string;
  // rel_path BRUT tel qu'en base (peut contenir des `\` — résidus du bug de
  // séparateurs desktop à purger). `relPath`, lui, est normalisé.
  rawRelPath?: string;
  // Version serveur (verrou optimiste, migration vault_optimistic_lock).
  // Absente tant que la migration n'est pas appliquée.
  version?: number;
  deletedByDevice?: string | null;
  deletedAt?: string | null;
};

export type SyncDecisionKind = 'push' | 'pull' | 'noop' | 'conflict-push-wins' | 'conflict-pull-wins';

export type SyncDecision = { kind: SyncDecisionKind; relPath: string };

//////// 2. diffVault — la décision, note par note //////////////////////////////////////

// Compare l'état local à l'état distant connu et décide, PAR note, quoi
// faire :
// - seulement locale                    → push
// - seulement distante (non supprimée)  → pull
// - les deux, même hash                 → rien à faire
// - les deux, hash différent            → tranché par la RÉFÉRENCE du
//   dernier cycle (`lastSynced`) : si le cloud porte encore le hash connu
//   au dernier cycle, c'est une modification LOCALE pure → push (jamais un
//   conflit — les modifications ne doivent PAS être perçues comme des
//   conflits) ; symétriquement, si le hash LOCAL est la référence connue,
//   c'est la distante qui a bougé → pull. Seule une divergence des DEUX
//   côtés depuis la référence reste un conflit, tranché alors par le
//   timestamp le plus récent. Sans référence connue (premier cycle, état
//   jeté à vide), on retombe sur le classement par mtime.
export function diffVault(
  local: LocalHashedNote[],
  remote: RemoteVaultFile[],
  lastSynced?: Record<string, string>,
  lastVersions?: Record<string, number>,
): SyncDecision[] {
  const localByPath = new Map(local.map((note) => [note.relPath, note]));
  const remoteByPath = new Map(remote.filter((file) => !file.deleted).map((file) => [file.relPath, file]));
  const allPaths = new Set<string>([...localByPath.keys(), ...remoteByPath.keys()]);

  const decisions: SyncDecision[] = [];
  for (const relPath of allPaths) {
    const localNote = localByPath.get(relPath);
    const remoteFile = remoteByPath.get(relPath);

    if (localNote && !remoteFile) {
      decisions.push({ kind: 'push', relPath });
    } else if (!localNote && remoteFile) {
      decisions.push({ kind: 'pull', relPath });
    } else if (localNote && remoteFile) {
      if (localNote.contentHash === remoteFile.contentHash) {
        decisions.push({ kind: 'noop', relPath });
      } else {
        const referenceHash = lastSynced?.[relPath];
        const referenceVersion = lastVersions?.[relPath];
        // Le cloud n'a pas bougé depuis le dernier cycle : par la VERSION
        // serveur quand elle est connue (autorité), sinon par le hash.
        const remoteUnchanged =
          typeof referenceVersion === 'number' && typeof remoteFile.version === 'number'
            ? referenceVersion === remoteFile.version
            : referenceHash === remoteFile.contentHash;
        if (remoteUnchanged) {
          decisions.push({ kind: 'push', relPath });
        } else if (referenceHash === localNote.contentHash) {
          decisions.push({ kind: 'pull', relPath });
        } else {
          // Divergence des deux côtés, ou référence inconnue (premier
          // cycle, ancien état) : JAMAIS d'arbitrage par mtime (horloges
          // d'appareils non fiables). Conflit prudent : fusion à trois voix
          // d'abord ; à défaut le cloud est conservé et la version locale
          // ARCHIVÉE en copie de conflit — rien n'est écrasé dans le cloud.
          decisions.push({ kind: 'conflict-pull-wins', relPath });
        }
      }
    }
  }

  // Ordre déterministe (alphabétique) — la Map/Set n'en garantit pas un
  // stable côté appelant, et un ordre reproductible simplifie les tests et
  // la lecture d'un résumé de synchro.
  return decisions.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
