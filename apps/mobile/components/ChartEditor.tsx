import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getSeriesColor } from '../lib/chartPalette';
import { CHART_TOOLBAR_ACTIONS, type ChartToolbarActionId } from '../lib/chartToolbarActions';
import { buildChartSeries } from '../lib/sheets';
import { usePreferences } from '../preferences/PreferencesContext';
import { ChartView } from './ChartView';
import { EditorToolbar } from './EditorToolbar';

// Éditeur Graphiques — tableur intégré (lignes/colonnes, saisie manuelle,
// pas de formules) d'où on génère un graphique barres/lignes/camembert.
// Scopé à UN fichier `.chart` du vault (`relPath`), ouvert/fermé/renommé/
// déplacé comme n'importe quel fichier de l'arborescence (voir
// NotesScreen.tsx) — plus de registre multi-feuilles séparé (voir la
// révision documentée dans le plan/la mémoire du projet; anciennement
// ChartsScreen.tsx). Desktop uniquement pour l'instant (window.vault, comme
// Notes/Tâches).
const AUTOSAVE_DELAY_MS = 600;
const CELL_WIDTH = 130;

function makeColumnId() {
  return Math.random().toString(36).slice(2);
}

type Props = {
  relPath: string;
};

const EMPTY_DATA: SheetData = { columns: [], rows: [], chart: null };

export function ChartEditor({ relPath }: Props) {
  const { theme, colorScheme, preferences } = usePreferences();
  const vault = typeof window !== 'undefined' ? window.vault : undefined;

  const [data, setData] = useState<SheetData>(EMPTY_DATA);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshData = useCallback(async () => {
    if (!vault) return;
    try {
      const content = await vault.readNote(relPath);
      setData(content.trim() ? JSON.parse(content) : EMPTY_DATA);
    } catch (error) {
      console.error('[chart] échec du chargement :', error);
      setData(EMPTY_DATA);
    }
  }, [vault, relPath]);

  useEffect(() => {
    void (async () => {
      await refreshData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath]);

  // Sauvegarde débouncée — même délai que l'autosave des notes
  // (NotesScreen.tsx) — déclenchée à chaque modification locale des
  // données (cellule, colonne, ligne, config du graphique).
  const scheduleSave = useCallback(
    (next: SheetData) => {
      if (!vault) return;
      setSaveStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void vault
          .writeNote(relPath, JSON.stringify(next, null, 2))
          .then(() => setSaveStatus('saved'))
          .catch((error) => {
            console.error('[chart] échec de la sauvegarde :', error);
          });
      }, AUTOSAVE_DELAY_MS);
    },
    [vault, relPath],
  );

  const updateData = useCallback(
    (updater: (prev: SheetData) => SheetData) => {
      setData((prev) => {
        const next = updater(prev);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  // --- Édition du tableau ---

  const renameColumn = (columnId: string, name: string) => {
    updateData((prev) => ({
      ...prev,
      columns: prev.columns.map((c) => (c.id === columnId ? { ...c, name } : c)),
    }));
  };

  const addColumn = () => {
    updateData((prev) => ({
      ...prev,
      columns: [...prev.columns, { id: makeColumnId(), name: `Colonne ${prev.columns.length + 1}` }],
    }));
  };

  const removeColumn = (columnId: string) => {
    updateData((prev) => ({
      ...prev,
      columns: prev.columns.filter((c) => c.id !== columnId),
      rows: prev.rows.map((row) => {
        const { [columnId]: _removed, ...rest } = row.cells;
        return { ...row, cells: rest };
      }),
      chart: prev.chart
        ? {
            ...prev.chart,
            labelColumnId: prev.chart.labelColumnId === columnId ? null : prev.chart.labelColumnId,
            valueColumnIds: prev.chart.valueColumnIds.filter((id) => id !== columnId),
          }
        : null,
    }));
  };

  const addRow = () => {
    updateData((prev) => ({ ...prev, rows: [...prev.rows, { id: makeColumnId(), cells: {} }] }));
  };

  const removeRow = (rowId: string) => {
    updateData((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== rowId) }));
  };

  const setCell = (rowId: string, columnId: string, value: string) => {
    updateData((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row)),
    }));
  };

  // --- Config du graphique ---

  const createChart = () => {
    updateData((prev) => ({
      ...prev,
      chart: { type: 'bar', labelColumnId: prev.columns[0]?.id ?? null, valueColumnIds: [] },
    }));
  };

  const removeChart = () => updateData((prev) => ({ ...prev, chart: null }));

  // Paramètres → Éditeur → "Barre d'outils Graphiques" : mêmes ordre/
  // visibilité que Notes/Canvas. `create-chart` est en plus toujours exclu
  // dès qu'un graphique existe déjà (comme l'ancien bouton conditionnel
  // "Créer un graphique" — l'appeler à nouveau écraserait silencieusement
  // la config existante, voir createChart ci-dessus).
  const chartActionHandlers: Record<ChartToolbarActionId, () => void> = {
    'add-column': addColumn,
    'add-row': addRow,
    'create-chart': createChart,
  };
  const toolbarActions = preferences.chartToolbarOrder
    .filter((item) => item.visible && (item.id !== 'create-chart' || !data.chart))
    .map((item) => CHART_TOOLBAR_ACTIONS.find((action) => action.id === item.id))
    .filter((action): action is (typeof CHART_TOOLBAR_ACTIONS)[number] => Boolean(action));

  const setChartType = (type: SheetChartType) => {
    updateData((prev) =>
      prev.chart
        ? {
            ...prev,
            // Camembert : une seule colonne de valeurs a du sens — on
            // tronque plutôt que de laisser une config ambiguë.
            chart: { ...prev.chart, type, valueColumnIds: type === 'pie' ? prev.chart.valueColumnIds.slice(0, 1) : prev.chart.valueColumnIds },
          }
        : prev,
    );
  };

  const setLabelColumn = (columnId: string) => {
    updateData((prev) => (prev.chart ? { ...prev, chart: { ...prev.chart, labelColumnId: columnId } } : prev));
  };

  const toggleValueColumn = (columnId: string) => {
    updateData((prev) => {
      if (!prev.chart) return prev;
      const isPie = prev.chart.type === 'pie';
      const already = prev.chart.valueColumnIds.includes(columnId);
      const valueColumnIds = isPie
        ? already
          ? []
          : [columnId]
        : already
          ? prev.chart.valueColumnIds.filter((id) => id !== columnId)
          : [...prev.chart.valueColumnIds, columnId];
      return { ...prev, chart: { ...prev.chart, valueColumnIds } };
    });
  };

  if (!vault) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📊 Graphique</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant, avec un coffre choisi.
        </Text>
      </View>
    );
  }

  const chartSeries = buildChartSeries(data);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <EditorToolbar
        items={toolbarActions.map((action) => ({
          id: action.id,
          label: action.label,
          onPress: chartActionHandlers[action.id],
        }))}
        theme={theme}
      />
      {saveStatus !== 'idle' && (
        <Text style={[styles.saveStatus, { color: theme.textMuted }]}>
          {saveStatus === 'saving' ? 'Enregistrement…' : 'Enregistré'}
        </Text>
      )}

      <ScrollView horizontal>
        <View>
          <View style={styles.gridRow}>
            {data.columns.map((column) => (
              <View key={column.id} style={[styles.cellWrap, { borderColor: theme.border }]}>
                <TextInput
                  value={column.name}
                  onChangeText={(text) => renameColumn(column.id, text)}
                  style={[styles.headerCell, { color: theme.text, backgroundColor: theme.surface }]}
                />
                <Pressable onPress={() => removeColumn(column.id)} style={styles.cellRemoveButton}>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addColumn} style={[styles.addCellButton, { borderColor: theme.border }]}>
              <Text style={{ color: theme.accent }}>+ Colonne</Text>
            </Pressable>
          </View>

          {data.rows.map((row) => (
            <View key={row.id} style={styles.gridRow}>
              {data.columns.map((column) => (
                <TextInput
                  key={column.id}
                  value={row.cells[column.id] ?? ''}
                  onChangeText={(text) => setCell(row.id, column.id, text)}
                  style={[styles.cell, { color: theme.text, borderColor: theme.border }]}
                />
              ))}
              <Pressable onPress={() => removeRow(row.id)} style={styles.rowRemoveButton}>
                <Text style={{ color: theme.textMuted }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
      <Pressable onPress={addRow} style={[styles.addRowButton, { borderColor: theme.border }]}>
        <Text style={{ color: theme.accent }}>+ Ligne</Text>
      </Pressable>

      <View style={[styles.chartSection, { borderColor: theme.border }]}>
        {!data.chart ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Graphique</Text>
            <Pressable onPress={createChart} style={[styles.button, { backgroundColor: theme.accent }]}>
              <Text style={styles.buttonText}>Créer un graphique</Text>
            </Pressable>
          </>
        ) : (
          // Une seule carte, clairement délimitée (fond + bordure), plutôt
          // qu'un empilement de rangées de pastilles à même le fond de
          // l'écran — chaque sous-section (type/étiquettes/valeurs) garde sa
          // propre étiquette de champ, avec un espacement généreux entre
          // elles pour rester lisible.
          <View style={[styles.chartCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={styles.chartCardHeader}>
              <Text style={[styles.chartCardTitle, { color: theme.text }]}>Graphique</Text>
              <Pressable onPress={removeChart} style={styles.headerAction}>
                <Text style={{ color: theme.textMuted }}>🗑️</Text>
              </Pressable>
            </View>

            <Text style={[styles.formLabel, { color: theme.textMuted }]}>Type de graphique</Text>
            <View style={styles.chipsRow}>
              {(['bar', 'line', 'pie'] as SheetChartType[]).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setChartType(type)}
                  style={[
                    styles.chip,
                    { borderColor: theme.border },
                    data.chart?.type === type && { backgroundColor: theme.accent, borderColor: theme.accent },
                  ]}
                >
                  <Text style={{ color: data.chart?.type === type ? '#fff' : theme.text }}>
                    {type === 'bar' ? 'Barres' : type === 'line' ? 'Lignes' : 'Camembert'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.formLabel, { color: theme.textMuted }]}>Étiquettes</Text>
            <View style={styles.chipsRow}>
              {data.columns.map((column) => (
                <Pressable
                  key={column.id}
                  onPress={() => setLabelColumn(column.id)}
                  style={[
                    styles.chip,
                    { borderColor: theme.border },
                    data.chart?.labelColumnId === column.id && {
                      backgroundColor: theme.accent,
                      borderColor: theme.accent,
                    },
                  ]}
                >
                  <Text style={{ color: data.chart?.labelColumnId === column.id ? '#fff' : theme.text }}>
                    {column.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.formLabel, { color: theme.textMuted }]}>
              Valeurs {data.chart.type === 'pie' ? '(une seule colonne)' : ''}
            </Text>
            <View style={styles.chipsRow}>
              {data.columns.map((column, i) => {
                const selected = data.chart?.valueColumnIds.includes(column.id) ?? false;
                return (
                  <Pressable
                    key={column.id}
                    onPress={() => toggleValueColumn(column.id)}
                    style={[
                      styles.chip,
                      { borderColor: selected ? getSeriesColor(i, colorScheme) : theme.border },
                      selected && { backgroundColor: `${getSeriesColor(i, colorScheme)}33` },
                    ]}
                  >
                    <Text style={{ color: theme.text }}>{column.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            {chartSeries.length > 0 ? (
              <ChartView type={data.chart.type} series={chartSeries} theme={theme} colorScheme={colorScheme} />
            ) : (
              <Text style={[styles.muted, { color: theme.textMuted }]}>
                Choisis une colonne d’étiquettes et au moins une colonne de valeurs.
              </Text>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    padding: 20,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  headerAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  saveStatus: {
    fontSize: 11,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  gridRow: {
    flexDirection: 'row',
  },
  cellWrap: {
    width: CELL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  headerCell: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  cellRemoveButton: {
    paddingHorizontal: 4,
  },
  cell: {
    width: CELL_WIDTH,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  addCellButton: {
    width: 100,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowRemoveButton: {
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  addRowButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chartSection: {
    borderTopWidth: 1,
    paddingTop: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  chartCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  chartCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartCardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
