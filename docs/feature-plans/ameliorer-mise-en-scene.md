# Améliorer la mise en scène sans génération d'image (2026-11-12)

**Palier** P2 (prompt de l'agent, outils, moteur, Reviewer). **Plan à valider par Pulsy avant code.**

Demande : mettre la génération d'image de côté et voir comment améliorer vraiment ce qui se fait aujourd'hui.

## 1. Où ça coince, mesuré sur `prof` (30 plans, 9:16)

| Constat | Chiffre |
|---|---|
| La shotlist ne décrit aucune mise en scène | chaque plan = une taille + un bout de texte de la voix (`"note": "L'élève accepte soulagée"`) |
| La note de réalisation est globale | 3 272 caractères pour 30 plans, aucune ligne par plan |
| Les gestes sont pauvres | sur 77 gestes : `idle` 26, `explain` 16, `point` 9. Trois gestes font les deux tiers |
| Les visages aussi | `neutral` 31, `smug` 18 sur 84 |
| Aucun objet posé ni tenu par un personnage | `props` 0, `extra` 0. Le sac, le combiné, le téléphone n'existent que dans 3 inserts |
| Aucun mouvement de caméra choisi | `move` 0 |
| Des directions demandées sont infaisables | « contre-plongées » écrites dans DIRECTOR.md, le moteur n'en a pas |
| Le plan large vertical est vide | un tiers de plafond, un tiers de sol |

**Lecture :** l'agent passe directement de « une phrase de la voix » à « 5 réglages de `shot()` ». Il n'y a aucune étape où quelqu'un décide ce qu'on voit. Et quand il voudrait montrer une action précise, le moteur n'a pas le mot pour la dire.

L'essai d'images a servi à une chose : il montre la cible. « La prof retourne le sac sur le pupitre » ou « la prof au premier plan, combiné à l'oreille, Maya petite au fond » sont de vraies mises en scène, dans notre style, que la chaîne ne produit jamais.

## 2. Ce que je propose, par ordre d'effet

### Étape 1 — Une direction écrite par plan (le plus gros levier)

Avant tout code de plan, l'agent remplit pour **chaque** plan une fiche courte, dans `episode.json` :

```
S14  quoi    : la prof retourne le sac de Maya sur le pupitre, rien n'en tombe d'utile
     qui/où  : PROF debout à gauche de d2, MAYA assise sur d2
     action  : PROF tient le sac à l'envers ; MAYA bras croisés
     objets  : sac (tenu par PROF), 3 crayons + gomme (sur d2)
     cadre   : medium-wide, sujet = le sac
     change  : par rapport à S13, la prof s'est rapprochée
```

- Un contrôle refuse la planche si une fiche manque, ou si deux plans de suite ont la même fiche (même cadre, mêmes gestes).
- Le code du plan doit ensuite suivre la fiche. Le Reviewer compare l'image **à la fiche**, plus seulement au texte de la voix.
- `DIRECTOR.md` garde le global (lieu, casting, palette) et devient plus court.

Coût : une étape de réflexion en plus par épisode, mais elle remplace des allers-retours avec le Reviewer.

### Étape 2 — Refuser ce que le moteur ne sait pas faire

Une fiche qui demande une contre-plongée, un personnage de dos ou un geste inconnu est refusée tout de suite, avec la liste de ce qui existe. Aujourd'hui la direction disparaît sans bruit.

### Étape 3 — Donner au moteur les mots qui manquent

D'après ce que les histoires demandent et ce que les images ont montré :

1. **Objet tenu** : `hold: <objet>` sur une personne (sac, combiné, téléphone, feuille, tasse). Aujourd'hui `hold` existe comme geste, sans objet.
2. **Se pencher** : `lean` vers une pièce ou une personne (la prof sur le pupitre).
3. **Regard** : `look: <personne ou pièce>`. Utilisé 0 fois sur `prof` ; à vérifier s'il existe déjà et n'est pas documenté.
4. **Profondeur** : un cadre « premier plan / arrière-plan » (une personne grande devant, une petite au fond), en un mot de `cam`.
5. **Plan large vertical** : recadrer pour remplir la hauteur (mur jusqu'en haut, sol réduit).
6. **Petite bibliothèque d'objets** : sac, combiné mural, feuille froissée, crayons, tasse, clés. À poser avec `props` (déjà codé, jamais rendu).

### Étape 4 — Mesures de variété envoyées au Reviewer et à l'agent

Déjà fait pour le geste répété. À ajouter : part de `idle`, part de `neutral`, nombre de plans sans objet alors que la fiche en cite un, suites de plans au même cadre.

### Étape 5 — Vérifier sur un vrai épisode

Refaire `prof` avec le même script et la même voix, puis comparer avant/après : répartition des gestes, nombre d'objets à l'image, refus du Reviewer, durée. C'est le seul vrai test. Il demande un LLM et donc ton accord.

## 3. Ordre et taille

| Étape | Fichiers principaux | Taille |
|---|---|---|
| 1. Fiche par plan | `pipeline/shotlist.py`, `src/tools/whatif.ts`, `src/orchestrator/director-guide.ts`, `reviewer.ts` | moyenne |
| 2. Refus de l'infaisable | `src/tools/whatif.ts` | petite |
| 3. Moteur | `engine-overlay/files/src/engine/{shot,actions,rooms}.tsx`, nouveau fichier d'objets | grande, découpable (5 d'abord, puis 1, 2, 4, 6) |
| 4. Mesures | `reviewer.ts`, `whatif.ts` | petite |
| 5. Essai réel | aucun code | 30 min de LLM |

Je recommande 1 → 2 → 3.5 → 3.1 → 5, puis le reste selon ce que l'essai montre.

## 4. Fait le 2026-11-12 (validé par Pulsy : ordre recommandé, plus la marche sur place, essai avec Codex)

**Correction d'une erreur de ma part.** J'avais écrit que le moteur n'avait pas d'angle de caméra. C'est faux : `angle: 'low' | 'high'`, `look`, `reach`, `handLProp` / `handRProp` et `props` existent déjà. Sur `prof`, l'agent ne s'en sert presque pas. Le manque est donc surtout de direction, moins de moteur. L'étape 2 a changé en conséquence : au lieu de refuser « l'infaisable », l'audit vérifie que **le code fait ce que la fiche dit**.

| Point | Où | Résultat |
|---|---|---|
| Fiche par plan | `src/tools/staging.ts` (nouveau), outil `stage_shots` | L'agent écrit pour chaque plan : `see` (ce qu'on voit), `people` (qui, où, fait quoi), `objects`, `angle`, `moves`, `change`. Enregistré dans `episode.json` |
| Contrôle des fiches | idem, `stagingProblems` | Refuse : fiche manquante, phrase trop courte ou copie de la voix, action vague, plan vide, deux voisins identiques, la même action dans plus d'un tiers des plans d'un personnage |
| Le code suit la fiche | idem, `stagingCodeProblems`, branché dans `shotsAudit` (`whatif.ts`) | Refuse avant `stills` : personnage de la fiche absent du code, objet cité non dessiné, angle non réglé, déplacement annoncé sans `walkTo` |
| Marche sur place | `stagingCodeProblems` + `shot.tsx` | `act: 'walk'` avec une place fixe est refusé. Nouveau `walkTo: { u, w }` : la personne va de `at` à `walkTo`, se tourne dans le sens de la marche et s'arrête à l'arrivée |
| Objet tenu | `engine-overlay/files/src/engine/objects.tsx` (nouveau), `shot.tsx` | `hold: 'bag'` : phone, handset, bag, paper, crumpled, cup, keys, book, pen, folder, box. `held('paper')` pour le poser sur un meuble avec `props` |
| Plan d'ensemble vertical | `shot.tsx` (`frameOn`) | En 9:16, zoom 0,85 → 1,4 : la salle remplit la hauteur (avant : un tiers de plafond, un tiers de sol) |
| Shotlist | `pipeline/shotlist.py` | Chaque plan reçoit `"stage": null`. Les épisodes d'avant, sans cette clé, ne sont pas concernés |
| Reviewer | `reviewer.ts` | Reçoit les fiches et juge l'image contre sa fiche (nouveau point 0 de sa consigne) |
| Guide de l'agent | `director-guide.ts`, `context.ts` | Section « Staging cards first », `walkTo`, `hold`, étape `stage_shots` dans la chaîne |

**Non fait dans ce lot :** se pencher (`lean`), cadre premier plan / arrière-plan en un mot, mesures de variété supplémentaires. Le plan large vertical **avec personnages** garde du sol vide : le cadre y est limité par la largeur du groupe, il faut de la profondeur dans la mise en scène pour le remplir.

## 5. Essai réel avec Codex (gpt-6.1-terra, agent et Reviewer), 2026-11-12

Copie de `prof` dans un dossier d'essai hors du dépôt, les 30 plans supprimés, même script, mêmes mots, même `shared.tsx`. L'agent devait écrire les fiches, recoder les plans, faire `stills` et `board`. Le projet d'origine n'a pas été touché.

**Durée : 15 min** pour 30 fiches, 30 plans, vignettes, planche et 2 tours de revue.

| Mesure (30 plans) | Avant | Après |
|---|---|---|
| `idle` | 26 | 4 |
| `explain` | 16 | 0 |
| Gestes les plus fréquents | idle, explain, point | cross-arms 12, think 11, point 11, nod 9 |
| Objet tenu (`hold`) | 0 | 4 |
| Objet posé (`props`) | 0 | 2 |
| Déplacement réel (`walkTo`) | 0 | 2 |
| Angle de caméra | 1 | 3 |
| Main vers quelque chose (`reach`) | 1 | 3 |
| Verdict du Reviewer au dernier tour | — | refusé, 4 défauts |

**À l'image (12 vignettes regardées) :** on voit maintenant la feuille froissée dans la main de la prof, le sac au pied du pupitre, le combiné saisi sur le bureau, la porte qui s'ouvre, le téléphone en insert. Les plans se distinguent mieux les uns des autres.

**Ce qui reste faible :**
1. **Les fiches sont au minimum.** L'agent écrit des phrases courtes (« Maya acquiesce et change d'expression. »). Le seuil de `see` est passé de 30 à 50 caractères après l'essai ; c'est un garde-fou, pas une garantie de mise en scène.
2. **Trois gestes dominent encore** (cross-arms, think, point : 34 sur environ 60). Mieux qu'avant, pas encore varié.
3. **Les 4 défauts refusés sont justes** : main de la prof dans le vide au lieu de toucher le pupitre (S4), sac coupé par le cadre (S12), fouille du sac non montrée (S14), principale cachée par la porte (S20).
4. **Le bas de l'image reste vide** dans les plans larges avec personnages.
5. **Une forme blanche sous le buste de la prof** dans plusieurs plans (S1, S10, S17, S22) : probablement la main du bras caché. Non analysé, à vérifier sur l'épisode d'origine.
6. L'agent a lancé `voice` et `render` malgré la consigne ; les deux ont été refusés (serveur de voix absent, planche périmée).
7. 33 retours en erreur sur 123 appels d'outil, dont 13 commandes shell refusées et 7 lots de fiches comptés à tort comme erreurs. Ce dernier point est corrigé : un lot partiel répond maintenant « N plans restants » sans erreur.

**Lecture :** la fiche par plan change réellement ce que l'agent code (objets, déplacements, moins de plans inertes), en un quart d'heure. Elle ne suffit pas à elle seule pour une mise en scène riche : les prochains leviers sont dans le moteur (toucher un meuble, fouiller un sac, se pencher, profondeur) et dans des fiches plus exigeantes.

Images locales : `docs/screenshots/mise-en-scene/prof-apres-codex-12-plans.jpg`, `prof-apres-codex-planche.jpg`.

## 6. Suite proposée

1. Moteur : `lean` (se pencher sur un meuble, main posée dessus), sac ouvert / fouille, ordre d'affichage de la porte devant une personne qui entre.
2. Cadre vertical à deux profondeurs (une personne grande devant, une petite derrière) pour remplir le bas de l'image.
3. Fiches : demander le sujet principal du cadre et refuser les verbes d'état (« réagit », « change d'expression »).
4. Vérifier la forme blanche sous le buste.
5. Relancer un épisode complet neuf (pas une copie) pour mesurer la durée totale avec l'étape des fiches.

## 7. Lot 2, fait le 2026-11-12 (demande de Pulsy : points 1, 2, 3, avec des gestes ouverts et du sur-mesure)

**Palier** P2, validé par Pulsy. **Non commité.**

### Gestes ouverts : on peut en créer, par épisode ou sur un plan

Un geste n'est qu'une suite de valeurs dans le temps. L'agent n'est donc plus limité à la liste.

```tsx
// dans shared.tsx : un geste réutilisable
const SALUTE = defineAction('salute', { dur: 10, armR: { a: [[0, 14], [1, 128]], b: [[0, 10], [1, 118]] }, headTilt: -4 });
// dans un plan
{ who: PROF, act: SALUTE }
// ou directement sur la personne, pour un geste unique
{ who: PROF, act: { loop: true, dur: 16, armR: { a: [[0, 150], [0.5, 120], [1, 150]], b: 20 } } }
```

- Une valeur est un nombre, ou des clés `[[p, valeur], …]` avec `p` de 0 à 1 sur la durée du geste.
- Bras et jambes : `a` = angle depuis l'épaule ou la hanche (0 pend, 90 vers l'avant, 140 en l'air), `b` = pli du coude ou du genou. Aussi : `tilt` (buste penché), `headTilt`, `squash`, `lift`, `look`, `talk`, `expr`, `stance`.
- `loop: true` répète (un geste) ; sans, l'action se joue une fois et tient sa fin (un clip).
- Une forme fausse est refusée avec la liste des champs. Un nom inconnu répond avec l'exemple à écrire.

**Cinq gestes ajoutés avec ce même outil** (ils servent aussi d'exemples) : `lean` (se pencher, une main posée), `rummage` (fouiller un sac, un tiroir), `slam` (main à plat sur la table), `give` (tendre quelque chose), `read`. Synonymes : `lean-on`, `search`, `dig`, `hand`, `offer`, `bang`.

### Dessin libre derrière les personnages

`behind: (t) => <g>…</g>` dessine sur le décor, derrière tout le monde. C'est la réponse au défaut S20 de l'essai : l'agent avait dessiné la porte dans `extra`, qui passe **devant** les personnages, et elle cachait la principale. `extra` reste pour le premier plan.

### Cadre à deux profondeurs

`cam: 'deep'` : la personne la plus proche est grande dans la moitié basse, les autres petites derrière. Le cadre peut couper la personne proche au bord, comme par-dessus une épaule. C'est le moyen de remplir une image verticale.

Limite : il faut placer la personne proche à environ 0,2 de large de l'autre. Trop près, elle la cache ; trop loin, il reste du sol en bas. C'est écrit dans le guide.

### Fiches plus exigeantes

- Nouveau champ obligatoire `subject` : la chose que l'œil regarde dans ce plan.
- Un verbe qui ne dessine rien est refusé quand il est seul ou presque : « réagit », « regarde », « change d'expression », « écoute », « attend », « listens »… Le même verbe avec un comment passe (« regarde le sac en se penchant sur le pupitre »).
- Le Reviewer voit le sujet dans la fiche.

### Fichiers

`engine-overlay/files/src/engine/actions.ts`, `engine-overlay/files/src/engine/shot.tsx`, `src/tools/staging.ts`, `src/orchestrator/director-guide.ts`, `test/smoke.test.mjs`.

### Validation du lot 2

- `npm test` : **58/58** (avec `numpy`), 1 test nouveau qui exécute réellement `actions.ts`, 1 test étendu.
- **Mutations : 6 détectées sur 6** (clip qui ne tient plus sa fin, bras proche non échangé, champ inconnu accepté, verbe vague accepté, sujet absent accepté, geste propre non résolu).
- Moteur compilé dans une copie de `prof` : 0 erreur.
- Rendus regardés : `lean`, `rummage`, `slam` à deux instants, un geste défini (`salute`), un geste écrit sur la personne, la porte en `behind` avec une entrée en marchant, `cam: 'deep'` sur deux mises en place.
- **Non vérifié :** `give` et `read` (compilés, non rendus) ; `cam: 'deep'` en 16:9 ; aucun nouvel essai avec un LLM après ce lot, donc on ne sait pas encore si l'agent crée ses propres gestes ni s'il remplit mieux les fiches.

### Vu au passage, non corrigé

- **La forme blanche sous le buste** : c'est la main du bras éloigné, qui pend derrière le corps et dépasse sous la veste. Elle se voit surtout sur la prof, peau claire sur pantalon sombre. Pas une régression. À traiter à part (cacher la main éloignée quand le corps est de trois quarts).
- **Maya assise sans pupitre devant elle** dans certains cadres serrés : le pupitre est hors champ ou derrière. Ancien.
- `tilt` ne se voit que de profil : de face, se pencher ne change presque rien.

Images locales : `docs/screenshots/mise-en-scene/controle-gestes-ouverts.jpg`, `controle-deux-profondeurs.jpg`.

### Suite proposée

1. Refaire l'essai Codex sur la copie de `prof` avec ce lot, et comparer au §5 (les 4 défauts refusés, la part des trois gestes dominants).
2. Main du bras éloigné.
3. Épisode complet neuf, de bout en bout, sur la machine où la voix et le rendu marchent.

### Commit proposé pour le lot 2 (non fait)

`feat(engine,staging): actions anyone can define, lean / rummage / slam / give / read, drawings behind people, two-depth framing, cards name their subject and refuse verbs that draw nothing`

## Hypothèses

- Le manque de variété vient surtout de l'absence de décision par plan, pas du modèle. À confirmer à l'étape 5.
- `look` n'est pas vérifié dans le moteur.

## Risques

- La fiche par plan peut rallonger l'épisode de quelques minutes. À mesurer.
- Un petit modèle peut remplir les fiches par copier-coller : d'où le contrôle des fiches identiques.
- Chaque nouveau mot du moteur doit être rendu et regardé, sinon il sera faux à l'image.

## Décisions attendues de Pulsy

1. D'accord pour commencer par la fiche par plan (étapes 1 et 2) ?
2. Pour le moteur, l'ordre proposé (plan large vertical, puis objet tenu) te convient ?
3. Accord pour un lancement réel de `prof` à l'étape 5, et avec quel modèle ?

## Validation

- Mesures du §1 : comptées sur `data/projects/prof/src/episodes/prof/` (30 fichiers de plan, `episode.json`, `DIRECTOR.md`).
- `npm test` : **57/57** (avec `numpy`), dont 3 tests nouveaux.
- **Mutations : 5 détectées sur 5** (marche sur place acceptée, fiches voisines identiques, objet de la fiche non dessiné, fiche manquante, action répétée).
- `tsc` de l'application : 0 erreur. Moteur compilé dans une copie de `prof` : 0 erreur.
- Rendus locaux regardés : marche avec `walkTo` à 3 instants (la personne traverse la salle), objets tenus (sac, combiné, feuille, tasse, clés, livre), plan d'ensemble vertical avant/après.
- Essai réel : 1 lancement Codex sur une copie de `prof` (§5), 270 messages, de 14:38 à 14:53 UTC.
- **Non vérifié :** l'appel de `stagingProblems` depuis `shotsAudit` n'a pas de test dédié (les fonctions sont testées seules). Objets `pen`, `folder`, `box`, `crumpled`, `phone` : compilés, pas tous regardés.

## Commit proposé (non fait)

`feat(staging,engine): one staging card per shot checked against the code, walkTo instead of walking on the spot, held objects, tall establishing shot fills the frame`

Fichiers :
- `src/tools/staging.ts` (nouveau), `src/tools/index.ts`, `src/tools/whatif.ts`
- `src/orchestrator/reviewer.ts`, `src/orchestrator/director-guide.ts`, `src/orchestrator/context.ts`
- `engine-overlay/files/src/engine/objects.tsx` (nouveau), `engine-overlay/files/src/engine/shot.tsx`
- `pipeline/shotlist.py`, `test/smoke.test.mjs`
- `docs/feature-plans/ameliorer-mise-en-scene.md`, `docs/feature-plans/essai-images-de-reference.md`, `docs/context-state.md`
