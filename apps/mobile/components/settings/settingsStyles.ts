import { StyleSheet } from 'react-native';

// Styles partagés entre toutes les sections de l'écran Paramètres (voir
// SettingsScreen.tsx) — évite de redéfinir "card"/"button"/"error"... dans
// chacun des 6 fichiers de apps/mobile/components/settings/. Les couleurs
// (theme.*) restent appliquées au niveau de chaque composant, pas ici : ce
// fichier ne porte que la géométrie, commune quel que soit le thème.
export const settingsStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardValue: {
    fontSize: 13,
  },
  label: {
    fontSize: 12,
    marginTop: 4,
  },
  hint: {
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  modeButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  error: {
    color: '#dc2626',
  },
  input: {
    flex: 1,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleLabel: {
    flex: 1,
    fontSize: 13,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 48,
    textAlign: 'center',
  },
  muted: {
    fontSize: 13,
  },
  // Liste réordonnable/masquable (case à cocher + libellé + flèches
  // haut/bas) — utilisée par ToolbarOrderEditor.tsx (barres d'outils
  // Canvas/Graphiques dans EditorSection.tsx).
  toolbarList: {
    gap: 6,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  toolbarItemLabel: {
    flex: 1,
    fontSize: 13,
  },
  reorderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  reorderButton: {
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  reorderButtonDisabled: {
    opacity: 0.3,
  },
});
