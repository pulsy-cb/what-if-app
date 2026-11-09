# Conception — personnages, bibliothèque, animation et profondeur 2.5D

**Palier P3** (moteur, prompt, pipeline). Conception et une expérience rendue en local : aucun code de l'application modifié, rien n'est commité.
Liens : `amelioration-visuel-et-systeme.md`, `reutilisation-decors.md`.

## 1. Réponse courte

Oui, il faut repenser le personnage, et ne pas seulement ajouter des morphologies. Mais le gain le plus rapide n'est pas là où on l'attend : **c'est la profondeur**. Elle ne demande pas de nouveau personnage et fonctionne dès maintenant avec `Hero`.

Je propose quatre briques qui s'emboîtent, et une règle commune d'ouverture :

| Brique | Ce que l'agent écrit aujourd'hui | Ce qu'il écrirait |
|---|---|---|
| **Scène 2.5D** (`Stage`) | `x: 780, y: 780, scale: 1`, ordre de dessin à la main | `at={{ u: 0.3, w: 0.6 }}` : taille, ordre, ombre calculés |
| **Corps** (morphologies) | un seul gabarit | `body: 'child'`, `'elder'`, `'broad'`… |
| **Garde-robe** | une veste en couleur, ou du SVG jetable | `outfit: ['hoodie', 'jeans', 'sneakers']` |
| **Actions** | une pose de bras + un sinus | `act('stand-up', t)`, adaptée au corps, à la vue, à la posture |

**Règle d'ouverture :** chaque catalogue a une porte de sortie. Si l'épisode demande un objet absent, l'agent descend d'un cran au lieu de rester bloqué (§7).

## 2. Ce que disent les 11 épisodes réels

Comptages approximatifs sur les `shots.tsx` (motifs de code, pas rendu).

**Profondeur**

| Constat | Mesure |
|---|---|
| `stand()`, seule aide qui calcule taille et position au sol | **10 appels pour 282 `Hero`**, dans 2 épisodes |
| Plans à plusieurs où tout le monde a la même échelle | `crush` 22/23 · `poudre` 9/9 · `new-rdv` 8/8 |
| Échelle contradictoire avec la position au sol | `not-father` 13/24 |
| Taille réelle comparée à celle qu'exige la perspective de la classe | `crush` : **0,57 en médiane** |

Le dernier chiffre explique l'impression d'incohérence. Le personnage a les pieds près de la caméra, mais la taille qu'il aurait au fond de la pièce : il paraît miniature et détaché du sol. Corriger ça agrandit les personnages proches, ce qui **remplit aussi le cadre 9:16**.

**Animation**

- 333 appels à `actPose` : `idle` + `talk` + `explain` en font **64 %**.
- 10 gestes sur 20 servent moins de 5 fois. L'agent invente `'walk' as any` et `'smug' as any` : la demande existe, le catalogue ne suit pas.
- **Défaut réel** : les bras s'écartent toujours sur leur propre côté, même de profil (`rig.tsx`, `joints()`, `dir = isLeg ? pose.facing : s`). Un personnage de profil qui « explique » lève donc un bras vers l'arrière. Le lot 5 a rendu ce défaut plus visible.

**Personnages**

- Seul le costume varie (36 `makeLook`) : même corps, même torse, couleurs différentes.
- Les notes de réalisation mentionnent enfant (5), bébé (5), vieux (4), blouse (3), tablier, robe : le rig ne sait pas les faire.
- `headGear` (27) et `torsoGear` (21) servent à du SVG jetable (`MicBoom`, `ChandlerStrap`), perdu après l'épisode et absent des vues de dos.

## 3. Le personnage : un nouveau composant à côté de `Hero`

| Option | Pour | Contre |
|---|---|---|
| Continuer à patcher `Hero` | peu de travail immédiat | bloc de 270 lignes, coiffures en dur, correctifs fragiles sur 4 copies |
| **Nouveau `Person`, `Hero` conservé** (recommandé) | données séparées du dessin, livré en fichiers neufs, aucun épisode cassé | deux composants à maintenir un temps |
| Rig externe (Spine, Rive) | outils mûrs | fait pour un rig dessiné à la main, écarté par la recherche |

`Person` reprend les champs de `Pose`, donc `poseAt`, `faceAt` et `ikArm` restent utilisables. Le travail du lot 5 (têtes de profil et de dos) devient ses données de coiffure.

```tsx
const LOU = cast({
  body: 'teen',
  skin: 'peach',
  hair: { style: 'bob', color: 'chestnut' },
  outfit: ['hoodie:rose', 'jeans', 'sneakers'],
  acc: ['backpack'],
});
```

**Piège à traiter dès le départ :** `joints(pose)`, `handWorld`, `ikArm`, `grabAt` ne connaissent pas les proportions : avec un autre corps, la main serait au mauvais endroit et les objets flotteraient. **Fait à l'étape B : `handOf`, `ikArmOf`, `reachOf`, `grabOf` reçoivent le corps** (argument explicite, car `poseAt` ne transporte pas de champ supplémentaire proprement typé).

### Morphologies

Un corps est un petit jeu de nombres, pas un dessin :

```ts
type Body = { head: number; torsoH: number; shoulder: number; hip: number; belly: number;
              upperArm: number; foreArm: number; thigh: number; shin: number; limb: number; height: number };
```

**Priorité (décision du 2026-11-09) : `teen` et `adult`.** Viennent ensuite `child`, `tall`, `broad`, `elder`. Un bébé reste un accessoire porté, pas un rig. Chaque corps garde la signature du style : tête ronde, trait épais, membres clairs.

Le torse devient une **forme calculée** depuis ces nombres et la vue. Le profil utilise `belly` : un corps large se reconnaît surtout de côté.

### Garde-robe en couches

Un vêtement ne dessine pas sur un corps fixe. Il reçoit les mesures, la vue et la palette :

```ts
garment({ id: 'apron', slot: 'over', draw: ({ view, m, c, ink }) => /* SVG */ })
```

| Couche | Exemples | Particularité |
|---|---|---|
| `legs` | jean, short, jupe | la jupe suit les genoux, donc s'adapte assis |
| `feet` | baskets, bottes | |
| `top` | t-shirt, chemise, sweat, pull | règle aussi la couleur des manches (courtes ou longues) |
| `over` | blazer, blouse, tablier, manteau | |
| `neck` | cravate, écharpe | |
| `back` | sac à dos | **derrière de face, devant de dos** : l'ordre dépend de la vue |
| `head` / `face` | chapeaux, lunettes | |
| `hand` | objets tenus | |

Un seul générateur produit plusieurs vêtements (col, manches, fermeture en options). Environ 8 générateurs couvrent 25 pièces : c'est tenable.

**Dégradation douce :** un vêtement livré avec seulement sa vue de face reste utilisable. Les autres vues reçoivent sa couleur sur la forme de base, sans détails.

## 3 bis. Coiffures et visages, sans complexifier

Le but : deux personnages se distinguent au premier regard, sans que l'agent ait à dessiner quoi que ce soit.

**Règle de simplicité :** uniquement des **choix nommés**, jamais de curseurs. Cinq emplacements de visage au maximum, chaque option tient en quelques traits. Tout est facultatif.

```tsx
const LOU = cast({ seed: 'lou', body: 'teen', hair: 'long', face: { brows: 'thick', marks: 'freckles' } });
```

**Coiffures.** Les 12 actuelles, plus une dizaine : `long`, `braids`, `bun`, `buzz`, `side-part`, `wavy`, `fringe`, `mohawk`, `dreads`, `hijab`. Une coiffure, c'est deux formes (derrière la tête, sur la tête) dessinées pour la face, le profil et le dos. Le 3/4 réutilise la face, comme au lot 5.

**Visage.**

| Emplacement | Options | Défaut |
|---|---|---|
| `eyes` | `round`, `almond`, `sleepy`, `wide` | `round` (actuel) |
| `brows` | `none`, `thin`, `thick`, `arched` | `none` (actuel, hors expressions) |
| `nose` | `none`, `button`, `long`, `wide` | `none` de face (actuel) |
| `marks` | `freckles`, `mole`, `blush`, `dimples`, `wrinkles` | aucune |
| `facial` | `stubble`, `mustache`, `goatee`, `beard` | aucune |

Soit environ 1 600 visages sans dessin supplémentaire, avant même les coiffures.

**Accessoires du visage et de la tête :** lunettes `round` et `square`, lunettes de soleil, boucles d'oreilles, bandeau. Aujourd'hui `glasses` dessine des lunettes noires : une vraie paire de lunettes de vue n'existe pas.

**Trois garde-fous :**

1. **`eyes` ne change que l'œil ouvert au repos.** Choc, sourire et clignement restent communs : sinon il faudrait redessiner 9 expressions par forme d'œil.
2. **`seed` remplit ce qui n'est pas précisé**, de façon reproductible. L'agent peut écrire une ligne courte et obtenir un personnage varié.
3. **Le contrôle existant s'étend** : deux membres du casting ne peuvent pas avoir la même silhouette. Et la règle du skill reste : rien qui ressemble à un personnage connu.

**Volontairement exclu :** visages modulables en continu, formes de bouche par personnage, couleur des yeux (invisible à cette taille).

## 4. La profondeur : `Stage`

Un conteneur qui connaît le sol et trie les éléments.

```tsx
<Stage room={CLS} cam={cam} focus={0.6}>
  <Classroom.Shell tokens={tokens} />
  <Person of={PROF} at={{ u: 0.3, w: 0.15 }} yaw={2} act="write-board" />
  <SchoolDesk at={{ u: 0.4, w: 0.5 }} />
  <Person of={LOU} seat={desk.seat(0)} yaw={0.5} act="explain" />
  <Person of={LEO} at={{ u: 0.7, w: 0.75 }} yaw={-0.5} />
</Stage>
```

| Ce que `Stage` calcule | Effet |
|---|---|
| position et taille depuis le sol, multipliées par `body.height` | plus de personnages miniatures, un enfant reste plus petit à même distance |
| **tri automatique par profondeur** | le pupitre cache bien les jambes, sans ordre à gérer |
| ombre de contact proportionnelle | le personnage touche le sol |
| teinte selon la profondeur | les personnages du fond s'éloignent, aujourd'hui tous à pleine luminosité |
| netteté autour de `focus` | amorces et arrière-plans flous cohérents |
| parallaxe par couche quand la caméra bouge | `parallax()` existe mais n'a servi dans aucun épisode |

**Les meubles déclarent des points d'accroche** : `desk.seat(0)`, `desk.top(0.3)`. Un objet posé ou un personnage assis tombe au bon endroit, sans coordonnées.

**Ça s'applique à tous les lieux** : `Stage` reçoit un sol abstrait. `room` pour une pièce, `plane` pour un extérieur, `flat` pour une vue de côté, `seats` pour un véhicule. `at={{ x, y, scale }}` reste accepté si le lieu ne rentre dans aucun cas.

**Conséquence pour les décors :** ils doivent se séparer en coque + éléments, pour que les meubles soient triés avec les personnages. Le gabarit `Classroom` va déjà dans ce sens (`rows`, slots). **Donc refaire `Bedroom` et `Kitchen` après `Stage`, pas avant** : je modifie ma recommandation précédente.

## 5. Les actions

Trois couches indépendantes, qui se combinent :

| Couche | Rôle | Exemples |
|---|---|---|
| **Posture** | le bas du corps | debout, assis, à genoux, allongé, penché |
| **Geste** | le haut du corps | parler, expliquer, désigner, se croiser les bras |
| **Clip** | une action dans le temps | se lever, s'asseoir, marcher, courir, se retourner, entrer, sortir, sursauter, s'effondrer |

Ce que ça corrige ou ajoute :

- **Adaptation à la vue** : de profil, les bras partent vers l'avant, et le passage est progressif de face à profil.
- **Adaptation au corps** : un `style` règle amplitude et vitesse (enfant vif, personne âgée lente et voûtée).
- **Structure des clips** : anticipation, action, maintien, retour, comme le demande le skill. Aujourd'hui un geste est une pose qui oscille.
- **Retournement** : `turnAt(t, …)` change de vue sur un clignement, ce qui résout le saut signalé au lot 5.
- **Interactions à deux** : donner, serrer la main, enlacer, pousser, chuchoter. Elles utilisent `ikArm` avec la main de l'autre comme cible.
- **Gestes sur les mots** : les pics de geste se calent sur `words.json`, au lieu d'un sinus sans rapport avec la phrase.

## 6. Ce que l'agent gagne

Un personnage passe d'une dizaine de lignes de pose à une ligne déclarative. Moins de texte à produire signifie moins de réponses coupées et d'erreurs de placement, les deux points faibles mesurés sur les modèles Flash. Le **lot 6 devient une couche mince** : le JSON se compile vers `Stage`, `Person` et les actions.

## 7. Rester ouvert : l'escalier commun

| Cran | Personnage | Vêtement | Action | Lieu |
|---|---|---|---|---|
| 1. Catalogue | `body: 'elder'` | `outfit: ['apron']` | `act="stand-up"` | `<Classroom.Shell>` |
| 2. Paramètres | proportions modifiées | couleurs, options | durée, amplitude | jetons, slots |
| 3. Emplacement libre | SVG en coordonnées du corps | SVG sur une couche | keyframes `poseAt` | SVG en couche `Stage` |
| 4. Définition dans l'épisode | `defineBody` | `defineGarment` | `defineAction` | composant de décor |
| 5. Promotion au catalogue | validée par le Reviewer sur une planche | idem | idem | idem |
| Toujours possible | `<Hero>` | `torsoGear` | `pose` à la main | `at={{x,y,scale}}` |

Trois règles pour que ça reste cohérent :

1. **Les crans 3 et 4 reçoivent les mêmes outils** que le catalogue (mesures, palette, trait), donc un objet improvisé garde le style.
2. **Une définition vit dans `src/episodes/<slug>/`**, là où l'agent a le droit d'écrire. Le moteur reste protégé.
3. **La promotion est un outil séparé** : rendu sur une planche (4 vues, 3 corps), contrôle du Reviewer, puis entrée au catalogue. C'est ce qui fait grandir la bibliothèque sans la polluer.

## 8. Ordre proposé

| Étape | Contenu | Taille | Critère de réussite |
|---|---|---|---|
| **A. `Stage` sur `Hero`** | sol, tri, ombres, teinte, accroches de meubles ; `Classroom` en coque + éléments | moyen | même scène rendue avant/après ; un enfant et un adulte cohérents à 3 profondeurs |
| **B. Corps** | `Person`, `teen` et `adult` d'abord, 4 vues, bras et jambes corrigés selon la vue | gros | planche corps × vues ; mains exactes avec `grabAt` ; assis de dos correct |
| **C. Garde-robe et visages** | couches, 8 générateurs, coiffures, emplacements de visage, `seed` | gros | 8 personnages distincts assemblés en une ligne chacun |
| **D. Actions** | postures, 12 clips, 4 interactions, `turnAt` | gros | grilles de mouvement lisibles, sur 3 corps et 2 vues |
| **E. Décors et catalogue** | `Bedroom`, `Kitchen`, `Study` en coque + éléments ; escalier et promotion | moyen | un lieu absent construit sans toucher au moteur |
| **F. Lot 6** | langage déclaratif | moyen | expérience `crush` S1–S8 |

L'étape A vient d'abord parce qu'elle donne le gain le plus visible, ne dépend d'aucune autre et réduit le problème du 9:16. Cela regroupe les lots annoncés : corps et vues (B), mouvement (D), gabarits et catalogue (E).

Chaque étape commence par une expérience rendue en local, comme pour les lots 3 et 5.

## 9. Risques

- **Style** : plusieurs corps peuvent diluer la signature visuelle. La planche de l'étape B sert à le vérifier avant d'aller plus loin.
- **Volume** : 6 corps × 4 vues × 25 vêtements ne se relit pas à l'œil. Il faut des planches générées et des contrôles automatiques (membre détaché, vêtement qui dépasse).
- **Temps de rendu** : flou et teinte par personnage coûtent cher sur Modal. À mesurer à l'étape A.
- **Taille du prompt** : déjà 51,6 Ko sur 90. Le catalogue doit rester une table courte (identifiant, usage), pas du code.
- **Deux composants** : `Hero` reste pour les anciens épisodes, mais le prompt n'enseigne que `Person`.
- **Le run réel n'a pas eu lieu** : on ne sait pas encore si le modèle exploite ce qu'on lui donne. Rien n'empêche de le lancer sur l'autre machine pendant l'étape A.

## 10. Décisions prises (2026-11-09)

1. **Style conservé** : grosse tête ronde, trait épais, membres clairs, déclinés.
2. **Priorité aux ados et adultes.**
3. **Expérience `Stage` lancée** : résultat ci-dessous.
4. **Ajout** : coiffures et traits du visage, sans complexité inutile (§3 bis).

## 11. Résultat de l'expérience `Stage`

Rendu local Remotion, classe de jour, sur le `Hero` actuel. Planches locales non versionnées : `docs/screenshots/stage/`. Prototype conservé : `engine-overlay/experiments/stage/` (il n'est pas appliqué aux projets).

| Critère | Résultat |
|---|---|
| Pieds au sol, taille selon la distance | **oui** : le même personnage à 3 profondeurs reste cohérent |
| Tri automatique | **oui** : éléments écrits dans le désordre, bon ordre au rendu |
| Élève assis de dos devant le prof, pupitre compris | **oui** |
| Teinte selon la distance | **oui**, discrète et lisible |
| Mise au point | **oui après correction** : réglage actuel trop fort |
| 9:16, 16:9, décor sombre | **oui** dans les trois |
| Taille plus proche de la perspective | le 9:16 est mieux rempli, il reste du sol vide en bas |
| Coût de rendu | pas d'écart visible sur une image (6 à 8 s, bundling compris) : **mesure à refaire sur une vraie vidéo** |

**Verdict : le principe tient, je recommande de l'intégrer.**

**Ce que l'expérience a appris :**

- **La perspective juste rend les personnages proches très grands.** Sans placement réfléchi, ils masquent le fond : ma première mise en place cachait le prof et le tableau. Le guide doit donner des repères (`w` de 0,1 à 0,6 en général, au-delà c'est une amorce, proche sur un côté et fond visible au milieu). Un contrôle automatique des recouvrements serait utile.
- **Un piège technique évité** : la teinte en CSS annulait le flou sur le même groupe. Il faut deux groupes imbriqués.

**Limites constatées :**

- Assis de dos, les jambes partent sur le côté : à régler avec les vues du corps (étape B).
- Un personnage proche peut être coupé par le bord en 9:16.
- Parallaxe non testée : les murs d'une pièce ne peuvent pas glisser en bloc, il faudra recalculer la perspective.
- Sol `room` uniquement : `plane`, `flat` et `seats` restent à écrire.
- Les pupitres sont passés en éléments à la main pour le test : `Classroom` doit les exposer proprement.

## 12. Étape A intégrée au calque (2026-11-09, non commitée)

**Livré**

| Fichier | Rôle |
|---|---|
| `engine-overlay/files/src/engine/stage.tsx` | `Stage`, `Staged`, `StageItem`, `roomGround`, `planeGround` ; `at={{ x, y, scale }}` en porte de sortie |
| `engine-overlay/files/src/engine/sets/classroom.tsx` | `ClassroomShell`, `DeskAt`, `deskSeat` |
| `src/tools/engine-overlay.ts` | ajoute `stage.tsx` et son export |
| `src/orchestrator/director-guide.ts`, `context.ts` | guide `Stage` envoyé **seulement si le moteur du projet l'a** |
| `src/tools/whatif.ts` | `Staged` compte comme personnage ; refus des positions hors sol |
| `src/orchestrator/reviewer.ts`, `scripts/measure-episode.py` | comptent `Staged`, `focus` et `shots_on_stage` |
| `engine-overlay/examples/` | scènes de contrôle (classe, rue, toit) et test d'ordre |

Planche finale locale : `docs/screenshots/stage/final-6-scenes.png`.

**Validation**

| Vérification | Résultat |
|---|---|
| `tsc` / `npm test` | 0 erreur / **15/15** |
| Mutations | **5/5 détectées** |
| Calque sur 4 moteurs réels | **0 erreur dans `src/engine/`** (`rig.tsx` toujours ignoré sur le plus ancien) |
| Ordre de dessin, mesuré au pixel | **6/6** : tri, `Fragment`, SVG sans profondeur avant et après |
| Scènes rendues | classe jour et sombre, mise au point, rue (`OUTDOOR`), toit (`planeGround`) |
| Classe par défaut | pièce inchangée ; écarts sur les personnages (nez du lot 5) et sur la bande du bas (correctif) |

**Défaut trouvé par le test d'ordre et corrigé :** `Stage` lisait toute prop `w` comme une profondeur, alors que `w` veut dire largeur sur la plupart des composants du moteur (`WallFrame`, `DiningTable`…). La profondeur passe désormais uniquement par `at` ou `depth`.

**Coût de rendu** (30 images, 9:16, une seule mesure, bundling compris)

| Cas | Durée |
|---|---|
| Avant (`Hero`, échelle 1) | 15 s |
| `Hero` sans `Stage`, aux tailles justes | 28 s |
| `Stage` sans teinte | 25 s |
| `Stage` avec teinte | 31 s |

`Stage` lui-même ne coûte rien de mesurable. **C'est la taille des personnages qui ralentit** : le halo `rim` se calcule sur leur surface. La teinte ajoute environ 25 % ; `fade={0}` la retire. À surveiller sur Modal.

**Limites**

- Aucun run LLM : on ne sait pas encore si l'agent place bien en `u`/`w`.
- `Stage` trie ses enfants directs seulement.
- Parallaxe non faite.
- Assis de dos, les jambes partent sur le côté : étape B.
- Seule `Classroom` expose ses meubles.
- Pas de contrôle automatique des recouvrements : seulement des repères dans le guide.
- Rien n'a été appliqué à `data/projects/`.

## 13. Étape B intégrée au calque (2026-11-09, non commitée)

**Livré :** `engine-overlay/files/src/engine/person.tsx`. `Person` reprend le dessin de `Hero` au mot près, avec les proportions en données. `Staged` l'utilise désormais, donc `Stage` donne aussi les vues aux moteurs anciens.

| Ajout | Détail |
|---|---|
| Corps | `adult`, `teen`, `defineBody('adult', {...})` pour une morphologie sur mesure ; la taille découle des proportions |
| Torse | vue de côté dessinée (ventre selon le corps, col et cravate sur l'avant), dos uni |
| Bras | de profil, les deux partent vers l'avant ; au 3/4, le bras éloigné aussi |
| Jambes | assis de face ou de dos, elles sont raccourcies et tombent droit |
| Direction | `yaw` suffit : plus besoin d'accorder `facing` (écart bras/tête impossible) |
| Mains | `handOf`, `ikArmOf`, `reachOf`, `grabOf` connaissent le corps |

Planches locales : `docs/screenshots/stage/corps-vues.png`, `gestes-assis.png`, `person-scenes.png`.

**Validation**

| Vérification | Résultat |
|---|---|
| **`Person` adulte de face vs `Hero`** | **0 pixel de différence** (12 looks × 6 poses) |
| Mains : la main arrive sur sa cible (3 corps × 6 vues × 2 mains) | 36 cas : 34 sous 14 px, pire écart 15 px (bras éloigné du `teen` au 3/4) |
| `grabOf` avec `teen` | l'objet reste dans la main |
| `tsc` / `npm test` | 0 erreur / **15/15** |
| Mutations | **2/2 détectées** |
| Calque sur 4 moteurs réels | **0 erreur dans `src/engine/`** |
| Scènes rendues | classe, marche, rue ; assis de dos correct |

Deux défauts ont été trouvés et corrigés en cours de route : le bras éloigné au 3/4 ne pouvait rien atteindre (direction quasi nulle à l'écran) et un `yaw` négatif sans `facing` aurait envoyé les bras à l'opposé de la tête.

**Limites**

- Seuls `teen` et `adult` sont fournis ; les autres corps restent à définir.
- Le torse d'un autre corps est une mise à l'échelle du torse adulte : l'étape C le remplacera par des formes calculées.
- `walkPose` garde ses angles : de profil, les deux bras restent légèrement en avant.
- `torsoGear` n'apparaît pas de dos ; écharpe et badge ne sont pas adaptés au profil.
- La géométrie de `Person` est vérifiée par rendus et calculs ponctuels, **pas par la suite de tests** (qui ne peut pas compiler le TSX du moteur).
- Toujours aucun run LLM ; le prompt système fait environ 52 Ko sur 90.

## 14. Étape C intégrée au calque (2026-11-09, non commitée)

**Livré :** un personnage s'écrit en une ligne, et ce qui n'est pas précisé vient du `seed`, toujours de la même façon.

```tsx
const LOU = cast({ seed: 'lou', body: 'teen', kind: 'fem', hair: 'long', outfit: ['hoodie:rose', 'jeans'], face: { marks: 'freckles' } });
<Staged at={{ u: 0.36, w: 0.6 }} look={LOU} />
```

| Fichier (`engine-overlay/files/src/engine/`) | Contenu |
|---|---|
| `cast.ts` | `cast()`, peaux, couleurs, tirage reproductible, messages d'erreur avec la liste des noms connus |
| `hair.tsx` | 10 coiffures en face, profil et dos : `long`, `braids`, `bun`, `buzz`, `sidepart`, `wavy`, `fringe`, `mohawk`, `dreads`, `hijab` (les 13 du rig restent) |
| `face-parts.tsx` | sourcils, nez, marques, pilosité, lunettes de vue, boucles d'oreilles, bandeau |
| `wardrobe.tsx` | `tshirt`, `shirt`, `hoodie`, `sweater` · `blazer`, `labcoat`, `apron`, `coat` · `tie`, `scarf` · `backpack` · jupe qui suit les genoux |
| `person.tsx`, `views.tsx`, `stage.tsx` | branchements ; manches, jambes et chaussures selon la tenue (`jeans`, `pants`, `shorts`, `skirt`, `sneakers`, `boots`, `formal`) |

Le guide de l'agent liste tous les noms en quelques lignes. Planches locales : `docs/screenshots/stage/cast-*.png`.

**Validation**

| Vérification | Résultat |
|---|---|
| **`Person` sans `cast` vs `Hero`, de face** | **0 pixel de différence** |
| Planches relues | 8 personnages × 5 vues, 10 coiffures × 4 vues, options de visage en face et profil, 12 personnages au `seed` seul |
| Scène en classe | ado en sweat, élève assise en jupe, ado au sac à dos, prof de dos |
| `tsc` / `npm test` | 0 erreur / **17/17** |
| Mutations | **6/6 détectées** |
| Calque sur 4 moteurs réels | **0 erreur dans `src/engine/`** |
| Prompt système | environ 54 Ko sur 90 |

Défauts trouvés au rendu et corrigés : croissant de peau en haut des têtes de dos (arc mal calculé, présent aussi au lot 5), jean vert au lieu de denim, chaume qui dépassait de profil, casque autour du cou hérité de la coiffure `curls`, et `Staged` qui refusait un personnage `cast()` à la compilation (l'agent aurait été bloqué).

**Limites**

- **Escalier d'ouverture partiel** : les crans 1 à 3 existent (catalogue, options, `torsoGear` / `headGear`, `defineBody`). `defineGarment`, `defineAction` et la promotion au catalogue ne sont pas faits.
- Le torse d'un corps non adulte reste une mise à l'échelle.
- `torsoGear` n'est affiché que de face.
- Accord des vêtements avec le corps vérifié sur `teen` et `adult` seulement.
- La forme des yeux ne change que l'œil au repos, par choix.
- Le rendu reste vérifié hors de la suite de tests ; seule la logique de `cast()` y est couverte.
- Toujours aucun run LLM : on ignore si un modèle Flash utilise bien `cast()`.

**Prochaine étape : D (actions : postures, clips comme se lever ou se retourner, interactions à deux).**

## Validation

Mesures issues des 11 épisodes réels (`data/projects/`, lecture seule) par `ast-grep` et comptage de motifs. Le ratio 0,57 suppose la géométrie de la classe et le coefficient de `stand()` : c'est un ordre de grandeur. Le mot « costume » et « gros » n'ont pas été retenus dans le comptage des notes, car ils apparaissent surtout dans « casting et costumes » et « gros plan ». Le §11 repose sur des rendus locaux réels ; aucun run LLM, aucune vidéo complète.

## Glossaire

- **2.5D** : scène plate en couches, mais avec taille, ordre et lumière qui respectent la profondeur.
- **Morphologie** : proportions d'un corps.
- **Coque** : murs, sol, plafond d'un décor, sans les meubles.
- **Point d'accroche** : emplacement déclaré par un meuble (siège, dessus de table).
- **Clip** : animation courte définie dans le temps.
- **Parallaxe** : les plans proches bougent plus vite que les plans lointains.
- **Tri par profondeur** : dessiner du plus loin au plus proche.
