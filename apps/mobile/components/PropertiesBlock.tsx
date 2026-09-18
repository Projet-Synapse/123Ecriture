import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePropertyDefinitions } from '../lib/usePropertyDefinitions';
import { usePropertyValues, type PropertyLine } from '../lib/usePropertyValues';
import { TYPE_ICONS, makePropertyDefinition } from '../lib/propertyTypes';
import type { Theme } from '../theme';
import { AddPropertyButton } from './AddPropertyButton';
import { DraftTextField } from './DraftTextField';
import { PropertyValueField } from './PropertyValueField';

// Bloc "Propriétés" affiché en haut/au fil de la note en mode Intermédiaire
// et Aperçu (voir NotesScreen.tsx — pas en mode Source, où le YAML brut du
// frontmatter reste directement éditable tel quel), façon capture de
// référence (.claude/References/image-4.png). Même logique/données que
// PropertiesPanel.tsx (barre latérale), via lib/usePropertyValues.ts — les
// deux surfaces restent synchronisées puisqu'elles lisent/écrivent le même
// frontmatter de la note active.
//
// SOURCE DE VÉRITÉ = le frontmatter du fichier (demande utilisateur : « les
// trois modes doivent détenir les mêmes informations ») : TOUTES les clés
// du YAML s'affichent ici, dans leur ordre réel du fichier, qu'elles soient
// enregistrées dans le schéma ou non. created/modified sont matérialisées
// dans le YAML à la sauvegarde (NotesScreen.tsx) et s'affichent en lecture
// seule (leur valeur est réécrite par l'app). `interactive` active le
// glisser-déposer (mode Intermédiaire uniquement — en Aperçu le bloc vit
// dans un ScrollView et le geste entrerait en conflit avec le défilement).
function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Valeur de date système affichée : ISO parsée → format français lisible ;
// toute autre valeur (ex. une date tapée à la main en mode Source) reste
// telle quelle plutôt que d'afficher « Invalid Date ».
function formatSystemDate(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return formatTimestamp(Date.parse(value));
  }
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

type Props = {
  theme: Theme;
  activeNote: VaultEntry;
  content: string;
  onChangeContent: (text: string) => void;
  tree: VaultTreeNode[];
  // Glisser-déposer actif (mode Intermédiaire uniquement — voir ci-dessus).
  interactive?: boolean;
};

export function PropertiesBlock({ theme, activeNote, content, onChangeContent, tree, interactive = false }: Props) {
  const { definitions, update, create } = usePropertyDefinitions();
  const { lines, availableToAdd, setValue, addValue, removeValue, reorder } = usePropertyValues(
    content,
    onChangeContent,
    definitions,
  );
  // Repliable — voir NotesScreen.tsx : en mode Intermédiaire, cette carte
  // reste fixe au-dessus de CodeMirror (qui gère son propre scroll interne,
  // impossible à imbriquer ici sans risquer de casser l'éditeur, voir les
  // "écarts pragmatiques" de docs/ARCHITECTURE.md sur ce composant) — le
  // repli permet au moins de lui rendre de la place pendant la frappe sans
  // avoir à toucher au modèle de scroll de CodeMirror.
  const [collapsed, setCollapsed] = useState(false);

  // Glisser-déposer (réordonnancement du frontmatter — l'ordre suit en mode
  // Source) : même mécanique HTML5 que l'arborescence de NotesScreen.tsx.
  // react-native-web 0.21 ne transmet pas `draggable` aux Pressable/View :
  // posé impérativement sur chaque `[data-propname]` (attribut fourni via
  // `dataSet`), web uniquement (natif : ordre en lecture seule pour l'instant).
  const listRef = useRef<View | null>(null);
  const [draggingName, setDraggingName] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<{ name: string; edge: 'above' | 'below' } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const insertionRef = useRef<{ name: string; edge: 'above' | 'below' } | null>(null);
  // Miroir des lignes pour les écouteurs de drag (mis à jour par effet —
  // react-hooks/refs interdit d'écrire une ref pendant le rendu).
  const linesRef = useRef<PropertyLine[]>(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    const container = listRef.current as unknown as HTMLElement | null;
    if (!container) return;
    const rows = container.querySelectorAll<HTMLElement>('[data-propname]');
    rows.forEach((row) => {
      row.draggable = interactive && !collapsed;
    });
  }, [lines, interactive, collapsed]);

  useEffect(() => {
    const container = listRef.current as unknown as HTMLElement | null;
    if (!container || !interactive) return;

    const handleDragStart = (event: DragEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-propname]');
      if (!target) return;
      draggingRef.current = target.getAttribute('data-propname');
      setDraggingName(draggingRef.current);
    };
    const handleDragOver = (event: DragEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-propname]');
      if (!target || !draggingRef.current) return;
      event.preventDefault();
      const name = target.getAttribute('data-propname');
      if (!name || name === draggingRef.current) return setInsertion(null);
      const rect = target.getBoundingClientRect();
      const edge: 'above' | 'below' = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
      const next: { name: string; edge: 'above' | 'below' } = { name, edge };
      if (insertionRef.current?.name !== next.name || insertionRef.current?.edge !== next.edge) {
        insertionRef.current = next;
        setInsertion(next);
      }
    };
    const handleDrop = () => {
      const dragged = draggingRef.current;
      const target = insertionRef.current;
      if (dragged && target) {
        const names = linesRef.current.map((line) => line.name).filter((name) => name !== dragged);
        const index = names.indexOf(target.name);
        const insertAt = index === -1 ? names.length : index + (target.edge === 'below' ? 1 : 0);
        names.splice(insertAt, 0, dragged);
        reorder(names);
      }
      handleDragEnd();
    };
    const handleDragEnd = () => {
      draggingRef.current = null;
      insertionRef.current = null;
      setDraggingName(null);
      setInsertion(null);
    };

    container.addEventListener('dragstart', handleDragStart);
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    container.addEventListener('dragend', handleDragEnd);
    return () => {
      container.removeEventListener('dragstart', handleDragStart);
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      container.removeEventListener('dragend', handleDragEnd);
    };
    // `insertion` volontairement absent : handleDrop lit insertionRef (mis à
    // jour à chaque dragover) — recréer les écouteurs à chaque survol serait
    // du bruit inutile.
  }, [interactive, reorder]);

  // Définition de repli pour une clé non enregistrée : champ texte générique
  // (PropertyValueField n'a besoin que de name/type pour ce cas).
  const fallbackDefinition = (line: PropertyLine): PropertyDefinition =>
    line.definition ?? makePropertyDefinition(`raw-${line.name}`, line.name, 'text');

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable style={styles.titleRow} onPress={() => setCollapsed((v) => !v)}>
        <Text style={[styles.title, { color: theme.textMuted }]}>Propriétés</Text>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{collapsed ? '▸' : '▾'}</Text>
      </Pressable>

      {!collapsed && (
        <View ref={listRef}>
          {lines.map((line) => {
            const isInsertionAbove = insertion?.name === line.name && insertion.edge === 'above';
            const isInsertionBelow = insertion?.name === line.name && insertion.edge === 'below';
            return (
              <View
                key={line.name}
                dataSet={{ propname: line.name }}
                style={[
                  styles.row,
                  draggingName === line.name && styles.rowDragging,
                  isInsertionAbove && styles.rowInsertAbove,
                  isInsertionBelow && styles.rowInsertBelow,
                ]}
              >
                {interactive && <Text style={[styles.grip, { color: theme.textMuted }]}>⋮⋮</Text>}
                <Text style={{ fontSize: 12 }}>
                  {line.isSystemDate ? (line.name === 'created' ? '➕' : '✏️') : TYPE_ICONS[line.definition?.type ?? 'text']}
                </Text>
                {line.isSystemDate ? (
                  // Dates matérialisées par l'app à la sauvegarde (voir
                  // NotesScreen.tsx) : lecture seule — une édition manuelle
                  // serait écrasée au prochain enregistrement.
                  <Text style={[styles.label, { color: theme.textMuted }]}>
                    {line.name === 'created' ? 'Créé' : 'Modifié'}
                  </Text>
                ) : line.definition ? (
                  // Renomme la propriété dans le SCHÉMA global (voir Paramètres →
                  // Gestion des propriétés) — la clé de frontmatter est migrée
                  // dans toutes les notes du coffre qui la portent.
                  <DraftTextField
                    initialValue={line.definition.name}
                    onCommit={(value) => {
                      const trimmed = value.trim();
                      const def = line.definition;
                      if (def && trimmed && trimmed !== def.name) void update(def.id, { name: trimmed });
                    }}
                    theme={theme}
                    style={[styles.labelInput, { color: theme.textMuted }]}
                  />
                ) : (
                  // Clé encore inconnue du schéma : nom en lecture seule —
                  // elle sera enregistrée automatiquement (Paramètres →
                  // Gestion des propriétés, scan du coffre).
                  <Text style={[styles.label, { color: theme.textMuted }]} numberOfLines={1}>
                    {line.name}
                  </Text>
                )}
                {line.isSystemDate ? (
                  <Text style={[styles.readonlyValue, { color: theme.text }]}>{formatSystemDate(line.value)}</Text>
                ) : (
                  <PropertyValueField
                    def={fallbackDefinition(line)}
                    value={line.value}
                    onChange={(value) => setValue(line.name, value)}
                    theme={theme}
                    tree={tree}
                  />
                )}
                {!line.isSystemDate && (
                  <Text
                    onPress={() => removeValue(line.name)}
                    style={[styles.rowRemove, { color: theme.textMuted }]}
                  >
                    ✕
                  </Text>
                )}
              </View>
            );
          })}

          <AddPropertyButton
            available={availableToAdd}
            onAdd={addValue}
            onCreateNew={async (name, type) => {
              await create(name, type, type === 'options' ? [] : undefined);
              // addValue n'a besoin que de name/type : la définition
              // définitive arrivera avec le rafraîchissement du schéma.
              addValue(makePropertyDefinition(`new-${name}`, name, type));
            }}
            theme={theme}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    // Espace sous la carte AVANT la barre d'outils de l'éditeur (voir
    // NotesScreen.tsx, `<EditorToolbar>` juste après ce composant) —
    // sans ça le bouton "+" (et son popover d'ajout, qui s'ouvre vers le
    // bas) touchait/chevauchait visuellement la barre d'outils juste en
    // dessous (bug rapporté).
    marginBottom: 12,
    // Nécessaire pour que le popover du bouton "+" (position: 'absolute',
    // voir AddPropertyButton.tsx) puisse s'étendre au-delà du bord bas de
    // cette carte sans être rogné par elle.
    zIndex: 1,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowDragging: {
    opacity: 0.4,
  },
  rowInsertAbove: {
    borderTopWidth: 2,
    borderTopColor: '#4f46e5',
  },
  rowInsertBelow: {
    borderBottomWidth: 2,
    borderBottomColor: '#4f46e5',
  },
  grip: {
    fontSize: 10,
    letterSpacing: -2,
  },
  label: {
    width: 90,
    fontSize: 12,
  },
  labelInput: {
    width: 90,
    fontSize: 12,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  readonlyValue: {
    flex: 1,
    fontSize: 12,
  },
  rowRemove: {
    paddingHorizontal: 4,
  },
});
