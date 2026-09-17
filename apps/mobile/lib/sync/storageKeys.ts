// Clé d'objet Storage d'une note — les chemins contenant émojis/accents sont
// REJETÉS par Supabase Storage (« Invalid key » ; vécu en v0.4.8 : 110
// fichiers d'un coffre refusés au push, donc jamais récupérables). On encode
// le chemin relatif en base64url : A-Za-z0-9-_ uniquement, accepté partout,
// déterministe, sans collision. Le chemin humain reste dans la table
// `vault_files` (rel_path) — la clé n'est qu'un identifiant technique.
//
// Rétro-compatibilité : les fichiers déjà poussés sous leur nom brut (ASCII)
// continuent d'être téléchargeables via la colonne storage_object_path
// enregistrée à l'époque (voir downloadRemoteText) ; les nouveaux push
// réécrivent la ligne avec la clé encodée.
export function vaultStorageObjectKey(relPath: string): string {
  const bytes = new TextEncoder().encode(relPath);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Inverse de vaultStorageObjectKey — sert uniquement aux tests (vérifier que
// l'encodage est sans perte), jamais au runtime.
export function decodeVaultStorageObjectKey(key: string): string {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
