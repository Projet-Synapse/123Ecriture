import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { usePreferences } from '../../preferences/PreferencesContext';
import { SettingsToggle } from './SettingsToggle';
import { settingsStyles as s } from './settingsStyles';

const NEW_NOTE_LOCATION_OPTIONS: { value: NewNoteLocation; label: string }[] = [
  { value: 'vaultRoot', label: 'Racine du coffre' },
  { value: 'sameFolder', label: 'Même dossier que la note active' },
  { value: 'custom', label: 'Dossier personnalisé' },
];

const FILE_SORT_MODE_OPTIONS: { value: FileSortMode; label: string }[] = [
  { value: 'alphabetical', label: 'Alphabétique' },
  { value: 'recent', label: 'Plus récent d’abord' },
  { value: 'oldest', label: 'Moins récent d’abord' },
  { value: 'manual', label: 'Manuel (glisser-déposer)' },
];

// Section "Gestion des fichiers et des liens" — dossier des pièces
// jointes, emplacement par défaut des nouvelles notes, création
// automatique de note cible pour un wikilink. Toujours disponible (ces
// réglages sont lus par apps/desktop/electron/vault.ts et
// NotesScreen.tsx), mais n'a d'effet visible qu'avec un coffre ouvert.
export function FilesLinksSection() {
  const {
    preferences,
    theme,
    setAttachmentsFolder,
    setNewNoteLocation,
    setNewNoteCustomFolder,
    setAutoCreateWikilinkTarget,
    setFileSortMode,
  } = usePreferences();

  // Champs texte en brouillon local, validés à la soumission (onBlur/Enter)
  // plutôt qu'à chaque frappe — même pattern que le renommage de coffre
  // dans AccountSyncSection.tsx, pour ne pas déclencher une sauvegarde IPC
  // par caractère tapé. Resynchronisés pendant le rendu (pas dans un effet,
  // voir https://react.dev/learn/you-might-not-need-an-effect) si la valeur
  // change ailleurs, ex. chargement des préférences depuis Electron.
  const [attachmentsDraft, setAttachmentsDraft] = useState(preferences.attachmentsFolder);
  const [syncedAttachmentsFolder, setSyncedAttachmentsFolder] = useState(preferences.attachmentsFolder);
  if (preferences.attachmentsFolder !== syncedAttachmentsFolder) {
    setSyncedAttachmentsFolder(preferences.attachmentsFolder);
    setAttachmentsDraft(preferences.attachmentsFolder);
  }

  const [customFolderDraft, setCustomFolderDraft] = useState(preferences.newNoteCustomFolder);
  const [syncedCustomFolder, setSyncedCustomFolder] = useState(preferences.newNoteCustomFolder);
  if (preferences.newNoteCustomFolder !== syncedCustomFolder) {
    setSyncedCustomFolder(preferences.newNoteCustomFolder);
    setCustomFolderDraft(preferences.newNoteCustomFolder);
  }

  const submitAttachmentsFolder = () => {
    const trimmed = attachmentsDraft.trim();
    setAttachmentsFolder(trimmed || 'attachments');
  };

  const submitCustomFolder = () => {
    setNewNoteCustomFolder(customFolderDraft.trim());
  };

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🗂️ Gestion des fichiers et des liens</Text>

      <Text style={[s.label, { color: theme.textMuted }]}>Dossier des pièces jointes</Text>
      <TextInput
        value={attachmentsDraft}
        onChangeText={setAttachmentsDraft}
        onSubmitEditing={submitAttachmentsFolder}
        onBlur={submitAttachmentsFolder}
        placeholder="attachments"
        placeholderTextColor={theme.textMuted}
        style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0, minWidth: 220 }]}
      />
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Relatif à la racine du coffre actif. Les fichiers déjà importés dans l’ancien dossier n’y sont pas déplacés.
      </Text>

      <Text style={[s.label, { color: theme.textMuted }]}>Emplacement par défaut des nouvelles notes</Text>
      <View style={s.row}>
        {NEW_NOTE_LOCATION_OPTIONS.map((option) => {
          const isActive = preferences.newNoteLocation === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setNewNoteLocation(option.value)}
              style={[
                s.modeButton,
                { borderColor: theme.border },
                isActive && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              <Text style={{ color: isActive ? '#fff' : theme.text }}>{option.label}</Text>
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

      <SettingsToggle
        label="Créer automatiquement la note cible d’un wikilink absent"
        value={preferences.autoCreateWikilinkTarget}
        onChange={setAutoCreateWikilinkTarget}
        theme={theme}
      />

      <Text style={[s.label, { color: theme.textMuted }]}>Ordre des fichiers dans l’explorateur</Text>
      <View style={s.row}>
        {FILE_SORT_MODE_OPTIONS.map((option) => {
          const isActive = preferences.fileSortMode === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setFileSortMode(option.value)}
              style={[
                s.modeButton,
                { borderColor: theme.border },
                isActive && { backgroundColor: theme.accent, borderColor: theme.accent },
              ]}
            >
              <Text style={{ color: isActive ? '#fff' : theme.text }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[s.hint, { color: theme.textMuted }]}>
        En mode Manuel, glisse un fichier dans l’explorateur pour le réordonner parmi ses frères — l’ordre est
        mémorisé même si tu reviens plus tard sur ce mode.
      </Text>
    </View>
  );
}
