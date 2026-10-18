// ✒️ 123ECRITURE — lib/editor/chartToolbarActions.ts — registre des actions de la barre d'outils Graphiques
//////////////////////////////////////////////////////////////////////////////
//
// Registre des actions de la barre d'outils Graphiques — même principe
// que canvasToolbarActions.ts (pas de `run` : `addColumn`/`addRow`/
// `createChart` restent des closures locales à ChartEditor.tsx, qui fait
// la correspondance id → handler).
//
// Invariants du fichier :
//   • La barre ne liste que les actions globales du `headerRow` (+ Colonne
//     / + Ligne / Créer un graphique) ; le type de graphique, la colonne
//     d'étiquettes/valeurs et "Supprimer le graphique" restent des
//     contrôles contextuels (ils n'ont de sens qu'une fois un graphique
//     créé), pas des entrées de barre d'outils.
//   • Masquer une entrée de la barre d'outils n'enlève pas l'action : les
//     raccourcis déjà présents en ligne (fin et sous la grille) restent
//     en secours.
//
//////////////////////////////////////////////////////////////////////////////

export type ChartToolbarActionId = 'add-column' | 'add-row' | 'create-chart';

export type ChartToolbarAction = {
  id: ChartToolbarActionId;
  label: string;
};

// Les boutons du `headerRow` actuel (+ Colonne / + Ligne) plus "Créer un
// graphique".
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
