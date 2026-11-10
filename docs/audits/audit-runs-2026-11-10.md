# Audit des runs réels du 2026-11-09/10 : temps, rythme, cohérence, visuel

**Palier P0** (analyse, aucun code modifié). Données : `data/app.db` et les projets du zip `what-if-data-code-et-base-actualise.zip`. Images fixes rendues en local depuis le code des épisodes (le zip ne contient pas les rendus) : `docs/screenshots/audit-2026-11-10/`.

| Projet | Format | Durée vidéo | Modèle | Temps total | Issue |
|---|---|---|---|---|---|
| `crush` (référence, ancien système) | 9:16 | 118 s | GLM-5.3-Flash | 103 min | jamais allé au bout (23 images fixes sur 24 en échec) |
| `jumeaux` | 9:16 | 89 s | GLM-5.3-Flash | 22 min | interrompu : le modèle croyait ses écritures corrompues |
| `jumeau-2` | 9:16 | 89 s | GLM-5.3-Flash | **107 min** | mp4 final |
| `y-school` | 16:9 | **962 s (16 min)** | DeepSeek-V4.1-Flash | **629 min** | mp4 final |

## 1. En bref

- **Le système va maintenant au bout**, et beaucoup plus proprement : 6 erreurs d'outils au lieu de 112, 154 étapes au lieu de 378, 25 plans orientés sur 28 au lieu de 2 sur 36.
- **Ton impression de rythme perdu est juste, et mesurable.** Il se passe **4 à 5 fois moins de choses dans chaque plan** qu'avant :

  | | `crush` | `not-father` | `jumeau-2` | `y-school` |
  |---|---|---|---|---|
  | évènements animés par plan | 4,5 | 3,6 | **0,8** | **1,0** |

  L'action la plus écrite est `idle` (« ne rien faire ») : 16 fois sur 36 dans `jumeau-2`, 46 sur 83 dans `y-school`.
- **La vidéo longue a un défaut de conception.** Le découpage plafonne à 36 plans quelle que soit la durée : 16 minutes donnent **un plan toutes les 27 secondes**.
- **Le temps d'une vidéo courte se répartit en trois blocs :** environ 30 min de rendu, environ 50 min d'allers-retours de correction, environ 20 min avant d'écrire le premier plan. Le rendu est déjà largement corrigé par le commit `4264402` venu de l'autre machine.

## 2. Ce qui s'est amélioré (même modèle, `crush` → `jumeau-2`)

| Indicateur | `crush` | `jumeau-2` |
|---|---|---|
| arrivé au mp4 | non | **oui** |
| erreurs d'outils | 112 | **6** |
| étapes du modèle | 378 | **154** |
| plans orientés (non frontaux) | 2 / 36 | **25 / 28** |
| plans avec amorce floue | 0 | **6** |
| images fixes en échec | 23 / 24 | **1 / 12** |

**Le Reviewer a fonctionné sur `jumeau-2`** avec le modèle vision Nemotron VL. Il a refusé une première fois pour des raisons justes : la cicatrice absente du gros plan, les ciseaux tombés non montrés, la mauvaise personne à l'écran en S24. Le plan a été corrigé, puis validé.

**`shot()`, `place()` et `cast()` ont été adoptés** par les deux modèles sans formation : 26 plans `shot()` sur 28 dans `jumeau-2`, 32 sur 36 dans `y-school`.

## 3. Pourquoi c'est long

### Vidéo courte : `jumeau-2`, 107 min

| Phase | Durée | Ce qui s'y passe |
|---|---|---|
| source → voix → découpage → plan | 0,3 min | rapide, la voix est réutilisée depuis `:8005` |
| avant le premier `shots.tsx` | **17,6 min** | `DIRECTOR.md` et lectures : `rooms.tsx` lu 10 fois |
| images fixes, corrections, Reviewer | **54 min** | 10 lancements d'images fixes, 20 min pour corriger le refus du Reviewer |
| rendu Modal | **31 min** | 2 670 images à **2,2 images/s** |
| master | 0,6 min | |

Le modèle a pensé 51 minutes au total, soit environ 20 s par étape. Il a **relu `shots.tsx` 36 fois** (66 fois dans `y-school`) : l'outil d'édition exige le texte exact, et l'historique compacté ne le contient plus.

### Vidéo longue : `y-school`, 629 min

- **540 minutes perdues sur le rendu.** 14 lancements identiques ont tous expiré au bout de 30 min, chacun en renvoyant 90 Mo de sources. Le garde-fou contre les boucles n'a rien arrêté : il ne compte que les échecs consécutifs, et l'agent intercalait des lectures réussies.
- Le rendu par morceaux du commit `4264402` a ensuite produit les 28 854 images en 28 min (environ 17 images/s, 0,24 Mo envoyés).
- **Gain attendu sur une vidéo courte :** le rendu devrait passer d'environ 30 min à quelques minutes. C'est une estimation à vérifier sur un prochain short.

## 4. Pourquoi le récit et l'action ne collent pas

1. **L'agent ne sait pas quand chaque mot est dit dans un plan.** Il reçoit le texte du plan, pas le moment de chaque mot. Il ne peut donc pas déclencher une action sur « *mes ciseaux sont tombés* ».
2. **Une seule action par personnage et par plan.** `shot()` accepte un `act`, qui tourne en boucle pendant tout le plan. Avant, `poseAt` enchaînait 2 à 4 poses. Résultat : des plans qui « tiennent » au lieu de jouer.
3. **Le vocabulaire ne contient que des gestes génériques.** `talk`, `explain`, `idle`… Rien pour toucher, prendre, regarder quelqu'un, se gratter, couper des cheveux.
   - Dans `jumeau-2`, « *J'ai soulevé les cheveux derrière l'oreille* » donne Miles qui parle et Nora qui « explique ».
   - Quand l'histoire exige un geste précis (les ciseaux qui tombent), l'agent abandonne `shot()` et dessine le plan à la main (S4).
4. **En vidéo longue, un plan couvre 8 à 10 phrases**, il ne peut en illustrer qu'une. Le contrôle de rythme de `plan` a bien échoué (« PACE TOO SLOW »), mais rien n'empêche de continuer, et le découpage ne peut pas faire mieux que 36 plans.
5. **Le choix automatique du lieu par plan se trompe.** Le découpage de `y-school` attribue « vehicle », « restaurant » ou « rooftop » à une histoire d'hôpital-pensionnat. L'agent a dû tout réécrire.

## 5. Lacunes visuelles

Constats sur les planches rendues (`docs/screenshots/audit-2026-11-10/`).

1. **Un seul angle par lieu.** La caméra regarde toujours le mur du fond : un gros plan n'est qu'un zoom dans la même pièce. Dans `jumeau-2`, le cercle du miroir est derrière presque chaque plan. Pas de contrechamp possible.
2. **Murs « nuageux » dans tous les plans.** La texture et le voile de lumière donnent un aspect sale, très visible en 16:9.
3. **Catalogue trop étroit.** Pas d'extérieur, de salon de coiffure, d'hôpital, de rue ni de magasin.
   - Le salon de `jumeau-2` se réduit à un fauteuil standard, un miroir et un comptoir.
   - La pelouse de `y-school` est un champ vide.
4. **Gros plans mal composés.** Deux visages qui se chevauchent (`y-school` S4, S6), une tête coupée par le bord (`jumeau-2` S17).
5. **Bras levés sans raison** dans beaucoup de plans de `y-school`, effet des gestes `explain`/`point`/`wave` choisis par défaut.
6. **Un client assis lit comme debout devant son fauteuil** (`jumeau-2` S6, S13). À vérifier.
7. **« high angle » et « low angle » ne sont que des noms.** `shot()` n'a pas d'angle de caméra : ces plans sont des gros plans ordinaires.

## 6. Ce que je propose, par ordre d'impact

### Priorité 1 : rythme et cohérence récit-action (shorts et vidéos longues)

1. **Donner à l'agent le moment de chaque mot dans le plan.** Le repère affiché dans le prompt (*pin*) donnerait par exemple `S4 : C'était(0) bien(5) … ciseaux(34) tombés(40)`, à partir de `words.json` et des bornes du plan. Petit changement, fort effet.
2. **Plusieurs temps dans un plan (`beats`).** Exemple : `beats: [{ at: 'ciseaux', who: 0, act: 'startle', face: 'shock' }, { at: 'tombés', cam: 'close' }]`. `at` accepte un mot du plan ou un numéro d'image.
3. **Des actions dirigées vers une cible :** `reach` (toucher ou prendre : une personne, un meuble ou un point), `look` (regarder quelqu'un), `drop`, `give` existe déjà. Le moteur a déjà `reachOf` et `grabOf`.
4. **Audit :** au moins 2 évènements par plan avec personnage, et `idle` refusé comme seule action. C'est le même principe que l'ancien contrôle sur `poseAt`, adapté.
5. **Mesurer le rythme dans le Reviewer :** lui transmettre les évènements par plan et la durée de chaque plan.

### Priorité 2 : vidéo longue

1. **Retirer le plafond de 36 plans** et caler le nombre de plans sur une durée moyenne. Il te faut choisir cette cible, voir §7.
2. **Faire de « PACE TOO SLOW » un vrai blocage** : `stills` refusé tant que le plan échoue.
3. **Écrire par chapitres**, avec un `DIRECTOR.md` et des lieux partagés, sans tout relire à chaque lot.

### Priorité 3 : temps

1. **Vérifier le rendu par morceaux sur un short** (attendu : 30 min → quelques minutes).
2. **Coupe-circuit :** une même étape coûteuse qui échoue 2 fois de suite avec la même erreur, même avec des lectures entre les deux, arrête le tour et l'explique. Les 540 min de `y-school` n'auraient pas eu lieu.
3. **Outil `edit_shot { id, code }`** qui remplace un plan entier par son identifiant : plus besoin de relire `shots.tsx` pour l'éditer.
4. **Mettre dans le prompt** la durée et la taille de chaque plan (`timeline.json` a été relu 22 fois), ainsi que l'API complète de `place()` (`rooms.tsx` a été lu 10 fois).

### Priorité 4 : visuel

1. **Contrechamp et fonds de gros plan.** Une vue « mur opposé » pour chaque lieu, et un fond flou simplifié en gros plan au lieu d'un zoom dans la pièce.
2. **Murs plus propres :** baisser ou retirer la texture nuageuse, moins de voile.
3. **Élargir le catalogue :** extérieur (pelouse, rue, parc), boutique ou salon, hôpital, couloir, et les pièces qui vont avec (fauteuil de coiffure, lit d'hôpital, comptoir de boutique, banc, arbre).
4. **Cadrage des gros plans :** écarter automatiquement les visages qui se chevauchent, et ne jamais couper une tête.
5. **Angles réels** : `cam: 'low'` et `cam: 'high'`, ou les retirer du découpage.

## 7. Décisions à prendre

1. **Rythme cible en vidéo longue.**
   - 6 à 8 s par plan : 16 min ≈ 120 à 160 plans, plus de temps de modèle.
   - Ou 4 s, comme en short : environ 240 plans.
2. **Ordre des chantiers.** Je recommande la priorité 1 d'abord : c'est elle qui touche ton ressenti sur les shorts comme sur les longues. La priorité 3 (§6) est rapide à faire en parallèle.

## 8. Autres constats

- **`jumeaux`** : GLM-Flash a cru cinq fois que ses écritures étaient corrompues, en citant le marqueur de compactage (`exports: S1, S2`). Le commit `91870a9` de l'autre machine a déjà durci ce compactage ; pas d'autre action.
- **Reviewer de `y-school` sans `WHATIF_REVIEW_MODEL`** : il a utilisé GLM-Flash, et 2 réponses sur 6 étaient illisibles. Il ne voit pas non plus la durée des plans, donc il n'a pas relevé les plans de 27 s.

## Validation

Exécuté dans cette session :

- `scripts/measure-episode.py` sur `crush`, `jumeau-2` et `y-school`.
- Décomposition du temps à partir des horodatages de `data/app.db`.
- Comptage des évènements animés dans les `shots.tsx`.
- Rendu local des 28 + 36 images fixes à partir du code des épisodes, sur une copie hors de `data/`.

**Non vérifié :** les vidéos finales (absentes du zip), l'effet du rendu par morceaux sur un short. Le temps « modèle » inclut la latence réseau du fournisseur.

## Glossaire

- **Évènement animé** : changement dans un plan (clé de pose, d'expression, action déclenchée à un instant, rotation).
- **Contrechamp** : plan pris depuis le côté opposé, typique d'un dialogue.
- **Pin** : bloc d'état de l'épisode remis au modèle à chaque étape.
- **Rendu par morceaux** : la vidéo est coupée en segments rendus en parallèle sur Modal, puis recollés.

Images locales : `docs/screenshots/audit-2026-11-10/sheet-jumeau-2.jpg`, `docs/screenshots/audit-2026-11-10/sheet-y-school.jpg`.
