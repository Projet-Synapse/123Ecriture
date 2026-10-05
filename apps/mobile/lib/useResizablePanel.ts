import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

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
    // Écouteurs souris = WEB UNIQUEMENT — `document` n'existe pas sous
    // Hermes : dès que le drag tactile a pu démarrer en natif (poignée
    // touch, 2026-10-03), cet effet plantait (« Property 'document'
    // doesn't exist ») — même famille que window.addEventListener
    // (v0.4.41). Le drag natif ne passe PAS ici : il vit dans les
    // callbacks touch appelés directement par les responders.
    if (Platform.OS !== 'web') return;

    // Un unique calcul de largeur pour souris ET doigt : mêmes bornes
    // (voir le commentaire de clamp dans handleMouseMove/touchMove).
    const applyDragX = (currentX: number) => {
      const drag = dragState.current;
      if (!drag) return;
      setLiveWidth(computeDragWidth(drag.startWidth, drag.startX, currentX, options.edge, 0, options.max));
    };

    // Au relâchement (souris ou doigt) : repli si sous le seuil (avec
    // onCollapseIntent pour le panneau droit), sinon largeur clampée
    // persistée — la persistance passe par setSidebarPanelLayout, donc
    // par les préférences (désormais écrites sur disque aussi en natif,
    // voir nativePreferencesAdapter.ts).
    const finishDrag = () => {
      setLiveWidth((current) => {
        if (current === null) return null;
        const collapsed = shouldCollapseOnRelease(current, options.min);
        if (collapsed && options.onCollapseIntent) {
          options.onCollapseIntent();
        } else {
          const width = collapsed ? stored.width : clampWidth(current, options.min, options.max);
          void setSidebarPanelLayout(id, { width, collapsed });
        }
        return null;
      });
      dragState.current = null;
    };

    const handleMouseMove = (event: MouseEvent) => applyDragX(event.clientX);
    const handleMouseUp = () => finishDrag();

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

  // Geste TACTILE (natif) — même mécanique que la souris, en trois appels
  // explicites depuis les responders de ResizeHandle.tsx : x absolu
  // (nativeEvent.pageX, l'équivalent de clientX). Sans document ni
  // window (inexistants/inutiles en natif) : le toucher reste capté par
  // la poignée elle-même pendant tout le geste (système de responders RN).
  // Fonctions volontairement NON mémoïsées : recréées à chaque rendu, elles
  // voient toujours `options`/`stored` frais — elles passent en props à
  // ResizeHandle qui ne s'en sert qu'au moment du geste.
  // Largeur effective à appliquer au style — 0 si replié (le panneau
  // reste monté mais invisible plutôt que démonté, pour ne pas perdre son
  // état interne le temps du repli, sauf le panneau droit qui, lui, se
  // démonte réellement via `sidebarOpen` dans NotesScreen.tsx). Pendant le
  // glisser, PAS clampée à `min` (même raison que dans handleMouseMove
  // ci-dessus : il faut voir le panneau se rétrécir sous `min` pour
  // percevoir le repli qui approche) — seulement à `max`.
  const width = liveWidth !== null ? clampWidth(liveWidth, 0, options.max) : stored.collapsed ? 0 : stored.width;

  const onHandleTouchStart = (x: number) => {
    // Départ = la largeur EFFECTIVE affichée (celle calculée ci-dessus,
    // plafond d'écran compris) — PAS `stored.width` : sur téléphone la
    // largeur stockée peut dépasser le plafond d'affichage (403 stockés
    // pour 230 affichés, vécu A13) — partir des stockés mangeait le
    // parcours du glisser dans le plafond : les premiers drags ne
    // changeait RIEN à l'écran.
    dragState.current = { startX: x, startWidth: width };
    setLiveWidth(width);
  };

  const onHandleTouchMove = (x: number) => {
    const drag = dragState.current;
    if (!drag) return;
    // Borné à [0, max] pendant le glisser (PAS [min, max]) — même raison
    // que pour la souris : le repli doit être visible approcher.
    setLiveWidth(computeDragWidth(drag.startWidth, drag.startX, x, options.edge, 0, options.max));
  };

  const onHandleTouchEnd = () => {
    setLiveWidth((current) => {
      if (current === null) return null;
      const collapsed = shouldCollapseOnRelease(current, options.min);
      if (collapsed && options.onCollapseIntent) {
        options.onCollapseIntent();
      } else {
        const finalWidth = collapsed ? stored.width : clampWidth(current, options.min, options.max);
        void setSidebarPanelLayout(id, { width: finalWidth, collapsed });
      }
      return null;
    });
    dragState.current = null;
  };

  const toggleCollapsed = useCallback(() => {
    void setSidebarPanelLayout(id, { width: stored.width, collapsed: !stored.collapsed });
  }, [id, setSidebarPanelLayout, stored.width, stored.collapsed]);

  return {
    // Largeur effective (calculée plus haut) — la même que celle dont part
    // le drag tactile.
    width,
    collapsed: stored.collapsed,
    isDragging: liveWidth !== null,
    onHandleMouseDown,
    onHandleTouchStart,
    onHandleTouchMove,
    onHandleTouchEnd,
    toggleCollapsed,
  };
}
