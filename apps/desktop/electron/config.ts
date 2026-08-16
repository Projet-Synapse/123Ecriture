import { app } from 'electron';
import fsSync from 'fs';
import path from 'path';

import type { AppConfig } from './types';

// Petit config.json partagé (dossier userData d'Electron, indépendant de la
// version de l'app) — utilisé par vault.js (vaultPath) et preferences.js
// (personnalisation). Lecture/écriture toujours synchrones et sans await
// entre les deux dans un même appel : chaque écriture reste une opération
// atomique du point de vue de la boucle d'événements Node, donc pas de
// risque de conflit entre deux handlers IPC qui écriraient "en même temps".

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function readConfig(): AppConfig {
  try {
    return JSON.parse(fsSync.readFileSync(getConfigPath(), 'utf8')) as AppConfig;
  } catch {
    return {};
  }
}

export function writeConfig(partial: Partial<AppConfig>): AppConfig {
  const next = { ...readConfig(), ...partial };
  fsSync.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fsSync.writeFileSync(getConfigPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
