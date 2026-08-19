const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
// Désactive les règles ESLint qui portent sur le style (indentation,
// virgules, longueur de ligne...) puisque c'est désormais Prettier qui s'en
// charge — évite que les deux outils se contredisent.
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // Évite un avertissement "react package is not installed" quand
    // eslint-plugin-react (via eslint-config-expo) tente d'auto-détecter la
    // version de React depuis des paquets comme apps/desktop qui n'en
    // dépendent pas (process principal Electron, pas de React).
    settings: {
      react: {
        version: '19.2.3',
      },
    },
  },
  {
    // apps/desktop/electron/*.js tourne en CommonJS Node (process principal
    // Electron), et les fichiers *.config.js à la racine (dont ce fichier
    // lui-même) tournent aussi sous Node au chargement — pas dans
    // l'environnement RN/browser du reste du projet. Sans ça, ESLint ne
    // reconnaît pas __dirname/require/module et remonte de faux positifs
    // "is not defined".
    files: ['apps/desktop/electron/**/*.js', '*.config.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    // Réservé aux fichiers TypeScript : le plugin @typescript-eslint n'est
    // enregistré par eslint-config-expo/flat que pour ces fichiers-là — sur
    // du .js pur (ex. apps/desktop/electron/*.js), ces règles feraient
    // planter ESLint ("could not find plugin").
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // Ces règles nécessitent l'info de type ; projectService détecte
        // automatiquement le tsconfig.json le plus proche de chaque fichier
        // (utile en monorepo, pas besoin de lister chaque tsconfig ici).
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // 🎯 Les chasseurs de bugs
      // `eqeqeq`/`no-duplicate-imports` sont des règles ESLint "de base" —
      // pas de préfixe de plugin (pas de `@`), @typescript-eslint n'en
      // fournit pas de variante namespacée (pas besoin d'info de type pour
      // celles-ci), contrairement aux règles `@typescript-eslint/*` qui
      // suivent.
      eqeqeq: ['error', 'always'],
      'no-duplicate-imports': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // `react-hooks/exhaustive-deps` (plugin react-hooks, PAS
      // @typescript-eslint) — n'a pas besoin d'info de type mais a besoin de
      // JSX/hooks, donc scoped ici plutôt que dans une section générique.
      // Attrapé en 'warn' seulement par défaut dans eslint-config-expo :
      // c'est exactement la règle qui aurait signalé le bug "fichier ouvert
      // par défaut" (effet lisant `preferences.defaultOpenMode` sans
      // dépendre de `preferencesLoaded, voir CLAUDE.md § Comportement) —
      // passée en 'error' pour que ce genre de closure obsolète bloque
      // vraiment le commit au lieu de juste s'afficher en jaune.
      'react-hooks/exhaustive-deps': 'error',

      // Un switch/if-else sur un type union (PropertyType, VaultEntryKind,
      // EditorViewMode...) qui oublie un cas après l'ajout d'un nouveau
      // membre est exactement le genre d'erreur silencieuse que ce projet a
      // déjà (ex. l'ajout de 'path'/'options' à PropertyType, voir
      // PropertiesPanel.tsx) — cette règle fait échouer le build si un
      // switch ne couvre plus tous les cas d'un type union.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Shadowing de variable (ex. un `theme` de closure interne qui masque
      // silencieusement le `theme` de la prop du composant) — source
      // classique de bug "je modifie la mauvaise variable". La version
      // @typescript-eslint remplace la règle de base (désactivée juste en
      // dessous) car elle comprend aussi les types/enums, pas seulement les
      // valeurs.
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',

      // `!` (non-null assertion) contourne le typage strict et a déjà été
      // une source de crash runtime ("impossible que ce soit null"... sauf
      // que si). En 'warn' plutôt que 'error' : quelques usages légitimes
      // existent déjà dans le code (ex. après un guard déjà fait), à trier
      // au cas par cas plutôt qu'à bloquer tout de suite.
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    // Dans les tests, `expect(x).toBeDefined()` suivi de `x!.foo` est un
    // idiome sûr et courant (TS ne peut pas narrower le type à partir d'une
    // assertion Vitest) — pas la même prise de risque qu'un `!` dans du
    // code applicatif réel. Désactivé seulement ici plutôt que de laisser
    // ces avertissements s'accumuler sans jamais être traités.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Fonction Supabase Edge (runtime Deno) : les imports par URL
    // (https://deno.land/...) sont valides sous Deno mais qu'ESLint/TS ne
    // peuvent pas résoudre depuis un projet Node — hors périmètre du lint.
    ignores: [
      '**/dist/**',
      '**/dist_electron/**',
      '**/.expo/**',
      '**/node_modules/**',
      'apps/desktop/release/**',
      'apps/desktop/electron-dist/**',
      'supabase/functions/**',
    ],
  },
]);
