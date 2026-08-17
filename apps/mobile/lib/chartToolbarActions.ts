// Registre des actions de la barre d'outils Graphiques — voir le
// commentaire en tête de canvasToolbarActions.ts (même principe, pas de
// `run` : `addColumn`/`addRow`/`createChart` restent des closures locales à
// ChartEditor.tsx).
export type ChartToolbarActionId = 'add-column' | 'add-row' | 'create-chart';

export type ChartToolbarAction = {
  id: ChartToolbarActionId;
  label: string;
};

// Les boutons du `headerRow` actuel (+ Colonne / + Ligne) plus "Créer un
// graphique". Les raccourcis déjà présents en ligne (fin d'en-tête de
// grille, sous la grille) restent inchangés en secours — masquer l'entrée
// de la barre d'outils n'enlève pas la seule façon de faire l'action. Le
// type de graphique, la colonne d'étiquette/valeurs et "Supprimer le
// graphique" restent des contrôles contextuels (n'ont de sens qu'une fois un
// graphique créé), pas des entrées de barre d'outils.
export const CHART_TOOLBAR_ACTIONS: ChartToolbarAction[] = [
  { id: 'add-column', label: '+ Colonne' },
  { id: 'add-row', label: '+ Ligne' },
  { id: 'create-chart', label: 'Créer un graphique' },
];

export const CHART_TOOLBAR_DESCRIPTIONS: Record<ChartToolbarActionId, string> = {
  'add-column': 'Ajouter une colonne',
  'add-row': 'Ajouter une ligne',
  'create-chart': 'Créer un graphique (masqué automatiquement si un graphique existe déjà)',
};

export const DEFAULT_CHART_TOOLBAR_ORDER: { id: ChartToolbarActionId; visible: boolean }[] =
  CHART_TOOLBAR_ACTIONS.map((action) => ({ id: action.id, visible: true }));
