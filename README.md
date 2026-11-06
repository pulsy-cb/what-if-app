# what-if-app — le studio piloté au chat

Une application web où l'on **parle** à un agent qui fabrique les épisodes *What If* : il lit le dépôt,
écrit le script, lance les scripts du skill (voix ElevenLabs, plan, stills, board, sfx, master), regarde
les images qu'il produit et itère. Le moteur d'animation reste celui du skill `what-if-animation` ;
l'app ajoute ce qui manquait : des **projets**, une **boucle d'agent**, des **outils typés**, des
**portes d'approbation** et des **checkpoints**.

```
navigateur ──► POST /api/threads/:id/messages      (une instruction, en français)
                    │
                    ▼
            orchestrateur  ──►  LLM (n'importe quelle API multimodale)
                    │              │ tool_calls
                    │              ▼
                    │        registre d'outils  ──►  projet (fichiers, git, scripts python)
                    ▼
             SSE ◄── texte, appels d'outils, artefacts, demandes d'approbation
```

## Démarrage

### En local (Node ≥ 22.5)

```bash
npm install
npm run build
WHATIF_PROVIDER=mock npm start       # http://127.0.0.1:3000 — offline, scripté, pour tester la boucle
```

Pour un vrai modèle : ouvre **⚙** dans l'app (fournisseur, base URL, modèle, clé), ou par environnement :

```bash
WHATIF_PROVIDER=openai WHATIF_BASE_URL=https://api.openai.com/v1 \
WHATIF_MODEL=gpt-4.1 WHATIF_API_KEY=sk-… npm start
```

Le skill est détecté automatiquement s'il est juste à côté (`../what-if-animation`) ; sinon
`WHATIF_SKILL_DIR=/chemin/vers/what-if-animation`.

### Sous Docker

```bash
cp .env.example .env          # mets la clé du modèle et ELEVENLABS_API_KEY
docker compose up --build
```

Le conteneur tourne **non-root**, écoute sur `127.0.0.1:3000` seulement, avec `shm_size: 1gb` pour
Chromium. Volumes : `./data` (projets, SQLite, checkpoints git) et `../what-if-animation:/skill:ro`.

> Dans le conteneur, les rendus Remotion ont besoin de `--gl=swangle` (pas de GPU) ; l'agent le passe
> quand il appelle `npx remotion`. `node_modules` du studio est installé par l'étape `install`.

## Ce qui existe dans cette v0.1

```
src/tools/           le contrat d'outil et les outils (aucune dépendance runtime)
  types.ts           Tool, ToolResult, validation JSON Schema minimale
  exec.ts            spawn sans shell, argv explicite, timeout, kill
  paths.ts           safeJoin (anti-traversée), walk, glob, extraction de symboles
  fs.ts              repo_map, read_file, write_file, edit_file, glob, grep, view_image
  shell.ts           shell (allowlist), git (status/diff/checkpoint/log/restore)
  shell-policy.ts    la liste blanche des commandes — le vrai rempart
  whatif.ts          whatif_new, whatif_run, whatif_status, whatif_sync_engine
src/orchestrator/
  main.ts            HTTP + routes + SSE + fichiers (Range pour la vidéo) + auth par token
  agent.ts           la boucle : modèle → outils → résultats → modèle, checkpoint avant mutation
  context.ts         compilation du contexte : prompt système, PROJECT.md, fichiers, historique compacté
  approvals.ts       porte "ask" : le run se bloque jusqu'au clic, timeout = refus
  db.ts              SQLite (node:sqlite) : projets, fils, messages, approbations, crédits
  bus.ts             bus d'événements par fil + buffer de rejeu (le SSE survit à un reload)
  providers/         openai-compatible (streaming + tool calls + vision), anthropic, mock
web/public/          l'UI : chat, cartes d'outils, images/vidéos, approbations, réglages
test/                smoke tests (outils, allowlist, boucle complète en HTTP avec le provider mock)
```

Zéro dépendance runtime : `node:http`, `node:sqlite`, `fetch` natif. Seul TypeScript est en dev.

## Les outils

| outil | politique | à quoi ça sert |
|---|---|---|
| `repo_map` | auto | arborescence + symboles exportés, sans `node_modules/out/.git` |
| `read_file` / `edit_file` / `write_file` | auto | lecture avec numéros de ligne ; remplacement ciblé (oldText unique, échec explicite) |
| `glob` / `grep` | auto | chercher un fichier, chercher du texte |
| `view_image` | auto | rattache une still / planche / grille pour que le modèle la voie |
| `shell` | **ask** | une seule commande, dans une allowlist (`npx tsc`, `npx remotion`, `python scripts/…`, `ffmpeg`, `git`…) |
| `git` | auto | statut, diff, checkpoint, log, restore |
| `whatif_new` | **ask** | copie le studio du skill + squelette d'épisode (`episode.json`, `timeline.json`, `shots.tsx`, `index.tsx`), enregistré dans `src/episodes/index.ts` |
| `whatif_run` | **ask** | une étape du pipeline : `install, voice, plan, stills, board, sfx, mixcheck, motiongrid, render, master` |
| `whatif_status` | auto | où en est l'épisode (script, words, timeline, stills, board, sfx, render, report) |
| `whatif_sync_engine` | **ask** | compare `src/engine` au skill, liste les fichiers modifiés localement, n'écrase que sur `apply` |

Trois politiques : `auto` (l'agent agit), `ask` (le run attend ton clic), `deny` (l'outil disparaît du
contexte). Toute mutation prend un **checkpoint git** avant de s'exécuter : `git log` rejoue l'histoire
de l'épisode, `git restore` revient en arrière.

## Le cycle d'un épisode

1. **Projet** : `+` dans la colonne Projets → copie du studio (engine + public + `package.json`) et un
   squelette d'épisode qui type-checke déjà (`npx tsc --noEmit` passe).
2. **Script** : l'agent remplit `episode.json` (cold open en 3 démos, prémisse, coût avec un fait sourcé).
3. **`voice`** → `words.json` (timings par mot). **`plan`** → `timeline.json` (segments, shots, fx, audio).
4. **`stills`** puis **`board`** : l'agent regarde la planche (`view_image`) et te demande l'accord.
5. **Après accord seulement** : `sfx`, `mixcheck`, `master` (−14 LUFS, crêtes < −1 dBTP, `report.json`).
6. Il tient `PROJECT.md` à jour : décisions, sources, ce qui est approuvé. C'est sa mémoire entre deux
   sessions, et ton point de reprise.

Le contexte est recompilé à chaque étape (prompt + PROJECT.md + arborescence + historique) et compacté
quand il dépasse `WHATIF_CONTEXT_CHARS` : les vieux résultats d'outils sont tronqués, le début de
conversation est résumé, les images récentes sont rattachées (max 3 par tour, ~4,5 Mo).

## Mettre à jour le moteur sans perdre son travail

`src/engine` appartient au skill, pas à l'app. La mise à jour est donc explicite :

```
whatif_sync_engine                 # rapport : nouveaux fichiers / identiques / modifiés localement
whatif_sync_engine { apply: true } # écrase après checkpoint git
```

Tu vois donc toujours *ce que tu as changé* avant de le perdre, et `git restore` annule.

## Tests

```bash
npm test        # build + 3 tests : outils, allowlist shell, boucle agent complète en HTTP (mock)
bash scripts/demo.sh "fais un tour du projet"   # contre un serveur déjà lancé
```

## Dépannage

**La page ne s'affiche pas / le conteneur redémarre en boucle**

```bash
docker compose ps            # STATUS: Restarting → il crashe
docker compose logs --tail=30
```

Si tu vois `Error: unable to open database file`, c'est `/data` : quand Docker crée le dossier
`./data` du bind mount, il le possède en `root:root` et l'app (uid 1000) ne peut pas y écrire SQLite.
L'entrypoint corrige maintenant le propriétaire puis abandonne les privilèges (`setpriv`), donc un
`docker compose up -d --build` suffit. Si ton dossier est sur un montage réseau ou en lecture seule,
utilise plutôt un volume nommé :

```yaml
    volumes:
      - whatif-data:/data
volumes:
  whatif-data:
```

**`warning: no studio/ in /skill`**

Le skill n'est pas monté : vérifie `WHATIF_SKILL_DIR` et le volume `../what-if-animation:/skill:ro`.

**Le modèle répond mais n'appelle jamais d'outil**

Certaines passerelles « openai-compatible » ignorent `tools`. Teste avec un modèle qui sait faire du
tool calling ; sinon l'agent discute mais ne touche pas au projet.

**`npx remotion render` échoue dans le conteneur**

Pas de GPU et pas de sandbox dans Docker : il faut `--gl=swangle` et `--no-sandbox` (Chromium headless),
et `shm_size: "1gb"` côté compose.

## Sécurité — à lire

- Le shell est une **RCE par conception** : l'agent écrit et exécute du code dans le projet. L'allowlist
  bloque les opérateurs (`; | & > $ ( )`) et les binaires non listés, mais ce n'est pas un bac à sable.
  Fais tourner l'app dans le conteneur, sur `127.0.0.1`, avec `WHATIF_AUTH_TOKEN` si autre chose que
  ta machine peut l'atteindre.
- Les clés sont stockées dans SQLite (`data/app.db`) et ne sont jamais renvoyées au navigateur
  (`hasKey` seulement). Pour un déploiement partagé, préfère les variables d'environnement et un
  utilisateur par conteneur.
- Chaque projet vit dans `data/projects/<id>` ; `safeJoin` refuse toute sortie de ce dossier.

## Prochaines étapes (dans l'ordre)

1. **CLI + serveur MCP** au-dessus du même registre : `whatif run "…"`, et l'agent utilisable depuis
   Claude Code / OpenCode. Le registre est déjà indépendant de l'HTTP.
2. **Budgets** : plafond de crédits par projet et par tour, refus automatique au-delà (`ledger` existe).
3. **Planches de trames** : attacher automatiquement `motiongrid` au contexte, et un outil `compare_frames`
   pour juger le mouvement — c'est là que la qualité se joue.
4. **Multi-utilisateur** : sessions, un token par personne, un `data/projects/<user>` par compte.
5. **Reprise de run** : persister l'état de la boucle pour survivre à un redémarrage du conteneur.

## Licence

Le moteur et les scripts viennent du skill `what-if-animation` (voir sa LICENSE). Cette app est un
harnais : elle n'embarque ni les polices, ni les assets, ni les voix.
