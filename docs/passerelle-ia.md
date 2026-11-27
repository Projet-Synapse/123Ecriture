# Passerelle IA — brancher le Qwen local sur 123Ecriture

L'app **PC** de 123Ecriture peut exposer le coffre ouvert à une IA locale, en
**lecture seule**, via un petit serveur **MCP** (Model Context Protocol) :

- adresse : `http://127.0.0.1:37123/mcp` (uniquement ce PC, jamais le réseau) ;
- jeton obligatoire : en-tête `Authorization: Bearer <jeton>` ;
- outils : `list_files`, `read_file`, `search` ;
- les éléments **verrouillés** (🔒), les dossiers cachés et tout ce qui est hors
  des « dossiers autorisés » sont invisibles ; chaque appel est noté dans le
  journal (Paramètres → 🤖 IA / Passerelle).

## 1. Dans 123Ecriture (PC)

1. Paramètres → 🤖 IA / Passerelle → cocher **Activer la passerelle IA**.
2. **🔑 Générer un jeton** → **Copier** (il ne sera plus affiché).
3. Le serveur démarre tout seul dans les 5 secondes (et s'arrête si on
   désactive ou révoque le jeton). 123Ecriture doit rester ouvert.

## 2. Côté IA : le Qwen de 123Promptez

123Promptez appelle Qwen via **Ollama** (`http://127.0.0.1:11434`, API
`/api/chat`, modèle du type `qwen3:8b`) — option « OpenAI / LM Studio » aussi
possible (`/v1/chat/completions`). Ollama seul ne sait pas parler MCP : il faut
un « hôte MCP » entre Qwen et 123Ecriture. Deux possibilités :

**A. LM Studio (le plus simple aujourd'hui).** Charger un Qwen (Qwen3) dans
LM Studio ≥ 0.3.17, puis onglet *Program* → *Install* → *Edit mcp.json* :

```json
{
  "mcpServers": {
    "123ecriture": {
      "url": "http://127.0.0.1:37123/mcp",
      "headers": { "Authorization": "Bearer COLLER_LE_JETON_ICI" }
    }
  }
}
```

Dans une conversation, demander par exemple « cherche “dragon” dans mon coffre
123Ecriture puis résume la note trouvée ». LM Studio demande confirmation avant
chaque appel d'outil.

**B. 123Promptez lui-même (évolution prévue).** 123Promptez enverrait à Ollama
la liste des outils (`tools` de `/api/chat`, que Qwen3 sait utiliser), puis
relaierait chaque appel d'outil vers `http://127.0.0.1:37123/mcp` avec le
jeton. À faire dans le dépôt 123Promptez (non inclus ici).

## 3. Vérifier à la main (facultatif)

```bash
curl -s http://127.0.0.1:37123/mcp \
  -H "Authorization: Bearer COLLER_LE_JETON_ICI" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_files","arguments":{}}}'
```

Sous Windows PowerShell, utiliser `curl.exe` et échapper les guillemets, ou
tester directement depuis LM Studio.

## Limites actuelles

- Lecture seule : les autorisations d'écriture (créer, modifier…) sont
  enregistrées mais aucun outil d'écriture n'existe encore.
- « Demander » n'a pas encore d'écran de confirmation : traité comme un refus.
- Fonctionne seulement app PC ouverte ; pas de serveur sur Android.
- Port fixe 37123 ; s'il est déjà pris, le serveur ne démarre pas (message dans
  la console de l'app).


## Chat Ellie (dans l’app)

Pour parler avec Qwen *dans* 123Écriture (panneau 💬 Ellie), voir
`docs/ellie.md`. Les mêmes verrous, autorisations, dossiers autorisés et
le même journal s’appliquent. Le chat est inerte tant que « Activer la
passerelle IA » n’est pas coché.
