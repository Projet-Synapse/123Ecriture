# Android : module natif `vault-fs`

Module Expo local (`apps/mobile/modules/vault-fs`), autolinké au `expo prebuild`
et **embarqué dans l'APK 123Ecriture** : pas d'app séparée, pas de nouvel
applicationId, pas de service externe.

## Rôle

Sur Android, c'est le **seul** point d'accès aux fichiers du coffre :

- uniquement l'URI d'arbre SAF persistante + des docIds
  (`DocumentsContract.buildDocumentUriUsingTree` / `buildChildDocumentsUriUsingTree`),
  jamais de `file://` ni de nom déduit d'une URI ;
- `listTree` : une requête batch par dossier, dossier = `MIME_TYPE` « directory »,
  retourne `relPath` POSIX + docId + mtime + taille et une **liste d'erreurs par
  dossier**. Dossier illisible = contenu *inconnu* (l'adaptateur garde les entrées
  connues, rien n'est considéré supprimé) ;
- `writeFileAtomic` : crée les dossiers manquants (recherche exacte par nom, pas
  de doublon « (1) »), écrit dans `.vfs-<id>-<nom>`, met l'ancien de côté, renomme,
  **relit et compare taille + SHA-256** ; repli : écriture directe `wt` + vérification.
  La promesse est rejetée si la vérification échoue → la synchro ne marque rien ;
- `deleteFile` : déplacement dans `.trash/` du coffre (destruction seulement si
  `permanent` ou déjà dans `.trash`) ; `rename` / `move` natifs (dossiers compris),
  avec vérification du nom final ;
- noms NFC ; `:`, emoji, accents, espaces conservés. Si le fournisseur refuse
  ou modifie un nom (ex. `:` sur stockage FAT), l'opération échoue en `E_NAME`
  au lieu de créer un fichier mal nommé.

Toutes les fonctions sont des `AsyncFunction` (hors thread UI).

## Côté TypeScript

| Fichier | Rôle |
|---|---|
| `modules/vault-fs/src/index.ts` | API typée, `VaultFs` = `null` si le module est absent |
| `lib/storage/nativeVaultFsAdapter.ts` | `VaultBridge` complet au-dessus du module |
| `lib/storage/vaultBackend.ts` | choix du backend (flag) |

Activé **par défaut sur Android si le module natif est présent**. Repli sur
l'ancien pont SAF (`nativeVaultAdapter.ts`) si le module manque (vieil APK /
Expo Go) ou si `EXPO_PUBLIC_VAULT_FS=0` au build.

## Tester sur le téléphone

1. Construire l'APK (workflow « Build Android APK » ou `npx expo prebuild -p android && cd android && ./gradlew assembleRelease`).
2. Installer **par-dessus** l'app existante (même applicationId, données conservées).
3. Ouvrir le coffre, vérifier l'arborescence (dossiers avec emoji/accents), créer
   une note `Réunion 10:30`, la renommer, la déplacer, la supprimer → elle doit
   apparaître dans `.trash/` du dossier du coffre.
4. Lancer une synchro : seuls les fichiers écrits et vérifiés passent « synchronisé ».
   `adb logcat | grep -i vaultfs` pour les erreurs natives.
