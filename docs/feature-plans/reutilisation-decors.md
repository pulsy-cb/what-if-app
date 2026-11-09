# Conception — réutiliser les décors sans perdre la cohérence

**Palier P3** (moteur + prompt + pipeline). Conception seule, validation Pulsy requise avant code.
Lié à : `amelioration-visuel-et-systeme.md` (lot 3).

## 1. Le vrai problème

Tu décris deux échecs opposés :

| Échec | Cause |
|---|---|
| **Réutiliser un ancien décor ne colle pas au contexte** | Un décor réutilisé est un bloc fermé : lieu, heure, couleurs et même histoire y sont figés |
| **Le reprendre tel quel crée une incohérence avec le reste** | Chaque décor a sa propre palette et sa propre lumière, rien ne les lie |

Preuve dans le code : `Classroom` écrit en dur « 7 × 8 = ? » au tableau, une pomme et un globe sur le bureau du prof, 5 élèves figés (`engine/sets/classroom.tsx:62-190`). C'est un **décor-histoire**, pas un décor réutilisable. Idem `Bedroom` : lit, calendrier et lune sont fixes.

À l'inverse, « tout faire sur mesure » (état actuel) donne des décors qui ne s'accumulent pas et des erreurs de modèle (tableau suspendu dans `crush`).

## 2. Principe : réutiliser des pièces, pas des scènes

Trois niveaux, chacun avec une règle différente.

| Niveau | Contenu | Réutilisation | Cohérence |
|---|---|---|---|
| **1. Style** (global, quasi figé) | Rig des personnages, épaisseur de trait, rim light, grain, familles de palettes, grammaire de lumière | **Toujours identique** entre épisodes | C'est la signature visuelle |
| **2. Pièces** (catalogue) | Mobilier et éléments : bureau d'élève, tableau, fenêtre, lit, comptoir, siège d'avion, étagère… | **Réutilisées librement**, paramétrées | Héritent du style et des jetons de l'épisode |
| **3. Scène** (par épisode) | Quel lieu, quelles pièces, où, à quelle heure | **Jamais copiée** : recomposée à chaque épisode | Définie une seule fois dans l'épisode, partagée par tous ses plans |

Conséquence : deux épisodes en classe auront le même *langage* (niveau 1) et les mêmes *briques* (niveau 2), mais pas la même salle (niveau 3). Variété et cohérence ne s'opposent plus, elles vivent à deux niveaux.

## 3. Les jetons d'épisode (le garant de la cohérence)

Un fichier par épisode, `src/episodes/<slug>/style.json`, lu par **toutes** les pièces :

```json
{
  "heure": "jour",
  "palette": { "mur": "#BFD3C2", "sol": "#CB9063", "bois": "#B98A55", "accent": "#E05780" },
  "lumiere": { "source": "fenetre-gauche", "chaleur": 0.7 },
  "ambiance": "lycée, matin, clair"
}
```

- Les pièces ne portent **aucune couleur en dur** : elles lisent la palette. Le bureau d'élève est brun dans un lycée de jour, bleu-gris dans un décor de nuit, sans changer une ligne.
- Un contrôle automatique compare les couleurs des plans aux jetons (extension de ce que fait déjà `shotsAudit` sur `DIRECTOR.md`, `whatif.ts:386-403`).
- Deux épisodes de la même série peuvent partager un `style.json` si tu veux une saison cohérente : c'est un choix, pas une obligation.

## 4. Une scène = une recette, pas du TSX

Aujourd'hui l'agent écrit le décor en TSX (`CustomRoom`, `Box`…) : c'est là que naissent les erreurs. À la place, il écrit une **recette** en données :

```json
{
  "lieu": "salle-de-classe",
  "piece": { "gabarit": "rectangle", "profondeur": 3.2 },
  "elements": [
    { "p": "tableau",       "pos": "mur-fond", "ecrit": "" },
    { "p": "fenetre",       "pos": "mur-gauche", "n": 3 },
    { "p": "bureau-eleve",  "rangees": 2, "colonnes": 3 },
    { "p": "horloge",       "pos": "mur-fond-droite" }
  ],
  "retirer": ["rideaux"]
}
```

- Un compilateur TypeScript transforme la recette en décor. L'agent ne peut plus placer un tableau en l'air : la position `mur-fond` est contrainte par le moteur.
- Les emplacements `ecrit`, `ranges`, `occupants` sont des **slots** : l'histoire entre par là (ce qui est écrit au tableau), pas dans la pièce.
- Les erreurs de fichier, de syntaxe et de placement des modèles Flash disparaissent à ce niveau (c'est la même logique que le lot 6, à plus petite échelle).

## 5. Comment l'agent choisit : l'escalier de réutilisation

Règle de décision, dans l'ordre, au démarrage d'un épisode :

1. **Gabarit existant adapté** : le lieu correspond (classe, chambre, cuisine…) → on part de sa recette, on change palette, heure, éléments (`retirer`/`ajouter`). Cas fréquent.
2. **Composition de pièces** : le lieu n'a pas de gabarit (cabine d'avion, salon de coiffure) → on assemble des pièces du catalogue.
3. **Nouvelle pièce** : il manque un objet précis (siège d'avion, miroir psyché) → l'agent la dessine, elle est **validée puis versée au catalogue**.
4. **Jamais** : copier un `shots.tsx` ou un décor d'un autre épisode.

C'est précisément ce qui évite l'incohérence : on ne reprend jamais un décor « tel quel », on reprend un **gabarit paramétré** par les jetons de l'épisode.

## 6. Éviter « le contexte ne correspond pas »

Chaque pièce et gabarit porte des **métadonnées de contexte** :

```json
{
  "id": "bureau-eleve",
  "lieux": ["salle-de-classe", "examen"],
  "epoque": ["actuel"],
  "ambiance": ["jour", "nuit"],
  "parametres": ["bois", "rangees", "colonnes", "usure"],
  "exclut": ["restaurant", "bureau-entreprise"]
}
```

- L'agent voit une **table courte** (id, lieux, paramètres), pas le code : ça tient dans le contexte même d'un modèle Flash.
- Un contrôle refuse une pièce hors contexte (ex. nappe à bougies hors restaurant : le contrôle existe déjà à la main, `whatif.ts:540-546`, il devient une donnée).
- Une pièce n'embarque **jamais d'élément narratif** : pas de « 7 × 8 », pas de personnage figé. Les occupants sont des `Hero` posés par l'épisode.

## 7. Promouvoir une nouvelle pièce

Pour que le catalogue grossisse sans se polluer :

1. L'agent dessine la pièce dans l'épisode.
2. Une **planche de pièces** (comme `CastSheet` pour les personnages) la rend sous 3 palettes et 2 heures.
3. Elle passe les contrôles du skill : pieds et ombre de contact, échelle par rapport au personnage, contraste (`look.md`, `traps.md`).
4. **Validation Pulsy** (ou Reviewer) avant d'entrer dans `engine/` : sinon un mauvais dessin se propage à tous les épisodes.

## 8. Ce que ça change dans le code

| Fichier | Changement |
|---|---|
| `engine/sets/*.tsx` | extraire les éléments en dur (tableau « 7×8 », pomme, élèves, calendrier) vers des slots ; lire la palette des jetons |
| `engine/pieces/` (nouveau) | catalogue de pièces + métadonnées (`.json` à côté) |
| `engine/recipe.tsx` (nouveau) | compilateur recette → décor, position contrainte |
| `src/episodes/<slug>/style.json`, `scene.json` | jetons et recette de l'épisode |
| `src/orchestrator/context.ts:58,115` | remplacer « build custom sets » par l'escalier du §5 et la table courte du catalogue |
| `src/tools/whatif.ts` (`shotsAudit`) | contrôle jetons / contexte ; refus de copie d'un autre épisode |
| `src/tools/whatif.ts` (`whatif_new`, `whatif_sync_engine`) | **à lire d'abord** : comment le moteur est copié aujourd'hui |

## 9. Expérience avant de s'engager

Sur un seul gabarit, `Classroom` :

1. Extraire les éléments narratifs en slots, lire une palette.
2. Générer **4 classes** depuis le même gabarit : lycée de jour, primaire coloré, amphi universitaire, salle de nuit.
3. Générer **1 lieu non scolaire** avec les mêmes pièces (salle de réunion).
4. Juger : sont-elles clairement différentes ? clairement du même univers ?

Réussite : 4 classes reconnaissables, nettement distinctes, sans aucun élément de l'histoire d'origine. Échec : elles se ressemblent trop (gabarit trop rigide) ou se contredisent (jetons insuffisants) → on revoit le découpage en pièces avant d'étendre à d'autres lieux.

## 10. Limites et risques

- **Le catalogue ne couvre pas tout** : un lieu très spécifique passera par l'étape 3 (nouvelle pièce), avec le coût d'erreurs de modèle déjà observé. À mesurer : part d'épisodes entièrement couverts par le catalogue.
- **Trop de paramètres** : si une pièce en a 15, le modèle les remplit mal. Cible : 3 à 6 par pièce.
- **Découpage en pièces** : un mauvais découpage donnera des décors « Lego ». Le test du §9 sert à le détecter tôt.
- **Moteur de référence** : 4 copies divergentes aujourd'hui (la plus récente : `crush`). Il faut en choisir une avant d'extraire les pièces.
- Aucun de ces points n'est mesuré : c'est une conception, pas un résultat.

## 11. Décisions à prendre (Pulsy)

1. Le principe « pièces + jetons + recette » (§2 à §5) te convient ?
2. Veux-tu **valider chaque nouvelle pièce** avant qu'elle entre au catalogue, ou laisser le Reviewer décider seul ?
3. Les jetons : un `style.json` **par épisode** (variété maximale), ou **partagé par série** quand tu le décides ?
4. On lance l'expérience du §9 (classe ×4 + 1 lieu) avant d'aller plus loin ?

## Validation

Aucun code modifié, rien exécuté. S'appuie sur la lecture de `engine/sets/classroom.tsx`, `engine/room.tsx`, `engine/furnish.tsx`, `src/orchestrator/context.ts` et `src/tools/whatif.ts` (contrôles).
**Fait** : ce fichier. Aucun commit.

## Glossaire

- **Jeton (token)** : valeur de style nommée (couleur, heure, lumière) lue par tous les éléments.
- **Pièce** : élément réutilisable d'un décor (bureau, fenêtre, lit).
- **Gabarit** : décor type paramétrable pour un lieu (classe, chambre).
- **Recette** : description en données d'une scène, compilée en décor.
- **Slot** : emplacement où l'histoire de l'épisode entre dans une pièce.

---

# Résultat de l'expérience (2026-11-09) et ce qui a été livré

## Expérience « classe ×4 + 1 lieu » — rendue en local (Remotion), 9:16

Planche : `docs/screenshots/lot3/classes-x5.png` (local, non versionné). De gauche à droite : défaut, lycée de jour, primaire, amphi, classe de nuit, salle de réunion.

| Scène | Même gabarit, autres jetons/slots | Verdict |
|---|---|---|
| Défaut | aucun changement | **identique à l'original** : 0 pixel de différence au-dessus du bas de l'image, 176 pixels ≤ 5/255 (arrondi flottant), bas de l'image = correctif voulu |
| Lycée de jour | mood `day`, tableau « Théorème de Thalès », copies sur le bureau | **net** : se lit comme une classe, rien de l'histoire d'origine |
| Primaire | murs menthe, sol rose, pupitres orange, 3 rangées, 2 fenêtres, dessins colorés, « A B C » | **net** : très différente |
| Amphi | sans fenêtres, ardoise, longs bancs (`len`), sans panneau ni casiers | **moyen** : se lit comme une classe sombre aux longs bancs, pas comme un amphi (pas de gradins) |
| Nuit | mood `night` bleuté + lampe (`Glow` en slot `extra`) | **moyen** : distincte du défaut, mais la nuit se lit mal car les fenêtres sont hors cadre en 9:16 |
| Salle de réunion | `CustomRoom` + `WallBoard` blanc + `WallClock` + table | **bon** : se lit comme une salle de réunion avec les mêmes pièces |

**Critère du §9** : « 4 classes reconnaissables, nettement distinctes, sans élément de l'histoire d'origine » → **2 sur 4 nettes, 2 moyennes, 0 contradiction visuelle**. Le principe tient ; les limites sont celles du gabarit (pas de gradins, fenêtres hors cadre), pas celles du principe.

## Découverte annexe : bande claire sous le sol en 9:16
Le sol (`RoomShell` et `Classroom`) s'arrêtait au plan proche ; un cadre 9:16 montre en dessous. Corrigé dans le gabarit et par un correctif de `RoomShell`. **Ce défaut touchait tous les épisodes 9:16.**

## Écarts avec la conception
| Prévu | Fait | Pourquoi |
|---|---|---|
| `style.json` par épisode lu par toutes les pièces | jetons passés en props de `Classroom`, définis **une seule fois** dans le composant de décor partagé de l'épisode | même cohérence intra-épisode, sans nouveau format de fichier ; à reprendre si on étend aux autres décors |
| Recette JSON compilée | non fait | le lot 6 (langage déclaratif) la couvrira ; l'expérience montre que props + slots suffisent pour la classe |
| Catalogue de pièces avec métadonnées de contexte | non fait | 2 pièces seulement (`WallBoard`, `PinBoard`) ; à créer quand une 3e famille de décor est refaite |
| Validation Reviewer des nouvelles pièces | non fait | rien à valider tant que le catalogue n'existe pas |
| Moteur de référence unique | **calque `engine-overlay/`** appliqué sur chaque copie | le moteur vient du skill externe et 4 copies divergent ; un calque évite d'écraser les différences locales |

## Livré
| Fichier | Rôle |
|---|---|
| `engine-overlay/files/src/engine/pieces.tsx` | `WallBoard`, `PinBoard` |
| `engine-overlay/files/src/engine/sets/classroom.tsx` | `Classroom` gabarit : `tokens`, `CLASS_MOODS`, slots (`board`, `deskProps`, `pinboard`, `rows`+`len`, `kids`, `windows`, `clock`, `cubbies`, `extra`) |
| `src/tools/engine-overlay.ts` | applique le calque : fichiers + correctifs idempotents par ancre (`RoomShell`, `index.ts`) |
| `src/tools/whatif.ts` | `whatif_new` l'applique ; `whatif_sync_engine` l'applique aussi **sans skill monté** |
| `engine-overlay/examples/classrooms.tsx`, `README.md` | exemples et mode d'emploi |
| `Dockerfile` | `COPY engine-overlay` |
| `director-guide.ts`, `context.ts`, `engine-digest.ts` | l'agent apprend les jetons, les slots et que les fenêtres sont hors cadre en 9:16 |

## Validation
- `tsc` **0 erreur** ; `npm test` **14/14** (12 avant) ; **4 mutations** du calque détectées (idempotence, contrôle d'ancre, dry run, synchro sans skill).
- Calque appliqué sur 3 versions réelles de moteur (3 621, 4 662 et 4 744 lignes) : **0 erreur de `tsc` dans `src/engine/`** ; rendu du gabarit vérifié sur le plus ancien.
- **Non fait** : aucun projet de `data/projects/` n'a été modifié (ce sont tes données) ; le calque s'applique sur demande via `whatif_sync_engine { apply: true }` ou à la création d'un projet. Pas de run LLM réel avec le gabarit.
- Limites : seul `Classroom` est un gabarit ; `Bedroom`, `Kitchen`, `Study`… gardent leur contenu de démo.
