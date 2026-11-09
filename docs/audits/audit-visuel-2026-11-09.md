# Audit visuel et système — what-if-app (2026-11-09)

**Palier P0** : audit seul, aucune ligne de code modifiée.

## 1. Verdict

**Tes limites viennent surtout du système, pas des modèles Flash.** Ordre de grandeur : **70 % système, 30 % modèle**.
C'est une estimation de jugement, pas une mesure : aucun modèle n'a été relancé pour cet audit.

Un modèle plus fort corrigerait les décors mal construits et les erreurs de fichiers. Il ne pourrait pas produire
un personnage de dos, un fondu entre deux scènes ou un vrai changement de lieu : le moteur et le découpage ne le
permettent pas ou l'empêchent.

Le problème central : **l'épisode est découpé à partir des mots, pas à partir de scènes.** Chaque plan illustre un
bout de phrase, puis un LLM écrit à la main environ 1 300 caractères de TSX par plan. Il n'existe nulle part d'objet
« scène » (lieu, moment, personnages présents, entrée, sortie, transition).

## 2. Tes constats, un par un

| Constat | Cause principale | Part du modèle |
|---|---|---|
| Salle de classe peu crédible | Système : prompt, recadrage 9:16 | Forte : décor mal construit |
| Toujours face caméra | Système : rig frontal, `yaw` non documenté | Faible |
| Changements de scène faibles | Système : aucune transition, décor unique | Quasi nulle |
| Plusieurs personnages | Système : aucune primitive de groupe | Moyenne |
| Trop centré sur les personnages | Système : audits et cadrages l'imposent | Faible |
| Épisodes qui se ressemblent | Système et modèle | Moyenne |

### 2.1 Salle de classe

Le moteur a déjà une vraie classe : tableau, rangées, élèves de dos, casiers. Elle fonctionne :
[math-teacher S1](../screenshots/shot-math-teacher-s1.png). Elle n'a servi que dans `math-teacher`.

Sur [crush](../screenshots/storyboard-crush.jpg), qui se passe entièrement en classe :

- **Le prompt pousse à refaire le décor.** « build custom sets » pour chaque épisode (`src/orchestrator/context.ts:58`, `:115`).
  L'agent a donc improvisé une pièce au lieu d'utiliser `<Classroom>`.
- **Le tableau est mal placé.** C'est une planche suspendue au milieu de la pièce (`crush/.../shots.tsx:21`, `v` 0,32–0,40).
  D'où le trapèze vert en haut de presque tous les plans. Erreur de modèle, jamais détectée.
- **Les pupitres sont des tables de restaurant.** 44 occurrences de `DiningTable`, copiée de l'unique exemple du prompt (`context.ts:197-230`).
- **Rideaux violets et ciel de crépuscule dans un lycée.** `BackWindow` a des rideaux par défaut (`engine/furnish.tsx:94`), non désactivés (`shots.tsx:20`).
- **Aucun élève de dos.** `Kid` : 0 usage sur les 11 épisodes.
- **Le 9:16 coupe le décor.** Seuls 900 des 1 920 px de large sont visibles (`engine/episode.tsx:12`), soit environ 690 px à zoom 1,3.
  Les décors sont dessinés pour le 16:9 : à ce zoom, la classe perd ses fenêtres, son bureau et un tiers de son tableau.

### 2.2 Face caméra

- **Le corps est frontal par construction.** Le visage est un calque décalé et compressé sur une tête ronde (`engine/rig.tsx:513`). Pas de nez, pas de vrai profil.
- **La vue de dos n'existe pas.** `yaw` va de profil gauche à profil droit (`rig.tsx:116`). Le seul dos est `Kid`, un autre dessin, très simple.
- **Le modèle n'est pas informé.** Le prompt ne parle jamais de `yaw`. Le digest (liste générée de l'API) donne le nom du type `Pose`, pas ses champs (`engine-digest.ts:37`). Et on lui interdit de lire le moteur comme les références du skill, qui demandent pourtant des personnages « rarely face-on » (`context.ts:111`).

| Épisode | Modèle | Valeurs `yaw` écrites | dont profil marqué (≥ 0,6) |
|---|---|---:|---:|
| crush | GLM-5.3-Flash | 0 | 0 |
| poudre | GLM-5.3-Flash | 0 | 0 |
| not-father | GLM-5.3-Flash | 66 | 38 |

**Même modèle, résultat opposé.** Le modèle sait s'en servir ; le système ne le lui demande pas.

### 2.3 Changements de scène

- **Coupe sèche uniquement.** Le rendu affiche un seul plan à la fois (`engine/episode.tsx:123-135`). Le schéma ne connaît que `flash` et `shake`.
- **Un `defaultSet` fige le lieu.** Il faut 2 mots-clés dans le même plan pour en changer, sinon le décor précédent reste (`pipeline/shotlist.py:570`, `:579`). Résultat : **36 plans sur 36 au même endroit** sur crush.
- **Ton gabarit de lancement renforce cet effet** : « règle simplement defaultSet ».
- **Sans `defaultSet`, ça téléporte.** Dans `math-teacher`, « feuille » ou « bande » envoient dans `study` alors que l'histoire est en classe.
- **Pas de continuité entre plans.** Chaque plan repositionne tout le monde de zéro.
- **Rythme lent.** Les 5 épisodes longs sont tous à 36 plans, soit 3,2 à 4 s médian, contre 1,9 s visé (`README.md:182`).

### 2.4 Plusieurs personnages

Répartition sur 267 plans (11 épisodes réels) :

| Personnages dans le plan | Plans | Part |
|---|---:|---:|
| 0 | 34 | 13 % |
| 1 | 137 | 51 % |
| 2 | 77 | 29 % |
| 3 ou plus | 19 | 7 % |

Près de la moitié des plans à 3+ viennent de `not-father` (9 sur 19).

Chaque personnage se pose à la main, sans groupe, foule, contact ni gestion de profondeur. Résultat typique
(crush S19) : trois `Hero` alignés à hauteur égale, face caméra. Il n'y a qu'une seule morphologie.

### 2.5 Trop centré sur les personnages

J'ai compris « utilisateurs » comme « personnages » (à confirmer, §7).

- **Un audit l'exige.** Un plan de scène sans personnage est une erreur bloquante (`src/tools/whatif.ts:461`), avec un minimum de 45 % de plans avec `Hero` (`:617`).
- **Les messages d'erreur imposent le centre** : « centre elements around x=960 » (`src/orchestrator/layout.ts:111`, `:116`).
- **Les cadrages du prompt sont centrés** (`context.ts:116-118`) et valables « dans les deux orientations » (`:85`). Sur crush, 22 des 24 réglages `camT` distincts ont un centre entre x=930 et x=1000.
- **La taille vient des mots.** Une réplique donne un `close` (`shotlist.py:406`), donc un visage plein cadre.
- **Les outils de composition dorment.** `parallax` : 0 épisode sur 11. `Foreground` : 2. Amorce floue `blur16` : 0.

### 2.6 Variété et cohérence

La cohérence graphique est un vrai acquis : [almost-muted](../screenshots/storyboard-almost-muted.jpg) tient très bien avec le `Bedroom` du moteur.

La variété est limitée : 69 exports sur 162 ne sont jamais utilisés (dont quelques utilitaires internes), parmi lesquels `Kitchen` et `Stairwell`.
Tout passe par `CustomRoom` (102 usages). À l'opposé, [rdv](../screenshots/storyboard-rdv.jpg) montre un « restaurant » réduit à un rideau et un spot.
Sur cette planche, un bras en V revient sur plusieurs plans (cause non investiguée).

## 3. Ce qui est vraiment dû aux modèles

Crush (GLM-5.3-Flash) : 112 appels d'outils en erreur sur 501 (22 %).

- Plans écrits dans `DIRECTOR.md`, `src/exports/motiongrid.tsx`, `shts.tsx`, un fichier nommé ``shots.tsx` ``. Des fichiers du studio ont été écrasés et perdus (`crush/PROJECT.md`).
- Réponses coupées par le budget de tokens, puis lots réécrits plusieurs fois.
- Note de réalisation non suivie : `DIRECTOR.md` annonce une Lou aux cheveux longs et un Leo qui se retourne ; le code dit `bob` et ne contient aucun `yaw`.
- 177 `read_file` malgré « do not explore ».
- Fonctions disponibles peu exploitées, et imitation littérale de l'unique exemple du prompt.

**Sur les modèles que tu cites :**

- L'application **n'enregistre pas le modèle par exécution** : je ne peux pas comparer proprement.
- Traces certaines pour l'agent : Kimi-K3 (`mobius`), GLM-5.3-Flash (`not-father`, `poudre`, `crush`).
- DeepSeek n'apparaît que comme `deepseek/deepseek-v4-flash-0731`, pour **la narration française de `:8005`**. Aucune trace comme agent, et aucune trace de la version « 4.1 flash 1017 ».

## 4. Le contrôle qualité visuel ne voit presque rien

C'est le défaut qui aggrave tous les autres, quel que soit le modèle.

- **L'agent reçoit 3 images en tri alphabétique** (`src/orchestrator/agent.ts:365`) : `S1`, `S10`, `S11`, toujours. Sur `last-guy`, 12 à 13 fois ces mêmes images.
- **Sur crush : 5 plans vus sur 36**, 0 `view_image`, 0 `board` dans la base.
- **La planche longue est illisible.** Crush fait 2280×10410 px. Dans mon propre affichage, elle arrive réduite à 438×2000, soit des vignettes d'environ 100 px. Le comportement exact de GLM n'est pas vérifié.
- **Le Reviewer n'a laissé aucune trace** dans les 14 projets. Il date du 2026-11-08 22:29, après le lancement de crush. Ses 5 critères ignorent orientation, mise en scène et lisibilité du lieu (`reviewer.ts:26-40`).
- **Les audits sont textuels** : regex sur le code, encre sur une grille 64×36. Ils peuvent dire « le plan n'est pas vide », jamais « ceci ne ressemble pas à une classe ».

## 5. Autres constats système

- `write_file` peut écrire partout dans le projet, d'où les écrasements de crush.
- 4 versions différentes du moteur coexistent dans les 14 projets.
- **Le skill public est plus ancien que le moteur des projets** : toute évolution doit partir des copies récentes (voir `recherche-skills-animation-2d-2026-11-09.md`).
- 3 projets sont restés au stade placeholder : `last-guy-2`, `phone-marie`, `my-jalous-best-friend`.
- Presque aucune direction artistique humaine : sur 140 messages « utilisateur », l'essentiel est automatique.
- README obsolète sur deux points : Fish au lieu d'ElevenLabs dans le cycle, « 3 tests » pour un seul fichier.

## 6. Recommandation

Dans cet ordre. **Commencer par le lot 0**, car il tranche la question du modèle avec des chiffres.

**Lot 0 — Mesurer (petit)**
- Enregistrer le modèle par exécution : `src/orchestrator/db.ts`, `agent.ts`.
- Test A/B : les 8 premiers plans de crush, même prompt, GLM-5.3-Flash contre un modèle haut de gamme (Claude Opus 5.5 ou Sonnet 5.5).
- Pronostic : décors et erreurs de fichiers nettement meilleurs ; face caméra, cuts et décor unique inchangés.

**Lot 1 — Prompt et contrôles, sans toucher au moteur (petit à moyen)**
- `context.ts` : utiliser les décors existants quand le lieu existe, `CustomRoom` seulement sinon.
- `engine-digest.ts` + `context.ts` : documenter les champs de `Pose`, remplacer l'exemple unique par 3 mises en scène (profil, amorce, groupe), ajouter une table de cadrages 9:16.
- `whatif.ts:461`, `layout.ts:111,116` : autoriser les plans sans personnage et les compositions décentrées.
- `agent.ts:365` + étape `board` : tri naturel, planches de 8 à 12 plans.
- `reviewer.ts` : vérifier qu'il tourne, ajouter orientation et lisibilité du lieu, lui donner un modèle vision solide.
- `write_file` : limiter à `src/episodes/<slug>/`.

**Lot 2 — Un vrai modèle de scène (moyen)**
- `scenes[]` dans `episode.json` : lieu, moment, personnages, entrée, sortie, transition.
- `pipeline/shotlist.py` : découper par scène puis par action, retirer la devinette par mots-clés.

**Lot 3 — Le moteur (gros, nécessite le skill)**
- Vue de dos, vrai 3/4, 3 ou 4 morphologies.
- Transitions : fondu, volet, raccord sur objet.
- Groupes et contacts, décors composés aussi pour le 9:16, palettes et heures du jour par épisode.

**Lot 4 — Le levier principal : un langage de plan déclaratif (gros)**
Le LLM décrit le plan en JSON (scène, personnages, placement, action, cadrage) et le moteur compose. Plus de TSX écrit à la main.
Fin des erreurs de syntaxe et de placement, cohérence garantie, variété portée par le moteur, et **les modèles Flash redeviennent suffisants**.
Modèle plus coûteux seulement pour la note de réalisation et le Reviewer.

## 7. Décisions à prendre

1. « Centré sur les utilisateurs » veut bien dire « sur les personnages » ?
2. Quel moteur sert de base aux lots 3 et 4 ? Recommandation : la copie la plus récente des projets.
3. On lance le lot 0 puis le lot 1 ? Le test A/B appelle un service payant : j'attends ton accord.

## 8. Validation

- **Base lue en lecture seule** : `data/app.db`, 14 projets, 4 779 messages.
- **Analysé** : `shots.tsx`, `episode.json`, `timeline.json` des 11 épisodes réels ; moteur, prompt, Reviewer, audits, `shotlist.py`.
- **Vu à l'œil** : 4 planches (crush, math-teacher, rdv, almost-muted) et 2 plans.
- **Non exécuté** : aucun modèle, aucun rendu, aucun test.
- **Non vérifié** : aucune vidéo finale (`out/` absent de ce poste). Le mouvement et les coupes sont jugés d'après le code. Les 7 autres épisodes réels sont jugés d'après leur code seul.
- **Limite des comptages** : ce sont des motifs dans le code. Un `Hero` généré dans une boucle compte pour un.

**Fait** : ce fichier. Aucun commit.

## Glossaire

- **Rig** : squelette animable d'un personnage.
- **`yaw`** : rotation du personnage sur lui-même (de −1 profil gauche à +1 profil droit).
- **Plan / insert / close** : unité de montage ; gros plan sur un objet ; plan serré.
- **Amorce** : élément flou au premier plan, par exemple l'épaule d'un personnage.
- **Parallaxe** : décalage de vitesse entre les couches, qui donne de la profondeur.
- **Digest** : liste de l'API du moteur, générée et donnée au modèle.
- **Déclaratif** : on décrit le résultat voulu, le moteur s'occupe de le réaliser.
- **Test A/B** : même tâche avec deux variantes, pour comparer.

## Corrections et ajouts (2026-11-09, après les lots 0 à 2)

- **`write_file`** : il existait déjà une liste d'interdits (`package.json`, `scripts/`, `.git/`, `.env`), pas d'absence totale de contrôle. `src/engine/` et `src/exports/` restaient écrivables, ce qui explique les écrasements de `crush`. Corrigé par une liste d'autorisés.
- **Reviewer** : activé par défaut avec les fournisseurs réels, mais il date du 2026-11-08 22:29 et n'a été déclenché dans aucun projet (aucune étape `board` après sa mise en place). Son modèle par défaut est celui de l'agent.
- **Rendu 9:16** (mesuré sur rendu) : un tiers du cadre est du plafond ou du sol vides ; `yaw` 0,85 ne produit pas un vrai profil ; le contrôle d'encre ne détecte presque rien.
- Les tests sont au nombre de 6 avant, 12 après (le README disait 3).
