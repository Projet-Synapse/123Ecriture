import { useCallback, useEffect, useRef, useState } from 'react';

import { usePreferences } from '../preferences/PreferencesContext';
import { clampWidth, computeDragWidth, shouldCollapseOnRelease } from './resizablePanel';

// Redimensionnement + repli au curseur d'une barre latérale (nav générale,
// explorateur de fichiers, panneau droit — voir AppShell.tsx/
// NotesScreen.tsx/RightSidebar.tsx). Aucun précédent dans le repo pour un
// drag `mousedown`/`mousemove`/`mouseup` continu (tout le drag existant est
// du HTML5 natif `draggable`, pensé pour déplacer un élément — voir
// NotesScreen.tsx §glisser pour réordonner — pas pour un curseur de
// redimensionnement) : nouveau pattern, écrit une fois ici et réutilisé 3
// fois. Écoute sur `document` (pas juste la poignée) le temps du glisser :
// le curseur sort forcément de la poignée (large de quelques pixels)
// pendant qu'on tire.
export function useResizablePanel(
  id: SidebarPanelId,
  options: {
    min: number;
    max: number;
    edge: 1 | -1;
    // Panneau droit (voir NotesScreen.tsx) : sa visibilité est DÉJÀ pilotée
    // ailleurs par `sidebarOpen` (bouton dans l'en-tête de l'éditeur) — pas
    // question d'avoir deux notions de "fermé" qui divergent. Quand fourni,
    // franchir le seuil de repli au relâchement appelle CE callback au lieu
    // de persister `collapsed`/une largeur à 0 ; la largeur mémorisée reste
    // celle d'avant le glisser, réutilisable telle quelle à la réouverture.
    onCollapseIntent?: () => void;
  },
) {
  const { preferences, setSidebarPanelLayout } = usePreferences();
  const stored = preferences.sidebarLayout[id];
  // Largeur "live" pendant le glisser — séparée de `stored` pour ne
  // persister (IPC + écriture disque) qu'au relâchement, pas à chaque pixel
  // parcouru par `mousemove`.
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (liveWidth === null) return;

    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      // Borné à [0, max] pendant le glisser (PAS [min, max]) : le panneau
      // doit pouvoir visiblement se rétrécir sous `min`, jusqu'à 0, pour que
      // l'utilisatrice VOIE le repli approcher avant de relâcher — le
      // clamper à `min` pendant le drag masquerait le geste et empêcherait
      // quasi toujours `shouldCollapseOnRelease` de se déclencher (la
      // largeur affichée ne serait jamais redescendue sous `min`).
      setLiveWidth(computeDragWidth(drag.startWidth, drag.startX, event.clientX, options.edge, 0, options.max));
    };

    const handleMouseUp = () => {
      setLiveWidth((current) => {
        if (current === null) return null;
        const collapsed = shouldCollapseOnRelease(current, options.min);
        if (collapsed && options.onCollapseIntent) {
          options.onCollapseIntent();
        } else {
          const width = collapsed ? stored.width : clampWidth(current, options.min, options.max);
          setSidebarPanelLayout(id, { width, collapsed });
        }
        return null;
      });
      dragState.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveWidth === null]);

  const onHandleMouseDown = useCallback(
    (event: { clientX: number; preventDefault: () => void }) => {
      event.preventDefault();
      dragState.current = { startX: event.clientX, startWidth: stored.width };
      setLiveWidth(stored.width);
    },
    [stored.width],
  );

  const toggleCollapsed = useCallback(() => {
    setSidebarPanelLayout(id, { width: stored.width, collapsed: !stored.collapsed });
  }, [id, setSidebarPanelLayout, stored.width, stored.collapsed]);

  return {
    // Largeur effective à appliquer au style — 0 si replié (le panneau
    // reste monté mais invisible plutôt que démonté, pour ne pas perdre son
    // état interne le temps du repli, sauf le panneau droit qui, lui, se
    // démonte réellement via `sidebarOpen` dans NotesScreen.tsx). Pendant le
    // glisser, PAS clampée à `min` (même raison que dans handleMouseMove
    // ci-dessus : il faut voir le panneau se rétrécir sous `min` pour
    // percevoir le repli qui approche) — seulement à `max`.
    width: liveWidth !== null ? clampWidth(liveWidth, 0, options.max) : stored.collapsed ? 0 : stored.width,
    collapsed: stored.collapsed,
    isDragging: liveWidth !== null,
    onHandleMouseDown,
    toggleCollapsed,
  };
}
