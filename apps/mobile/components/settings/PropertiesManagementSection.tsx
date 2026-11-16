import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { usePropertyDefinitions } from '../../lib/properties/usePropertyDefinitions';
import { TYPE_ICONS, TYPE_LABELS, TYPE_ORDER } from '../../lib/properties/propertyTypes';
import { placePopover, solidColor, type Rect } from '../../lib/ui/popover';
import { usePreferences } from '../../preferences/PreferencesContext';
import type { Theme } from '../../theme';
import { DraftTextField } from '../editors/DraftTextField';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/PropertiesManagementSection.tsx — le schéma global des propriétés
//////////////////////////////////////////////////////////////////////////////
//
// Paramètres → "Gestion des propriétés" : LE endroit où configurer le
// SCHÉMA global de propriétés typées (créer/renommer/changer de type/
// supprimer, et pour le type "Options" la liste des valeurs proposées).
// Le panneau latéral (PropertiesPanel.tsx) et le bloc en haut de note
// (PropertiesBlock.tsx) ne font qu'éditer des valeurs.
//
// Invariants du fichier :
//   • Renommer une définition migre la CLÉ de frontmatter dans les notes
//     qui la portent déjà (voir migrateRenamedPropertyInVault,
//     apps/desktop/electron/properties.ts).
//   • Changer le type ou supprimer une définition ne touche JAMAIS les
//     valeurs déjà écrites — seulement ce registre (voir le commentaire
//     d'en-tête d'apps/desktop/electron/properties.ts).
//   • Un seul sélecteur de type ouvert à la fois : l'état `openTypePickerId`
//     est levé au parent — plusieurs TypePicker sont montés en même temps,
//     sans exclusivité leurs popovers `position: 'absolute'` se
//     chevauchent avec les lignes voisines.
//   • Le scan du coffre enregistre les propriétés trouvées (type déduit)
//     et compte leur usage par note (`usage[name]`) ; relançable via
//     « Revérifier », lancé à l'ouverture de la section.
//
// SOMMAIRE :
//   1. TypePicker et résumé de migration (helpers)
//   2. PropertiesManagementSection — le registre du schéma
//   3. Les styles
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. TypePicker et résumé de migration (helpers) ///////////////////////////////////

// Taille du menu (6 px de marge interne + 10 options de ~30 px).
const TYPE_MENU_WIDTH = 190;
const TYPE_MENU_HEIGHT = 12 + TYPE_ORDER.length * 30;

function TypePicker({
  value,
  onSelect,
  theme,
  open,
  onToggle,
}: {
  value: PropertyType;
  onSelect: (type: PropertyType) => void;
  theme: Theme;
  open: boolean;
  // Levé au composant parent (voir PropertiesManagementSection ci-dessous)
  // plutôt qu'un state local à chaque instance : un seul menu ouvert.
  onToggle: () => void;
}) {
  // MENU EN SURCOUCHE (Modal transparent) — avant, un popover en
  // `position: 'absolute'` DANS la ligne : les lignes suivantes passaient
  // par-dessus (zIndex borné à son contexte d'empilement) et son fond
  // (panneaux, translucides selon l'apparence) laissait voir ET cliquer
  // les boutons derrière. Désormais : fond PLEIN, ombre, au-dessus de tout,
  // un fond invisible capte les clics et ferme au clic extérieur.
  const chipRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const screen = useWindowDimensions();

  const toggle = () => {
    if (open) {
      onToggle();
      return;
    }
    const node = chipRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        onToggle();
      });
    } else {
      setAnchor(null);
      onToggle();
    }
  };

  const solid = solidColor(theme.surface, solidColor(theme.background, '#ffffff'));
  const place = anchor
    ? placePopover(anchor, { width: TYPE_MENU_WIDTH, height: TYPE_MENU_HEIGHT }, screen)
    : { left: Math.max(8, (screen.width - TYPE_MENU_WIDTH) / 2), top: 80, maxHeight: screen.height - 160 };

  return (
    <View style={styles.typePickerWrap}>
      <Pressable
        ref={chipRef}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={[styles.typeChip, { borderColor: open ? theme.accent : theme.border }]}
      >
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
          {TYPE_ICONS[value]} {TYPE_LABELS[value]} ▾
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={onToggle}>
        {/* Fond invisible plein écran : capte TOUS les clics hors du menu. */}
        <Pressable style={styles.typeBackdrop} onPress={onToggle} accessibilityLabel="Fermer le menu des types" />
        <View
          style={[
            styles.typePopover,
            { left: place.left, top: place.top, maxHeight: place.maxHeight, backgroundColor: solid, borderColor: theme.border },
          ]}
        >
          <ScrollView bounces={false}>
            {TYPE_ORDER.map((type) => {
              const selected = type === value;
              return (
                <Pressable
                  key={type}
                  onPress={() => {
                    onSelect(type);
                    onToggle();
                  }}
                  style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                    styles.typeOption,
                    (hovered || pressed) && { backgroundColor: `${theme.accent}22` },
                    selected && { backgroundColor: `${theme.accent}33` },
                  ]}
                >
                  <Text style={{ fontSize: 12, width: 18, textAlign: 'center' }}>{TYPE_ICONS[type]}</Text>
                  <Text style={{ color: theme.text, fontSize: 12, flex: 1 }}>{TYPE_LABELS[type]}</Text>
                  {selected && <Text style={{ color: theme.accent, fontSize: 12 }}>✓</Text>}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// Résumé de migration → message lisible, jamais un simple "OK" (voir
// usePropertyDefinitions.update et le commentaire d'en-tête de
// electron/properties.ts). `migratedCount === 0 && skippedCount === 0`
// (propriété pas encore utilisée dans aucune note) reste affiché tel quel —
// "0 note(s) mise(s) à jour" est une information honnête, pas un bruit à
// masquer.
function formatMigrationMessage(migration: PropertyRenameMigrationSummary): string {
  const parts = [`${migration.migratedCount} note(s) mise(s) à jour`];
  if (migration.skippedCount > 0) {
    parts.push(`${migration.skippedCount} ignorée(s) — la nouvelle clé existait déjà`);
  }
  if (migration.errorCount > 0) {
    parts.push(`${migration.errorCount} erreur(s)`);
  }
  return parts.join(' · ');
}

//////// 2. PropertiesManagementSection — le registre du schéma ///////////////////////////

export function PropertiesManagementSection() {
  const { theme } = usePreferences();
  const { bridge, definitions, error, refresh, create, update, remove } = usePropertyDefinitions();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropertyType>('text');
  // Un seul sélecteur de type ouvert à la fois — voir le commentaire de
  // TypePicker plus haut. `'new'` désigne celui de la ligne de création tout
  // en bas, les autres valeurs sont des `PropertyDefinition.id`.
  const [openTypePickerId, setOpenTypePickerId] = useState<string | null>(null);
  // Résumé de la dernière migration de frontmatter suite à un renommage —
  // partagé entre toutes les lignes (comme `error` ci-dessus) plutôt qu'un
  // état par propriété : un seul renommage à la fois a du sens ici.
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);

  // Scan du coffre : toutes les propriétés mentionnées dans les fichiers
  // doivent être enregistrées convenablement, avec un petit chiffre —
  // lancé à l'ouverture de la section, relançable via « Revérifier ».
  // `usage[name]` = nombre de notes portant la clé.
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const runScan = useCallback(async () => {
    if (!bridge?.scanVault) return;
    setScanning(true);
    try {
      const result = await bridge.scanVault();
      setUsage(result.usage);
      setScanMessage(
        result.createdCount > 0
          ? `✅ ${result.createdCount} nouvelle(s) propriété(s) détectée(s) dans tes fichiers et enregistrée(s).`
          : null,
      );
      await refresh();
    } catch (err) {
      console.error('[properties] échec du scan du coffre :', err);
    } finally {
      setScanning(false);
    }
  }, [bridge, refresh]);

  useEffect(() => {
    // Passage par un timer : react-hooks/set-state-in-effect interdit un
    // setState synchronement dans l'effet (setScanning de runScan) — un
    // déclenchement après le montage est exactement le but recherché.
    const timer = setTimeout(() => {
      void runScan();
    }, 0);
    return () => clearTimeout(timer);
  }, [runScan]);

  const renameProperty = (id: string, trimmedName: string) => {
    setMigrationMessage(null);
    void (async () => {
      const migration = await update(id, { name: trimmedName });
      if (migration) setMigrationMessage(formatMigrationMessage(migration));
    })();
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    void create(name, newType, newType === 'options' ? [] : undefined);
  };

  if (!bridge) {
    return (
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🏷️ Gestion des propriétés</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>Disponible sur la version desktop pour l’instant.</Text>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[s.cardTitle, { color: theme.text }]}>🏷️ Gestion des propriétés</Text>
        <Text style={[s.label, { color: theme.textMuted }]}>
          Le schéma défini ici est proposé partout où une note peut avoir des propriétés (barre latérale, bloc en
          haut de note). Renommer une propriété migre automatiquement les notes qui l’utilisaient déjà ; changer
          son type ne modifie jamais les notes déjà écrites.
        </Text>
        {error && <Text style={[styles.error, { color: theme.danger }]}>⚠️ {error}</Text>}
        {migrationMessage && (
          <Text style={[styles.migrationMessage, { color: theme.textMuted }]}>✅ {migrationMessage}</Text>
        )}
        {scanMessage && (
          <Text style={[styles.migrationMessage, { color: theme.textMuted }]}>{scanMessage}</Text>
        )}

        <View style={styles.scanRow}>
          <Pressable onPress={() => void runScan()} style={[styles.scanButton, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text, fontSize: 12 }}>
              {scanning ? '⏳ Scan du coffre…' : '🔄 Revérifier le coffre'}
            </Text>
          </Pressable>
          <Text style={[styles.scanHint, { color: theme.textMuted }]}>
            Enregistre automatiquement les propriétés trouvées dans tes notes (type déduit) et compte leur usage.
          </Text>
        </View>

        {definitions.length === 0 && (
          <Text style={[styles.muted, { color: theme.textMuted }]}>Aucune propriété définie pour l’instant.</Text>
        )}

        {definitions.map((def) => (
          <View key={def.id} style={styles.defBlock}>
            <View style={styles.defRow}>
              <DraftTextField
                initialValue={def.name}
                onCommit={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== def.name) renameProperty(def.id, trimmed);
                }}
                theme={theme}
                style={[styles.defNameInput, { color: theme.text, borderColor: theme.border }]}
              />
              {/* Compteur d'usage (demande utilisateur : « un petit chiffre ») —
                  nombre de notes du coffre portant cette propriété. */}
              <View style={[styles.usageBadge, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text, fontSize: 11 }}>{usage[def.name] ?? 0}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>notes</Text>
              </View>
              <TypePicker
                value={def.type}
                onSelect={(type) => void update(def.id, { type })}
                theme={theme}
                open={openTypePickerId === def.id}
                onToggle={() => setOpenTypePickerId((current) => (current === def.id ? null : def.id))}
              />
              <Pressable onPress={() => void remove(def.id)} style={styles.rowRemove}>
                <Text style={{ color: theme.textMuted }}>🗑️</Text>
              </Pressable>
            </View>
            {(def.type === 'options' || def.type === 'multi-options') && (
              <View style={styles.optionsEditRow}>
                <Text style={[styles.optionsHint, { color: theme.textMuted }]}>
                  Options (séparées par des virgules) :
                </Text>
                <DraftTextField
                  initialValue={(def.options ?? []).join(', ')}
                  onCommit={(text) =>
                    void update(def.id, {
                      options: text
                        .split(',')
                        .map((item) => item.trim())
                        .filter((item) => item.length > 0),
                    })
                  }
                  placeholder="🟠 En cours, 🔴 Bloqué, 🟡 En attente"
                  theme={theme}
                  style={[styles.optionsInput, { color: theme.text, borderColor: theme.border }]}
                />
              </View>
            )}
          </View>
        ))}

        <View style={styles.createRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={submitCreate}
            placeholder="Nouvelle propriété…"
            placeholderTextColor={theme.textMuted}
            style={[styles.createInput, { color: theme.text, borderColor: theme.border }]}
          />
          <TypePicker
            value={newType}
            onSelect={setNewType}
            theme={theme}
            open={openTypePickerId === 'new'}
            onToggle={() => setOpenTypePickerId((current) => (current === 'new' ? null : 'new'))}
          />
          <Pressable onPress={submitCreate} style={[styles.createButton, { backgroundColor: theme.accent }]}>
            <Text style={styles.createButtonText}>Créer</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

//////// 3. Les styles ////////////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  stack: {
    gap: 16,
  },
  muted: {
    fontSize: 12,
    lineHeight: 18,
  },
  error: {
    fontSize: 12,
  },
  migrationMessage: {
    fontSize: 12,
  },
  defBlock: {
    gap: 6,
    // Sépare visuellement chaque propriété de la suivante — sans ça, des
    // lignes consécutives très compactes (juste 6px de gap) + un popover de
    // sélecteur de type ouvert (voir TypePicker) donnent l'impression que
    // les rangées "se rentrent dedans".
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  defRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Filet de sécurité : sur un panneau étroit, empile plutôt que de
    // laisser le nom/le chip de type/la poubelle se chevaucher.
    flexWrap: 'wrap',
  },
  usageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  scanButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  scanHint: {
    fontSize: 11,
    flex: 1,
    minWidth: 140,
    lineHeight: 15,
  },
  defNameInput: {
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  rowRemove: {
    paddingHorizontal: 4,
  },
  optionsEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
  },
  optionsHint: {
    fontSize: 11,
  },
  optionsInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 12,
  },
  typePickerWrap: {
    position: 'relative',
  },
  typeChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  // Fond plein écran invisible du menu (capte les clics extérieurs).
  typeBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  typePopover: {
    position: 'absolute',
    width: TYPE_MENU_WIDTH,
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 16,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  createInput: {
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  createButton: {
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
