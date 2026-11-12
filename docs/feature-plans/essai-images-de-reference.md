# Essai : images de référence par scène avant le code (2026-11-12)

**Palier** P1 (essai, aucun code de l'application touché). Demandé par Pulsy : tester l'étape 1, « des images clés par scène », et dire comment garder la cohérence d'une image à l'autre.

**Épisode d'essai :** `prof` (vertical 9:16, 67 s, 30 plans, une salle de classe, 4 personnages). Il existe déjà sans images de référence, ce qui donne un point de comparaison.

**Déroulé :** Pulsy teste les prompts ci-dessous sur le ou les services de son choix, puis dit lequel on garde. Rien n'est branché dans le studio pour l'instant.

## 1. Comment on tient la cohérence

L'idée : le modèle d'image ne doit rien inventer de ce qui est fixe. Tout ce qui est fixe vient de **nos propres rendus** et d'un **texte identique** dans chaque prompt. Seule l'action change.

| Ce qui doit rester pareil | Comment on le fixe |
|---|---|
| Le style du dessin | Les rendus du moteur en référence + le bloc STYLE, identique partout |
| Les personnages (visage, coiffure, tenue) | Une planche par personnage (face, trois-quarts, profil), rendue par le moteur, jointe à chaque appel |
| Le décor (murs, meubles, couleurs) | Le rendu de la salle vide, jointe à chaque appel + le bloc ROOM, identique partout |
| La place de chacun dans la pièce | Le bloc ROOM donne une place fixe à chaque personnage et à chaque meuble |
| Gauche et droite à l'écran | Règle fixe : la prof à gauche de l'image, Maya à droite, dans tous les plans où elles sont ensemble |
| La lumière | « daylight from the window », dans le bloc STYLE |
| La continuité d'une image à la suivante | **Chaînage** : l'image A validée est jointe comme référence pour B, C, D… |

**Deux règles pratiques :**
1. Générer d'abord l'image A (plan large). Ne passer à la suite que quand elle est bonne : c'est elle qui sert d'ancre.
2. Si le service a une graine (`seed`), garder la même pour toute la série.

**Ce qu'il ne faut pas demander au modèle** (le moteur ne saura pas le refaire) : perspective forcée, plongée ou contre-plongée marquée, personnages de dos en gros plan, mains détaillées avec des doigts, ombres portées complexes, texte ailleurs que sur le tableau.

## 2. Les images à joindre à chaque appel

Dossier local (non commité) : `docs/screenshots/essai-images-prof/refs/`

1. `RefProf.png` : la remplaçante, face, trois-quarts, profil.
2. `RefMaya.png` : l'élève.
3. `RefPrincipale.png` : la principale.
4. `RefCamille.png` : le voisin.
5. `RefRoom.png` : la salle vide, vue du tableau.
6. `RefRoomReverse.png` : la salle vide, vue de la porte et de la fenêtre.
7. `RefLineup.png` : trois personnages côte à côte, pour les tailles relatives.

Si le service limite le nombre d'images, garder dans l'ordre : la salle (5), les personnages présents dans la scène, puis l'image A.

## 3. Les deux blocs fixes (à coller tels quels en tête de chaque prompt)

Les prompts sont en anglais : les modèles d'image y répondent mieux.

**STYLE**

```
STYLE — match the attached reference images exactly. Flat 2D cartoon, vector look: solid flat colours, one dark outline of even thickness, no gradients on characters, no texture, no photorealism, no 3D. Characters are simple: a large round head, dot eyes, a small curved nose, a thin line mouth, a boxy torso, thin straight arms and legs, mitten hands without fingers. Keep each character's head shape, hair, glasses and clothes exactly as in their reference sheet. Soft daylight from a window, gentle shadows on the floor only. Vertical 9:16 frame. No text, no captions, no logos, except the writing already on the blackboard.
```

**ROOM**

```
ROOM — the classroom from the reference image, unchanged: pale green back wall, dark brown tiled floor, cream ceiling with two black pendant lamps. On the back wall, from left to right: a large green blackboard with white writing, a cork pinboard with coloured notes, a round wall clock. Four wooden school desks with metal legs in two rows, a small blue bin on the right. Positions never change: the teacher (burgundy blazer, glasses, bun) stands on the LEFT of the frame near the blackboard; Maya (coral hoodie, ponytail) sits at the front desk on the RIGHT of the frame; Camille (mustard sweater) sits at the desk behind her. The door is on the wall opposite the blackboard.
```

## 4. Les six images de l'épisode

Chaque prompt = STYLE + ROOM + le texte ci-dessous. Les numéros de plans indiquent ce que l'image couvre.

### A. L'accusation (plans S1 à S4) — l'ancre, à générer en premier

Références : salle, prof, Maya, Camille.

```
SHOT — wide shot of the whole classroom. The teacher on the left slams her flat hand on the front desk, leaning forward, eyebrows angry, mouth open. Maya, seated at the front desk on the right, leans back, startled, eyebrows raised, both hands on the desk. Camille behind her looks up. Full bodies visible, the blackboard readable behind them.
```

### B. Maya se défend (plans S7 à S9)

Références : salle, Maya, prof, **image A**.

```
SHOT — medium shot on Maya, seated at her desk on the right, seen from the front at desk height. She opens both hands, palms up, worried, explaining. The teacher's burgundy sleeve and shoulder are at the left edge of the frame, out of focus. Same room, same light and same desks as the previous image.
```

### C. La fouille du sac (plans S12 à S15)

Références : salle, prof, Maya, **image A**.

```
SHOT — medium-wide shot. The teacher on the left has emptied a navy backpack on Maya's desk: three pencils, an eraser, one crumpled sheet of paper. She holds the open bag upside down, frowning. Maya, seated on the right, arms crossed, calm, almost relieved. No phone anywhere on the desk. Same room, same light as the previous image.
```

### D. L'appel à la direction (plans S16 à S19)

Références : salle, prof, Maya, **image A**.

```
SHOT — medium shot on the teacher, standing on the left beside the blackboard, holding the handset of a beige wall phone to her ear with a curly cord, her other hand pointing toward the right of the frame. She looks stern and sure of herself. Maya is small in the background on the right, seated, worried. Same room, same light as the previous image.
```

### E. La principale entre (plans S20 à S23)

Références : salle vue de la porte (`RefRoomReverse`), principale, prof, Maya, **image A**.

```
SHOT — wide shot looking toward the door wall (reverse view of the room: a wooden door in the middle, a pinboard and a window with beige curtains to its right). The door is open; the principal (navy blazer, side-parted chestnut hair, earrings) stands in the doorway, upright and calm. The teacher, seen from behind three-quarters on the left, turns toward her with a satisfied smile. Maya, seated on the right, looks at the door, eyes wide.
```

### F. Le téléphone brandi (plans S24 à S28)

Références : salle, principale, prof, Maya, **image A**.

```
SHOT — medium shot in front of the blackboard. The principal stands in the centre, holding a smartphone in a pink case up at shoulder height, screen off, looking at the teacher. The teacher on the left has her mouth open, eyebrows up, shoulders dropped. Maya, seated on the right, lowers her head with a small embarrassed smile. Same room, same light as image A.
```

## 5. Comment juger les images (grille à remplir par service testé)

| Critère | Question |
|---|---|
| Style | Pourrait-on la prendre pour un rendu du moteur ? Contour égal, aplats, pas de dégradé sur les personnages |
| Personnages | Reconnaît-on chacun d'une image à l'autre : coiffure, lunettes, couleur de tenue ? |
| Décor | Tableau, panneau, horloge, pupitres : mêmes places et mêmes couleurs dans A, B, C, D, F ? |
| Places | La prof est-elle toujours à gauche, Maya à droite ? |
| Faisable par le moteur | Les poses existent-elles chez nous (debout, assis, bras tendu, mains ouvertes, bras croisés) ? |
| Objets | Le sac, le combiné, le téléphone rose sont-ils lisibles et à l'échelle ? |
| Texte parasite | Y a-t-il des lettres inventées ailleurs que sur le tableau ? |

À noter aussi par service : le prix par image, le temps, et le nombre d'images de référence acceptées.

## 6. Ensuite (non commencé)

1. Pulsy choisit le service d'après la grille.
2. Refaire `prof` avec ces six images données à l'agent et au Reviewer, et comparer à la version actuelle : nombre de refus, remarques de cadrage, durée.
3. Si le gain est net : brancher une étape `refs` dans la chaîne (planches rendues par le moteur → images par scène → DIRECTOR.md), puis décider pour une image par plan.

## 7. Premier essai réel : API gflow, modèle `nano2-lite` (2026-11-12)

Service fourni par Pulsy : API REST « gflow » (Google Flow), `POST /v1/images/generations`, modèle `nano2-lite`, format 9:16. Sortie 768×1376.

| Image | Référence donnée | Résultat | Temps |
|---|---|---|---|
| A avec la planche du moteur (`image_base64`) | `gen/sheet.jpg` (salle + 4 personnages) | **échec** : Flow refuse l'envoi, « one-time upload-terms confirmation » | 103 s |
| `A-sans-ref` | aucune | réussie | 36 s |
| `B-chaine` | image A (`ref_media_ids`) | réussie, mais mauvaise action | 36 s |
| `F-chaine` | image A (`ref_media_ids`) | réussie, mais quasi-copie de A | 77 s |

**Ce qu'on apprend :**
1. **Composition** : A est bonne. Places respectées (prof à gauche, Maya à droite, Camille derrière), décor complet, cadre vertical bien rempli. C'est mieux composé que le plan actuel du moteur.
2. **Style** : sans notre planche, ce n'est pas notre style. Doigts détaillés, visages plus riches, perspective de coin de pièce, ombres portées. Le moteur ne sait pas refaire ça tel quel.
3. **Chaînage** : le décor et les personnages restent identiques d'une image à l'autre (tableau, horloge, panneau, tenues). La cohérence est donc tenable.
4. **Mais la référence écrase l'action** : avec A en référence, le modèle retouche A au lieu de faire un nouveau plan. F ne contient ni la principale ni le téléphone. B montre la prof penchée sur Maya au lieu de Maya seule, avec un défaut (une touffe de cheveux flotte à droite).
5. **Texte parasite** : « History », « E=mc² » inventés sur le tableau. Toléré par le prompt, à interdire si gênant.

**Conséquences pour la méthode :**
- L'image A ne doit pas être la seule référence d'un plan différent. Il faut des références « neutres » (salle vide, planches de personnages), donc l'envoi d'images doit marcher.
- Formuler les plans suivants comme un nouveau cadrage, en nommant ce qui change et ce qui disparaît.

**Bloqué, action Pulsy :** ouvrir Flow avec le compte du service, envoyer une image une fois à la main et accepter les conditions d'envoi. Autre signe à vérifier : `GET /v1/credits` répond « session expired », alors que la génération passe.

**Limites de l'API vues :** une seule image par `image_base64` ; `ref_paths` vise des fichiers sur la machine du serveur ; pas de graine. D'où la planche unique `sheet.jpg`. Jusqu'à 10 références par `ref_media_ids` pour ce modèle.

**Non exécuté :** images C, D, E ; essai avec la planche du moteur ; comparaison avec `nano2` et `nano-pro` ; prix (crédits illisibles).

Scripts de l'essai (locaux) : `gen/imgtest_gen.py`, `gen/imgtest_sheet.py`.

## 8. Deuxième essai : Agnes Image 2.5 Flash (2026-11-12)

`POST https://apihub.agnes-ai.com/v1/images/generations`, modèle `agnes-image-2.5-flash`, `size: 1K`, `ratio: 9:16` (736×1312). Les références passent en `extra_body.image` (plusieurs images, en Data URI). La doc annonce l'essai gratuit pour l'instant. La clé est passée par variable d'environnement, elle n'est écrite dans aucun fichier.

| Image | Références (planches du moteur) | Temps | Résultat |
|---|---|---|---|
| `A` | salle, prof, Maya, Camille | 14 s | notre style, mais la scène est petite au milieu : plafond vide en haut, sol vide en bas |
| `A2` (avec consigne FRAMING) | idem | 15 s | mieux remplie, bonne action (main sur le pupitre). Reste un tiers de sol vide |
| `B` | salle, Maya, prof | 15 s | Maya de face, mains ouvertes : bonne pose. **Camille est devenue une deuxième Maya** (couettes, sweat moutarde) |
| `F` | salle, principale, prof, Maya | 13 s | le téléphone rose est là. **Personnages en trop** (une Maya de plus, un personnage à chignon en moutarde), visage de la principale déformé |

**Ce qu'on apprend :**
1. **Style et décor : c'est le nôtre.** Tableau, panneau, horloge, lampes, pupitres, couleurs : identiques d'une image à l'autre, et identiques au moteur. Le texte du tableau est même repris. Le moteur saurait refaire ces images.
2. **Les références neutres règlent le problème vu avec gflow** : chaque image est un vrai nouveau plan, pas une retouche de la précédente.
3. **Identité des personnages : fragile.** Dès qu'il y a 3 personnages ou qu'un personnage n'a pas sa planche jointe, le modèle mélange coiffures et tenues, ou ajoute des figurants.
4. **Cadrage vertical : moyen.** Le modèle garde la proportion horizontale de la salle. La consigne FRAMING aide sans suffire.
5. **Défauts d'image :** halo orangé autour de certains personnages, visages parfois brouillés. Sans gravité si l'image ne sert que de guide.
6. **Vitesse :** 13 à 15 s par image, 3 en parallèle sans erreur.

**Comparaison rapide**

| | gflow `nano2-lite` (sans nos planches) | Agnes 2.5 Flash (avec nos planches) |
|---|---|---|
| Composition, mise en scène | très bonne | correcte, trop de vide |
| Fidélité à notre style | non | oui |
| Personnages stables | oui (par chaînage) | fragile au-delà de 2 |
| Nouveau plan sur demande | non, recopie la référence | oui |
| Temps | 36 à 77 s | 15 s |

La comparaison n'est pas équitable tant que gflow n'a pas reçu nos planches.

**Pistes pour le prochain tour (non exécutées) :**
- Joindre la planche de **chaque** personnage visible, et écrire « exactly N characters, no one else ».
- Donner une salle de référence rendue en 9:16 au lieu de 16:9, pour le vide vertical.
- Tester `size: 2K` pour les visages.
- Images C, D, E.

Images locales : `docs/screenshots/essai-images-prof/agnes/` (`A.png`, `A2.png`, `B.png`, `F.png`, `planche-A2-B-F.jpg`), script `agnes_gen.py`.

## 9. Agnes, deuxième tour (2026-11-12)

Changements : `size: 2K` (1472×2624), salle de référence verticale recadrée (`RefRoomV.png`), planche de chaque personnage visible, « EXACTLY N characters, no one else » dans chaque prompt.

| Image | Résultat | Personnages en trop |
|---|---|---|
| A, l'accusation | bonne pose, cadre mieux rempli | une petite prof en double au fond |
| B, Maya se défend | très bonne pose (mains ouvertes, visage inquiet) | la prof entière au fond + un double de Maya en moutarde |
| C, la fouille | sac, crayons, gomme, feuille froissée : tout est là et lisible | un double de Maya derrière elle |
| D, l'appel | combiné beige, cordon, bras tendu, prof au premier plan : le plan le plus réussi | un double de Maya en moutarde |
| E, la principale entre | **non générée** : limite du compte gratuit (HTTP 429), deux essais | — |
| F, le téléphone brandi | principale reconnaissable, téléphone rose en main | un double de Maya derrière elle |

**Ce qui est réglé :** le halo et les visages brouillés (grâce au 2K), le grand vide en haut, les objets. Le décor reste identique partout.

**Ce qui ne l'est pas :** le modèle ajoute un personnage dans 5 images sur 5, presque toujours un double de Maya au pupitre de derrière. « EXACTLY N » n'a aucun effet. Cause probable : les planches de personnages montrent trois fois la même personne, et la salle a des pupitres vides que le modèle remplit. Le texte du tableau a disparu. Il reste un quart de sol vide.

**Constat sur le moteur, vu au passage :** le plan d'ensemble vertical du moteur (`RefRoom-moteur-9x16.png`) a lui-même un tiers de plafond vide et un tiers de sol vide. Le vide des images vient en partie de là.

**Pistes suivantes (non exécutées) :**
- Planche de personnage à **une seule pose** (ou la `RefLineup` seule) au lieu de trois vues.
- Retirer les pupitres inutiles de la salle de référence pour les plans serrés.
- Générer E quand la limite est levée (délai ou offre payante : à décider par Pulsy).

Images locales : `docs/screenshots/essai-images-prof/agnes2/` (`A.png`, `B.png`, `C.png`, `D.png`, `F.png`, `planche-A-F.jpg`).

## 10. Question de Pulsy : les plans sont-ils limités par des directions trop vagues ?

Oui, en partie, et c'est mesurable sur `prof` :

1. **La note de réalisation ne dirige pas plan par plan.** `DIRECTOR.md` fait 3 272 caractères pour 30 plans. Il décrit le lieu, le casting, la palette et des principes (« alternance d'échelles », « champs / contrechamps »). Il ne dit pour aucun plan qui est où, qui fait quoi, ni ce qu'on doit voir.
2. **Certaines directions ne sont pas faisables.** Il demande des « contre-plongées accusatrices » : le moteur n'a pas d'angle de caméra. La direction est donc perdue sans que personne le signale.
3. **Un plan se résume à 5 réglages.** S1 : un cadre (`wide`), une place par personne, un geste parmi une vingtaine (`explain`), un visage (`neutral`). Il n'y a rien pour dire « elle se penche sur le pupitre », « elle retourne le sac », « elle tient le combiné ». D'où les plans qui se ressemblent et le bras tendu partout.
4. **Personne ne voit l'image avant de coder.** L'agent écrit des paramètres sans cible visuelle. Le Reviewer juge après coup, sans référence non plus.

Donc deux limites qui se cumulent : une direction globale et vague, et un vocabulaire de plan trop court pour exprimer une direction précise. Les images de l'essai montrent l'écart : C (le sac vidé) et D (le combiné) sont des mises en scène que la chaîne actuelle ne produit pas, alors que le style est le nôtre.

**Ce que ça implique :**
- Une direction **par plan** (ou par scène) avant le code : une phrase de mise en scène et, si l'essai est concluant, une image.
- Un contrôle qui refuse une direction que le moteur ne sait pas faire, au lieu de la laisser tomber.
- Élargir le moteur là où les images demandent toujours la même chose : interaction avec un objet tenu, personne penchée, premier plan fort.

## Validation

- 7 appels à Agnes au deuxième tour : 5 réussis, 2 refusés par la limite du compte gratuit (§9).
- 4 appels à Agnes Image 2.5 Flash le 2026-11-12 : 4 réussis (voir §8). Images regardées une par une.
- 4 appels à l'API gflow le 2026-11-12 : 3 réussis, 1 refusé (voir §7). Images regardées une par une.
- Planches de référence rendues en local (Remotion 4.0.530) à partir du `shared.tsx` réel de `prof` : 7 fichiers, 1920×1080.
- **Non exécuté :** aucun prix vérifié ; aucun essai avec les planches du moteur en référence.

**Images générées (locales, non commitées) :** `docs/screenshots/essai-images-prof/gen/A-sans-ref.png`, `B-chaine.png`, `F-chaine.png`, `sheet.jpg`.

**Images locales (non commitées) :**
1. `docs/screenshots/essai-images-prof/refs/RefProf.png`
2. `docs/screenshots/essai-images-prof/refs/RefMaya.png`
3. `docs/screenshots/essai-images-prof/refs/RefPrincipale.png`
4. `docs/screenshots/essai-images-prof/refs/RefCamille.png`
5. `docs/screenshots/essai-images-prof/refs/RefRoom.png`
6. `docs/screenshots/essai-images-prof/refs/RefRoomReverse.png`
7. `docs/screenshots/essai-images-prof/refs/RefLineup.png`
