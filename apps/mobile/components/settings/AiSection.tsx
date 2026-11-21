import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { lockingPath, normalizeLockedPaths } from '../../lib/ai/aiLock';
import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';
import { VaultPicker, type Choice } from './TemplatesSection';

// ✒️ 123ECRITURE — components/settings/AiSection.tsx — 🤖 IA : verrouillage
//////////////////////////////////////////////////////////////////////////////
//
// Section « 🤖 IA / Passerelle ». Partie 1 (v0.4.100) : la liste des
// dossiers et fichiers VERROUILLÉS pour l'IA (lib/ai/aiLock.ts) —
// ajouter, retirer. Même réglage que le clic droit « 🔒 Verrouiller pour
// l'IA » de l'explorateur ; stocké dans les préférences, répliquées dans
// le coffre (.123ecriture/preferences.json) donc synchronisées.
//
// Invariant : un élément verrouillé est TOUJOURS exclu de ce que l'IA
// peut voir ou toucher, quelles que soient les autres autorisations.
//
//////////////////////////////////////////////////////////////////////////////

function useVaultEntries(): Choice[] | null {
  const [entries, setEntries] = useState<Choice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.listTree) {
        setEntries([]);
        return;
      }
      try {
        const tree = await window.vault.listTree();
        const out: Choice[] = [];
        const walk = (items: VaultTreeNode[]) => {
          for (const item of items) {
            out.push({ value: item.relPath, label: item.type === 'folder' ? `📁 ${item.relPath}` : item.relPath });
            if (item.type === 'folder') walk(item.children ?? []);
          }
        };
        walk(tree);
        if (!cancelled) setEntries(out);
      } catch {
        if (!cancelled) setEntries([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return entries;
}

export function AiLockSection() {
  const { preferences, theme, setAiLockedPaths } = usePreferences();
  const locked = useMemo(() => normalizeLockedPaths(preferences.aiLockedPaths), [preferences.aiLockedPaths]);
  const entries = useVaultEntries();
  // Déjà couverts (directement ou par un dossier parent) : pas proposés.
  const addable = useMemo(() => (entries ?? []).filter((e) => !lockingPath(e.value, locked)), [entries, locked]);
  const known = useMemo(() => new Set((entries ?? []).map((e) => e.value.toLowerCase())), [entries]);

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🔒 Verrouillé pour l’IA</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        L’IA ne peut ni voir, ni lire, ni chercher, ni modifier ces dossiers et fichiers. Un dossier verrouillé
        verrouille tout ce qu’il contient. Le verrou suit les renommages et déplacements, et se synchronise avec tes
        autres appareils. Raccourci : clic droit (ou appui long) sur un élément de l’explorateur.
      </Text>
      {locked.length === 0 && <Text style={[s.hint, { color: theme.textMuted }]}>Rien n’est verrouillé.</Text>}
      {locked.map((path) => (
        <View key={path} style={[s.row, { alignItems: 'center' }]}>
          <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
            🔒 {path}
            {entries && !known.has(path.toLowerCase()) ? (
              <Text style={{ color: theme.textMuted, fontSize: 12 }}> (introuvable)</Text>
            ) : null}
          </Text>
          <Pressable
            onPress={() => void setAiLockedPaths(locked.filter((p) => p !== path))}
            accessibilityRole="button"
            accessibilityLabel={`Déverrouiller ${path}`}
            style={[s.modeButton, { borderColor: theme.border, paddingHorizontal: 10 }]}
          >
            <Text style={{ color: theme.text }}>🔓 Déverrouiller</Text>
          </Pressable>
        </View>
      ))}
      <Text style={[s.label, { color: theme.textMuted }]}>Verrouiller un dossier ou un fichier</Text>
      <View style={s.row}>
        <VaultPicker
          value=""
          choices={addable}
          placeholder={entries ? 'Choisir dans le coffre…' : 'Chargement…'}
          onSelect={(path) => {
            if (path) void setAiLockedPaths([...locked, path]);
          }}
        />
      </View>
    </View>
  );
}
