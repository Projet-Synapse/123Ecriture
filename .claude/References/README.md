# 123Ecriture

Application d'écriture et de productivité personnelle, local-first, écrite
en MDX — première brique du 🧠 Projet Synapse.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les choix
d'architecture, le modèle de données et la feuille de route par phases.

## 🗂️ Structure

```
apps/
├── mobile/    # Expo (iOS, Android, et export web)
└── desktop/   # Electron (PC/Mac/Linux), charge le renderer web d'Expo
```

Statut actuel : **Phase 0 — scaffold**. Les deux apps démarrent et affichent
un écran minimal ; aucune logique de vault/éditeur MDX pour l'instant (voir
la feuille de route dans `docs/ARCHITECTURE.md`).

## 🚀 Démarrer

Prérequis : Node ≥ 18, [pnpm](https://pnpm.io).

```bash
pnpm install
```

### Mobile / Web (Expo)

```bash
pnpm dev:mobile
# puis 'w' pour ouvrir dans le navigateur, ou scanner le QR code avec Expo Go
```

### Desktop (Electron)

Electron charge en développement le serveur web d'Expo — il faut donc que
`pnpm dev:mobile` tourne (avec le web démarré) dans un premier terminal,
puis dans un second :

```bash
pnpm dev:desktop
```

## ✅ Qualité

```bash
pnpm lint       # ESLint sur tout le monorepo
pnpm typecheck  # tsc --noEmit sur les paquets TypeScript
```
