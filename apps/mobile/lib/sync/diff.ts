// Décisions de synchro (push/pull/conflit) — logique PURE, sans Electron ni
// réseau, volontairement isolée du reste pour rester facilement testable
// (voir diff.test.ts) : c'est la zone la plus sensible du moteur de synchro
// au sens de CLAUDE.md ("sauvegarde et gestion des données"), donc celle qui
// mérite le plus de tests unitaires indépendants de toute vraie fenêtre
// Electron/session Supabase.

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
};

export type SyncDecisionKind = 'push' | 'pull' | 'noop' | 'conflict-push-wins' | 'conflict-pull-wins';

export type SyncDecision = { kind: SyncDecisionKind; relPath: string };

// Compare l'état local (hashé côté main process, voir
// apps/desktop/electron/sync.js) à l'état distant connu (une ligne
// `vault_files` par note, voir supabase/migrations/) et décide, PAR note,
// quoi faire :
// - seulement locale             → push
// - seulement distante (non supprimée) → pull
// - les deux, même hash          → rien à faire
// - les deux, hash différent     → conflit, tranché par le timestamp le
//   plus récent (le perdant est sauvegardé avant d'être écrasé — voir
//   syncEngine.ts, jamais fait ici : cette fonction ne fait AUCUN effet de
//   bord, juste des décisions).
export function diffVault(local: LocalHashedNote[], remote: RemoteVaultFile[]): SyncDecision[] {
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
        const localTime = localNote.modifiedAt;
        const remoteTime = new Date(remoteFile.updatedAt).getTime();
        decisions.push({
          kind: localTime >= remoteTime ? 'conflict-push-wins' : 'conflict-pull-wins',
          relPath,
        });
      }
    }
  }

  // Ordre déterministe (alphabétique) — la Map/Set n'en garantit pas un
  // stable côté appelant, et un ordre reproductible simplifie les tests et
  // la lecture d'un résumé de synchro.
  return decisions.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
