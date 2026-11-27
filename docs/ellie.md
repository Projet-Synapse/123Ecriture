# Ellie — parler avec l’IA locale dans 123Écriture

Ellie est le chat intégré de 123Écriture : ton Qwen (ou un autre modèle
local) devient un « second cerveau » *dans* l’app, en **lecture seule**.
Elle propose des textes ; rien n’est modifié dans une note sans un clic
sur **Copier** ou **Insérer dans la note**.

La passerelle MCP (Paramètres → 🤖 IA / Passerelle, `docs/passerelle-ia.md`)
reste disponible pour une IA *externe* (LM Studio, etc.). Ellie s’en sert
des mêmes règles : verrous 🔒, autorisations, dossiers autorisés, journal.

## 1. Activer Ellie

1. Paramètres → 🤖 IA / Passerelle → cocher **Activer la passerelle IA**.
   Tant que cette case est décochée, le panneau Ellie reste inerte.
2. Carte **💬 Ellie (chat dans l’app)** :
   - fournisseur **Ollama** (défaut) ou **OpenAI / LM Studio** ;
   - URL (défaut `http://127.0.0.1:11434`) ;
   - modèle (ex. `qwen3:8b`) ;
   - nom de l’IA (défaut « Ellie ») et prompt système / personnalité ;
   - option « Joindre la note ouverte par défaut ».
3. **Tester la connexion** (liste les modèles via `/api/tags` ou `/v1/models`).

Le bouton **💬** de l’en-tête de l’éditeur ouvre le panneau (onglet du
panneau latéral droit sur le PC ; feuille plein écran sur le téléphone).

## 2. Configurer Ollama

Sur le **même PC** que 123Écriture :

1. Installe Ollama, puis un modèle : `ollama pull qwen3:8b`.
2. URL : `http://127.0.0.1:11434`.
3. Si un message parle de CORS, relance Ollama avec `OLLAMA_ORIGINS=*`.
   L’app PC passe par un proxy (processus principal) : le CORS ne devrait
   pas poser problème une fois l’app packagée.

Sur un **téléphone**, `127.0.0.1` désigne le téléphone, pas le PC :

1. Sur le PC : `OLLAMA_HOST=0.0.0.0` et `OLLAMA_ORIGINS=*`, ouvre le port
   11434 du pare-feu (réseau privé), même Wi-Fi.
2. Dans 123Écriture, URL du type `http://192.168.1.26:11434` (l’IP du PC).
3. Les APK officielles n’autorisent pas encore le HTTP en clair vers le
   réseau local (seul le build de débogage le fait). Pour tester sur
   Android, un build de test sera nécessaire.

## 3. LM Studio (API compatible OpenAI)

Charge un modèle, démarre le serveur local (souvent le port 1234), active
CORS si besoin. Choisis **OpenAI / LM Studio**, URL
`http://127.0.0.1:1234` (avec ou sans `/v1`). Liste : `/v1/models`.
Chat : `/v1/chat/completions`. Une clé API est optionnelle.

## 4. Ce qu’Ellie peut lire

- Option **Inclure la note courante** (case du panneau) : le contenu de la
  note ouverte est joint au message, *sauf* si la note est verrouillée 🔒
  ou hors des dossiers autorisés.
- Si le modèle gère les outils (Qwen3 via Ollama le fait en principe),
  Ellie peut appeler `list_files`, `read_file` et `search` — **exactement**
  la même décision que la passerelle (verrous hérités, permissions
  Interdit / Demander / Toujours, dossiers autorisés, journal).
  « Demander » est encore traité comme un refus (pas d’écran de
  confirmation).
- Si le modèle ne renvoie pas d’appel d’outil, seul le contexte injecté
  (note courante, si autorisée) est fourni.

Ellie **n’écrit pas** dans le coffre. Les boutons **Copier** et **Insérer
dans la note** exigent un clic. L’insertion se fait au curseur, en mode
Source ou Intermédiaire.

Les conversations sont enregistrées localement dans
`.123ecriture/ellie-conversations.json` (comme le journal, non synchronisé).

## Limites actuelles

- Le panneau s’ouvre depuis l’éditeur (une note ouverte).
- Pas d’écriture automatique, pas d’écran « Demander ».
- Sur Android en version officielle, le HTTP local peut être bloqué
  (cleartext) ; à traiter dans un build de test / une version future.
- Le délai d’un tour de chat est de 5 minutes (chargement d’un modèle) ;
  15 secondes pour le test de connexion. Le bouton **Stop** annule.
