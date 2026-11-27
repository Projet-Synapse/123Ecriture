// ✒️ 123ECRITURE — lib/notify/notifyCore.ts — la file des bulles de notification
//////////////////////////////////////////////////////////////////////////////
//
// Bulles (toasts) qui apparaissent puis disparaissent seules, empilées —
// desktop, web et Android. Ce module est la LOGIQUE PURE (horloge et
// minuteries injectées, tests : notifyCore.test.ts) ; notify.ts en tient
// l'instance unique de l'app, components/ToastHost.tsx les affiche.
//
// Invariants du fichier :
//   • Anti-spam : une notification de même clé (par défaut type + message)
//     déjà affichée n'en crée pas une seconde — la bulle existante est
//     rafraîchie (compteur « ×N » si le message est identique, message
//     remplacé sinon) et son délai repart de zéro.
//   • `throttleMs` : une même clé n'est pas réaffichée avant ce délai
//     après sa DERNIÈRE apparition (bulles de sauvegarde, discrètes).
//   • Durées par type ; les erreurs restent plus longtemps. Toute bulle se
//     ferme au clic ; `duration: 0` = jusqu'au clic.
//   • Au plus MAX_TOASTS bulles : la plus ancienne (hors erreurs si
//     possible) laisse sa place.
//   • Disparition en deux temps : `leaving` (fondu, LEAVE_MS) puis retrait.
//
//////////////////////////////////////////////////////////////////////////////

export type NotifyType = 'success' | 'info' | 'warning' | 'error';

export type ToastAction = {
  kind: 'ellie-suggestion';
  body: string;
};

export type NotifyInput = {
  type?: NotifyType;
  message: string;
  // ms avant disparition ; 0 = jusqu'au clic. Défaut : DEFAULT_DURATIONS.
  duration?: number;
  // Regroupement : même clé = même bulle (défaut : type + message).
  key?: string;
  // Pas de réaffichage de la même clé avant ce délai (ms).
  throttleMs?: number;
  // Clic sur la bulle : ouvrir un détail (ex. suggestion Ellie). Le ✕ ferme sans agir.
  action?: ToastAction;
};

export type Toast = {
  id: string;
  key: string;
  type: NotifyType;
  message: string;
  count: number;
  leaving: boolean;
  action?: ToastAction;
};

export const DEFAULT_DURATIONS: Record<NotifyType, number> = {
  success: 2500,
  info: 4500,
  warning: 7000,
  error: 12000,
};
export const MAX_TOASTS = 4;
export const LEAVE_MS = 220;

export type NotifyClock = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type NotifyStore = {
  notify: (input: NotifyInput) => string | null;
  dismiss: (id: string) => void;
  clear: () => void;
  getToasts: () => Toast[];
  subscribe: (listener: () => void) => () => void;
};

export function createNotifyStore(clock: NotifyClock): NotifyStore {
  let toasts: Toast[] = [];
  let seq = 0;
  const timers = new Map<string, unknown>();
  const lastShownAt = new Map<string, number>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };

  const stopTimer = (id: string) => {
    const handle = timers.get(id);
    if (handle !== undefined) clock.clearTimer(handle);
    timers.delete(id);
  };

  const remove = (id: string) => {
    stopTimer(id);
    const before = toasts.length;
    toasts = toasts.filter((t) => t.id !== id);
    if (toasts.length !== before) emit();
  };

  const dismiss = (id: string) => {
    const toast = toasts.find((t) => t.id === id);
    if (!toast || toast.leaving) return;
    stopTimer(id);
    toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    emit();
    timers.set(id, clock.setTimer(() => remove(id), LEAVE_MS));
  };

  const arm = (id: string, duration: number) => {
    stopTimer(id);
    if (duration > 0) timers.set(id, clock.setTimer(() => dismiss(id), duration));
  };

  const notify = (input: NotifyInput): string | null => {
    const message = input.message.trim();
    if (!message) return null;
    const type = input.type ?? 'info';
    const key = input.key ?? `${type}:${message}`;
    const duration = input.duration ?? DEFAULT_DURATIONS[type];
    const now = clock.now();
    const existing = toasts.find((t) => t.key === key && !t.leaving);
    if (existing) {
      toasts = toasts.map((t) =>
        t.id === existing.id
          ? { ...t, type, message, count: t.message === message ? t.count + 1 : 1, action: input.action ?? t.action }
          : t,
      );
      lastShownAt.set(key, now);
      arm(existing.id, duration);
      emit();
      return existing.id;
    }
    const last = lastShownAt.get(key);
    if (input.throttleMs && last !== undefined && now - last < input.throttleMs) return null;
    lastShownAt.set(key, now);
    const id = `t${++seq}`;
    toasts = [...toasts, { id, key, type, message, count: 1, leaving: false, action: input.action }];
    const visible = toasts.filter((t) => !t.leaving);
    if (visible.length > MAX_TOASTS) {
      const victim = visible.find((t) => t.type !== 'error') ?? visible[0];
      stopTimer(victim.id);
      toasts = toasts.filter((t) => t.id !== victim.id);
    }
    arm(id, duration);
    emit();
    return id;
  };

  return {
    notify,
    dismiss,
    clear: () => {
      for (const id of [...timers.keys()]) stopTimer(id);
      toasts = [];
      emit();
    },
    getToasts: () => toasts,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Textes partagés (testés) : pluriels français.
export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

// `properties` : propriétés (frontmatter) dont un lien ou un chemin a changé.
export function linksUpdatedMessage(links: number, files: number, properties = 0): string {
  const base = `${plural(links, 'lien mis à jour', 'liens mis à jour')} dans ${plural(files, 'fichier', 'fichiers')}`;
  return properties > 0 ? `${base}, dont ${plural(properties, 'propriété', 'propriétés')}` : base;
}

export function receivedFilesMessage(count: number): string {
  return count > 1 ? `${count} nouveaux fichiers synchronisés` : '1 nouveau fichier synchronisé';
}
