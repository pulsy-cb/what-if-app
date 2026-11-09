# Recherche — skills et moteurs d'animation 2D par code (2026-11-09)

**Palier P0** : recherche seule, aucun code de l'application modifié. Périmètre : pas de modèle de diffusion.

## 1. Conclusion

1. **La découverte principale n'est pas sur internet : elle est dans ton skill de base.** Il exige déjà ce qui te manque (profil, amorces, contrôle plan par plan, gros plans). L'application a retiré ces consignes.
2. **Je n'ai trouvé aucun skill prêt à l'emploi qui fasse des histoires à plusieurs personnages et plusieurs scènes en 2D par code.** Il faut assembler des idées.
3. **La référence la plus proche est `animdsl`** : un script texte avec scènes, placements, vues (face, 3/4, profil, dos) et transitions. C'est exactement le langage déclaratif proposé au lot 4 de l'audit.
4. **Rien ne justifie de changer de moteur.** Remotion + SVG reste le bon socle.

## 2. Ce que l'application a perdu par rapport au skill

Le dépôt fait 36 Ko de références. L'application les interdit explicitement : « no reading [...] /skill/references/* » (`src/orchestrator/context.ts:111`).

| Sujet | Skill d'origine | Application actuelle |
|---|---|---|
| Orientation | « Mostly three-quarter or profile, rarely face-on » (`look.md:47`) | `yaw` absent du prompt |
| Personnage assis | « Seat characters in profile » : de face, ça ne se lit pas (`traps.md:38-40`) | Exemple unique avec `yaw` ±0,32 |
| Amorce floue | Environ un tiers des plans (`look.md:72`) | Citée en passant ; `blur16` : 0 épisode sur 11 |
| Gros plan | Zoom 3 à 4,5 (`kit.md:31`, `look.md:37`) | Prompt 2,1–2,4 ; **au-delà de 3,0 : erreur bloquante** (`whatif.ts:527`, `:533`) |
| Plan large | Zoom 0,75 à 1,1 (`kit.md:31`) | 1,0 à 1,3 (`context.ts:117`) |
| Rythme | 0,7 à 3 s, rien de statique au-delà de 3 s | 3,2 à 4 s médian sur les épisodes longs |
| Contrôle | Chaque image en taille réelle, 11 critères (`look.md:59-81`) | 3 images en tri alphabétique, Reviewer à 5 critères |
| Mise en scène | Classroom, `Kid` en amorce (`kit.md:98`) | « build custom sets » pour chaque épisode |
| Nouveau décor | Ajouté à `engine/sets/` et documenté (`kit.md:150`) | Écrit dans `shots.tsx`, perdu après l'épisode |

**Conséquence** : la variété ne s'accumule pas. Restaurant, cabine d'avion, salon : chaque décor réussi disparaît avec son épisode.

**Contexte** : le skill vise 15–25 s et un héros. L'application va jusqu'à 143 s avec plusieurs personnages. Il faut donc aussi le dépasser, pas seulement le rétablir.

**Attention, version du moteur** : le dépôt public est identique au moteur de `math-teacher` et `mobius` (3 621 lignes). Le moteur récent (4 744 à 4 750 lignes, avec `outdoor` et `vehicle`) n'existe que dans les copies des projets. **Les modifications doivent partir de ces copies**, pas du dépôt public.

## 3. Ce qui existe

### Projets directement comparables

| Projet | Ce que c'est | À reprendre | Limite |
|---|---|---|---|
| [animdsl](https://github.com/frankhart2018/animdsl) | Script texte vers vidéo, Rust, personnages procéduraux | Scènes, `place X at left-third facing right`, `camera close-up X`, `transition`, 4 vues du corps, chevauchement = erreur bloquante | 5 étoiles, expérience, Rust ; vidéos non visionnées |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | Gros ensemble de skills vidéo (78 877 étoiles) | Personnage = paquet de données, poses qui ne listent que ce qui change, contrôle en couches, `visual-style.md` | Une partie utilise la diffusion ; ces skills sont très courts (environ 1,5 Ko) ; dépôt AGPL-3.0 |
| [Remotion Transitions](https://www.remotion.dev/docs/transitions/transitionseries) | Fondus, volets, glissements officiels | `fade`, `wipe`, `slide`, overlays au point de coupe | Voir §5 : décale la synchro voix |
| [HyperFrames](https://www.heygen.com/research/html-to-video) | Vidéo en HTML + GSAP pour agents | Idée de composition simple à écrire | Aucun gain sur les personnages |

### Idées venant de la recherche

| Travail | Idée | Résultat annoncé | Utilité ici |
|---|---|---|---|
| [MoVer](https://mover-dsl.github.io) (SIGGRAPH 2025) | Le LLM écrit aussi des assertions vérifiables, le rapport d'échec lui revient | 58,8 % de réussite sans itération, 93,6 % avec jusqu'à 50 corrections | Forte : remplace nos regex par de vraies règles |
| [Code2Video](https://arxiv.org/abs/2510.01174) (NeurIPS 2025) | Planner, Coder, Critic visuel avec repères de placement | +40 % face à la génération directe | Forte : séparer le plan du code |
| [VAnim](https://yukinonooo.github.io/files/VAnim_ICML2026.pdf) (ICML 2026) | Identifier les éléments d'abord, puis ne modifier que le nécessaire | Séquences 9,8× plus courtes | Principe seul : demande un entraînement |
| [AnimTOON](https://github.com/srk0102/AnimTOON) | Le LLM ne produit que les keyframes, un convertisseur garantit le format | −98,8 % de tokens (chiffre de l'auteur) | Même principe que le langage déclaratif |
| [Prose Storyboard Language](https://diglib.eg.org/items/6600dfc3-fbcf-4784-8166-b299e2cb5a2b/full) | Grammaire formelle des plans, en coordonnées écran | Pas de chiffre | Forte : vocabulaire de cadrage |
| [Keyframer](https://arxiv.org/html/2402.06071v2) (Apple) | Le LLM anime un SVG existant, l'humain affine | Étude qualitative | Faible : pas de personnage riggé |

### Techniques de studio

- **Vues échangées, pas un visage déformé.** [Moho](https://www.lostmarble.com/moho/manual/switch_layers.html) et Adobe Character Animator font pivoter une tête en affichant des dessins distincts (face, 3/4, profil). Certaines séries sautent même la vue de face. Notre rig compresse un seul visage : c'est pour ça qu'il reste frontal.
- **Synchro labiale.** [Rhubarb](https://github.com/DanielSWolf/rhubarb-lip-sync) produit des formes de bouche à partir de l'audio, mais son moteur par défaut ne reconnaît que l'anglais. Pour le français, mieux vaut calculer les bouches depuis `words.json`.

### Écartés

- **Spine, Rive, DragonBones** : pensés pour un rig fait à la main dans un éditeur, donc mal adaptés à une génération par agent.
- **Lottie** : format très verbeux pour un LLM selon [OmniLottie](https://arxiv.org/pdf/2603.02138).
- **Moteurs d'annuaires** : les skills « remotion » listés sont des guides d'API. Aucun ne traite la mise en scène.

## 4. Ce que je recommande de reprendre

Par ordre de rapport effort / effet visuel.

**A. Rétablir le savoir du skill (petit, à faire d'abord)**
- Retirer l'interdiction (`context.ts:111`). Injecter `look.md` et `traps.md` (12,6 Ko) et la table des champs de `Pose` issue de `kit.md`.
- Rétablir les zooms du skill, avec des valeurs dédiées au 9:16 (`context.ts:116-118`, `whatif.ts:527`, `:533`).
- Donner les 11 critères à l'agent et au Reviewer.

**B. Capitaliser les décors et le style (petit à moyen)**
- Tout décor réussi rejoint `engine/sets/`, avec ses coordonnées documentées.
- Un fichier de style par épisode : palette, heure du jour, lumière, comme `visual-style.md`.

**C. Transitions (moyen)**
- Voir §5. Fondu, volet, noir ; choisis par scène.

**D. Quatre vues du personnage (moyen à gros)**
- Tête dessinée en face, 3/4, profil, dos, avec bascule sur un clignement ou une coupe.
- Corps adapté aux mêmes vues, 3 ou 4 morphologies, données séparées du rendu.

**E. Contrôles vérifiables, façon MoVer (moyen)**
- Exemples : tout le monde dans le cadre, pas de chevauchement, un personnage regarde son interlocuteur, deux plans voisins ne partagent pas le même cadrage.
- Critic visuel par lots de 8 à 12 plans.

**F. Langage déclaratif, façon animdsl (gros, le levier principal)**

Le modèle décrit, un compilateur TypeScript génère les plans. Exemple de forme possible :

```yaml
scene: confrontation
lieu: classroom
moment: jour
presents: [lou, leo]
entree: { transition: fondu, duree: 12 }
plans:
  - cadrage: amorce
    sur: lou
    depuis: leo
    lou: { place: tiers-droit, vue: trois-quarts-gauche, pose: parle, regarde: leo }
  - cadrage: gros-plan
    sur: leo
    leo: { vue: trois-quarts-droite, expression: smug }
```

Avant d'y investir : **écrire une scène de crush à la main dans ce format** et comparer le résultat.

## 5. Point technique : les transitions

La documentation Remotion indique que `TransitionSeries` **raccourcit la durée totale** (40 + 60 − 30 = 70 images). Notre montage est calé au mot près sur la voix : l'utiliser tel quel la désynchroniserait.

Recommandation : garder la timeline, et faire chevaucher deux plans pendant quelques images dans `Episode` (`engine/episode.tsx:123-135`). Risque connu du skill : les identifiants SVG doivent rester uniques quand deux plans s'affichent ensemble (`traps.md:42`).

## 6. À ne pas faire

- Migrer vers HyperFrames ou GSAP : même problème de personnage, gros chantier.
- Réécrire le rendu en Rust.
- Entraîner un modèle spécialisé (VAnim, AnimTOON).
- Importer OpenMontage en bloc : trop large, et sa licence AGPL impose une vérification. Reprendre les idées, pas les fichiers.

## 7. Décisions à prendre

1. On commence par **A + B**, puis on mesure avec le test A/B de l'audit ?
2. Le test de la scène en langage déclaratif (F) t'intéresse maintenant, ou après A + B ?
3. « Centré sur les utilisateurs » désigne bien les personnages ?

## 8. Validation et limites

- **Lu** : skill complet côté `SKILL.md`, `look.md`, `kit.md`, `traps.md` ; empreinte de son moteur comparée aux 14 projets.
- **Lu sur GitHub** : README et spécification d'animdsl, 4 skills OpenMontage.
- **Non vérifié** : aucun de ces outils n'a été installé ou lancé. Aucune vidéo visionnée.
- **Chiffres** : ceux du tableau viennent des auteurs. La note `+40 %` de Code2Video et les 98,8 % d'AnimTOON ne sont pas reproduits.
- **Recherche incomplète** : `gh search repos` n'a rien renvoyé. L'absence de skill équivalent vaut pour les recherches web menées, pas comme preuve générale.
- **Annuaires de skills** : descriptions et compteurs d'installation contradictoires, non retenus.
- **Licences** : skill de base MIT. OpenMontage : dépôt AGPL-3.0, mais certains skills se déclarent MIT. animdsl : pas de licence formelle (« use it however you want »).

**Fait** : ce fichier, et mise à jour de `audit-visuel-2026-11-09.md`. Skill cloné uniquement en dossier temporaire. Aucun commit.

## Glossaire

- **DSL** : petit langage spécialisé, ici pour décrire des scènes.
- **Vue** : dessin d'un personnage sous un angle donné.
- **Rig data-driven** : le personnage est décrit par des données, le moteur reste générique.
- **Assertion** : règle vérifiable automatiquement.
- **Critic** : agent qui juge le résultat visuel.

## Sources

- [what-if-animation](https://github.com/kelano86/what-if-animation)
- [animdsl](https://github.com/frankhart2018/animdsl) · [présentation](https://hnshowcase.com/post/47108065/a-2d-animation-dsl-every-line-written-by-claude-zero-human-c)
- [OpenMontage](https://github.com/calesthio/OpenMontage)
- [Remotion TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries)
- [HyperFrames](https://www.heygen.com/research/html-to-video)
- [MoVer](https://mover-dsl.github.io) · [article](https://arxiv.org/abs/2502.13372)
- [Code2Video](https://arxiv.org/abs/2510.01174)
- [VAnim](https://yukinonooo.github.io/files/VAnim_ICML2026.pdf)
- [AnimTOON](https://github.com/srk0102/AnimTOON)
- [OmniLottie](https://arxiv.org/pdf/2603.02138)
- [Keyframer](https://arxiv.org/html/2402.06071v2)
- [Prose Storyboard Language](https://diglib.eg.org/items/6600dfc3-fbcf-4784-8166-b299e2cb5a2b/full)
- [Animating SVGs with LLMs](https://scosman-blog.pages.dev/blog/animating_svgs_with_llms)
- [Moho, Switch Layers](https://www.lostmarble.com/moho/manual/switch_layers.html)
- [Adobe Character Animator, Head Turner](https://community.adobe.com/t5/character-animator-discussions/creating-a-character-with-head-and-body-turns/td-p/11825446)
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync)
- [Spine runtimes](https://github.com/EsotericSoftware/spine-runtimes) · [Rive vs Spine](https://rive.app/rive-vs-spine)
