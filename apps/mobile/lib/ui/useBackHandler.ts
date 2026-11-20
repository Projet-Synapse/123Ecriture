// ✒️ 123ECRITURE — lib/ui/useBackHandler.ts — inscription au bouton retour Android
//////////////////////////////////////////////////////////////////////////////
// Une seule écoute BackHandler pour toute l'app, qui distribue selon
// lib/ui/backStack.ts. Sans effet hors Android. Le gestionnaire est lu
// via une ref (mise à jour en effet) : pas de réinscription à chaque rendu.
//////////////////////////////////////////////////////////////////////////////
import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';

import { createBackStack, type BackHandlerFn } from './backStack';

const stack = createBackStack();
let listening = false;

function ensureListening(): void {
  if (listening || Platform.OS !== 'android') return;
  listening = true;
  BackHandler.addEventListener('hardwareBackPress', () => stack.dispatch());
}

export function useBackHandler(priority: number, handler: BackHandlerFn, enabled = true): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') return;
    ensureListening();
    return stack.register(priority, () => handlerRef.current());
  }, [priority, enabled]);
}
