import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { listTemplateNotes, normalizeTemplateRules, type TemplateRule } from '../../lib/notes/templates';
import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/TemplatesSection.tsx — templates par chemin et nouveaux fichiers
//////////////////////////////////////////////////////////////////////////////
//
// Section « Templates » : décide du CONTENU et de l'EMPLACEMENT d'un
// nouveau fichier.
//   • Règles « dossier du coffre → fichier template » (v0.4.100) : liste
//     éditable (ajouter, supprimer, réordonner). À la création, la règle
//     dont le dossier est le PLUS SPÉCIFIQUE s'applique (sous-dossiers
//     compris) — NotesScreen.applyDefaultTemplate → templateForNewFile.
//   • Template par défaut (autres chemins) ou « Aucun ».
//   • Dossier des nouveaux fichiers : réglage newNoteLocation /
//     newNoteCustomFolder (déplacé ici en v0.4.99, pas dupliqué).
//
// Migration : l'ancien « Dossier des templates » (templatesFolder) n'a plus
// de champ ; il reste lu — ses fichiers (ou ceux des dossiers MODÈLES /
// TEMPLATES) sont proposés EN PREMIER dans les sélecteurs, et le menu
// « Insérer un modèle » les liste toujours. Le template par défaut est
// conservé tel quel. Aucune perte.
//
// Invariants : les sélecteurs lisent l'arborescence du coffre ACTIF
// (window.vault.listTree — desktop et Android) ; les brouillons texte sont
// validés à la soumission.
//
// SOMMAIRE :
//   1. Lecture du coffre (useVaultChoices)
//   2. VaultPicker — sélecteur avec recherche
//   3. TemplatesSection
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Lecture du coffre (useVaultChoices) ///////////////////////////////

const NEW_NOTE_LOCATION_OPTIONS: { value: NewNoteLocation; label: string }[] = [
  { value: 'vaultRoot', label: 'Racine du coffre' },
  { value: 'sameFolder', label: 'Même dossier que la note active' },
  { value: 'custom', label: 'Dossier personnalisé' },
];

type Choice = { value: string; label: string };

function useVaultChoices(templatesFolder: string | undefined): { notes: Choice[]; folders: Choice[] } | null {
  const [choices, setChoices] = useState<{ notes: Choice[]; folders: Choice[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.listTree) {
        setChoices({ notes: [], folders: [] });
        return;
      }
      try {
        const tree = await window.vault.listTree();
        if (cancelled) return;
        const templates = new Set(listTemplateNotes(tree, templatesFolder).map((n) => n.relPath));
        const notes: Choice[] = [];
        const folders: Choice[] = [];
        const walk = (items: VaultTreeNode[]) => {
          for (const item of items) {
            if (item.type === 'folder') {
              folders.push({ value: item.relPath, label: item.relPath });
              walk(item.children ?? []);
            } else if (/\.mdx?$/i.test(item.relPath)) {
              notes.push({ value: item.relPath, label: item.relPath.replace(/\.(mdx|md)$/i, '') });
            }
          }
        };
        walk(tree);
        // Templates (dossier choisi / MODÈLES / TEMPLATES) en premier.
        notes.sort((a, b) => Number(templates.has(b.value)) - Number(templates.has(a.value)));
        setChoices({ notes, folders });
      } catch {
        if (!cancelled) setChoices({ notes: [], folders: [] });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [templatesFolder]);
  return choices;
}

//////// 2. VaultPicker — sélecteur avec recherche ///////////////////////////

function VaultPicker({
  value,
  choices,
  placeholder,
  noneLabel,
  onSelect,
}: {
  value: string;
  choices: Choice[];
  placeholder: string;
  noneLabel?: string;
  onSelect: (value: string) => void;
}) {
  const { theme } = usePreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? choices.filter((c) => c.label.toLowerCase().includes(q)) : choices;
  }, [choices, query]);
  const current = value ? choices.find((c) => c.value === value)?.label ?? `${value} (introuvable)` : null;
  const pick = (next: string) => {
    onSelect(next);
    setOpen(false);
    setQuery('');
  };
  return (
    <View style={{ gap: 4, flex: 1, minWidth: 180 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        style={[s.input, { borderColor: theme.border, flex: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }]}
      >
        <Text style={{ color: current ? theme.text : theme.textMuted, flex: 1 }} numberOfLines={1}>
          {current ?? (noneLabel && !value ? noneLabel : placeholder)}
        </Text>
        <Text style={{ color: theme.textMuted }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <View style={{ gap: 2, borderWidth: 1, borderRadius: 8, padding: 6, borderColor: theme.border }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher…"
            placeholderTextColor={theme.textMuted}
            style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0 }]}
          />
          {noneLabel !== undefined && (
            <Pressable onPress={() => pick('')} accessibilityRole="button" style={{ paddingVertical: 5, paddingHorizontal: 8 }}>
              <Text style={{ color: theme.textMuted, fontSize: 13 }}>{noneLabel}</Text>
            </Pressable>
          )}
          {filtered.slice(0, 50).map((c) => (
            <Pressable
              key={c.value}
              onPress={() => pick(c.value)}
              accessibilityRole="button"
              style={{
                paddingVertical: 5,
                paddingHorizontal: 8,
                borderRadius: 6,
                backgroundColor: c.value === value ? theme.accent : 'transparent',
              }}
            >
              <Text style={{ color: c.value === value ? '#fff' : theme.text, fontSize: 13 }} numberOfLines={1}>
                {c.label}
              </Text>
            </Pressable>
          ))}
          {filtered.length > 50 && (
            <Text style={[s.hint, { color: theme.textMuted }]}>+ {filtered.length - 50} autres — affine la recherche</Text>
          )}
        </View>
      )}
    </View>
  );
}

//////// 3. TemplatesSection //////////////////////////////////////////////////

export function TemplatesSection() {
  const {
    preferences,
    theme,
    setDefaultNewNoteTemplate,
    setTemplateRules,
    setNewNoteLocation,
    setNewNoteCustomFolder,
  } = usePreferences();

  const rules = useMemo(() => normalizeTemplateRules(preferences.templateRules), [preferences.templateRules]);
  const defaultTemplate = preferences.defaultNewNoteTemplate ?? '';
  const choices = useVaultChoices(preferences.templatesFolder);
  const folderChoices = useMemo(
    () => [{ value: '', label: '/ (tout le coffre)' }, ...(choices?.folders ?? [])],
    [choices],
  );

  const [customFolderDraft, setCustomFolderDraft] = useState(preferences.newNoteCustomFolder);
  const [syncedCustomFolder, setSyncedCustomFolder] = useState(preferences.newNoteCustomFolder);
  if (preferences.newNoteCustomFolder !== syncedCustomFolder) {
    setSyncedCustomFolder(preferences.newNoteCustomFolder);
    setCustomFolderDraft(preferences.newNoteCustomFolder);
  }
  const submitCustomFolder = () => {
    void setNewNoteCustomFolder(customFolderDraft.trim());
  };

  const saveRules = (next: TemplateRule[]) => void setTemplateRules(next);
  const updateRule = (index: number, patch: Partial<TemplateRule>) =>
    saveRules(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const moveRule = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    saveRules(next);
  };

  const smallButton = (label: string, onPress: () => void, disabled = false, a11y?: string) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      style={[s.modeButton, { borderColor: theme.border, opacity: disabled ? 0.4 : 1, paddingHorizontal: 10 }]}
    >
      <Text style={{ color: theme.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🧩 Templates</Text>

      {/* //1. Règles par chemin */}
      <Text style={[s.label, { color: theme.textMuted }]}>Templates par chemin</Text>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Un nouveau fichier créé dans un dossier (ou ses sous-dossiers) reçoit le template de la règle la plus précise.
        Exemple : « Projets/Réunions » → « Modèle réunion », « Projets » → « Modèle projet ».
      </Text>
      {rules.length === 0 && (
        <Text style={[s.hint, { color: theme.textMuted }]}>Aucune règle : le template par défaut s’applique partout.</Text>
      )}
      {rules.map((rule, index) => (
        <View
          key={`${index}-${rule.folder}`}
          style={{ gap: 6, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8 }}
        >
          <View style={[s.row, { alignItems: 'flex-start' }]}>
            <VaultPicker
              value={rule.folder}
              choices={folderChoices}
              placeholder="Choisir un dossier…"
              onSelect={(folder) => updateRule(index, { folder })}
            />
            <Text style={{ color: theme.textMuted, paddingTop: 8 }}>→</Text>
            <VaultPicker
              value={rule.template}
              choices={choices?.notes ?? []}
              placeholder="Choisir un fichier template…"
              onSelect={(template) => updateRule(index, { template })}
            />
          </View>
          <View style={s.row}>
            {smallButton('↑', () => moveRule(index, -1), index === 0, 'Monter la règle')}
            {smallButton('↓', () => moveRule(index, 1), index === rules.length - 1, 'Descendre la règle')}
            {smallButton('✕ Supprimer', () => saveRules(rules.filter((_, i) => i !== index)))}
          </View>
        </View>
      ))}
      <View style={s.row}>{smallButton('+ Ajouter une règle', () => saveRules([...rules, { folder: '', template: '' }]))}</View>

      {/* //2. Template par défaut */}
      <Text style={[s.label, { color: theme.textMuted }]}>Template par défaut (autres chemins)</Text>
      <View style={s.row}>
        <VaultPicker
          value={defaultTemplate}
          choices={choices?.notes ?? []}
          placeholder="Choisir un fichier template…"
          noneLabel="Aucun"
          onSelect={(relPath) => void setDefaultNewNoteTemplate(relPath)}
        />
      </View>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Appliqué avec « + Nouvelle note » et depuis un [[lien]] vers une fiche absente. Variables : {'{{title}}'},{' '}
        {'{{date}}'}, {'{{time}}'}, {'{{date:DD/MM/YYYY}}'}. Les fichiers des dossiers MODÈLES / TEMPLATES sont proposés en
        premier.
      </Text>

      {/* //3. Dossier des nouveaux fichiers */}
      <Text style={[s.label, { color: theme.textMuted }]}>Dossier des nouveaux fichiers</Text>
      <View style={s.row}>
        {NEW_NOTE_LOCATION_OPTIONS.map((option) => {
          const active = preferences.newNoteLocation === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => void setNewNoteLocation(option.value)}
              accessibilityRole="button"
              style={[
                s.modeButton,
                { borderColor: theme.border },
                active && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              <Text style={{ color: active ? '#fff' : theme.text }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {preferences.newNoteLocation === 'custom' && (
        <TextInput
          value={customFolderDraft}
          onChangeText={setCustomFolderDraft}
          onSubmitEditing={submitCustomFolder}
          onBlur={submitCustomFolder}
          placeholder="ex. Notes/Brouillons"
          placeholderTextColor={theme.textMuted}
          style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0, minWidth: 220 }]}
        />
      )}
    </View>
  );
}
