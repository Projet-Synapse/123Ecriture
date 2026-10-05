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
//
// ⚠️ 100 % JS PUR, zéro API navigateur : TextEncoder/btoa/atob/TextDecoder
// n'existent pas sous Hermes natif — ce fichier tourne à CHAQUE cycle de
// synchro, sur toutes les plateformes (crash Android vécu en 0.4.41-fix3).
// UTF-8 : `utf8Bytes` (lib/sync/nativeSha256.ts) ; base64 : implémentation
// locale, testée contre la référence Node (voir nativeSha256.test.ts et la
// batterie lancée au développement).
import { utf8Bytes } from './nativeSha256';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: number[] | Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
}

function base64Decode(text: string): Uint8Array {
  // Tolérant : ignore tout ce qui n'est pas de l'alphabet (padding
  // optionnel — base64url est souvent produit sans '=').
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    const value = B64_ALPHABET.indexOf(c);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

// UTF-8 → String, manuel (TextDecoder absent d'Hermes). Les points de code
// hors BMP (émojis) sont reconstitués en surrogate pairs.
function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
      i += 4;
    }
  }
  return out;
}

export function vaultStorageObjectKey(relPath: string): string {
  return base64Encode(utf8Bytes(relPath))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Inverse de vaultStorageObjectKey — sert uniquement aux tests (vérifier que
// l'encodage est sans perte), jamais au runtime.
export function decodeVaultStorageObjectKey(key: string): string {
  return utf8Decode(base64Decode(key.replace(/-/g, '+').replace(/_/g, '/')));
}
