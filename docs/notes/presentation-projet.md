# what-if-app — présentation

> Source : `README.md`, `package.json`, arborescence, `git log`. Code non audité, application non lancée.

## En bref

Studio web piloté au chat. On donne une instruction en français à un agent LLM, il produit un épisode
vidéo animé court (*What If*, format 15–25 s) et rend un mp4 masterisé.

Le moteur d'animation n'est pas ici : il vient du skill `what-if-animation`. L'app ajoute les projets,
la boucle d'agent, les outils typés, les portes d'approbation et les checkpoints git.

## Chaîne de production

| Étape | Ce qui se passe | Service |
|---|---|---|
| `source` | Transcription anglaise d'une vidéo YouTube/TikTok, propositions de narration française | API locale `nouveau` (:8005), Deepgram |
| script | L'agent condense en 50–60 mots dans `episode.json` | LLM |
| `voice` | Voix française + `words.json` (mots horodatés) | ElevenLabs v4 via `nouveau` (Fish en option) |
| `plan` / `shotlist` | `timeline.json`, découpage en plans | local |
| `stills` | Images clés, mesure de la zone d'encre, échec si plan vide | Modal (Remotion + Chromium) |
| `board` | Planche de contact, relue par l'agent et par un Reviewer indépendant (contexte vierge) | LLM vision |
| `sfx`, `mixcheck`, `motiongrid` | Optionnels | ElevenLabs |
| `render` | Vidéo | Modal |
| `master` | −14 LUFS, crêtes < −1 dBTP, `report.json` | local (`master.py`) |

## Architecture

```
navigateur ──► POST /api/threads/:id/messages
                    ▼
            orchestrateur ──► LLM (OpenAI-compatible, Anthropic, mock)
                    │            │ tool_calls
                    │            ▼
                    │      registre d'outils ──► projet (fichiers, git, scripts Python)
                    ▼
             SSE ◄── texte, outils, artefacts, approbations
```

| Dossier | Rôle |
|---|---|
| `src/orchestrator/` | HTTP + SSE (`main.ts`), boucle (`agent.ts`), contexte (`context.ts`), Reviewer, approbations, SQLite |
| `src/tools/` | Outils de l'agent : fichiers, shell en allowlist, git, `whatif_*` |
| `pipeline/` | Scripts Python/Node : rendu Modal, source, voix, sfx, shotlist |
| `web/public/` | UI : chat, minuteur, cartes d'outils, images/vidéos, réglages |
| `data/` | Ignoré par git : `app.db`, `projects/<id>` |

## Stack

- TypeScript, Node ≥ 22.5. Zéro dépendance runtime : `node:http`, `node:sqlite`, `fetch` natif.
- Python pour `pipeline/`. Docker (non-root, `127.0.0.1:3000`, `network_mode: host`).
- Lancement sans clé : `npm install && npm run build && WHATIF_PROVIDER=mock npm start`.

## État

- v0.1, privé. 24 commits du 2026-11-06 au 2026-11-09.
- Épisodes montrés dans le README : Crush, Möbius, Doubler une feuille de papier, Almost Muted, RDV.
- Par défaut (`WHATIF_APPROVALS=off`), l'agent enchaîne tout le pipeline sans validation. Chaque mutation
  prend un checkpoint git.
- Prochaines étapes du README : CLI + MCP, budgets, planches de trames, multi-utilisateur, reprise de run.

## À savoir

- **Skill absent sur ce poste** : `../what-if-animation` n'existe pas. Sans lui (ou `WHATIF_SKILL_DIR`),
  pas de `studio/` à copier : la création d'épisode ne peut pas fonctionner. Le mode `mock` reste utilisable.
- **Dépendances externes pour un vrai épisode** : `nouveau` sur :8005, compte Modal, clé LLM, clé ElevenLabs.
- **Shell = RCE par conception** (dixit README) : l'allowlist n'est pas un bac à sable. Conteneur et
  `127.0.0.1` obligatoires, `WHATIF_AUTH_TOKEN` si l'app est joignable d'ailleurs.
- **Écarts dans le README** : le cycle d'un épisode cite encore Fish pour `voice` alors que la section TTS
  annonce ElevenLabs v4 ; « 3 tests » annoncés, un seul fichier présent (`test/smoke.test.mjs`).

## Glossaire

- **Skill** : paquet d'instructions et de scripts réutilisable par un agent ; ici, il porte le moteur d'animation.
- **Modal** : plateforme d'exécution cloud à la demande, utilisée ici pour le rendu.
- **SSE** (Server-Sent Events) : flux serveur → navigateur en continu.
- **Still** : image fixe extraite d'un plan.
- **LUFS / dBTP** : unités de loudness perçue et de crête audio réelle.
- **RCE** (Remote Code Execution) : exécution de code arbitraire à distance.
