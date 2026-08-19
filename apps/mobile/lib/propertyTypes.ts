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
