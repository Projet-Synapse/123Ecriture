# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Monorepo managed with pnpm workspaces + Turborepo (`pnpm@10.32.1`, Node >=18). Run from the repo root unless noted.

```bash
pnpm install            # install all workspace deps

pnpm dev:mobile         # Expo dev server (apps/mobile) — UI, Live Preview, all business logic
pnpm dev:desktop        # build the Electron main process then launch it (apps/desktop)

pnpm lint               # turbo run lint — both packages
pnpm typecheck          # turbo run typecheck (tsc --noEmit) — both packages
pnpm build              # turbo run build — both packages
```

Per-package (from `apps/mobile/` or `apps/desktop/`, or via `pnpm --filter @123ecriture/mobile <script>`):

```bash
# apps/mobile
pnpm test                        # vitest run — pure-logic unit tests (lib/*.test.ts)
pnpm vitest run lib/frontmatter.test.ts   # single test file
pnpm vitest run -t "nom du test"          # single test by name
pnpm build:web                   # expo export --platform web → apps/mobile/dist (what Electron loads)

# apps/desktop
pnpm build:electron              # esbuild bundles electron/main.ts + preload.ts → electron-dist/*.js (CJS)
pnpm package:linux / :win / :mac # build:electron + electron-builder (local packaging test)
```

There is no test suite in `apps/desktop` — only `apps/mobile` has Vitest, and only for files under `lib/` (pure logic, no React Native/Electron dependency). Electron main-process code is not unit tested; verify it by actually launching the app (`pnpm dev:desktop`) — several past bugs (frozen editor, no scroll, live-preview silently disabled) were only caught this way, not by lint/typecheck.

## Architecture

### Two apps, no shared packages yet

`pnpm-workspace.yaml` declares `apps/*` and `packages/*`, but **no `packages/` directory exists** — despite what `docs/ARCHITECTURE.md` describes as the target layout (`packages/core`, `storage`, `sync`, `ui`, `editor`...), all logic currently lives directly in the two apps:

- **`apps/mobile`** — the actual application. An Expo (React Native + React Native Web) app: every screen, component, and piece of business logic (vault tree, frontmatter parsing, sync engine, markdown rendering, preferences...) lives here, under `components/`, `lib/`, `preferences/`. Despite the name, this is also what runs as the web/desktop UI — `expo export --platform web` produces the bundle that Electron loads as its renderer.
- **`apps/desktop`** — an Electron **shell only**. `electron/main.ts` creates the window and loads the Expo web build; `electron/preload.ts` exposes typed IPC bridges via `contextBridge`; each `electron/<domain>.ts` file (`vault.ts`, `tasks.ts`, `properties.ts`, `calendar.ts`, `occurrences.ts`, `sync.ts`, `auth.ts`, `preferences.ts`, `search.ts`, `contextMenu.ts`, `updater.ts`, `vaults.ts`) registers `ipcMain.handle(...)` handlers — this is the only place with real filesystem/OS access. There is no separate desktop-only UI.

This split is a deliberate, documented choice (see `docs/ARCHITECTURE.md` §5/§6/§8, "écart pragmatique"): extracting a shared package is postponed until there is a **second real consumer** (e.g. a native-mobile storage adapter) — until then a `packages/` split would just add monorepo resolution overhead for no benefit. When adding a feature, default to putting logic in `apps/mobile/lib/` and IPC handlers in `apps/desktop/electron/`, not a new package.

### The IPC bridge pattern (how renderer and main process talk)

Every desktop feature follows the same three-file shape:

1. `apps/desktop/electron/<domain>.ts` — `ipcMain.handle('<domain>:<action>', ...)`, reads/writes JSON under `.123ecriture/` in the active vault (or app-level `config.json` for preferences/theme).
2. `apps/desktop/electron/preload.ts` — `contextBridge.exposeInMainWorld('<domain>', { action: (...) => ipcRenderer.invoke('<domain>:action', ...) })`.
3. `apps/mobile/types/global.d.ts` — ambient `Window.<domain>` bridge type + shared data types, **hand-mirrored** from `apps/desktop/electron/types.ts` (not actually shared — same "no abstraction before a second consumer" reasoning as above). When changing a type on one side (e.g. `PropertyType`), update both files.

Renderer code accesses a bridge as `typeof window !== 'undefined' ? window.<domain> : undefined` and degrades gracefully (not a crash) when it's `undefined` — this is how web/mobile builds without Electron avoid breaking. Existing domains: `vault`, `vaults`, `auth`, `sync`, `tasks`, `calendar`, `properties`, `occurrences`, `preferences`, `contextMenu`, `updater`, `search`.

### Vault & file model

- A **vault** is a local folder. `apps/desktop/electron/vaults.ts` manages the list of known vaults and which one is active (`config.json`, app-level, not per-vault).
- A hidden `.123ecriture/` folder inside the vault holds per-vault JSON registries: `properties.json` (property schema, not values), `tasks.json`, `occurrences.json`, `order.json` (manual sort), `state.json` (last-opened note), `vault.json` (stable vault identity, used as sync key instead of the path).
- A **note** is a `.mdx`/`.md` file with an optional YAML frontmatter block, parsed/serialized by `apps/mobile/lib/frontmatter.ts` (`js-yaml`, tolerant — invalid YAML never throws, just yields `{}`). Frontmatter values are the *values* of properties; `properties.json` only holds the *schema* (name + type) — renaming/retyping/deleting a property never touches already-written note content.
- `VaultEntryKind` (`markdown | canvas | chart | excalidraw`) is derived purely from file extension (see `walkTree` in `vault.ts`) and drives which editor `NotesScreen.tsx` mounts: `MdxEditor`/`NoteRenderer`, `CanvasEditor`, `ChartEditor`, `ExcalidrawEditor`. `.canvas` follows the open JSON Canvas spec; `.chart` is a small custom JSON format (`lib/sheets.ts`).

### Editor: three view modes, one CodeMirror instance

`apps/mobile/components/MdxEditor.tsx` wraps `@uiw/react-codemirror` and backs both **Source** and **Intermédiaire** (Live Preview) modes — same editor instance, the only difference is whether the `ViewPlugin` from `lib/mdxLivePreview.ts` is attached (inline decorations: styled bold/italic/headings with markers hidden unless the cursor is inside, clickable pills for links/tags/occurrences/embeds). **Aperçu** (reading mode) is a fully separate read-only component, `NoteRenderer.tsx` (`markdown-it` + `react-native-markdown-display`). Since the app compiles via `react-native-web`, a "DOM-pure" component like the CodeMirror wrapper integrates directly into the React tree with no ref/effect escape hatch — that workaround is only needed for real native-primitive gaps (`SvgOverlay.tsx`, `AudioEmbed.tsx`).

Properties are edited through `PropertyValueField.tsx` (one widget per `PropertyType`), shown both inline above the note (`PropertiesBlock.tsx`, Intermédiaire/Aperçu only) and in the right sidebar (`PropertiesPanel.tsx`); the property *schema* itself (create/rename/retype, and per-type config like `options` choices) is edited in Settings → "Gestion des propriétés" (`components/settings/PropertiesManagementSection.tsx`), not in either of those note-facing views. Shared logic lives in `lib/usePropertyDefinitions.ts` (schema CRUD) and `lib/usePropertyValues.ts` (per-note frontmatter read/write) — reuse these hooks rather than re-deriving property state.

### Preferences vs. vault content

Two separate persistence layers — don't mix them up:
- **Preferences** (theme, editor font, toolbar order, sidebar layout...) — app-level, machine-scoped, `PreferencesContext.tsx` (React context) ↔ `window.preferences` ↔ `apps/desktop/electron/preferences.ts` (`config.json` in Electron `userData`). All setters return a `Promise` that resolves only after the disk write completes — some callers (e.g. drag-reorder right after switching sort mode to "Manuel") depend on this to avoid a read-after-write race.
- **Vault content** (notes, tasks, properties schema, occurrences...) — per-vault, stored under `.123ecriture/` inside the vault folder itself, so it travels with the vault.

### Sync (Supabase)

Opt-in, manual, desktop-only so far. Auth (`apps/desktop/electron/auth.ts` + `apps/mobile/lib/sync/AuthContext.tsx`) uses system-browser + custom protocol (`app123ecriture://auth-callback`) with PKCE; the Supabase session lives in the renderer. Sync logic is split into a pure diff function (`apps/mobile/lib/sync/diff.ts`, push/pull/conflict decisions, unit tested) and an effectful orchestrator (`syncEngine.ts`). Schema: dedicated Postgres schema `app_123ecriture` (never `public`), one Storage object per note. Conflict strategy is last-write-wins with the losing side saved as a visible `Nom (conflit <timestamp>).mdx` — never a silent overwrite.

## CI / release

`.github/workflows/release.yml` triggers only on a pushed `v*` tag — never on a plain commit/branch push. It builds Windows/Linux/macOS via `electron-builder --publish always`, drafts a GitHub Release with the installers attached, then (as of 2026-08-19, explicit user decision) a final `publish-release` job **auto-publishes it** (`gh release edit --draft=false`) once all 3 builds succeed AND the 3 installers (`.exe`/`.dmg`/`.AppImage`) are confirmed attached — if any is missing, publishing is skipped and the draft is left for inspection instead. There is no human review step between "build succeeded" and "shipped": `electron-updater` (`apps/desktop/electron/updater.ts`, `autoDownload`/`autoInstallOnAppQuit`) only sees published releases, so publishing = immediate rollout to every existing install. **Always bump the version and smoke-test before tagging** — pushing the tag is the real point of no return now, not a later manual "Publish" click.

**Known trap**: `electron-builder` resolves which release to publish to from the `version` field in `apps/desktop/package.json`, *not* from the git tag name. If you push a tag without bumping both `apps/desktop/package.json` and `apps/mobile/package.json` to match, the build silently skips uploading all installer assets (logs show `skipped publishing ... reason=existing type not compatible`) — the `publish-release` job's asset check catches this and refuses to publish, but the underlying mismatch still needs fixing (bump both `package.json` versions in the same commit that gets tagged, keep them equal, and use a version that hasn't already been tagged).

## Conventions specific to this repo

- Code comments and commit messages are in **French**, using a `<type> : <description>` prefix on commits (`feat :`, `fix :`, `chore :`...).
- Comments frequently explain *why*, including dead ends and bugs already hit (e.g. flexbox height bugs in the CodeMirror wrapper, IPC race conditions) — read the comment above a piece of non-obvious code before changing it, the reasoning is usually already there.
- `docs/ARCHITECTURE.md` is the living design doc: each shipped deviation from the original plan is recorded inline as an "écart pragmatique" (pragmatic deviation) rather than silently diverging from the doc — update it when you make an architecturally significant choice that isn't already covered.
