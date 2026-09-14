// Liste des sections de l'app — chacune est rendue par son écran réel dans
// App.tsx (Notes/Tâches/Calendrier/Paramètres). Ancien champ `description`
// supprimé : il n'était lu que par PlaceholderScreen, écran d'attente devenu
// mort depuis que les 4 sections affichent toutes un vrai contenu.

export type Section = {
  id: string;
  label: string;
  icon: string;
};

// Canvas et Graphiques ne sont PAS des sections ici : ce sont des types de
// fichiers du vault (`.canvas`/`.chart`), ouverts depuis l'arborescence de
// "Notes" comme n'importe quel fichier (voir CanvasEditor.tsx/
// ChartEditor.tsx, NotesScreen.tsx) — révision du choix initial, documentée
// dans le plan/la mémoire du projet.
export const SECTIONS: Section[] = [
  { id: 'notes', label: 'Notes', icon: '📝' },
  { id: 'tasks', label: 'Tâches', icon: '✅' },
  { id: 'calendar', label: 'Calendrier', icon: '📅' },
  { id: 'settings', label: 'Paramètres', icon: '⚙️' },
];
