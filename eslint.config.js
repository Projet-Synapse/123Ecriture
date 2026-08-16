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
      // @typescript-eslint n'en fournit pas de variante namespacée (pas
      // besoin d'info de type pour celles-ci), contrairement aux trois
      // suivantes.
      eqeqeq: ['error', 'always'],
      'no-duplicate-imports': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
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
