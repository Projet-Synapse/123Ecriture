# Scores de qualité — 123Ecriture

| Dimension | Score |
|---|---|
| ♻ Ergonomie | 6/10 |
| 👍 Stabilité | 5/10 |
| 🔰 Sécurité | 6/10 |
| 🗂 Organisation | 7/10 |
| 🚀 Performance | 4/10 |

Bilan initial (2026-10-02, session débogage Android) : desktop est mature ; le
mobile natif était écrit sans jamais avoir été testé sur appareil réel
(commentaire « PAS TESTÉ SUR UN VRAI APPAREIL » dans nativeVaultAdapter.ts) —
la journée a révélé et corrigé 8 crashes/bugs distincts côté SAF/Hermes.

## Tâches

### ♻ Ergonomie
- [ ] Système de mise à jour automatique sur Android (équivalent de l'updater desktop — expo-updates ou vérification GitHub Releases) — demande 2026-10-03 (+1)
- [ ] Vue Graphique : largeur de la barre latérale réglable (elle masque tout sur téléphone) — demande 2026-10-03 (+1)
- [ ] Mode Intermédiaire fidèle sur Android : WebView embarquant l'éditeur web CodeMirror (pont contenu/sauvegarde/thème/clavier tactile) — demande explicite 2026-10-02, validé « phasé » par l'utilisatrice (+1)
- [ ] État de chargement explicite pendant le parcours SAF de l'arborescence (~1 min sur un grand coffre, UI figée aujourd'hui) (+1)
- [ ] Indicateur de progression de la synchro (compteur de fichiers traités) (+1)
- [ ] « Réglages du mode sombre » : titre écrasé verticalement en layout étroit (vu sur A13) (+1)

### 👍 Stabilité
- [ ] Tester sur appareil réel toute nouvelle fonction SAF avant merge (règle de process — les crashes du 02/10 venaient tous de là) (+1)
- [ ] Survivre à l'échec d'un fichier isolé pendant un pull sans compter sur le try/catch appelant (+1)
- [ ] Session Supabase : baser le stockage natif sur un stockage chiffré (expo-secure-store) plutôt qu'un JSON en clair (+1)

### 🔰 Sécurité
- [ ] Vérifier que les policies RLS couvrent le bucket Storage pour un second appareil (+1)

### 🗂 Organisation
- [ ] Factoriser le parcours SAF dupliqué (nativeVaultAdapter.walkSafChildren vs nativeSyncAdapter.walkAndHash) (+1)
- [ ] Fusionner le clone de build C:\b et le workspace (risque de divergence de sources) (+1)
- [ ] Committer les correctifs Android 2026-10-02 (18+ fichiers en attente) (+1)

### 🚀 Performance
- [ ] Réutiliser le hash du sync-state pour ne re-hacher que les fichiers à risque (cycle = minutes sur ~1000 notes) (+1)
- [ ] Lire le contenu SAF sans la copie cache intermédiaire (readAsStringAsync + copyAsync par fichier) (+1)
- [ ] Décharger le parcours hors du thread JS (UI figée pendant les walks) (+1)

## Historique
- 2026-10-02 : création après la session de débogage Android (8 crashes/bugs
  natifs corrigés : window.addEventListener, addEventListener DOM des effets,
  Blob.text(), OOM expo/fetch, getInfoAsync SAF, chemins Windows `\`,
  MIME/extension Android, chevron SVG transform).
