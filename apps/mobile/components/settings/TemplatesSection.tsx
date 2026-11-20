import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { listTemplateNotes } from '../../lib/notes/templates';
import { usePreferences } from '../../preferences/PreferencesContext';
import { settingsStyles as s } from './settingsStyles';

// ✒️ 123ECRITURE — components/settings/TemplatesSection.tsx — modèles et nouveaux fichiers
//////////////////////////////////////////////////////////////////////////////
//
// Section « Templates » (v0.4.99) : regroupe tout ce qui décide du
// CONTENU et de l'EMPLACEMENT d'un nouveau fichier.
//   • Dossier des templates ('' = détection automatique des dossiers
//     MODÈLES / TEMPLATES, comportement historique) — lu par « 📋 Insérer
//     un modèle » et par le modèle par défaut.
//   • Modèle des nouveaux fichiers (ou « Aucun ») — appliqué par
//     NotesScreen (applyDefaultTemplate) au bouton « + Nouvelle note » et
//     à la création depuis un [[lien]] vers une fiche absente.
//   • Dossier des nouveaux fichiers : le réglage EXISTANT newNoteLocation /
//     newNoteCustomFolder, DÉPLACÉ ici depuis « Gestion des fichiers et des
//     liens » (pas dupliqué).
//
// Invariants : brouillons texte validés à la soumission (onBlur/Enter),
// resynchronisés pendant le rendu — même pattern que FilesLinksSection ;
// la liste des modèles est lue dans le coffre ACTIF (window.vault, desktop
// et Android).
//
// SOMMAIRE :
//   1. Options et useTemplateList
//   2. TemplatesSection
//
//////////////////////////////////////////////////////////////////////////////

//////// 1. Options et useTemplateList ////////////////////////////////////////

const NEW_NOTE_LOCATION_OPTIONS: { value: NewNoteLocation; label: string }[] = [
  { value: 'vaultRoot', label: 'Racine du coffre' },
  { value: 'sameFolder', label: 'Même dossier que la note active' },
  { value: 'custom', label: 'Dossier personnalisé' },
];

type TemplateChoice = { relPath: string; name: string };

function useTemplateList(folder: string | undefined): TemplateChoice[] | null {
  const [list, setList] = useState<TemplateChoice[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.listTree) {
        setList([]);
        return;
      }
      try {
        const tree = await window.vault.listTree();
        if (cancelled) return;
        setList(
          listTemplateNotes(tree, folder).map((note) => ({
            relPath: note.relPath,
            name: note.name.replace(/\.(mdx|md)$/i, ''),
          })),
        );
      } catch {
        if (!cancelled) setList([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [folder]);
  return list;
}

//////// 2. TemplatesSection //////////////////////////////////////////////////

export function TemplatesSection() {
  const {
    preferences,
    theme,
    setTemplatesFolder,
    setDefaultNewNoteTemplate,
    setNewNoteLocation,
    setNewNoteCustomFolder,
  } = usePreferences();

  const templatesFolder = preferences.templatesFolder ?? '';
  const defaultTemplate = preferences.defaultNewNoteTemplate ?? '';

  const [folderDraft, setFolderDraft] = useState(templatesFolder);
  const [syncedFolder, setSyncedFolder] = useState(templatesFolder);
  if (templatesFolder !== syncedFolder) {
    setSyncedFolder(templatesFolder);
    setFolderDraft(templatesFolder);
  }

  const [customFolderDraft, setCustomFolderDraft] = useState(preferences.newNoteCustomFolder);
  const [syncedCustomFolder, setSyncedCustomFolder] = useState(preferences.newNoteCustomFolder);
  if (preferences.newNoteCustomFolder !== syncedCustomFolder) {
    setSyncedCustomFolder(preferences.newNoteCustomFolder);
    setCustomFolderDraft(preferences.newNoteCustomFolder);
  }

  const templates = useTemplateList(templatesFolder);
  const missingDefault =
    defaultTemplate !== '' && templates !== null && !templates.some((t) => t.relPath === defaultTemplate);

  const submitFolder = () => {
    const cleaned = folderDraft.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (cleaned !== templatesFolder) void setTemplatesFolder(cleaned);
  };
  const submitCustomFolder = () => {
    void setNewNoteCustomFolder(customFolderDraft.trim());
  };

  const choiceButton = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      style={[
        s.modeButton,
        { borderColor: theme.border },
        active && { backgroundColor: theme.accent, borderColor: theme.accent },
      ]}
    >
      <Text style={{ color: active ? '#fff' : theme.text }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🧩 Templates</Text>

      {/* //1. Dossier des templates */}
      <Text style={[s.label, { color: theme.textMuted }]}>Dossier des templates</Text>
      <TextInput
        value={folderDraft}
        onChangeText={setFolderDraft}
        onSubmitEditing={submitFolder}
        onBlur={submitFolder}
        placeholder="Automatique (dossiers MODÈLES / TEMPLATES)"
        placeholderTextColor={theme.textMuted}
        style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0, minWidth: 220 }]}
      />
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Chemin relatif à la racine du coffre (ex. « 0. BASE/📁 MODÈLES »). Vide : tous les dossiers nommés MODÈLES
        ou TEMPLATES. Utilisé par « 📋 Insérer un modèle » et par le modèle des nouveaux fichiers.
      </Text>

      {/* //2. Modèle des nouveaux fichiers */}
      <Text style={[s.label, { color: theme.textMuted }]}>Modèle appliqué aux nouveaux fichiers</Text>
      <View style={s.row}>
        {choiceButton('none', 'Aucun', defaultTemplate === '', () => void setDefaultNewNoteTemplate(''))}
        {(templates ?? []).map((t) =>
          choiceButton(t.relPath, t.name, t.relPath === defaultTemplate, () => void setDefaultNewNoteTemplate(t.relPath)),
        )}
      </View>
      {templates !== null && templates.length === 0 && (
        <Text style={[s.hint, { color: theme.textMuted }]}>Aucun modèle trouvé dans ce dossier.</Text>
      )}
      {missingDefault && (
        <Text style={[s.hint, { color: theme.danger }]}>
          Le modèle choisi (« {defaultTemplate} ») est introuvable : aucun modèle ne sera appliqué.
        </Text>
      )}
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Appliqué aux notes créées avec « + Nouvelle note » et depuis un [[lien]] vers une fiche absente.
        Variables : {'{{title}}'}, {'{{date}}'}, {'{{time}}'}, {'{{date:DD/MM/YYYY}}'}.
      </Text>

      {/* //3. Dossier des nouveaux fichiers (déplacé depuis Gestion des fichiers) */}
      <Text style={[s.label, { color: theme.textMuted }]}>Dossier des nouveaux fichiers</Text>
      <View style={s.row}>
        {NEW_NOTE_LOCATION_OPTIONS.map((option) =>
          choiceButton(option.value, option.label, preferences.newNoteLocation === option.value, () =>
            void setNewNoteLocation(option.value),
          ),
        )}
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
