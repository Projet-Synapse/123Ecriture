import { useEffect, useState } from 'react';
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

const DEFAULT_OPEN_MODE_OPTIONS: { value: DefaultOpenMode; label: string }[] = [
  { value: 'lastOpened', label: 'Dernier ouvert' },
  { value: 'newNote', label: 'Nouvelle note' },
  { value: 'specific', label: 'Fichier spécifique' },
];

// Section "Gestion des fichiers et des liens" — dossier des pièces
// jointes, emplacement par défaut des nouvelles notes, création
// automatique de note cible pour un wikilink. Toujours disponible (ces
// réglages sont lus par apps/desktop/electron/vault.ts et
// NotesScreen.tsx), mais n'a d'effet visible qu'avec un coffre ouvert.
//
// //1. Pièces jointes — dossier de destination.
// //2. Nouvelles notes — emplacement par défaut (+ dossier personnalisé).
// //3. Wikilinks — création automatique de la note cible.
// //4. Ordre des fichiers dans l'explorateur.
// //5. Fichier ouvert par défaut (dernier ouvert / nouvelle note /
//      spécifique) — voir NotesScreen.tsx pour l'effet d'ouverture et le
//      défilement automatique de l'explorateur vers la note active.

// v0.4.36 : sélecteur RÉEL pour « Fichier ouvert par défaut » — l'ancien
// champ texte exigeait de connaître le chemin exact par cœur ; ici on
// choisit le fichier dans l'arborescence du coffre actif, et le choix
// s'applique immédiatement (persistance via setDefaultOpenSpecificPath).
function DefaultOpenFilePicker() {
  const { preferences, theme, setDefaultOpenSpecificPath } = usePreferences();
  const [fichiers, setFichiers] = useState<{ relPath: string; nom: string }[]>([]);
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    const load = async () => {
      if (typeof window === 'undefined' || !window.vault?.listTree) return;
      try {
        const tree = await window.vault.listTree();
        const notes: { relPath: string; nom: string }[] = [];
        const walk = (nodes: VaultTreeNode[], prefix: string) => {
          for (const n of nodes) {
            if (n.type === 'note') notes.push({ relPath: n.relPath, nom: (prefix ? prefix + ' / ' : '') + n.name });
            if (n.type === 'folder' && n.children) walk(n.children, (prefix ? prefix + ' / ' : '') + n.name);
          }
        };
        walk(tree, '');
        setFichiers(notes);
      } catch {
        setFichiers([]);
      }
    };
    void load();
  }, [ouvert]);

  const filtres = fichiers.filter((f) => f.nom.toLowerCase().includes(recherche.trim().toLowerCase()));
  const choix = preferences.defaultOpenSpecificPath
    ? fichiers.find((f) => f.relPath === preferences.defaultOpenSpecificPath)?.nom ?? preferences.defaultOpenSpecificPath
    : null;

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOuvert((v) => !v)} accessibilityRole="button" style={[s.input, { borderColor: theme.border, flex: 0, minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Text style={{ color: choix ? theme.text : theme.textMuted, flex: 1 }} numberOfLines={1}>
          {choix ?? 'Choisir un fichier…'}
        </Text>
        <Text style={{ color: theme.textMuted }}>{ouvert ? '▾' : '▸'}</Text>
      </Pressable>
      {ouvert && (
        <View style={{ gap: 2, maxHeight: 240, borderWidth: 1, borderRadius: 8, padding: 6, borderColor: theme.border }}>
          <TextInput
            value={recherche}
            onChangeText={setRecherche}
            placeholder="Rechercher…"
            placeholderTextColor={theme.textMuted}
            style={[s.input, { color: theme.text, borderColor: theme.border, flex: 0, minWidth: 200 }]}
          />
          {filtres.slice(0, 60).map((f) => (
            <Pressable
              key={f.relPath}
              onPress={() => {
                void setDefaultOpenSpecificPath(f.relPath);
                setOuvert(false);
              }}
              accessibilityRole="button"
              style={{ paddingVertical: 5, paddingHorizontal: 8, borderRadius: 6, backgroundColor: f.relPath === preferences.defaultOpenSpecificPath ? theme.accent : 'transparent' }}
            >
              <Text style={{ color: f.relPath === preferences.defaultOpenSpecificPath ? '#fff' : theme.text, fontSize: 13 }} numberOfLines={1}>
                {f.nom}
              </Text>
            </Pressable>
          ))}
          {filtres.length > 60 && <Text style={[s.hint, { color: theme.textMuted }]}>+ {filtres.length - 60} autres…</Text>}
        </View>
      )}
    </View>
  );
}

export function FilesLinksSection() {
  const {
    preferences,
    theme,
    setAttachmentsFolder,
    setNewNoteLocation,
    setNewNoteCustomFolder,
    setAutoCreateWikilinkTarget,
    setFileSortMode,
    setDefaultOpenMode,
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
    void setAttachmentsFolder(trimmed || 'attachments');
  };

  const submitCustomFolder = () => {
    void setNewNoteCustomFolder(customFolderDraft.trim());
  };

  return (
    <View style={[s.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[s.cardTitle, { color: theme.text }]}>🗂️ Gestion des fichiers et des liens</Text>

      {/* //1. Pièces jointes */}
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

      {/* //2. Nouvelles notes */}
      <Text style={[s.label, { color: theme.textMuted }]}>Emplacement par défaut des nouvelles notes</Text>
      <View style={s.row}>
        {NEW_NOTE_LOCATION_OPTIONS.map((option) => {
          const isActive = preferences.newNoteLocation === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => void setNewNoteLocation(option.value)}
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

      {/* //3. Wikilinks */}
      <SettingsToggle
        label="Créer automatiquement la note cible d’un wikilink absent"
        value={preferences.autoCreateWikilinkTarget}
        onChange={(value) => void setAutoCreateWikilinkTarget(value)}
        theme={theme}
      />

      {/* //4. Ordre des fichiers */}
      <Text style={[s.label, { color: theme.textMuted }]}>Ordre des fichiers dans l’explorateur</Text>
      <View style={s.row}>
        {FILE_SORT_MODE_OPTIONS.map((option) => {
          const isActive = preferences.fileSortMode === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => void setFileSortMode(option.value)}
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

      {/* //5. Fichier ouvert par défaut */}
      <Text style={[s.label, { color: theme.textMuted }]}>Fichier ouvert par défaut</Text>
      <View style={s.row}>
        {DEFAULT_OPEN_MODE_OPTIONS.map((option) => {
          const isActive = preferences.defaultOpenMode === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => void setDefaultOpenMode(option.value)}
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
      {preferences.defaultOpenMode === 'specific' && <DefaultOpenFilePicker />}
      <Text style={[s.hint, { color: theme.textMuted }]}>
        Le fichier ouvert au démarrage de l’app (ou à l’activation d’un coffre) — l’explorateur se déplie et
        défile toujours jusqu’à lui, quel que soit le mode choisi ici.
      </Text>
    </View>
  );
}
