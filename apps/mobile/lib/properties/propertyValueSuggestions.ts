// ✒️ 123ECRITURE — lib/properties/propertyValueSuggestions.ts — suggestions de valeurs de propriétés
//////////////////////////////////////////////////////////////////////////////
//
// Autocomplétion des VALEURS de propriétés (bloc Propriétés de la note,
// barre latérale), comme les liens internes `[[…]]` :
//   • valeurs déjà utilisées pour la MÊME propriété dans le coffre, triées
//     par fréquence puis pertinence (début du texte > début d'un mot >
//     ailleurs), filtrage insensible aux accents et aux majuscules ;
//   • options définies dans le schéma (Options, Options multiples, Bulles) ;
//   • noms de notes (insérés en `[[Nom]]`) pour le type Chemin ou dès
//     qu'on tape `[[`.
// Fonctions PURES, testées (propertyValueSuggestions.test.ts) — la
// collecte disque vit dans propertyValueIndex.ts, l'UI dans
// components/properties/SuggestTextInput.tsx.
//
//////////////////////////////////////////////////////////////////////////////

// Index : nom de propriété (minuscules) → valeur → nombre de notes.
export type PropertyValueIndex = Map<string, Map<string, number>>;

export type ValueSuggestion = {
  // Texte inséré tel quel (`[[Nom]]` pour une note).
  value: string;
  // Libellé affiché (le nom seul pour une note).
  label: string;
  source: 'used' | 'option' | 'note';
  count: number;
};

// Minuscules sans accents (« Été » → « ete ») pour la comparaison.
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Valeurs suggérables d'une valeur de frontmatter : chaînes et nombres,
// éléments de tableau compris ; booléens, objets et vides ignorés.
export function flattenPropertyValue(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
    } else if (typeof item === 'number' && Number.isFinite(item)) {
      out.push(String(item));
    }
  }
  return out;
}

// Ajoute le frontmatter d'UNE note à l'index (une valeur compte une fois
// par note, même répétée dans un tableau). created/modified exclus : des
// horodatages, jamais utiles en suggestion.
export function absorbFrontmatterValues(index: PropertyValueIndex, data: Record<string, unknown>): void {
  for (const [key, raw] of Object.entries(data)) {
    const name = key.toLowerCase();
    if (name === 'created' || name === 'modified') continue;
    const values = new Set(flattenPropertyValue(raw));
    if (values.size === 0) continue;
    let counts = index.get(name);
    if (!counts) {
      counts = new Map();
      index.set(name, counts);
    }
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

// Pertinence d'un libellé pour la requête : 0 = commence par, 1 = un mot
// commence par, 2 = contient, null = ne correspond pas.
export function matchRank(label: string, query: string): number | null {
  const q = normalizeForSearch(query);
  if (!q) return 0;
  const l = normalizeForSearch(label);
  if (l.startsWith(q)) return 0;
  const at = l.indexOf(q);
  if (at === -1) return null;
  return /[\s\-_/.,([]/.test(l[at - 1] ?? '') ? 1 : 2;
}

// Requête `[[…` en cours à la fin du texte (lien interne non refermé) :
// { start: position du `[[`, query } ou null.
export function openWikilinkQuery(text: string): { start: number; query: string } | null {
  const start = text.lastIndexOf('[[');
  if (start === -1) return null;
  const rest = text.slice(start + 2);
  if (rest.includes(']]')) return null;
  return { start, query: rest };
}

export type SuggestOptions = {
  query: string;
  // Valeurs déjà utilisées pour CETTE propriété (index.get(nom)).
  used?: ReadonlyMap<string, number>;
  // Options du schéma (Options / Options multiples / Bulles).
  schemaOptions?: readonly string[];
  // Noms de notes : proposés quand `includeNotes` (type Chemin, `[[`).
  noteNames?: readonly string[];
  includeNotes?: boolean;
  // Valeurs à ne pas reproposer (déjà présentes dans la liste/les bulles).
  exclude?: readonly string[];
  limit?: number;
};

export function suggestPropertyValues(options: SuggestOptions): ValueSuggestion[] {
  const { query, used, schemaOptions = [], noteNames = [], includeNotes = false, exclude = [], limit = 8 } = options;
  const excluded = new Set(exclude.map(normalizeForSearch));
  const trimmedQuery = query.trim();
  const byKey = new Map<string, ValueSuggestion & { rank: number }>();

  const consider = (suggestion: ValueSuggestion) => {
    const key = normalizeForSearch(suggestion.value);
    if (!key || excluded.has(key)) return;
    // La valeur EXACTE déjà tapée n'est pas une suggestion utile (« ete »
    // propose bien « Été » : corrige la graphie).
    if (suggestion.value === trimmedQuery) return;
    const rank = matchRank(suggestion.label, query);
    if (rank === null) return;
    const existing = byKey.get(key);
    if (existing) {
      // Une option du schéma aussi utilisée : fréquence cumulée.
      existing.count = Math.max(existing.count, suggestion.count);
      return;
    }
    byKey.set(key, { ...suggestion, rank });
  };

  for (const [value, count] of used ?? []) consider({ value, label: value, source: 'used', count });
  for (const option of schemaOptions) {
    consider({ value: option, label: option, source: 'option', count: used?.get(option) ?? 0 });
  }
  if (includeNotes) {
    for (const name of noteNames) {
      const value = `[[${name}]]`;
      consider({ value, label: name, source: 'note', count: used?.get(value) ?? 0 });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.rank - b.rank || a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
    .slice(0, limit)
    .map(({ rank: _rank, ...rest }) => rest);
}

// Liste séparée par des virgules : on complète le DERNIER élément.
export function lastListSegment(text: string): { prefix: string; query: string } {
  const comma = text.lastIndexOf(',');
  if (comma === -1) return { prefix: '', query: text.trim() };
  return { prefix: `${text.slice(0, comma + 1)} `, query: text.slice(comma + 1).trim() };
}
