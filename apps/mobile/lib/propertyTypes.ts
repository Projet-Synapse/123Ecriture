// Constantes et helpers partagés pour le système de propriétés typées (voir
// PropertyDefinition dans types/global.d.ts) — utilisés par
// PropertiesPanel.tsx (barre latérale), PropertiesBlock.tsx (bloc en haut
// de note) et settings/PropertiesManagementSection.tsx (Paramètres →
// Gestion des propriétés), pour ne pas dupliquer 3 fois la même logique de
// formatage/parsing des valeurs par type.

export const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Texte',
  list: 'Liste',
  number: 'Nombre',
  checkbox: 'Case à cocher',
  date: 'Date',
  datetime: 'Date et heure',
  path: 'Chemin',
  options: 'Options',
};

// Icône affichée devant chaque propriété (voir la capture de référence
// .claude/References/image-4.png — une icône par ligne, façon Obsidian).
export const TYPE_ICONS: Record<PropertyType, string> = {
  text: '≡',
  list: '☰',
  number: '#',
  checkbox: '☑',
  date: '📅',
  datetime: '🕐',
  path: '📁',
  options: '🔘',
};

export const TYPE_ORDER: PropertyType[] = [
  'text',
  'list',
  'number',
  'checkbox',
  'date',
  'datetime',
  'path',
  'options',
];

export function defaultValueForType(type: PropertyType): unknown {
  if (type === 'checkbox') return false;
  if (type === 'number') return 0;
  if (type === 'list') return [];
  return '';
}

// Devine le type d'une propriété à partir d'une valeur de frontmatter
// (auto-enregistrement des clés trouvées dans les fichiers, voir
// properties:scan-vault) : tableau → Liste, nombre → Nombre, booléen →
// Case à cocher, tout le reste → Texte. Une valeur échantillon seulement :
// si des notes différentes portent des types hétérogènes, la première clé
// vue gagne (pas de sur-ingénierie pour un cas marginal).
export function inferPropertyType(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  return 'text';
}

// ⚠️ La lib DOM de TypeScript déclare AUSSI une interface globale
// PropertyDefinition (CSS @property : inherits/initialValue/syntax) qui
// FUSIONNE avec la nôtre (types/global.d.ts) — un littéral brut exigerait
// le champ `inherits`, parasite du format properties.json. Tout littéral
// construit côté renderer passe donc par ce constructeur (cast localisé
// ici, nulle part ailleurs).
export function makePropertyDefinition(
  id: string,
  name: string,
  type: PropertyType,
  createdAt = '',
): PropertyDefinition {
  return { id, name, type, createdAt } as unknown as PropertyDefinition;
}

export function formatValueForInput(type: PropertyType, value: unknown): string {
  if (type === 'list') return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  if (value === null || value === undefined) return '';
  return String(value);
}

export function parseInputForType(type: PropertyType, text: string): unknown {
  if (type === 'number') {
    const parsed = Number(text.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (type === 'list') {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return text;
}
