// Liste des sections de l'app. Chacune deviendra un vrai module (voir
// docs/ARCHITECTURE.md §8) au fil des phases — pour l'instant ce sont des
// écrans placeholder qui donnent juste la structure de navigation.

export type Section = {
  id: string;
  label: string;
  icon: string;
  description: string;
};

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
    description: 'Calendrier — prévu en Phase 5 (modules de productivité).',
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: '🎨',
    description: 'Canvas / Excalidraw — prévu en Phase 5 (modules de productivité).',
  },
  {
    id: 'graph',
    label: 'Graphe',
    icon: '🕸️',
    description: 'Graphe de notes, dérivé automatiquement des liens — prévu en Phase 5.',
  },
  {
    id: 'settings',
    label: 'Paramètres',
    icon: '⚙️',
    description: 'Vault, mises à jour — disponible sur la version desktop.',
  },
];
