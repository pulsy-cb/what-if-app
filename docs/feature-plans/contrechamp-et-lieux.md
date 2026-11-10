# Contrechamp, lieux, personnages assis et angles (2026-11-10)

**Palier P2** (moteur, guide, audit). Point 2 de « la suite », demandé par Pulsy. Les lieux s'appuient sur son analyse de 50 vidéos de la chaîne `herytstory` (répartition par catégorie).

## 1. Contrechamp

- `shot({ ..., view: 'reverse' })` : la caméra passe à l'autre bout de la pièce et regarde le mur opposé.
  - Les meubles sont en miroir : gauche et droite, avant et arrière.
  - Ce qui se retrouve juste derrière la caméra disparaît.
- Les personnages gardent leur `at` : le moteur les place en miroir et les retourne. Un visage devient un dos, et un trois-quarts vers la droite devient un trois-quarts de dos vers la gauche.
- Les regards (`look`), les gestes vers une cible (`reach`) et les sièges (`on`) suivent automatiquement.
- **Mur opposé :** chaque lieu a une liste `front`, par exemple une porte et un panneau pour la classe, une télé pour le salon. On peut la changer avec `place(nom, { front: [...] })`.
- **Usage dans un dialogue :** un plan en vue normale sur l'un, un plan en `reverse` sur l'autre.

## 2. Lieux

**17 lieux nouveaux**, soit 23 au total :

| Catégorie de l'analyse | Part | Lieux |
|---|---|---|
| Rue / extérieur | 30,5 % | `street`, `garden`, `park`, `schoolyard`, `rooftop` (extérieurs : ciel et sol, sans murs) |
| Autres décors (bureau, couloir, comptoir) | 20,6 % | `corridor`, `diner`, `office` (existant) |
| Chambre / espace intime | 12,2 % | `hospital`, `bedroom` (existant) |
| Salon / cuisine | 12,2 % | `living`, `kitchen` (existants) |
| École | 11,5 % | `hallway` (casiers), `cafeteria`, `schoolyard`, `classroom` (existant) |
| Réceptions / lieux publics | 5,3 % | `reception` (arche fleurie, tables rondes), `auditorium` (scène, écran, rangées) |
| Hôpital / soins | 3,1 % | `hospital`, `clinic` |
| Commerces | — | `shop`, `salon` (coiffure) |
| Police / prison | 2,3 % | `police-office`, `cell` |
| Véhicule | 2,3 % | non couvert par `place()` : décors `Vehicle` / `CarExterior` du moteur, plan écrit à la main |

**27 pièces nouvelles :**
- intérieur : `hospital-bed`, `monitor`, `iv-stand`, `curtain`, `locker`, `shelf`, `stage`, `podium`, `seat-row`, `round-table`, `arch`, `bars`, `bench`, `picnic-table`, `flowers` ;
- murs : `mirror`, `screen`, `wall-shelf`, `alarm` ;
- extérieur : `facade`, `house`, `skyline`, `fence`, `hedge`, `parapet`, `road`, `sidewalk`, `path`, `tree`, `street-lamp`, `car`, `bus`.

**Ce qui reste ouvert :**
- `place('blank')` pour une pièce, ou un extérieur proche (`park`) avec ses propres pièces ;
- une pièce dessinée sur place (`draw`) ;
- `definePiece` pour une pièce réutilisée ;
- un plan écrit à la main.

## 3. Personnage assis vu de face

Avant, la cuisse pointée vers la caméra était écrasée par le dessin : le personnage paraissait debout devant sa chaise.

Maintenant, assis de face ou de trois-quarts :
- les genoux s'écartent un peu ;
- un « giron » (les cuisses vues en raccourci) est dessiné par-dessus le bas du buste, à la couleur du pantalon.

En profil, le dessin ne change pas. Debout, le rendu est le même qu'avant (contrôlé à l'image).

## 4. Angles

- `angle: 'low'` (contre-plongée) : le décor s'étire autour des pieds du personnage cadré, qui domine, et le cadre montre plus de plafond.
- `angle: 'high'` (plongée) : le personnage se tasse au-dessus du sol.
- Aussi utilisable comme temps de caméra : `beats: [{ at, angle }]`.

C'est une approximation 2D, pas une vraie perspective.

## 5. Autres changements

- **Audit :** les positions vont désormais de `u` -0,5 à 1,5. Les extérieurs bordent la rue de -0,3 à 1,3 pour qu'un plan large en 16:9 reste plein.
- **Guide et Reviewer :** ils connaissent le contrechamp, les angles, les lieux et les pièces.
- **Prompt :** 54,5 Ko (+1,6 Ko) ; le digest n'est pas tronqué.

## 6. Limites

- **Véhicules et ambulance** : pas de recette `place()`.
- **Contrechamp :** le plafond, les murs latéraux et les lampes sont les mêmes des deux côtés ; seul le mur du fond change.
- **Assis de trois-quarts :** le giron est souvent caché par le bras. C'est le dossier de la chaise qui fait lire la position.
- **Gros plans :** l'écart automatique des visages n'est pas fait.

## Validation

- `npm test` **26/26**, dont l'audit de la borne `u` (test adapté, mutation détectée).
- `tsc` de l'application : 0 erreur. Calque compilé sur 4 moteurs réels : 0 erreur.
- Rendus locaux :
  - les 17 lieux en vue normale et en contrechamp, en 16:9 ;
  - 6 lieux et le champ-contrechamp en 9:16 ;
  - les personnages assis (face, trois-quarts, profil) ;
  - les angles bas et haut.
- **Pas de test automatique** pour le miroir du contrechamp ni pour le giron : la preuve est le rendu. Ces fonctions vivent dans le moteur TSX et le dépôt ne les exécute pas hors Remotion.
- **Non exécuté :** vrai LLM, Modal, simulation complète. Le pipeline n'a pas changé depuis la dernière simulation, hormis la borne `u` de l'audit.

## Commit proposé

`feat(engine): reverse angle, 17 places from the channel analysis, seated lap, low and high angles`

**Fichiers :**
- `engine-overlay/files/src/engine/{rooms.tsx,shot.tsx,person.tsx}` ;
- `engine-overlay/examples/places-shots.tsx` ;
- `src/orchestrator/{director-guide.ts,reviewer.ts}` ;
- `src/tools/whatif.ts`, `test/smoke.test.mjs` ;
- cette note, `docs/context-state.md`.

**Images locales (non commitées) :**
1. `docs/screenshots/lieux-2026-11-10/01-lieux-16x9.jpg`
2. `docs/screenshots/lieux-2026-11-10/02-champ-contrechamp.jpg`
3. `docs/screenshots/lieux-2026-11-10/03-assis.png`
4. `docs/screenshots/lieux-2026-11-10/04-9x16-et-angles.png`
