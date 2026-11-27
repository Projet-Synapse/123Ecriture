// ✒️ 123ECRITURE — electron/ellieProxy.ts — proxy HTTP du chat Ellie (évite le CORS app://)
//////////////////////////////////////////////////////////////////////////////
//
// L'app packagée charge le renderer depuis `app://` : un fetch direct vers
// Ollama (127.0.0.1:11434) est souvent bloqué par CORS. Les appels passent
// donc par le process principal (pas de CORS). Le renderer envoie la
// requête ; les lignes du flux sont poussées par IPC (`ellie:line`).
//
//////////////////////////////////////////////////////////////////////////////

import { ipcMain, type IpcMainInvokeEvent } from 'electron';

type EllieRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

const inflight = new Map<string, AbortController>();

function assertLocalAiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL invalide.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL HTTP(S) requise.');
}

export function registerEllieHandlers(): void {
  ipcMain.handle('ellie:request', async (_event, input: EllieRequest) => {
    assertLocalAiUrl(input.url);
    const res = await fetch(input.url, { method: input.method, headers: input.headers, body: input.body });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  });

  ipcMain.handle('ellie:stream', async (event: IpcMainInvokeEvent, payload: EllieRequest & { id: string }) => {
    assertLocalAiUrl(payload.url);
    const ctrl = new AbortController();
    inflight.set(payload.id, ctrl);
    try {
      const res = await fetch(payload.url, {
        method: payload.method,
        headers: payload.headers,
        body: payload.body,
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body || typeof res.body.getReader !== 'function') {
        const text = await res.text();
        if (res.ok) {
          for (const line of text.split('\n')) {
            if (line.trim()) event.sender.send('ellie:line', { id: payload.id, line });
          }
        }
        return { ok: res.ok, status: res.status, text };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) event.sender.send('ellie:line', { id: payload.id, line });
        }
        buffer += decoder.decode();
        if (buffer.trim()) event.sender.send('ellie:line', { id: payload.id, line: buffer });
      } finally {
        reader.releaseLock();
      }
      return { ok: true, status: res.status, text: '' };
    } finally {
      inflight.delete(payload.id);
    }
  });

  ipcMain.on('ellie:abort', (_event, id: string) => {
    const ctrl = inflight.get(id);
    if (ctrl) ctrl.abort();
  });
}
