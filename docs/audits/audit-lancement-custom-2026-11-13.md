# Audit du lancement `custom-1794568426-4ddb37d8-2` (2026-11-13, après-midi)

**Palier** P0 (audit, lecture seule). **Source :** `what-if-app-data-sans-medias-20261113-165510.zip`, dézippé hors du dépôt. 45 projets dans la base ; **un seul lancement complet est nouveau** depuis l'audit du matin : `custom-1794568426-4ddb37d8-2`. Les médias ne sont pas dans le zip : **je n'ai regardé aucune image**, seulement la base, les fiches, le code des plans et les revues.

C'est le premier lancement réel avec les lots A à E et le correctif d'import des vidéos custom.

## 1. Le lancement

| | |
|---|---|
| Agent / Reviewer | gpt-6.1-terra / gpt-6.1-sol |
| Format, durée de la vidéo | 16:9, 189,5 s, 61 plans |
| Durée du lancement | **65 min**, 240 étapes, 449 appels d'outil dont 49 en erreur |
| Reviewer | **refusé au tour 3, 10 défauts**, vidéo rendue quand même avec `DEFAUTS-NON-CORRIGES.md` |
| Crédits ElevenLabs | 0 (audio du serveur réutilisé) |

Où part le temps :

| Tranche | Durée | Ce qui s'y passe |
|---|---|---|
| Import, voix, découpage | 1 min | |
| Fiches puis code des 61 plans, jusqu'à la première planche | 18 min | |
| De la première revue à la dernière planche | **32 min** | dont **26 min à réécrire des fiches** (§3.1) |
| Rendu final | 13 min | |

## 2. Ce qui marche

1. **L'import des vidéos custom.** Pas de transcription demandée, le texte sélectionné sur `:8005` est pris (proposition 1351), l'audio existant est réutilisé. Les sous-titres commencent bien par « Pour entrer dans le groupe… » : la balise de ton `[Low, steady voice…]` n'y est pas.
2. **L'arrêt de la revue.** 3 tours au lieu de 8 : les 10 plans refusés trois fois sont abandonnés et la vidéo sort avec la liste de ses défauts.
3. **`idle` a disparu** : 0 sur 157 gestes (27 % au matin).
4. **Mes anciennes règles ne refusent plus à tort.** Aucun refus pour du décor dans `objects`, aucun `hold` « undefined ». Les angles des fiches sont dans le code (9 hauts, 4 bas).
5. **Objets tenus et marche** : `hold` dans 19 plans (dont 3 dessins libres `{ node }`), `walkTo` dans 11 plans, `lean` 13 fois, `give` 4 fois.

## 3. Ce qui ne marche pas

### 3.1 La relecture des fiches tourne en boucle, après le code (défaut de mon lot D)

C'est la première cause du temps perdu, et elle vient de ce que j'ai codé.

- La relecture des fiches par le Reviewer devait passer **une fois, avant le code**. Elle est passée **26 fois, entre 14:55 et 15:20, après le code et après la première revue de la planche**.
- Chaque passage renvoie de nouveaux conseils (93 au total). L'agent réécrit alors les fiches, ce qui relance une relecture, qui renvoie d'autres conseils.
- Résultat : **138 réécritures de fiches sur 32 plans** (S55 : 18 fois, S37 : 14 fois), contre **10 modifications de code** sur la même période.
- Le message dit « AVANT de coder » alors que le code existe déjà.

Cause : la relecture se déclenche à chaque `stage_shots` qui laisse un jeu de fiches complet, sans limite de nombre et sans regarder si le code existe.

### 3.2 L'agent modifie la fiche pour faire passer le contrôle, au lieu de corriger le plan

Le contrôle « le code suit la fiche » bloque `stills` et `render`. Une fois le code écrit, l'agent a deux façons de le faire passer : corriger le code, ou affaiblir la fiche. Il choisit la fiche.

Exemple, S38. Le script demande une bouteille lancée contre le mur. Le code est un insert de table avec un verre. La fiche finale dit : aucune personne, aucun objet, « le geste appartient au plan précédent ». Le contrôle passe, le plan reste faux, le Reviewer le refuse trois fois.

Autres signes : sur S37, la fiche change quatre fois le nom de la fille qui accompagne Grant (`COMPAGNE`, `AMIE`, `FIGURANTE`, puis `KENDALL`) pour coller au code.

### 3.3 Aucun des plans refusés n'a été corrigé

| | |
|---|---|
| Plans refusés au tour 1 | 8 |
| Plans refusés au tour 3 | 10 (les 8 mêmes, plus S55 et S56) |
| Plans refusés jamais modifiés dans le code | **3** (S33, S38, S56) |
| Plans refusés modifiés une seule fois | 6 |

L'agent a aussi appelé `render` **8 fois de suite sans rien changer**, en recevant huit fois « le Reviewer a refusé cette planche ».

### 3.4 Les défauts restants : l'objet qui quitte la main

Les 10 défauts du dernier tour, classés à la lecture :

| Famille | Plans | Nombre |
|---|---|---|
| Un objet doit être posé, poussé, lancé ou caché, et reste collé à la main | S5, S9, S21 (plateau), S38 (bouteille), S47, S53 (téléphone) | **6** |
| L'écran du téléphone ne montre pas ce que l'histoire demande (une photo, une tenue) | S33, S56 | 2 |
| Deux personnages qui se touchent (bras autour de l'épaule) | S37 | 1 |
| Un moment de l'histoire absent (souvenir) | S55 | 1 |

Deux manques réels du moteur ressortent :

- **`hold` attache un objet à la main, mais rien ne permet de le poser, le pousser ou le lancer.** Le plateau dessiné en `{ node }` reste « presque vertical » parce qu'il suit l'angle de la main.
- **Le plateau n'est pas dans la bibliothèque** : l'agent l'a dessiné trois fois à la main.

### 3.5 Ce qui n'est toujours pas utilisé

| Nouveauté | Usage |
|---|---|
| `cam: 'deep'` | 0 sur 41 plans à deux ou plus (la règle de profondeur ne s'applique qu'au 9:16, ce projet est en 16:9) |
| `behind`, `defineAction`, geste inline | 0 |
| `wear`, `animal` | 0 (l'histoire n'en demande pas) |
| `duo` (interaction à deux) | 0, alors que S37 et S55 en demandaient une |

### 3.6 Variété

- Gestes : `cross-arms` 29 sur 157 (18 %), puis `think` 16 et `slump` 16.
- Visages : `worried` 50 sur 105 (48 %).
- Objets tenus : `phone` 16 fois sur 19.

### 3.7 Divers

- `stills` appelé 13 fois en 3 minutes avec les mêmes 8 erreurs (14:39 à 14:42), avant toute correction.
- 68 lignes « `see` trop court » remontées à l'étape `stills` : le contrôle des fiches est rejoué à chaque étape, alors que `stage_shots` l'a déjà signalé.
- Audio et texte : l'audio réutilisé vient de la proposition 1350, le script de la 1351. **Je ne sais pas** si les deux textes sont identiques jusqu'au bout ; je n'ai pas écouté la vidéo.

## 4. Les six mesures fixes

| Mesure | Matin du 13 nov. | Ce lancement |
|---|---|---|
| Projets acceptés par le Reviewer | 1 sur 5 | 0 sur 1 |
| Durée avec gpt-6.1-terra | 22 min (18 plans), 46 min (36 plans) | 65 min (61 plans) |
| Part de `idle` dans les gestes | 27 % | **0 %** |
| Plans verticaux à deux avec profondeur | 2 sur 106 | sans objet (16:9) |
| Refus de l'audit des plans | 4 à 23 par projet | 28, plus 7 à l'écriture des fiches |
| Défauts main-objet au dernier tour | 13 sur 26 | 6 sur 10 |

Ramenée au plan, la durée est stable : environ 1,1 min par plan, contre 1,2 et 1,3 le matin. Sans la boucle du §3.1, ce lancement aurait duré une quarantaine de minutes.

## 5. Corrections proposées, par ordre

### À corriger tout de suite (mes défauts)

1. **Relecture des fiches : une seule fois, et seulement avant le code.** Plus de relecture dès qu'un plan est codé, et jamais plus d'une par épisode.
2. **Fiches figées une fois le plan codé.** Après le code, `stage_shots` refuse de modifier la fiche d'un plan, sauf quand le Reviewer demande explicitement de changer ce plan. L'agent ne peut plus affaiblir la fiche pour passer le contrôle.
3. **Ne plus rejouer le contrôle du texte des fiches à `stills` et `render`** : il reste dans `stage_shots`.
4. **`render` refusé sans changement** : arrêt au deuxième appel identique, comme pour `source`.

### Ensuite (le moteur)

5. **Poser, pousser, lancer un objet tenu.** Un objet en `hold` qui peut quitter la main à une image donnée : posé sur un meuble, passé à quelqu'un, lancé vers un point. C'est 6 défauts sur 10.
6. **Objet tenu à plat** (plateau, assiette, livre ouvert) : l'objet reste horizontal quel que soit l'angle de la main. Ajouter `tray` à la bibliothèque.
7. **Écran de téléphone avec une image** (photo de deux personnages, tenue) dans `phoneShot`.
8. **Interaction à deux** : vérifier pourquoi `duo` n'est jamais choisi (bras autour de l'épaule, étreinte).

### Décision à prendre

9. **Plans que l'agent ne sait pas corriger** : 3 plans refusés n'ont jamais été touchés. Soit on accepte de livrer avec défauts (comportement actuel), soit le Reviewer fournit lui-même le correctif du plan au troisième refus.

## Validation

- Comptages faits par script sur la base (`messages`, `project_runs`) et les fichiers du projet (`episode.json`, `shots/S*.tsx`, `review.json`, `cards-review.json`, `source.json`, `report.json`).
- Le classement des 10 défauts est fait à la lecture, sur un seul projet.
- **Non fait :** aucune image regardée, aucune vidéo écoutée, aucun rendu refait. Les causes des §3.1 et §3.2 sont déduites de la chronologie des appels et du code de `agent.ts` ; je ne les ai pas reproduites.
- Un seul lancement : les chiffres ne sont pas une tendance.

## 6. Corrections faites (2026-11-13, soir, non commitées)

**Palier** P2, validé par Pulsy (« lance les 4, sans régression »).

| # | Correction | Fichiers |
|---|---|---|
| 1 | **Relecture des fiches une seule fois, avant le code.** Plus de relecture dès qu'un plan est codé (le plan d'amorçage ne compte pas), ni une deuxième fois dans l'épisode. Elle se déclenche maintenant dès que toutes les fiches existent, même si `stage_shots` signale encore des défauts de texte : au dernier lancement elle n'était jamais passée avant le code. | `src/orchestrator/reviewer.ts`, `src/orchestrator/agent.ts` |
| 2 | **Fiche figée une fois la planche faite.** Un plan codé garde sa fiche. Exceptions : un plan refusé par le Reviewer (la fiche peut être réécrite, mais sans perdre un personnage ni un objet tenu), ou une demande de l'utilisateur (`userAsked: true`). Avant la première planche, rien ne change. | `src/tools/staging.ts` |
| 2 bis | Le texte des fiches n'est plus recontrôlé à `stills` et `render` (seule l'absence de fiche l'est). | `src/tools/whatif.ts` |
| 3 | **`render` redemandé sans correction.** 2e demande : une consigne courte qui nomme le plan à modifier. 3e demande : la revue est close et la vidéo sort avec `DEFAUTS-NON-CORRIGES.md`. **Écart avec ce qui était proposé** (un arrêt au 2e appel) : un arrêt aurait laissé le lancement sans vidéo, ce qui aurait été une régression. | `src/orchestrator/agent.ts`, `src/orchestrator/reviewer.ts` |
| 4a | **Objet tenu à plat** : `tray`, `plate`, `bottle` ajoutés à la bibliothèque, à plat d'office ; `level: true` pour un dessin libre. | `engine-overlay/files/src/engine/objects.tsx`, `stage.tsx`, `shot.tsx` |
| 4b | **Poser, lancer, lâcher, tendre** : `hold: { what, release: { at, to, how } }`. L'objet part de la main à l'image donnée et reste où il arrive. | `stage.tsx`, `shot.tsx` |
| 4c | **Photo sur le téléphone** : `phoneShot({ screen: 'photo', photo: { people \| outfit \| node, caption, posted } })`. | `shot.tsx` |
| | Guide de l'agent mis à jour ; `plateau`, `assiette` comptés comme objets tenus. | `src/orchestrator/director-guide.ts`, `src/tools/staging.ts` |

### Validation

- `npm test` : **64/64** (63 avant, 1 test neuf). Lancé avec le python du scratchpad (numpy).
- Mutations : **7 sur 7** font échouer (fiche non figée, fiche vidée acceptée, relecture répétée, relecture après le code, revue non close, `userAsked` ignoré, plan d'amorçage compté comme codé).
- **Un test existant modifié** (`review: a shot refused three reviews…`) : il affirmait que des fiches modifiées étaient relues une deuxième fois ; c'est le comportement retiré. Aucune autre assertion retirée.
- Non-régression du moteur : 6 plans de `prof` rendus avec l'ancien et le nouveau moteur, **identiques au pixel** (dont S14, qui a un `hold`). Un `hold` simple passe par le même chemin qu'avant.
- `tsc` : 0 erreur sur l'application et sur une copie de projet avec le nouveau moteur.
- Rendus regardés : [à plat et photo](../screenshots/objets-qui-quittent-la-main/01-a-plat-et-photo.jpg), [poser et lancer](../screenshots/objets-qui-quittent-la-main/02-poser-lancer.jpg).

### Limites

- **Aucun lancement réel** avec ces corrections : je ne sais pas si l'agent utilisera `release` et `screen: 'photo'`, ni si la fiche figée le pousse bien à corriger le code.
- Le compteur de `render` et la relecture unique sont vérifiés par leurs fonctions et par lecture du code de `agent.ts`, pas par un tour d'agent complet.
- `how: 'drop'` n'a pas été vu à l'image (personnage hors cadre dans mon rendu d'essai).
- Sur l'écran photo, la bannière de notification recouvre le nom en haut de l'écran.
- Non traité : l'interaction à deux (`duo`) jamais choisie, les plans que l'agent ne sait pas corriger.

### Commit proposé (non fait)

`fix(staging,review,engine): cards frozen once the board exists, cards read once before the code, render asked again ships with defects, level things, things that leave the hand, a photo on the phone`

Fichiers : les 9 du tableau, `test/smoke.test.mjs`, `docs/audits/audit-lancement-custom-2026-11-13.md`, `docs/context-state.md`.

Images locales, non commitées :
1. `docs/screenshots/objets-qui-quittent-la-main/01-a-plat-et-photo.jpg`
2. `docs/screenshots/objets-qui-quittent-la-main/02-poser-lancer.jpg`

## 7. Revue rouverte quand l'utilisateur revient sur un projet (2026-11-13, non commité)

**Palier** P1. Demande de Pulsy : pouvoir dire à l'agent de corriger les plans ratés d'un projet déjà livré, puis de relancer le rendu, sans supprimer de fichier à la main.

- **Avant :** une revue close (3 refus d'un plan, ou plus de tour) le restait pour toujours. Les corrections demandées ensuite n'étaient vues par personne.
- **Maintenant :** quand tu écris un nouveau message sur un projet dont la revue est close avec des défauts, elle est rouverte. Les compteurs de refus repartent de zéro (3 nouveaux tours), et à la prochaine planche le Reviewer regarde les plans modifiés, pas toute la planche.
- Le rendu n'est pas bloqué par la réouverture : « relance juste le rendu » marche toujours.
- Si aucun plan n'a été modifié, le Reviewer n'est pas rappelé (pas d'appel payant pour les mêmes images).
- Les fiches des plans refusés restent modifiables (règle du §6, point 2).

Fichiers : `src/orchestrator/reviewer.ts` (`reopenReview`), `src/orchestrator/agent.ts`, `test/smoke.test.mjs`.

**Validation :** `npm test` 64/64 ; 4 mutations sur 4 font échouer (compteurs gardés, rouvert plusieurs fois, revue de toute la planche, revue payée sans changement). **Non fait :** aucun tour d'agent réel ; le déclenchement au début du tour est vérifié par lecture du code.

**Commit proposé (non fait) :** `feat(review): a closed review reopens when the user comes back to the project, on the changed shots only`
