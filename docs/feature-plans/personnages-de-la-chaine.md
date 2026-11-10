# Personnages de la chaîne : héroïne récurrente et types (2026-11-10)

**Palier P2** (moteur, guide). Point 2 de « la suite », demandé par Pulsy, à partir de son analyse des protagonistes de la chaîne `herytstory`.

## 1. Ce que dit l'analyse

La narratrice revient dans la plupart des vidéos avec les mêmes signes :
- rousse cuivrée, chignon tressé haut avec des mèches libres ;
- yeux vairons (un bleu, un vert) et taches de rousseur ;
- t-shirt blanc avec « her » sur la poitrine, jogging vert à bande jaune, baskets.

Rôles secondaires fréquents : la mère, le policier, le frère, le serveur, le soignant, la mariée.

## 2. Ce qui est ajouté à `cast()`

| Ajout | Écriture |
|---|---|
| Héroïne de la chaîne | `cast({ as: 'heroine', seed: 'her' })`, toujours identique d'un épisode à l'autre |
| Types prêts | `as` : `mother`, `father`, `brother`, `sister`, `friend`, `police`, `doctor`, `nurse`, `waiter`, `teacher`, `bride`, `groom`, `boss`. Ce qu'on donne en plus l'emporte ; les champs du visage se fusionnent |
| Coiffures | `braided-bun` (chignon tressé haut, mèches aux tempes), `shag` (dégradé mi-long aux pointes effilées) |
| Yeux | `eyes: 'hazel'`, ou deux couleurs `['blue', 'green']` : iris de couleur, pupille, reflet. Les yeux fermés ou plissés gardent leur dessin |
| Vêtements | `joggers` (bande latérale, `joggers:green+mustard`), `cargo`, `dress` (haut et jupe jusqu'aux chevilles, assise comprise). Deuxième couleur après `+` pour tout vêtement |
| Motif | `print: { text: 'her', color: 'coral' }` sur la poitrine (caché sous une veste) |

**Changer une seule chose pour une histoire :** `cast({ as: 'heroine', seed: 'her', outfit: ['dress:green', 'formal:white'] })` met l'héroïne en robe et garde tout le reste.

**Corrigé au passage :** assise en jupe ou en robe, le giron prend la couleur du tissu (il était couleur peau).

## 3. Limites

- La bande du jogging est dessinée au milieu de la jambe ; en profil, elle se lit comme une bande latérale.
- Pas de plâtre ni de fauteuil roulant : ce sont des accessoires (point 3 de la suite).
- Les types sont des points de départ, pas des personnages fixes. Deux « mère » avec des `seed` différents se ressemblent (mêmes vêtements), seuls le visage et les couleurs non fixées changent.

## Fichiers

- `engine-overlay/files/src/engine/cast.ts` : `CAST_TYPES`, `as`, `eyes`, `print`, `EYE_COLORS`, `joggers`, `cargo`, `dress`, accents `+`.
- `engine-overlay/files/src/engine/hair.tsx` : `braided-bun`, `shag`.
- `engine-overlay/files/src/engine/person.tsx` : iris, bande des jambes, robe longue, couleur du giron.
- `engine-overlay/files/src/engine/wardrobe.tsx` : motif sur la poitrine.
- `engine-overlay/examples/cast-types.tsx` : planches.
- `src/orchestrator/director-guide.ts` : types, yeux, coiffures, vêtements.
- `test/smoke.test.mjs` : 1 test nouveau.

## Validation

- `npm test` **27/27**. Mutations : **4 sur 4 détectées** (visage non fusionné, robe sans jupe, yeux vairons perdus, type qui écrase ce qui est donné).
- `tsc` de l'application : 0 erreur. Calque compilé sur 4 moteurs : 0 erreur.
- Prompt : 55,4 Ko, digest non tronqué.
- Rendus locaux :
  - l'héroïne en 5 vues et en gros plan ;
  - les 13 types ;
  - la mariée debout et assise, avec le marié.
- **Non exécuté :** vrai LLM, Modal.

## Commit proposé

`feat(cast): the channel heroine and ready character types, heterochromia, braided bun, joggers and dresses`

Fichiers : ceux ci-dessus, plus cette note et `docs/context-state.md`.

**Images locales (non commitées) :**
1. `docs/screenshots/personnages-2026-11-10/01-heroine.png`
2. `docs/screenshots/personnages-2026-11-10/02-types-et-mariee.png`
