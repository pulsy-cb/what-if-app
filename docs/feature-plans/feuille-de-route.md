# Feuille de route : intégrer les améliorations notées (2026-11-13)

**Palier** P0 (organisation). Question de Pulsy : au-delà des corrections de l'audit, comment intégrer les améliorations et évolutions qu'on a notées ?

Ce document range tout ce qui est ouvert en lots, dans un ordre, avec ce dont chaque lot dépend. Les détails restent dans les notes citées.

## 1. La méthode : un lot, un lancement, un audit

Ce qui a marché ces trois jours, à garder :

1. **Un lot court** (une à trois améliorations liées), codé et testé ici : tests, mutations, rendus regardés.
2. **Commit, zip du code**, mise à jour de l'autre machine.
3. **Deux ou trois vidéos réelles** lancées par Pulsy, avec gpt-6.1-terra de préférence.
4. **Zip des données renvoyé**, audit chiffré : ce qui est utilisé, ce qui est refusé à tort, ce que le Reviewer reproche.
5. **Le lot suivant est choisi d'après l'audit**, pas d'après le plan.

Pourquoi : l'audit du 13 novembre a montré deux choses qu'aucun test ne pouvait montrer. Mes règles refusaient à tort (150 refus), et les nouveautés décrites dans le guide n'étaient pas utilisées. Seul un vrai lancement le révèle.

**Une mesure fixe à chaque audit**, pour comparer les lots entre eux :

| Mesure | Valeur au 13 nov. |
|---|---|
| Projets acceptés par le Reviewer | 1 sur 5 |
| Durée avec gpt-6.1-terra | 22 et 46 min |
| Part de `idle` dans les gestes | 27 % |
| Plans verticaux à deux avec profondeur | 2 sur 106 |
| Refus de l'audit par projet | 4 à 23 |
| Défauts de contact main-objet au dernier tour | 13 sur 26 |

## 2. Les lots

### Lot A — corrections de l'audit (fait le 2026-11-13, non commité)

Points 1 à 4 de `docs/audits/audit-lancements-2026-11-13.md`, plus le plafond de revue.

| Correction | Où |
|---|---|
| Le décor cité dans `objects` n'est plus refusé : seuls les objets tenus ou manipulés doivent être dessinés | `src/tools/staging.ts` (`handledObjects`) |
| `hold` accepte `kind`, `name`, `object`, `item`, un dessin direct, ou `{ node }` pour un objet hors bibliothèque ; message clair sinon | `engine-overlay/files/src/engine/shot.tsx` (`holdOf`) |
| Le narrateur est refusé dans `people` dès l'écriture de la fiche | `src/tools/staging.ts` |
| Un angle écrit sur la fiche est appliqué au plan tout seul | `src/tools/staging.ts` (`applyCardAngles`), appelé par `shotsAudit` dans `src/tools/whatif.ts` |
| Plafond de tours de revue : 2 → 3 par défaut | `src/orchestrator/config.ts` |
| Guide de l'agent mis à jour | `src/orchestrator/director-guide.ts` |

Validation : `npm test` 59/59 ; 4 mutations détectées sur 4 ; rendu regardé de `hold` avec `kind`, avec un portefeuille dessiné à la main, et des gestes `give` et `read`.

**À faire sur l'autre machine :** la variable `WHATIF_REVIEW_MAX_ROUNDS` y vaut 8. La retirer ou la mettre à 3, sinon le nouveau défaut ne s'applique pas.

### Lot B — le contact et la profondeur (fait le 2026-11-13, non commité)

| Point | Où | Résultat |
|---|---|---|
| La main qui touche (H1) | `engine-overlay/files/src/engine/shot.tsx` (`stepIn`, `ARM_REACH`) | Une personne qui a un `reach` vers un meuble ou un point est placée à portée de bras, et se tourne vers la cible si aucun `yaw` n'est donné. Vérifié à l'image sur 4 places de départ : la personne finit toujours contre le pupitre |
| La profondeur en vertical (H2) | `src/tools/staging.ts` (`stagingCodeProblems`) | En 9:16, au moins un tiers des plans à deux personnes ou plus doit utiliser `cam: 'deep'` ou des profondeurs écartées (0,3 et plus). Sinon l'audit refuse et nomme les plans. Règle active à partir de 4 plans de ce type |
| `idle` refusé si la fiche décrit une action | idem | Un plan où personne n'a de geste, d'objet, de `reach` ni de déplacement est refusé, avec la liste des gestes proches |

Limite vue à l'image : la personne qui touche un pupitre occupé se retrouve derrière celle qui y est assise. La main est alors cachée. C'est une conséquence de la place des sièges (voir lot C).

### Lot C — le dessin du personnage (fait en partie le 2026-11-13, non commité)

| Point | Où | Résultat |
|---|---|---|
| Main du bras éloigné (H6) | `engine-overlay/files/src/engine/person.tsx` (`farHandHidden`) | **Corrigé.** La main cachée derrière le corps n'est plus dessinée. Vérifié à 5 angles : plus de forme blanche sous la veste |
| Se pencher vu de face (H8) | `engine-overlay/files/src/engine/actions.ts` (`own`) | **Corrigé, effet léger.** De face, le corps s'affaisse un peu au lieu de ne rien faire. De profil, rien ne change |
| Assis sans meuble en plan serré (H7) | — | **Non corrigé, cause trouvée.** Le siège d'un pupitre est placé côté caméra : l'élève est assis *devant* son pupitre, qui reste derrière lui. Dans les images de comparaison, l'élève est *derrière* le pupitre, qui cache ses jambes et reçoit ses mains. Changer cela modifie l'aspect de tous les épisodes d'école : **décision de Pulsy** |

### Lot D — la direction avant le code (points 1 et 2 faits le 2026-11-13, non commité)

| Point | Où | Résultat |
|---|---|---|
| Le Reviewer lit les fiches avant le code (H10) | `src/orchestrator/reviewer.ts` (`reviewStageCards`), `src/orchestrator/agent.ts` | Dès que toutes les fiches sont écrites, un appel en texte seul renvoie au plus 8 remarques. C'est un conseil : rien n'est bloqué. Les mêmes fiches ne sont pas relues deux fois ; une réponse illisible ne dit rien |
| Arrêt quand un plan est refusé trois fois de suite | `src/orchestrator/reviewer.ts` (`nextStrikes`, `MAX_STRIKES`), `src/orchestrator/agent.ts` | Au troisième refus d'affilée du même plan, la revue s'arrête, la vidéo part avec la liste des défauts, et le Reviewer n'est plus rappelé |
| La scène avant le plan (H9) | — | **Non commencé.** Le plus gros du lot |

Coût du premier point : un appel de plus au modèle du Reviewer par épisode, en texte seul.

### Lot E — personnages non humains et accessoires portés (niveaux 1 et 2 faits le 2026-11-13, non commité)

Nouveau fichier `engine-overlay/files/src/engine/worn.tsx`, branché dans `shot.tsx`.

| Niveau | Ce qui existe | Usage |
|---|---|---|
| 1. Accessoires portés | 23 accessoires. Tête : couronne, chapeau de fête, auréole, casque audio, bandeau, bandage, cornes, loup, masque médical, cache-œil, lunettes de soleil, nez de clown, oreilles de chat, de lapin, d'ours, de chien. Buste : collier, cravate, nœud papillon, écharpe, badge, médaille, pendentif | `wear: ['eye-mask', { what: 'collar', color: '#8A8A8A' }]` |
| 2. Animal debout qui parle | 9 têtes : chat, chien, lion, ours, lapin, loup, renard, cochon, souris. Oreilles, museau, moustaches, crinière | `animal: 'lion'` ou `animal: { kind: 'cat', fur: '#D98A3A' }` |
| 3. Animal à quatre pattes | **non fait** : demande un autre squelette. Le guide dit à l'agent de le mettre debout ou en insert | — |

Choix de dessin : le visage sous l'animal reste celui du personnage. Il parle et réagit donc comme les autres, sans rien de plus à animer. La crinière est un anneau autour de la tête, le museau est posé au-dessus de la bouche.

Ce qui est posé sur le visage (loup, lunettes, museau) glisse du côté où la tête regarde. Un accessoire inconnu répond avec la liste complète.

Vu à l'image (9 animaux, 18 accessoires sur 23) : tout suit la tête et le corps. Limites : les cheveux du personnage restent visibles sous les oreilles ; de profil, le museau est simplement décalé, pas redessiné de côté.

### Lot F — plusieurs voix (narrateur, mixte, personnages seuls)

Specs complètes : `docs/feature-plans/specs-voix-plusieurs-personnages.md`. Prévu pour un autre agent.

Dépend de : le relevé sur le serveur `:8005` (voix disponibles, appels par réplique), et tes cinq décisions listées dans les specs. **Indépendant des lots B à E** : peut avancer en parallèle, sur une autre branche.

Point de rencontre avec le reste : la fiche de mise en scène recevra « qui parle dans ce plan ». C'est écrit dans les specs.

### Mis de côté

- **Génération d'image.** Fiable à un ou deux personnages, pas au-delà, et pas assez précise pour être ajoutée. Essais documentés dans `essai-images-de-reference.md` (§7 à §12).
- **Hypothèses H3, H4, H5, H11 à H16** (`hypotheses-amelioration-systeme.md`) : chacune demande d'abord un comptage. À ressortir quand un audit les met en avant.

## 3. Ordre proposé

| Ordre | Lot | Taille | Qui |
|---|---|---|---|
| 1 | A, corrections de l'audit | fait | — |
| 2 | B, contact et profondeur | moyenne | ici |
| 3 | C, dessin du personnage | petite | ici, avec B |
| — | **lancements réels + audit** | — | Pulsy, puis ici |
| 4 | D, points 1 et 2 | petite | ici |
| 5 | E, accessoires portés puis tête d'animal | moyenne à grande | ici, après cadrage |
| 6 | D, point 3 (scènes) | grande | ici |
| en parallèle | F, plusieurs voix | grande | autre agent |

Deux règles pour ne pas se disperser :
- **Pas plus de deux chantiers ouverts à la fois** : un ici, et les voix ailleurs.
- **Un audit entre deux lots de moteur.** Sans lui, on empile des nouveautés que l'agent n'utilise pas, comme `deep` et `defineAction` cette fois-ci.

## 4. Décisions attendues de Pulsy

1. L'ordre du §3 te convient-il ?
2. Lot E : d'accord pour commencer par les accessoires portés et la tête d'animal sur corps humain ?
3. Lot F : qui prend les specs des voix, et quand ?

## Validation

- **Lots A à E (points faits) : `npm test` 63/63** avec `numpy`. `tsc` : 0 erreur. Moteur compilé dans une copie de `prof` : 0 erreur.
- **Mutations : 20 détectées sur 20** (lot A 4, lot B 4, lot C 3, lot D 5, lot E 4).
- Rendus regardés : objet dessiné à la main dans `hold`, `give`, `read` ; main qui touche sur 4 distances ; personnage à 5 angles ; se pencher à 3 angles ; assis en plan moyen et serré ; 9 têtes d'animaux et 18 accessoires.
- Un ancien test a été adapté (un geste ajouté dans un exemple) parce que la nouvelle règle `idle` le refusait à juste titre. Aucune assertion retirée.
- **Non vérifié :** aucun lancement réel. La lecture des fiches par le Reviewer n'a tourné qu'avec un faux modèle : la qualité de ses remarques est inconnue.
- Lot A : `npm test` 59/59 (avec `numpy`) ; mutations 4 sur 4 ; `tsc` 0 erreur ; moteur compilé dans une copie de `prof` ; 1 rendu regardé.
- Les mesures du §1 viennent de `docs/audits/audit-lancements-2026-11-13.md`.
- **Non vérifié :** aucun lancement réel avec le lot A.

## Commit proposé (non fait)

`feat(staging,engine,review): fewer wrong refusals, hands that reach, depth in tall frames, no idle on an action card, far hand hidden, cards read before the code, review stops after three refusals of a shot, worn things and animal heads`

Fichiers : `src/tools/staging.ts`, `src/tools/whatif.ts`, `src/orchestrator/config.ts`, `src/orchestrator/director-guide.ts`, `src/orchestrator/reviewer.ts`, `src/orchestrator/agent.ts`, `engine-overlay/files/src/engine/shot.tsx`, `engine-overlay/files/src/engine/person.tsx`, `engine-overlay/files/src/engine/actions.ts`, `engine-overlay/files/src/engine/worn.tsx` (nouveau), `test/smoke.test.mjs`, `docs/audits/audit-lancements-2026-11-13.md`, `docs/feature-plans/feuille-de-route.md`, `docs/feature-plans/hypotheses-amelioration-systeme.md`, `docs/feature-plans/essai-images-de-reference.md`, `docs/context-state.md`.

## Reste à faire après ces lots

1. **La scène avant le plan** (lot D, point 3) : non commencé. C'est le plus gros morceau restant.
2. **Le siège derrière le pupitre** (lot C) : décision de Pulsy, car l'aspect des épisodes d'école change.
3. **Animal à quatre pattes** (lot E, niveau 3) : seulement si les histoires le demandent souvent.
4. **Lancements réels et audit** : aucun de ces lots n'a tourné avec un vrai agent.

Note sur les tests : la suite complète prend 20 secondes en temps normal. Le 13 novembre, la machine était saturée (charge moyenne 175) et un lancement a dépassé 10 minutes sans échec. Ce n'est pas un défaut du code.
