// ✒️ 123ECRITURE — lib/notify/notify.ts — l'API centrale des bulles
//////////////////////////////////////////////////////////////////////////////
//
// `notify({ type, message, duration })` depuis n'importe où (écrans,
// contextes, moteur) ; `useToasts()` pour l'affichage (ToastHost.tsx).
// Une seule instance pour toute l'app (logique : notifyCore.ts).
//
//////////////////////////////////////////////////////////////////////////////

import { useSyncExternalStore } from 'react';

import { createNotifyStore, type NotifyInput, type Toast } from './notifyCore';

export type { NotifyInput, NotifyType, Toast } from './notifyCore';

const store = createNotifyStore({
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

export function notify(input: NotifyInput): string | null {
  return store.notify(input);
}

export function dismissToast(id: string): void {
  store.dismiss(id);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(store.subscribe, store.getToasts, store.getToasts);
}
