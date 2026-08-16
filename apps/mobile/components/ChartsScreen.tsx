import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getSeriesColor } from '../lib/chartPalette';
import { buildChartSeries } from '../lib/sheets';
import { useVaults } from '../lib/sync/VaultsContext';
import { usePreferences } from '../preferences/PreferencesContext';
import { ChartView } from './ChartView';

// Écran Graphiques — tableur intégré (lignes/colonnes, saisie manuelle, pas
// de formules) d'où on génère un graphique barres/lignes/camembert. Choix
// assumé avec l'utilisatrice : le plus gros des 3 options proposées
// (tableur "façon Excel" plutôt que stats auto ou propriétés de notes).
// Plusieurs feuilles nommées par coffre, même schéma que les listes de
// tâches (apps/desktop/electron/sheets.js). Desktop uniquement pour
// l'instant (window.sheet*, comme Notes/Tâches).
const AUTOSAVE_DELAY_MS = 600;
const CELL_WIDTH = 130;

function makeColumnId() {
  return Math.random().toString(36).slice(2);
}

export function ChartsScreen() {
  const { theme, colorScheme } = usePreferences();
  const sheetListsBridge = typeof window !== 'undefined' ? window.sheetLists : undefined;
  const sheetBridge = typeof window !== 'undefined' ? window.sheet : undefined;
  const contextMenuBridge = typeof window !== 'undefined' ? window.contextMenu : undefined;
  const { activeVaultPath: vaultPath } = useVaults();

  const [sheetLists, setSheetLists] = useState<SheetListEntry[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [data, setData] = useState<SheetData>({ columns: [], rows: [], chart: null });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [listActionError, setListActionError] = useState<string | null>(null);
  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSheetLists = useCallback(async () => {
    if (!sheetListsBridge) return;
    const [lists, active] = await Promise.all([sheetListsBridge.list(), sheetListsBridge.getActive()]);
    setSheetLists(lists);
    setActiveSheetId(active);
  }, [sheetListsBridge]);

  const refreshData = useCallback(async () => {
    if (!sheetBridge) return;
    setData(await sheetBridge.getActiveData());
  }, [sheetBridge]);

  useEffect(() => {
    if (!vaultPath || !sheetListsBridge) return;
    void (async () => {
      try {
        await refreshSheetLists();
      } catch (error) {
        console.error('[sheets] échec du chargement initial :', error);
      }
    })();
    const unsubscribe = sheetListsBridge.onChanged((lists) => {
      setSheetLists(lists);
      void sheetListsBridge.getActive().then(setActiveSheetId);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, sheetListsBridge]);

  useEffect(() => {
    if (!vaultPath || !activeSheetId) return;
    void (async () => {
      try {
        await refreshData();
      } catch (error) {
        console.error('[sheets] échec du chargement de la feuille :', error);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, activeSheetId]);

  // Sauvegarde débouncée — même délai que l'autosave des notes
  // (NotesScreen.tsx) — déclenchée à chaque modification locale des
  // données (cellule, colonne, ligne, config du graphique).
  const scheduleSave = useCallback(
    (next: SheetData) => {
      if (!sheetBridge) return;
      setSaveStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void sheetBridge
          .saveActiveData(next)
          .then(() => setSaveStatus('saved'))
          .catch((error) => {
            console.error('[sheets] échec de la sauvegarde :', error);
          });
      }, AUTOSAVE_DELAY_MS);
    },
    [sheetBridge],
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

  const runListAction = useCallback(async (action: () => Promise<void>) => {
    setListActionError(null);
    try {
      await action();
    } catch (error) {
      console.error('[sheets] échec :', error);
      setListActionError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const showSheetSwitcher = useCallback(() => {
    if (!contextMenuBridge) return;
    const items = [
      ...sheetLists.map((s) => ({ id: s.id, label: s.id === activeSheetId ? `✅ ${s.name}` : s.name })),
      { id: '__new__', label: '➕ Nouvelle feuille' },
    ];
    void contextMenuBridge.show(items).then((choice) => {
      if (!choice) return;
      if (choice === '__new__') {
        setShowCreateForm(true);
        return;
      }
      void runListAction(async () => {
        if (!sheetListsBridge) return;
        setSheetLists(await sheetListsBridge.switch(choice));
        setActiveSheetId(choice);
      });
    });
  }, [contextMenuBridge, sheetLists, activeSheetId, sheetListsBridge, runListAction]);

  const submitCreateSheet = useCallback(async () => {
    const name = createDraft.trim();
    if (!name || !sheetListsBridge) return;
    setShowCreateForm(false);
    setCreateDraft('');
    await runListAction(async () => {
      setSheetLists(await sheetListsBridge.create(name));
      setActiveSheetId(await sheetListsBridge.getActive());
    });
  }, [createDraft, sheetListsBridge, runListAction]);

  const startRenameSheet = (sheet: SheetListEntry) => {
    setRenamingSheetId(sheet.id);
    setRenameDraft(sheet.name);
  };

  const submitRenameSheet = useCallback(async () => {
    if (!renamingSheetId || !sheetListsBridge) return;
    const id = renamingSheetId;
    const name = renameDraft;
    setRenamingSheetId(null);
    await runListAction(async () => {
      setSheetLists(await sheetListsBridge.rename(id, name));
    });
  }, [renamingSheetId, renameDraft, sheetListsBridge, runListAction]);

  const handleRemoveSheet = useCallback(async () => {
    if (!activeSheetId || !sheetListsBridge) return;
    await runListAction(async () => {
      setSheetLists(await sheetListsBridge.remove(activeSheetId));
      setActiveSheetId(await sheetListsBridge.getActive());
    });
  }, [activeSheetId, sheetListsBridge, runListAction]);

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

  if (!vaultPath || !sheetListsBridge || !sheetBridge) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.title, { color: theme.text }]}>📊 Graphiques</Text>
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Disponible sur la version desktop pour l’instant, avec un coffre choisi.
        </Text>
      </View>
    );
  }

  const activeSheet = sheetLists.find((s) => s.id === activeSheetId) ?? null;
  const isRenaming = renamingSheetId === activeSheetId;
  const chartSeries = buildChartSeries(data);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        {isRenaming ? (
          <TextInput
            autoFocus
            value={renameDraft}
            onChangeText={setRenameDraft}
            onSubmitEditing={() => void submitRenameSheet()}
            onBlur={() => void submitRenameSheet()}
            style={[styles.sheetNameInput, { color: theme.text, borderColor: theme.accent }]}
          />
        ) : (
          <Pressable onPress={showSheetSwitcher} style={styles.sheetSwitcher}>
            <Text style={[styles.sheetName, { color: theme.text }]} numberOfLines={1}>
              📊 {activeSheet ? activeSheet.name : 'Aucune feuille'} {sheetLists.length > 0 ? '▾' : ''}
            </Text>
          </Pressable>
        )}
        {activeSheet && !isRenaming && (
          <>
            <Pressable onPress={() => startRenameSheet(activeSheet)} style={styles.headerAction}>
              <Text style={{ color: theme.textMuted }}>✏️</Text>
            </Pressable>
            <Pressable onPress={() => void handleRemoveSheet()} style={styles.headerAction}>
              <Text style={{ color: theme.textMuted }}>🗑️</Text>
            </Pressable>
          </>
        )}
        {!activeSheet && (
          <Pressable
            onPress={() => setShowCreateForm((prev) => !prev)}
            style={[styles.button, styles.smallButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>Nouvelle feuille</Text>
          </Pressable>
        )}
        <Text style={[styles.saveStatus, { color: theme.textMuted }]}>
          {saveStatus === 'saving' ? 'Enregistrement…' : saveStatus === 'saved' ? 'Enregistré' : ''}
        </Text>
      </View>

      {showCreateForm && (
        <View style={styles.addRow}>
          <TextInput
            autoFocus
            value={createDraft}
            onChangeText={setCreateDraft}
            onSubmitEditing={() => void submitCreateSheet()}
            placeholder="Nom de la feuille…"
            placeholderTextColor={theme.textMuted}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
          <Pressable onPress={() => void submitCreateSheet()} style={[styles.button, { backgroundColor: theme.accent }]}>
            <Text style={styles.buttonText}>Créer</Text>
          </Pressable>
        </View>
      )}
      {listActionError && <Text style={styles.error}>⚠️ {listActionError}</Text>}

      {!activeSheet ? (
        <Text style={[styles.muted, { color: theme.textMuted }]}>
          Aucune feuille pour l’instant — crées-en une pour commencer.
        </Text>
      ) : (
        <>
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
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Graphique</Text>
            {!data.chart ? (
              <Pressable onPress={createChart} style={[styles.button, { backgroundColor: theme.accent }]}>
                <Text style={styles.buttonText}>Créer un graphique</Text>
              </Pressable>
            ) : (
              <>
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
                  <Pressable onPress={removeChart} style={styles.headerAction}>
                    <Text style={{ color: theme.textMuted }}>🗑️</Text>
                  </Pressable>
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
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  smallButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sheetSwitcher: {
    flex: 1,
    paddingVertical: 4,
  },
  sheetName: {
    fontSize: 18,
    fontWeight: '600',
  },
  sheetNameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    borderBottomWidth: 1,
    paddingVertical: 2,
  },
  headerAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  saveStatus: {
    fontSize: 11,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
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
    gap: 8,
  },
  sectionTitle: {
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
