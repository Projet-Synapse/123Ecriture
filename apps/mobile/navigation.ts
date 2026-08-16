// Liste des sections de l'app. Chacune deviendra un vrai module (voir
// docs/ARCHITECTURE.md §8) au fil des phases — pour l'instant ce sont des
// écrans placeholder qui donnent juste la structure de navigation.

export type Section = {
  id: string;
  label: string;
  icon: string;
  description: string;
};

// Canvas et Graphiques ne sont PLUS des sections ici : ce sont des types de
// fichiers du vault (`.canvas`/`.chart`), ouverts depuis l'arborescence de
// "Notes" comme n'importe quel fichier (voir CanvasEditor.tsx/
// ChartEditor.tsx, NotesScreen.tsx) — révision du choix initial, documentée
// dans le plan/la mémoire du projet.
export const SECTIONS: Section[] = [
  {
    id: 'notes',
    label: 'Notes',
    icon: '📝',
    description: "L'éditeur MDX (ouvrir, écrire, sauvegarder un vault local) arrive en Phase 1.",
  },
  {
    id: 'tasks',
    label: 'Tâches',
    icon: '✅',
    description: 'To-do list locale, stockée dans le vault.',
  },
  {
    id: 'calendar',
    label: 'Calendrier',
    icon: '📅',
    description: 'Notes journalières et évènements, stockés dans le vault.',
  },
  {
    id: 'settings',
    label: 'Paramètres',
    icon: '⚙️',
    description: 'Vault, mises à jour — disponible sur la version desktop.',
  },
];
