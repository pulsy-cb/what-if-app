# Plan — améliorer le visuel et le système

**Palier P3** (prompt + moteur + pipeline + base). **Validation Pulsy requise avant tout code.**
Sources : `docs/audits/audit-visuel-2026-11-09.md`, `docs/audits/recherche-skills-animation-2d-2026-11-09.md`.

## 1. Principe

Trois constats guident l'ordre :

1. Le skill d'origine demandait déjà profil, amorces, gros plans et contrôle strict. L'application l'a retiré : le plus gros gain est **gratuit** (lot 1).
2. Un modèle plus fort n'ajoute ni vue de dos, ni transition, ni changement de lieu : il faut le moteur (lots 4 à 6).
3. Sans mesure, on ne saura pas si ça progresse (lot 0).

Chaque lot est livrable seul et se valide sur le **même épisode de référence** : `crush`, plans S1 à S8, `GLM-5.3-Flash`, mêmes réglages.

## 2. Mesure de référence (à refaire après chaque lot)

Mesurée sur `crush` le 2026-11-09, script `docs/audits/` (comptages de motifs dans `shots.tsx`) :

| Indicateur | Valeur actuelle |
|---|---|
| Valeurs `yaw` écrites | 0 |
| Plans avec amorce floue (`blur16`, `Foreground`) | 0 / 36 |
| Lieux distincts | 1 (classe) sur 36 plans |
| Plans à 3 personnages ou plus | 4 / 36 |
| Appels d'outils en erreur | 112 / 501 |
| Zoom `camT` max | 2,02 |

Objectifs après lots 1 à 3 (hypothèses, à confirmer par la mesure) : `yaw` dans plus de la moitié des plans à personnage, amorce dans environ un tiers, erreurs d'outils sous 10 %.

## 3. Lots

### Lot 0 — Mesurer (petit)

| Fichier | Changement |
|---|---|
| `src/orchestrator/db.ts` | colonne `model` dans `project_runs` (migration `ALTER TABLE`) |
| `src/orchestrator/agent.ts` | écrire le modèle à la fin du tour |
| `scripts/measure-episode.py` (nouveau) | les 6 indicateurs du §2 sur un projet |

Risque : touche `app.db`. **Dump `pg_dump` non applicable (SQLite)** : copier `data/app.db` avant migration.
Réussite : une exécution de test enregistre son modèle.

### Lot 1 — Rendre au modèle le savoir du skill (petit, aucun changement du moteur)

| Fichier | Changement |
|---|---|
| `src/orchestrator/context.ts:111` | retirer l'interdiction de lire les références |
| `src/orchestrator/context.ts` (nouveau bloc système) | injecter `look.md` + `traps.md` du skill (12,6 Ko), condensés |
| `src/orchestrator/context.ts:58,115` | décors existants d'abord (`Classroom`, `Bedroom`…), `CustomRoom` seulement si le lieu manque |
| `src/orchestrator/context.ts:116-118` | table de zooms séparée 16:9 / 9:16, valeurs du skill (large 0,75–1,1, gros plan 3–4,5) |
| `src/orchestrator/context.ts:197-230` | 3 exemples au lieu d'un : profil, amorce (over-the-shoulder), groupe de 3 |
| `src/orchestrator/engine-digest.ts:37` | développer les champs de `Pose` (`yaw`, `facing`, `look`, `tilt`…) |
| `src/tools/whatif.ts:527,533` | plafond de zoom 3,0 → 4,5 |
| `src/tools/whatif.ts:461,617` | autoriser des plans sans personnage (plan de décor, objet) |
| `src/orchestrator/layout.ts:111,116` | ne plus imposer « centre x=960 » : accepter une composition décentrée volontaire |
| `src/tools/fs.ts` | `write_file` limité à `src/episodes/<slug>/` |

Point d'attention : le moteur en 9:16 n'affiche que 900 des 1 920 px de large (`engine/episode.tsx:12`). La table de zooms doit être calculée sur cette largeur, pas recopiée du skill.
Réussite : sur `crush` S1–S8, `yaw` présent, au moins 2 plans avec amorce, aucun fichier écrit hors de l'épisode.

### Lot 2 — Contrôle visuel qui voit vraiment (petit à moyen)

| Fichier | Changement |
|---|---|
| `src/orchestrator/agent.ts:365` | choisir les images à montrer par pertinence (plans modifiés), plus de tri alphabétique `S1,S10,S11` |
| étape `board` (`src/tools/whatif.ts`, `pipeline/`) | planches de 8 à 12 plans, lisibles à l'œil |
| `src/orchestrator/reviewer.ts:26-40` | remplacer les 5 critères par les 11 du skill (`look.md:59-81`) + orientation, lisibilité du lieu |
| `src/orchestrator/reviewer.ts` | un modèle vision fort, réglé séparément (`WHATIF_REVIEW_MODEL`) |

Réussite : le Reviewer produit un `review.json` sur `crush` (aucune trace dans les 14 projets aujourd'hui) avec au moins un défaut réel relevé.

### Lot 3 — Réutilisation des décors (moyen à gros) — **conception détaillée : `reutilisation-decors.md`**

Principe : on réutilise des **pièces** et des **gabarits paramétrés par des jetons d'épisode**, jamais une scène copiée. Un moteur de référence unique (aujourd'hui 4 copies divergentes, la plus récente : `crush`). **Commencer par l'expérience « classe ×4 + 1 lieu »** (§9 du document dédié).

Réussite : un nouvel épisode « cabine d'avion » s'assemble depuis le catalogue sans réécrire de décor ; deux épisodes en classe sont distincts mais du même univers.

### Lot 4 — ~~Transitions~~ **Abandonné** (décision Pulsy, 2026-11-09)

Non nécessaire. Les coupes sèches restent. Le risque de désynchronisation de la voix avec `TransitionSeries` n'a donc plus à être traité.

### Lot 5 — Vues du personnage (gros)

- `engine/rig.tsx` : têtes dessinées en face, 3/4, profil, dos, avec bascule sur clignement ou coupe (technique Moho/Character Animator), au lieu du visage compressé (`rig.tsx:513`).
- Corps pour les mêmes vues ; 3 ou 4 morphologies en données séparées du rendu.
- Bouches depuis `words.json` (pas Rhubarb : anglais seulement).
- Un personnage de dos ne doit pas coûter un appel de plus au modèle : `vue: 'dos'` dans la pose.

Réussite : feuille de personnages (`CastSheet`) avec 4 vues lisibles, puis un plan de dos dans `crush`.

### Lot 6 — Langage déclaratif (gros) — **commencer par une expérience**

Le modèle décrit scène, personnages, placement, vue, cadrage ; un compilateur TypeScript génère les plans (modèle : `animdsl`, MoVer, Code2Video).

**Expérience avant d'investir** : écrire à la main `crush` S1–S8 dans ce format, générer les plans, comparer à la version actuelle. Décision go/no-go sur le rendu.
Gain attendu : disparition des erreurs de fichiers et de placement, variété portée par le moteur, modèles Flash suffisants. Non démontré à ce stade.

## 4. Ordre recommandé

`0 → 1 → 2` (petits, à lancer ensemble) → mesure → `3` (expérience d'abord) → `5` → expérience `6`. (Lot 4 abandonné.)
Le test A/B GLM-5.3-Flash contre un modèle fort (service payant) se fait après le lot 1, pas avant : on veut voir ce que le modèle faible donne **avec** le bon prompt.

## 5. Hypothèses et risques

- Les gains du lot 1 sont plausibles (même modèle, `not-father` utilise `yaw` 66 fois), pas prouvés.
- Le skill vise 15–25 s et un héros ; l'application va jusqu'à 143 s et plusieurs personnages : copier le skill ne suffit pas.
- Un prompt plus long coûte du contexte (`WHATIF_CONTEXT_CHARS` 90 000) : condenser, mesurer.
- Les anciens épisodes gardent leur moteur : pas de migration automatique.

## 6. Décisions à prendre (Pulsy)

1. Valider le palier P3 et l'ordre ci-dessus ?
2. Lancer **lots 0 + 1 + 2 d'un coup**, ou lot par lot ?
3. « Centré sur les utilisateurs » = « sur les personnages » ?
4. Accord pour le test A/B payant (modèle fort) après le lot 1 ?

## Validation

Aucun code modifié, rien exécuté. Les fichiers et numéros de ligne viennent de la lecture du dépôt le 2026-11-09. Le fonctionnement de `whatif_new` / `whatif_sync_engine` n'a pas été lu en détail (lot 3).

**Fait** : ce plan. Aucun commit.

## Glossaire

- **Amorce** : élément flou au premier plan.
- **`yaw`** : orientation du corps, −1 profil gauche à +1 profil droit.
- **Déclaratif** : on décrit le résultat, le moteur le construit.
- **A/B** : même tâche avec deux variantes pour comparer.

---

# Avancement — 2026-11-09 : lots 0, 1, 2 réalisés (non commités)

**Palier P3.** Décision de Pulsy : validation par le Reviewer, pas de validation manuelle ; lot 4 abandonné.

## Fait

| Lot | Fichier | Changement |
|---|---|---|
| 0 | `src/orchestrator/db.ts` | colonne `project_runs.model` (migration `ALTER TABLE` idempotente) |
| 0 | `src/orchestrator/agent.ts` | le modèle est enregistré à chaque tour |
| 0 | `scripts/measure-episode.py` (nouveau) | mesure de variété sur un épisode (orientation, amorces, groupes, zooms, rythme, erreurs d'outils) |
| 1 | `src/orchestrator/director-guide.ts` (nouveau) | guide du réalisateur, injecté comme message système (7,2 Ko) |
| 1 | `src/orchestrator/context.ts` | décors existants d'abord (jamais copiés d'un autre épisode) ; interdiction de lecture levée (une lecture ciblée) ; zooms par format ; 2 nouveaux exemples (amorce floue en profil, groupe étagé) |
| 1 | `src/orchestrator/engine-digest.ts` | corps de `Pose`, `Limb`, `Expr`, `ActKind`, `HandKind` ; plafond 11 500 → 14 000 |
| 1 | `src/tools/whatif.ts` | zoom 0,6–4,5 ; plan « establishing » / « empty » / « detail » sans personnage ; 30 % minimum de plans avec personnage (45 % avant) |
| 1 | `src/orchestrator/layout.ts` | messages : cadrage décentré accepté (seuils inchangés) |
| 1 | `src/tools/fs.ts` | **liste d'autorisés** : `src/episodes/`, notes racine, `out/` ; `WHATIF_ALLOW_ENGINE_WRITES=1` ouvre le moteur |
| 2 | `pipeline/board_sheets.py` (nouveau) + `src/tools/whatif.ts` | planches de contact de 8 (9:16) ou 9 (16:9) plans, générées après `board` |
| 2 | `src/orchestrator/image-pick.ts` (nouveau) + `agent.ts` | l'agent revoit les plans re-rendus, sinon les planches, sinon un échantillon régulier (plus `S1, S10, S11`) |
| 2 | `src/orchestrator/reviewer.ts` | lit jusqu'à 6 planches ; 9 critères (+ mise en scène, lisibilité du lieu, 9:16, cohérence) ; reçoit des mesures du code ; 8 remarques max |
| — | `test/smoke.test.mjs`, `README.md` | 6 nouveaux tests ; documentation |

## Validation (commandes réellement exécutées)

| Vérification | Résultat |
|---|---|
| `tsc --noEmit` | **0 erreur** (0 avant) |
| `npm test` | **12/12** (6/6 avant) |
| Mutations (correctif cassé → test rouge) | **8/8 confirmées** : allowlist, plan sans personnage, zoom 4,5, digest de `Pose`, migration, guide injecté, `pickImages`, lecture des planches |
| Exemples du prompt | compilés avec `tsc` **et rendus** avec Remotion en local (stills 9:16) |
| `board_sheets.py` | exécuté sur 11 stills factices (Pillow 12) : 2 planches, accents corrects |
| Taille du prompt système | 40,6 Ko → **51,6 Ko** (budget 90 Ko) |

Fixture modifiée : le test « tools » éditait `a.ts` à la racine ; déplacé sous `src/episodes/e/` (politique d'écriture), assertions inchangées.

## Mesure de référence (avant les lots) — `docs/audits/mesure-reference-2026-11-09.txt`

| | crush | not-father | poudre |
|---|---|---|---|
| plans orientés (non frontaux) | 2/36 | 31/36 | 0/22 |
| valeurs `yaw` écrites | 0 | 66 | 0 |
| plans avec amorce floue | 0 | 0 | 0 |
| erreurs d'outils | 112/501 | 47/226 | 32/146 |
| modèle enregistré | non | non | non |

`crush` et `poudre` (GLM-5.3-Flash) n'orientent presque rien ; `not-father` (même modèle) oriente beaucoup : le prompt, pas le modèle, décide.

## Découvertes du rendu local (nouvelles, à intégrer à la suite)

1. **Le cadre 9:16 montre un tiers de plafond ou de sol vide.** Constaté sur deux stills réelles : les décors sont dessinés pour le 16:9 et n'occupent qu'une bande au milieu. C'est une limite du **moteur** (lot 3/5), pas du modèle. Le guide recommande des mediums et `cy` 600–680 en attendant.
2. **`yaw` 0,85 ne donne pas un vrai profil** : le corps reste de face, seul le visage glisse. Confirme que les vues du personnage (lot 5) sont nécessaires.
3. **Le contrôle d'encre (`layout.ts`) ne détecte quasiment rien** : le grain et la vignette remplissent toute l'image. Un vrai contrôle passe par le Reviewer ou des assertions sur le code (piste MoVer).
4. Remotion **rend en local** (Chrome téléchargé au premier rendu) : on peut valider les stills sans Modal.

## Simulation reviewer (P3 : approfondie)

| Remarque prévisible | Détectable ? | Sort |
|---|---|---|
| « +27 % de prompt : mesuré ? » | oui | mesuré (51,6 Ko / 90 Ko) ; historique réduit d'autant, à surveiller |
| « L'allowlist peut bloquer une correction légitime du moteur » | oui | interrupteur `WHATIF_ALLOW_ENGINE_WRITES=1` documenté |
| « Les anciens épisodes gardent l'ancien moteur » | oui | inchangé, assumé |
| « Aucun run réel avec un LLM » | oui | **non exécuté** (service payant) ; voir ci-dessous |
| « `board_sheets.py` n'a pas tourné dans `whatif_run` » | oui | **non vérifié de bout en bout** : testé seul et en tests unitaires, pas via Modal |
| « Pillow sans police accentuée dans Docker » | oui | repli sans accents prévu ; paquet `fonts-dejavu-core` à ajouter au `Dockerfile` si on veut les accents (non fait) |
| « Le Reviewer par défaut est le modèle Flash » | oui | à régler : `WHATIF_REVIEW_MODEL` (vision solide). Sans cela la validation par le Reviewer reste faible |

## À surveiller / actions Pulsy

- **Commit proposé** (non fait) : `feat(director): director guide, readable board sheets, stricter write policy, per-run model` + `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Fichiers à nommer un par un : les 9 modifiés + `pipeline/board_sheets.py`, `scripts/measure-episode.py`, `src/orchestrator/director-guide.ts`, `src/orchestrator/image-pick.ts`.
- **Redémarrer le serveur / rebuild l'image** pour que l'agent utilise le nouveau code. `data/app.db` sera migré au démarrage ; sauvegarde faite : `data/app.db.bak-2026-11-09`.
- **Régler le modèle du Reviewer** (`⚙` ou `WHATIF_REVIEW_MODEL`) : c'est lui qui remplace la validation manuelle.
- **Prochain test réel** : rejouer `crush` S1–S8 avec GLM-5.3-Flash et `measure-episode.py` (service payant : à ton accord).

## Prochaine étape

Lot 3 : **l'expérience « classe ×4 + 1 lieu »** de `reutilisation-decors.md` §9, en tenant compte de la découverte n°1 (bande 16:9 dans un cadre 9:16). Je peux la lancer dès maintenant : elle se rend en local, sans service payant.

---

# Avancement — lot 3 (2026-11-09, suite) : gabarit de décor + calque moteur

Détail, rendus et écarts : `reutilisation-decors.md` (section « Résultat de l'expérience »).
**Fait** : gabarit `Classroom` (jetons + slots), pièces `WallBoard`/`PinBoard`, correctif du sol 9:16, calque `engine-overlay/` appliqué par `whatif_new` et `whatif_sync_engine`. **Validation** : `tsc` 0, tests 14/14, 4 mutations, 3 moteurs réels sans erreur dans `src/engine/`, 5 scènes rendues.
**À faire ensuite** : gabarits pour `Bedroom`/`Kitchen`/`Study`, lot 5 (vues du personnage), run réel LLM pour mesurer.

---

# Avancement — lot 5 (2026-11-09) : vues du personnage

**Palier P3.** Rendus locaux (Remotion) : `docs/screenshots/lot5/` (local, non versionné) — `scenes-avant-apres.png`, `tetes-H0/H1/H2.png`.

## Fait
| Fichier | Changement |
|---|---|
| `engine-overlay/files/src/engine/views.tsx` (nouveau, 391 lignes) | têtes de **profil** et de **dos** pour les 12 coiffures (`bob`, `spiky`, `curls`, `bunches`, `ponytail`, `afro`, `cap`, `beanie`, `helmet`, `suit`, `bald`, `hood` + défaut) et les accessoires (lunettes, casque, micro, barbe, moustache) ; **nez** au 3/4 ; **dos de veste** sans col ni fermeture ; types minimaux propres (compile sur tous les moteurs) |
| `src/tools/engine-overlay.ts` | correctifs **groupés et atomiques** (tout ou rien par fichier, comptage exact des occurrences) ; correctif de `rig.tsx` (6 opérations) ; exports `pieces` et `views` séparés |
| `src/orchestrator/director-guide.ts` | `yaw` expliqué comme une **boussole** : 0 face · ±0,45 3/4 · ±1 profil · ±2 dos |
| `engine-overlay/README.md`, `examples/views-sheet.tsx` | doc et planche de référence |

`yaw` devient une boussole : 0 de face, ±0,45 trois-quarts (un nez apparaît), ±1 profil dessiné (nez, oreille, un œil), ±2 de dos (cheveux ou chapeau seulement). Le moteur change de dessin à 0,2, 0,72 et 1,3 : une rotation se lit mieux sur une coupe ou un clignement que glissée.

## Résultats visuels
- **Avant/après sur la même classe** : tous de face → prof **de dos** au tableau + deux élèves en 3/4 face à face.
- `walkPose` (yaw 0,85) donne maintenant de **vrais profils**.
- 12 coiffures × 6 orientations rendues et relues : les 4 vues tiennent pour toutes ; défauts relevés puis corrigés (nez trop haut, trait parasite sous le nez, oreille qui ressemblait à un œil, mèche parasite du costume vu de dos, épaule décalée en vue de dos).

## Validation
| Vérification | Résultat |
|---|---|
| `tsc` | **0 erreur** |
| `npm test` | **14/14** |
| Mutations | 7 détectées (comptage d'occurrences, patch partiel, décalage d'épaule, export `views`, guide) ; 2 premières mutations non compilables refaites |
| **Vue de face vs ancien `rig.tsx`** | **0 pixel de différence** sur 12 personnages ; 3/4 : ~250 pixels (le nez) |
| Calque sur 4 moteurs réels (3 621 / 4 662 / 4 744 / 4 750 lignes) | **0 erreur `tsc` dans `src/engine/`** ; `rig.tsx` patché sur les 3 récents ; **ignoré proprement sur le plus ancien** (structure de tête différente) |

## Limites et écarts
- **Changement de comportement** : avec le calque, tout `yaw` ≥ 0,72 (et `walkPose`) dessine un vrai profil au lieu d'un visage glissé. Les épisodes existants changent d'aspect **seulement si** le calque est appliqué à leur projet (rien n'a été appliqué à `data/projects/`).
- Le plus ancien moteur (`math-teacher`, 3 621 lignes) garde l'ancien comportement.
- Le **corps** n'a pas de vues propres : en profil, jambes et bras gardent leur dessin (acceptable, mais les pieds ne sont pas dessinés « de dos »). Pas de 3 ou 4 morphologies (hors périmètre de ce lot).
- Le changement de vue est un **saut** aux seuils, pas un fondu.
- `tie`, `scarf`, `badge` (accessoires du torse) ne sont pas adaptés au profil.
- Non vérifié : aucun run LLM ; l'agent utilisera-t-il vraiment `yaw` 2 ? À mesurer avec `scripts/measure-episode.py` (indicateur « plans orientés »).

## À faire par Pulsy
Commit (non fait) : `feat(engine): character views (profile, three-quarter, back) + overlay patch groups`. Fichiers nommés un par un : `engine-overlay/`, `src/tools/engine-overlay.ts`, `src/orchestrator/director-guide.ts`, `test/smoke.test.mjs`, et les fichiers des lots précédents. **Ne pas commiter `docs/screenshots/`.**
Pour l'appliquer à un projet existant : `whatif_sync_engine { apply: true }` sur ce projet.
