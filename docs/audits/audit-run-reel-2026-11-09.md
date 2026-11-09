# Audit de préparation au run réel et état des étapes E et F (2026-11-09)

**Palier P3** (agent, Reviewer, Docker, moteur). Point d'arrêt : implémentation terminée, tests locaux verts. La suite se fait sur la machine qui a Docker et les clés.

## 1. Verdict

- **Aucun bloquant connu ne reste dans le code.** Huit défauts qui auraient cassé ou faussé un run ont été trouvés et corrigés (§4).
- **Ce n'est pas une preuve que le run réel passera.** Aucun vrai LLM, Modal, serveur `:8005` ni build Docker n'a tourné ici (§6).
- La principale inconnue est le modèle : écrira-t-il du `shot()` correct et corrigera-t-il ce que le Reviewer signale ? Seul un vrai run le dira.

## 2. Où on en est

| Étape | État | Détail |
|---|---|---|
| E. Décors et catalogue | **fait, sauf promotion** | `rooms.tsx` : `place()`, 6 lieux + `blank`, 3 ambiances, 23 pièces, `definePiece`, pièce libre via `draw` |
| F. Langage déclaratif | **fait** | `shot.tsx` : `shot({ place, cam, people, duo, extra })`, cadrage automatique 16:9 et 9:16, tabourets, positions et poses fonctions du temps |
| Audit du run | **fait** | §4 |
| Tests sur l'autre machine | **à faire** | §7 |

**Écarts par rapport au plan, à arbitrer :**
- `Bedroom`, `Kitchen`, `Study` n'ont pas été transformés en gabarits. Le catalogue `place()` les remplace pour les nouveaux épisodes ; les anciens décors restent intacts pour les épisodes existants.
- **La promotion** (garder une pièce inventée par l'agent pour les épisodes suivants, outil `whatif_promote`) **n'est pas faite**. Choix : attendre de voir ce que l'agent invente vraiment lors d'un run.

**Critère E** (« un lieu absent construit sans toucher au moteur ») : atteint, laverie rendue avec une machine dessinée sur place (`engine-overlay/examples/places-shots.tsx`).

**Critère F** (expérience `crush`) : les 36 plans réécrits en `shot()` passent audit, images fixes et planches. `shots.tsx` passe de 50 523 octets (avec `shared.tsx`) à 8 551. **Pas une comparaison de qualité** : ces plans sont générés par mon script, sans les accessoires propres à l'histoire.

## 3. Construction d'un projet, étape par étape

| Étape | Vérifié comment | Résultat |
|---|---|---|
| `whatif_new` + calque moteur | simulation sur le skill public | OK |
| `source`, `voice` | **non exécutés** (services externes) | remplacés par des fichiers préparés |
| `plan` (vrai `plan.py`) | simulation | OK, 36 plans |
| `DIRECTOR.md`, `shots.tsx` par lots, `index.tsx` | simulation | OK, `tsc` 0 erreur |
| Audit des plans + test de plantage | simulation et noms volontairement faux | OK, messages exploitables |
| `stills` | simulation en rendu local | OK, 36 images. **Modal non testé** |
| `board` + planches de contact | simulation | OK, 5 planches |
| Reviewer → refus → correction → validation | simulation, LLM scripté | OK, 2 tours |
| `sfx` automatique | simulation, bibliothèque en cache | OK |
| `render` | simulation, **21 images seulement**, local | OK, 1080×1920 |
| `master` | **non exécuté** | script du skill, non modifié |

Simulation : vraie boucle `runTurn`, vrais outils et scripts du skill, seuls les LLM sont remplacés par un script. Elle vérifie aussi l'ordre des messages à chaque appel.

## 4. Défauts trouvés et corrigés

| # | Gravité | Défaut | Correction |
|---|---|---|---|
| 1 | bloquant | L'audit ne reconnaissait ni `act`, ni `<Duo>`, ni `shot()` : plans déclarés statiques ou sans personnage, `stills` refusé | `whatif.ts` : audit aligné |
| 2 | bloquant | Skill public : un épisode 9:16 ne remplissait que le haut du cadre | correctif `episode.tsx` dans le calque, sans effet sur les moteurs récents |
| 3 | bloquant | `docker-compose.yml` ne transmettait aucune variable `WHATIF_REVIEW*` : le Reviewer restait sur le modèle de l'agent | variables ajoutées |
| 4 | majeur | Réponse illisible du Reviewer annoncée « VALIDÉ » | « NON VÉRIFIÉ » + second essai |
| 5 | majeur | Un modèle sans vision faisait sauter le Reviewer en silence | repli sur le code seul, signalé ; budget de sortie 4 000 → 12 000 |
| 6 | majeur | L'agent pouvait ignorer un refus du Reviewer et lancer le rendu | `render` bloqué tant qu'un tour reste ; le dernier tour ne bloque jamais ; panne ou Reviewer coupé lèvent le blocage |
| 7 | majeur | Un message `user` pouvait s'intercaler entre deux résultats d'outils (rejet 400 des API de type OpenAI) | notes retenues jusqu'à la fin de l'étape |
| 8 | majeur | Une erreur en tête de `shots.tsx` (`cast`, `place`) était avalée et n'apparaissait qu'au rendu Modal | signalée par l'audit, avec la liste des noms valides |

**Aussi :** prompt contradictoire remplacé par une version `shot()` quand le moteur l'a (50,4 Ko contre 56 ; `makeLook` et `<Hero` n'y figurent plus) ; `node_modules` installé tout seul au premier `stills` si absent ; message de démarrage, mesures du Reviewer et `measure-episode.py` alignés ; digest porté à 23 000 caractères car il était tronqué.

## 5. Reviewer

- Tourne après chaque `board` réussi, 2 tours au maximum par tour de conversation.
- Reçoit jusqu'à 6 planches, le récit, `DIRECTOR.md`, le code et des mesures automatiques ; il connaît `shot()`.
- **Sans `WHATIF_REVIEW_MODEL`, il utilise le modèle Flash de l'agent** : à régler sur un modèle vision.
- **Jamais exécuté avec un vrai modèle.** La pertinence de ses remarques reste à juger.

## 6. Limites connues

- `shot()` n'a pas d'angle haut ou bas : caméra littérale ou plan écrit à la main.
- Le Reviewer demande une amorce floue environ un plan sur trois : l'agent doit penser à `focus` ou `extra`, sinon un refus est possible.
- En 9:16, un plan d'ensemble garde un plafond important.
- Le skill monté sur l'autre machine n'est pas connu d'ici. Les projets récents (4 662 à 4 750 lignes) suggèrent une version plus récente que le dépôt public (3 621). Le calque compile sur les quatre moteurs testés.
- Bruit sans conséquence dans les logs du conteneur : avertissements React `linearGradient`.

## 7. À faire sur l'autre machine

1. `git pull --ff-only`, puis `docker compose up --build`.
2. Dans `.env` : `WHATIF_REVIEW_MODEL` (modèle vision) et, si besoin, `WHATIF_REVIEW_PROVIDER`, `WHATIF_REVIEW_BASE_URL`, `WHATIF_REVIEW_API_KEY`.
3. **Pré-vol** : `docker compose exec studio node pipeline/preflight.mjs`. Il vérifie skill, calque, ffmpeg, Python, Modal, `:8005`, et fait un court appel à chaque modèle (avec image). Il ne rend rien.
4. Suivre `docs/feature-plans/protocole-run-reel.md`, d'abord sur un épisode court.
5. Me renvoyer : sortie du pré-vol, `out/<slug>/sheets/*.jpg`, `review.json`, sortie de `measure-episode.py`, anomalies.

**À reprendre ensuite :** corriger ce que le run révèle ; décider de la promotion ; réduire encore le prompt si besoin.

## 8. Validation

Exécuté dans cette session :

- `npm test` : **22/22**. `tsc` de l'application : 0 erreur.
- Mutations : **13 sur 13 détectées**, dont une après renforcement d'un test qui ne la voyait pas.
- Calque sur 4 moteurs réels : 0 erreur de type hors `Root` absent du bac à sable.
- Simulation complète sur 36 plans : voir §3.
- Noms volontairement faux (vêtement, lieu, action, meuble) : 4 erreurs signalées avec la liste des valeurs valides.
- Contrôle de mise en page sur scènes sombres : aucun faux « vide ».
- Pré-vol lancé ici en configuration vide : signale correctement ce qui manque.

La borne basse du cadrage (dernier ajustement de `shot.tsx`) a été contrôlée sur des rendus isolés, sans test automatique et sans relancer les 36 plans.

**Non exécuté :** LLM réels, Modal, `:8005`, ElevenLabs, build Docker, `master`, rendu complet d'un épisode.

## Glossaire

- **Calque moteur** : fichiers et correctifs de l'application appliqués sur le moteur copié depuis le skill.
- **Pré-vol** : script de vérification à lancer avant un run.
- **Mutation** : casser volontairement le code pour vérifier qu'un test échoue.
- **Planche de contact** : image regroupant 8 ou 9 plans.
- **Modèle vision** : modèle capable de lire des images.
