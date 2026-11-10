# Rythme, cohérence récit-action, temps et visuel (2026-11-10)

**Palier P2** : moteur, outils, découpage, Reviewer, prompt. La validation vient de la demande de Pulsy du 2026-11-10 : appliquer l'audit `docs/audits/audit-runs-2026-11-10.md` dans l'ordre proposé.

**Décisions de Pulsy :**
- vidéos longues : un plan toutes les 3 à 6 s ;
- shorts : plus de rythme ;
- ordre des chantiers : celui de l'audit (priorités 1 → 4).

## 1. Ce qui change pour l'agent

| Avant | Maintenant |
|---|---|
| une action en boucle par personnage et par plan | `beats: [{ at, act, face, yaw, look, reach }]` : plusieurs temps dans un plan |
| le texte du plan, sans le moment de chaque mot | le prompt donne `mot@image` pour chaque plan à écrire, et le retour du Reviewer le donne pour les plans à corriger |
| gestes génériques seulement | `look` (se tourner vers quelqu'un), `reach` (la main vers une personne, avec `part` tête, buste ou main ; vers un meuble ; vers un point) |
| caméra : une taille par plan, poussée lente | caméra par temps : recadrage sur un mot (`cam`), passage à l'autre personne (`on`), secousse (`shake`) |
| rien n'obligeait un plan à jouer | l'audit refuse la planche si plus d'un plan sur cinq avec personnages ne change rien |
| corriger un plan = relire `shots.tsx` pour le citer | `edit_shot { episode, id, code }` remplace le plan entier |
| la durée et la taille des plans étaient à relire dans `timeline.json` | elles sont toujours dans le prompt |

## 2. Cadence

| Durée de la vidéo | Avant | Maintenant |
|---|---|---|
| ≤ 28 s | ~1,6 s par plan | inchangé |
| ≤ 2 min 30 | ~3,2 s (36 plans max) | **~2,4 s** ; contrôle : ≥ 20 coupes/min, aucun plan > 5 s |
| > 2 min 30 | ~3,2 s, **plafond 36 plans** | **~4,5 s, sans plafond** ; contrôle : ≥ 10 coupes/min, aucun plan > 9 s |

**Le contrôle de cadence bloque désormais `stills` et `board`.** Avant, `plan` signalait l'erreur mais rien n'empêchait de continuer.

**Découpage d'une vidéo longue accéléré.** La recherche est bornée aux plans de durée plausible : 214 plans en 39 s, au lieu de plus de 6 min sans finir. Coupes identiques à l'ancien calcul sur `jumeau-2`.

**Mesuré sur les vrais épisodes :**

| Épisode | Avant | Maintenant |
|---|---|---|
| `jumeau-2` (89 s) | 28 plans, médiane 3,2 s | **37 plans, médiane 2,3 s** |
| `y-school` (16 min) | 36 plans, médiane 26,8 s | **214 plans, médiane 4,5 s**, le plus long 7,0 s |

## 3. Temps

- **Coupe-circuit** : `render` ou `master` qui échoue 2 fois pour la même cause (3 fois pour `stills`) arrête le tour, même si des lectures réussies sont intercalées. C'est ce qui a coûté 540 min à `y-school`.
- `edit_shot`, plus les durées et tailles de plans toujours présentes dans le prompt, doivent réduire les relectures (36 et 66 par épisode jusqu'ici).
- Rendu par morceaux (commit `4264402`) : **à mesurer sur un short**.

## 4. Visuel (premier lot)

- **Murs** : la texture « nuageuse » est atténuée à 30 %, et les coins sombres sont gardés.
- **Plan moyen et gros plan** : le décor passe en flou léger (moyen) ou fort (gros plan), et la profondeur nette est celle du personnage cadré. `background: 'sharp'` le désactive, par exemple pour lire un tableau.

**Reste à faire :**
- contrechamp (vue du mur opposé) ;
- catalogue d'extérieurs et de lieux (salon, hôpital, rue, parc) ;
- personnage assis vu de face ou de trois-quarts, qui se lit encore comme debout ;
- vrais angles haut et bas ;
- écart automatique des visages en gros plan.

## 5. Fichiers

**Moteur (calque) :**
- `engine-overlay/files/src/engine/stage.tsx` : `beats` et `reach` dans `Staged` ;
- `engine-overlay/files/src/engine/shot.tsx` : beats de personnes et de caméra, `look`, `reach`, fond flou ;
- `engine-overlay/files/src/engine/rooms.tsx` : `pointOf`, murs adoucis.

**Application :**
- `src/tools/whatif.ts` : `timedChanges`, `paceTarget`, `paceProblem`, règle de rythme, cadence bloquante ;
- `src/tools/fs.ts` : `edit_shot`, `replaceShot` ;
- `src/orchestrator/context.ts` : `shotWordFrames`, durées des plans dans le prompt ;
- `src/orchestrator/reviewer.ts` : plans figés, durées, mots dans le retour ;
- `src/orchestrator/agent.ts` : coupe-circuit, mots dans le retour du Reviewer ;
- `src/orchestrator/director-guide.ts` : guide `shot()` (temps, rythme, `edit_shot`).

**Découpage, tests, exemples :**
- `pipeline/shotlist.py` : cadence, sans plafond, recherche bornée ;
- `test/smoke.test.mjs` : 4 tests nouveaux, 2 adaptés ;
- `src/tools/engine-overlay.ts` : fichiers cachés exclus du calque ;
- `engine-overlay/examples/places-shots.tsx` : exemple `SBeats`.

## Validation

- `npm test` **26/26**. `tsc` de l'application : 0 erreur. Calque compilé sur 4 moteurs : 0 erreur.
- Mutations : **9 sur 9 détectées** (8 + la copie des `.DS_Store`).
- Découpage + `plan.py` réels sur `jumeau-2` et `y-school` : cadence OK (§2).
- Rendus locaux :
  - un plan à six instants : main vers l'autre personne, recadrage, sursaut, secousse ;
  - murs et fond flou, avant/après.
- Simulation de bout en bout : voir §6.

**Non exécuté :** vrai LLM, Modal, mesure du temps total d'un short.

## 6. Simulation de bout en bout

Vraie boucle agent, vrais outils et scripts du skill public ; LLM et Reviewer scriptés ; épisode de `crush` (118 s).

| Étape | Résultat |
|---|---|
| `plan` | **refusé** : 36 plans trop lents pour un short de 118 s (nouvelle cadence) |
| `shotlist` puis `plan` | **49 plans**, accepté |
| `shots.tsx` en 2 lots, avec temps, regard, main et recadrage | `tsc` 0 erreur, audit OK |
| `stills` (49) et `board` | OK |
| Reviewer | refus de S2 ; `render` bloqué |
| `edit_shot` S2, `stills` S2 S3, `board` | OK |
| Reviewer | validé |
| `render` (21 images, local) | OK |

Mesure transmise au Reviewer : « 0 plans avec personnages où rien ne change pendant le plan ».

**Corrigé au passage :** le calque copiait le `.DS_Store` de macOS dans les projets. Les fichiers cachés sont maintenant exclus, avec un test.

## 7. Commit proposé (à faire par Pulsy ou sur demande)

`feat(rhythm): word-timed beats, look and reach in shot(), pace by length, edit_shot, stop on repeated render failures, softer walls and close-up focus`

Fichiers : ceux du §5, plus `src/tools/engine-overlay.ts`, cette note et `docs/context-state.md`.
