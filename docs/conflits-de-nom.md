# Conflits de nom (indexation, import, synchro)

Quand un fichier arrive sur un nom déjà pris — même chemin, casse différente
(`Note.md` / `note.md`), accents encodés autrement (NFC/NFD) ou nom refusé par
le stockage (`E_NAME`) — rien n'est tranché automatiquement.

- **File persistée** : `.123ecriture/pending-conflicts.json` dans le coffre
  (`lib/sync/conflictQueue.ts` logique pure, `conflictStore.ts` persistance).
- **Gel** : tant qu'un conflit est en file, la synchro ne pousse, ne tire ni
  ne tombstone ses chemins (référence `syncState` conservée).
- **Feuille** `components/ConflictSheet.tsx`, montée dans `AppShell` : en bas
  de la page courante, non bloquante, réductible (« Plus tard »).
- **Choix** : Fusionner (3 voies `merge.ts`, texte uniquement, refusée si
  chevauchement), Renommer (« nom (2) » éditable), Remplacer (copie cachée de
  l'ancienne version sous `.123ecriture/conflits/`), Garder les deux (seul cas
  qui crée « nom (conflit) »), Annuler l'upload / la réception / Ignorer.
  Case « appliquer à tous les conflits restants » : un choix indisponible
  (Fusionner un binaire) laisse le conflit en file.
- **Origines** : `syncEngine` (fusion 3 voies non propre, collision casse/NFC
  distant↔local, `E_NAME` au pull), `nativeVaultFsAdapter.importAttachment`
  (copie mise de côté dans `.123ecriture/conflicts-staged/`),
  `nativeVaultFsAdapter.refresh` (collisions de l'index).
