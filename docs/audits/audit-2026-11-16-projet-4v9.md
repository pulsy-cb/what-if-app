# Audit du projet `4v9iyhecgpu-1` — premier lancement réel avec les lots du 16 novembre

**Palier** P0 (audit seul, aucun code modifié).
**Source** : `what-if-app-data-no-media-20261116-144328-safe.zip`, dézippé hors du dépôt. Deux projets neufs : `4v9iyhecgpu` (échec à l'import) et `4v9iyhecgpu-1` (livré).
**Moteur du projet** : identique octet pour octet au calque du commit `bdf3fdd` (15 fichiers comparés). C'est donc le premier vrai lancement avec les lots du 16 novembre.

## 1. Résumé

Le lancement s'est bien passé côté chaîne : 30 minutes, 91 appels, 7 échecs tous corrigés par l'agent, vidéo livrée (33,8 s, 18 plans, -14,8 LUFS). Aucun blocage, aucune boucle.

L'image, elle, a des défauts nets sur 9 plans sur 18, et **personne ne les a relevés**, parce que le Reviewer n'a pas pu être lu (voir B1). Deux vrais bugs de code expliquent une bonne part des défauts ; le reste relève de garde-fous manquants et du dessin.

| # | Sujet | Nature | Plans touchés | Priorité |
|---|---|---|---|---|
| B1 | Réponse du Reviewer illisible deux fois, revue perdue | bug | tout l'épisode | haute |
| B2 | Hauteur `v` inversée entre `reach` et `props` / `release` | bug (introduit par mes lots) | S5, S14 | haute |
| G1 | Sujet du plan hors cadre ou caché, non détecté | garde-fou manquant | S7, S10, S11, S15 | haute |
| G2 | Objet « sur le bureau » dessiné au sol | garde-fou + guide | S6, S14, S15 | moyenne |
| D1 | Profil avec cheveux `curls` lu comme un dos | dessin | S2 | moyenne |
| D2 | Feuille posée sur une table dessinée debout | dessin | S4, S18 | moyenne |
| D3 | Cadres 9:16 à moitié vides en plan large ou plongée | cadrage | S4, S6, S7, S15 | moyenne |
| M1 à M4 | Points mineurs | divers | — | basse |

Planches (locales, non commitées) : `docs/screenshots/audit-2026-11-16-4v9/01-planche-S1-S10.jpg`, `02-planche-S11-S18.jpg`.

## 2. Déroulé du lancement

- `4v9iyhecgpu` : l'identifiant vidéo a été saisi en minuscules (`4v9iyhecgpu` au lieu de `4v9iYHecGpU`). Le serveur `:8005` répond 404 « Vidéo introuvable ». L'orchestrateur a bien arrêté au deuxième échec identique (correctif du 13 novembre : il fonctionne). L'interface ne change pas la casse du champ vidéo : la saisie était en minuscules. Voir M1 pour le message.
- `4v9iyhecgpu-1` : import, voix, découpage, plan et sons en moins d'une minute ; 11 passages de `stills` dont 4 refusés par l'audit des plans (lieu `study` inconnu, personnes de la fiche absentes du code, objet de la fiche non dessiné, profondeur en 9:16) ; planche, relecture, rendu.
- Relecture des fiches : un seul passage (5 remarques), comme prévu depuis le 13 novembre. Pas de boucle.
- Utilisation des nouveautés du 16 novembre : vues trois quarts sur 16 plans, 0 contrechamp, `stance: 'kneel'`, `open-arms`, `stamp.tone`, `tag.sub`, accessoire `at`, visages `smug`, `cool`, `tired`, `furious`, `terrified`, `oops`. Non utilisés : `release`, `pour`, `tabletopShot`, `phoneShot`, alors que le récit s'y prêtait (dérouler le carton, mesurer, feuilleter le programme).

## 3. Bugs

### B1 — La revue finale a été perdue (réponse du Reviewer « non-JSON », deux essais)

- **Constat** : `review.json` porte `ok: false`, `pass: true`, `issues: []`. Le début de la réponse gardé dans le résumé montre pourtant un vrai verdict : `"pass": false, "summary": "L'épisode est globalement fidèle au script…"`. Le Reviewer avait donc des remarques ; elles ont été jetées, et l'agent a fait sa propre vérification (« continuité OK ») puis livré.
- **Cause** : `parseReviewJson` (`src/orchestrator/reviewer.ts:338`) sait retirer la clôture ```` ```json ````, mais échoue dès que le JSON est invalide. Deux causes possibles, que je ne peux pas départager car la réponse brute n'est pas conservée (140 caractères seulement) :
  1. guillemets non échappés dans un texte. Ce script cite le mot « pouces » entre guillemets : très probable ;
  2. réponse coupée par le plafond de sortie.
- **Correctif proposé** : lecture tolérante par champs (`shot`, `severity`, `problem`, `fix` repérés par leurs clés, ce qui couvre les deux causes), et écriture de la réponse brute dans `out/<slug>/review-raw.txt` quand la lecture stricte échoue.
- **Effet** : c'est le défaut le plus coûteux du lancement. Les défauts G1 sont exactement ceux que le Reviewer signale d'habitude.

### B2 — `v` n'a pas le même sens dans `reach` et dans `props` / `release`

- **Constat** : en S5 et S14, le prof doit toucher la fiche ou le carton posé bas ; sa main part vers sa tête (en S14, le mètre ruban se dresse au-dessus du crâne).
- **Cause** : `reach: { to: { u, w, v } }` lit `v` comme « 0 plafond, 1 sol » (`shot.tsx:429`, convention du 10 novembre). `props.at` et `release.to`, que j'ai ajoutés les 13 et 16 novembre, lisent `v` comme « 0 sol, 1 tête » (`shot.tsx:698` et `748`), et le guide n'écrit que cette seconde convention. L'agent a donc donné `v: 0.03` au geste et `v: 0.02` à l'objet pour viser le même point : l'un est monté, l'autre est resté au sol.
- **Responsabilité** : incohérence introduite par mes lots.
- **Correctif proposé** : une seule convention partout, « 0 sol, 1 tête », y compris pour `reach`, et la phrase dans le guide. Effet sur l'existant : 7 plans dans 57 projets donnent un `v` à `reach` ; ils changeraient s'ils étaient re-rendus.

## 4. Garde-fous manquants

### G1 — Le sujet du plan peut être hors cadre ou caché sans que rien ne le dise

- S7 : `on: 0` désigne Elijah, il n'est pas à l'image (caméra écrite à la main `{ x, y, zoom }`). On voit une élève de dos.
- S10 : le prof, sujet du plan, est coupé par le bord gauche (`cam: 'deep'`, `move: 'track'`).
- S11 : `on: 1` désigne le prof ; Elijah, au premier plan, le recouvre presque entièrement.
- S15 : Elijah est absent de l'image ; le prof occupe un huitième du cadre.
- **Cause** : l'audit des plans vérifie que le code cite les personnes de la fiche, pas qu'elles tombent dans le cadre. Une caméra écrite à la main contourne le cadrage automatique. À noter : c'est l'agent lui-même qui a réécrit S1, S3 et S7 en caméra manuelle « pour remplir le cadre ».
- **Proposition** : à l'image clé, calculer la boîte de la tête du sujet (`on`) et refuser le plan si elle sort du cadre ou si une personne plus proche la recouvre de plus de la moitié.

### G2 — Un objet « sur le bureau » finit au sol

- S6, S14, S15 : le carton est donné par `props: [{ at: { u, w, v: 0.02 } }]`. `v: 0.02`, c'est le sol : le carton est aux pieds des personnages.
- **Cause** : l'agent choisit `at` (point au sol) alors qu'un meuble est là ; le guide ne dit pas quelle hauteur vaut un plateau de table.
- **Proposition** : dans le guide, « sur un meuble : toujours `on: '<pièce>'` » avec la hauteur d'une table (`v` ≈ 0,4) ; dans l'audit, un avertissement quand un `at` bas tombe sur l'emprise d'une pièce.

## 5. Dessin et cadrage

### D1 — Un profil avec les cheveux `curls` se lit comme un dos (S2)

- Reproduit : `docs/screenshots/audit-2026-11-16-4v9/03-S2-variantes-vue.jpg` et `04-S2-profil-boucles.jpg`. La vue n'est pas en cause : de face, trois quarts ou `3/4-right`, le visage est là. Dès que l'orientation finale dépasse 0,72 (seuil du profil dans `views.tsx`), la coiffure couvre l'œil et l'oreille se retrouve au centre de la tête.
- Ici `yaw: 0.5` en `3/4-left` devient 0,74 (la vue ajoute 0,24) : juste au-dessus du seuil.
- S2 est le gros plan qui présente le héros : c'est le plan où ce défaut coûte le plus.
- **Proposition** : redessiner la masse de `curls` en profil pour dégager l'œil et le front ; à vérifier sur les autres coiffures volumineuses. Cause exacte dans le dessin de la coiffure à confirmer au moment du correctif.

### D2 — Une feuille posée sur une table est dessinée debout (S4, S18)

- Le programme, donné par `props: [{ on: 'table', node }]`, apparaît comme une affiche collée sur le devant du bureau, à moitié sous le plateau.
- **Cause** : un `node` est dessiné face caméra et centré sur le point d'appui. Rien ne permet de dire « à plat ».
- **Proposition** : une option `flat: true` sur `props` (écrasement vertical et appui sur le bord bas), et la règle d'origine dans le guide (le point d'appui est le bas du dessin).

### D3 — Cadres 9:16 à moitié vides

- S4, S6, S7 : 35 à 45 % de sol nu en bas. S15 (`wide` + plongée) : mur et plafond en haut, sol en bas, personnage minuscule.
- L'audit refuse déjà les plans à deux personnes côte à côte en 9:16 ; il ne dit rien d'un personnage seul trop petit.
- **Proposition** : en 9:16, refuser un plan dont la personne suivie occupe moins d'un quart de la hauteur, sauf plan d'ouverture ; et resserrer le cadrage automatique de `wide` avec `angle: 'high'`.

### Autres observations d'image

- Le lieu `office` de nuit (S4, S5, S17, S18) est peu lisible : pièce très sombre, tableau blanc éclatant et flou derrière la tête.
- S15, à genoux vu de trois quarts : la posture se lit comme « debout, jambes courtes ».
- Bien : S3, S8, S12, S13, S16 sont propres ; les visages nouveaux se lisent ; aucun plan de dos imposé par une vue.

## 6. Points mineurs

- **M1** — Identifiant vidéo introuvable : le message dit « This video has no French proposal on :8005 either », ce qui oriente mal. Sur un 404, dire « identifiant introuvable ; la casse compte ».
- **M2** — 7 `as never` dans les plans (39 fichiers sur tous les projets). Vérifié au compilateur : `open-arms`, `stand-up`, `rummage`, `slam` passent sans cela ; c'est une habitude de l'agent. Un seul cache une vraie erreur : `face: 'explain'`, qui n'existe pas (retombe sur le visage neutre). Proposition : l'audit refuse `as never` et `as any` dans un plan.
- **M3** — `shotlist.md` colle les guillemets au mauvais mot (« l'affiche reste.« », « cinq.»« »). Affichage seulement.
- **M4** — Lieu `study` : cité par l'agent, inconnu du moteur, un passage perdu. Un alias vers `office` suffit.

## 7. Lots proposés

| Lot | Contenu | Palier | Taille |
|---|---|---|---|
| A | B1 lecture tolérante du Reviewer + réponse brute gardée ; B2 `v` unifié + guide | P1 | petit |
| B | G1 sujet dans le cadre et non caché ; G2 objet bas sur un meuble ; M2 refus de `as never` | P2 | moyen |
| C | D1 profil `curls` ; D2 `flat` pour les objets posés ; D3 cadrage 9:16 | P2 | moyen |
| D | M1, M3, M4 | P0/P1 | très petit |

Ordre conseillé : A, puis B. Le lot A rend la revue finale à nouveau utile ; le lot B attrape avant le rendu ce que la revue attrapait après.

Une fois A et B faits, ce projet peut être repris sans tout relancer : « corrige les plans S2, S5, S6, S7, S10, S11, S14, S15 puis relance le rendu » (réouverture de la revue, commit `2305f6d` et précédents).

## 8. Validation

- Moteur du projet contre calque `bdf3fdd` : `cmp` sur 15 fichiers → 15 identiques.
- `npx tsc --noEmit` sur la copie du projet → 0 erreur.
- Rendu `4v9iyhecgpu-1Board` → 18 images sur 18, lues une par une sur deux planches.
- D1 : 8 rendus de S2 (4 vues et orientations, puis 4 orientations de face) → dos à partir de 0,74, visage à 0,62.
- B2 : lecture de `shot.tsx:429`, `698`, `748` et du guide ; comptage des `reach` avec `v` dans les 57 projets → 7 plans.
- M2 : fichier de test compilé avec les quatre gestes sans `as never` → acceptés.
- B1 : cause exacte **non établie** (réponse brute absente) ; les deux hypothèses sont couvertes par le correctif proposé.
- `npm test` : non exécuté (aucun code modifié).
- Vidéo finale : non vue (le zip ne contient pas les médias) ; l'audit porte sur l'image clé de chaque plan.

## Fichiers locaux

1. `docs/screenshots/audit-2026-11-16-4v9/01-planche-S1-S10.jpg`
2. `docs/screenshots/audit-2026-11-16-4v9/02-planche-S11-S18.jpg`
3. `docs/screenshots/audit-2026-11-16-4v9/03-S2-variantes-vue.jpg`
4. `docs/screenshots/audit-2026-11-16-4v9/04-S2-profil-boucles.jpg`

## 9. Lot A — fait, non commité (16 nov.)

**Palier** P1.

**Fait**
- `src/orchestrator/reviewer.ts` : `salvageReview` lit une réponse au JSON invalide champ par champ (guillemets non échappés, réponse coupée). `parseReviewJson` s'en sert quand la lecture stricte échoue ; le rapport porte alors `salvaged: true`. Un refus dont aucune remarque bloquante n'est lisible reste « illisible » (le Reviewer est redemandé), et la réponse reçue est gardée dans `review.json` (`raw`, 20 000 caractères au plus).
- `engine-overlay/files/src/engine/shot.tsx` : `reach: { to: { u, w, v } }` lit `v` comme `props.at` et `release.to` (0 sol … 1 tête). Défaut inchangé à l'image (20 % de la hauteur).
- `src/orchestrator/director-guide.ts` : une phrase sur le sens unique de `v`, avec les repères (0,4 table, 0,62 buste), et « un objet sur un meuble passe par `on` ».
- `test/smoke.test.mjs` : 2 blocs d'assertions ajoutés.

**Validation**
- `npm test` → 75/75.
- Mutation (lecture tolérante désactivée) → 74/75, échec sur « unescaped quotes must not lose the review ». Restauré, vérifié.
- Rendu de S5 et S14 avec le moteur corrigé : la main descend vers la fiche et le mètre ruban touche le carton (`docs/screenshots/audit-2026-11-16-4v9/05-lot-A-S5-S14-avant-apres.jpg`).
- Non couvert par une mutation : le changement de `v` (protégé par une assertion sur le source, vérifié par le rendu).

**À surveiller**
- 7 plans de projets existants donnent un `v` à `reach` avec l'ancien sens : ils changeraient s'ils étaient re-rendus.
- La cause exacte de la réponse illisible du 16 novembre reste inconnue ; au prochain cas, `raw` la donnera.

**Commit proposé** : `fix(reviewer,engine): a review with broken JSON is read field by field and kept when unreadable, reach reads v as a height like props and release`

## 10. Lot B — plan, à valider (P2)

Fichiers touchés : `engine-overlay/files/src/engine/shot.tsx`, `src/tools/whatif.ts`, `src/orchestrator/director-guide.ts`, `test/smoke.test.mjs`.

1. **Sujet dans le cadre (G1)** — `shot()` calcule déjà la caméra et la place de chaque personne. À la construction du plan, il calcule en plus, pour l'image clé, la boîte de la tête de la personne suivie (`on`) dans le cadre final, et expose le résultat. L'audit des plans (`whatif.ts`) refuse alors :
   - une tête du sujet à plus de 40 % hors du cadre ;
   - une tête du sujet recouverte à plus de 50 % par une personne plus proche de la caméra.
   Message à l'agent : quel plan, quelle personne, et la correction (retirer la caméra écrite à la main, écarter la personne du premier plan).
   Exemptions : `cam: 'ots'` et `'pov'` (l'amorce est voulue), `tabletopShot`, `phoneShot`.
2. **Objet bas sur un meuble (G2)** — l'audit avertit quand un `props.at` avec `v` inférieur à 0,15 tombe dans l'emprise d'une pièce (table, bureau), et propose `on: '<pièce>'`.
3. **`as never` / `as any` dans un plan (M2)** — refusés par l'audit, avec la liste des gestes et visages valides dans le message.

Risque : un refus à tort bloquerait `stills`. Garde-fou : je passe les 786 plans des projets existants dans le nouveau contrôle et je lis à la main chaque refus avant de fixer les seuils ; objectif 0 refus à tort.

## 11. Lot B — fait, non commité (16 nov.)

**Palier** P2, plan validé par Pulsy.

**Fait**
- `engine-overlay/files/src/engine/shot.tsx` : à chaque rendu, si l'audit écoute (`globalThis.__whatifFraming`), le plan note la part de la tête du sujet qui est dans le cadre, la part cachée par une personne plus proche, et les accessoires `at` bas situés dans l'emprise d'un meuble. Sans audit, rien ne change à l'image.
- `engine-overlay/files/src/engine/rooms.tsx` : `pieceAt(u, w)` donne la table, le bureau, le comptoir ou le lit qui se trouve sous un point.
- `src/tools/whatif.ts` : `framingErrors` (refus si moins de 70 % de la tête dans le cadre, ou plus de 45 % cachée ; refus d'un accessoire bas sous un meuble) et `castErrors` (refus de `as never` / `as any` après un nom de geste, de visage, de vue…). L'audit des plans relève ces notes à l'image clé.
- `src/orchestrator/director-guide.ts` : règle du sujet dans le cadre, caméra écrite à la main réservée au décor vide, pas de `as never`.
- `test/smoke.test.mjs` : 1 test ajouté (76 au total).

**Calibrage sur l'existant** (57 projets, 1 601 plans, 717 sujets mesurés)
- 696 sujets entièrement dans le cadre. 20 plans refusés dans 12 projets, plus 1 accessoire bas.
- 15 des 16 hors-cadre viennent d'une caméra écrite à la main : c'est bien la cause attendue.
- Les 5 plans les plus proches des seuils ont été rendus et regardés : 5 vrais défauts (sujet coupé par le bord ou caché), 0 refus à tort (`docs/screenshots/audit-2026-11-16-4v9/06-lot-B-cinq-cas-limites.jpg`). Les 15 autres, plus loin des seuils, n'ont pas été regardés un par un.
- Sur `4v9iyhecgpu-1`, l'audit refuse maintenant S5 (fiche sous le bureau), S7, S10 et S11.

**Validation**
- `npm test` → 76/76. Un premier passage a donné 75/76 sur un test de délai sans rapport (« agy provider… kills unauthenticated agy prompt immediately ») ; non reproduit au second passage.
- 4 mutations sur 4 détectées (seuil de visibilité, seuil de recouvrement, détection du cast, accessoire bas) ; fichier restauré, identique.
- `npx tsc --noEmit` sur le dépôt et sur une copie de projet → 0 erreur.

**Limites**
- S15 n'est pas refusé : le sujet désigné (le prof) est visible ; c'est Elijah, second rôle, qui est hors cadre. Seul le sujet (`on`) est contrôlé.
- S6, S14, S15 (carton au sol) ne sont pas refusés : le point donné n'est sous aucun meuble. Seul un objet bas **dans l'emprise** d'un meuble l'est. Le guide dit maintenant quelle hauteur donner.
- Le contrôle porte sur l'image clé, pas sur toute la durée du plan.
- Une personne qui marche, une paire (`hug`…), `ots`, `pov` et la posture couchée ne sont pas contrôlées.
- Si un ancien projet repasse par `stills`, ses plans fautifs seront refusés (20 plans connus).

**Commit proposé** (lots A et B ensemble) : `fix(reviewer,engine,audit): a review with broken JSON is read field by field, reach reads v as a height, the subject of a shot must be in the frame and not hidden, a low prop under a piece and a cast in a shot are refused`

## 12. Lot C — plan, à valider (P2)

1. **D1 profil `curls`** : redessiner la coiffure en profil pour dégager l'œil ; passer toutes les coiffures en profil sur une planche avant / après.
2. **D2 objet à plat** : `props: [{ on, node, flat: true }]` couche le dessin sur le meuble ; guide.
3. **D3 cadres 9:16** : resserrer le cadrage automatique de `wide` en plongée ; refuser en 9:16 un sujet qui occupe moins d'un quart de la hauteur, hors plan d'ouverture. Seuil calibré sur l'existant comme pour le lot B.

## 13. Lots C et D — faits, non commités (16 nov.)

**Fait**
- **D1** `views.tsx` : en profil, les boucles `curls` s'arrêtent au-dessus du sourcil et descendent derrière le crâne. S2 re-rendu : on lit un profil, avec l'œil, le sourcil et le sourire.
- **D2** `shot.tsx` : `props: [{ on, flat: true, node }]` couche le dessin sur le meuble. S4 et S18 re-rendus avec `flat: true` : la feuille est posée sur le bureau. Guide mis à jour.
- **D3** `shot.tsx` : en format vertical, le plan `wide` sur une personne seule prend un champ plus étroit (personne environ 28 % plus grande).
- **M1** `source_import.py` : sur un 404, le message dit que l'identifiant est introuvable et sensible à la casse.
- **M4** `rooms.tsx` : alias de lieux (`study`, `library`, `school`, `home`, `cafe`, `road`, `toilet`, `pub`…) ; un test vérifie que chaque alias pointe vers un lieu réel.

**Non fait**
- **D3, refus d'un sujet trop petit** : abandonné. Mesure sur 417 sujets en 9:16 : aucun sous 26 % de la hauteur ; il n'y a pas de cas isolé à refuser, c'est le cadrage `wide` lui-même qui était large. S15 (deux personnes, plongée) garde son cadre : le resserrement ne touche que les plans à une personne.
- **D3, plan large resserré** : protégé par une assertion sur le source, **non vu à l'image** (aucun plan large à une personne dans le projet audité).
- **M3** guillemets de `shotlist.md` : ce fichier est écrit par le script du skill, hors de ce dépôt.
- Lieu `office` de nuit peu lisible, posture à genoux de trois quarts : non traités.

**Validation** : `npm test` 77/77 (avec les lots audio). Lot C : assertions sur le source et 4 rendus avant / après regardés ; pas de mutation dédiée.
