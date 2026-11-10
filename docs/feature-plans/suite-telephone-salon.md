# Suite de l'audit telephone-salon : ce qui est fait, ce qui reste (2026-11-10, soir)

**Palier** P2. Pulsy a validé le plan de `docs/audits/audit-run-telephone-salon-2026-11-10.md` §6. Une décision en plus : **en vertical (9:16), un plan court quelle que soit la durée**.

Le code a été arrêté en cours de route à la demande de Pulsy (manque de temps). Les tests et les rendus restent à faire sur l'autre machine.

## 1. Fait, mais pas testé jusqu'au bout

Les fichiers modifiés compilent (`tsc` : 0 erreur). Rien n'est commité.

| Point | Fichier | Changement |
|---|---|---|
| Cadence verticale | `pipeline/shotlist.py` | `aspect` 9:16 → environ 2,4 s par plan, même au-delà de 150 s |
| Cadence verticale | `src/tools/whatif.ts` | `paceTarget(dur, aspect)` : en 9:16, au moins 20 coupes/min et aucun plan de plus de 5 s. `paceProblem` lit `aspect` dans `episode.json` |
| Reviewer : tout lire | `src/orchestrator/reviewer.ts` | `episode.json` lu jusqu'à 3 Mo (avant : 25 Ko, sinon rien) ; DIRECTOR.md en entier, jusqu'à 12 000 caractères dans le prompt (avant : 3 500) ; script 9 000 et plans 7 000 caractères |
| Reviewer : code des plans | idem, `summarizeShotsCode` (exportée) | 1 200 caractères par plan (avant : 380), ligne « personnages cités » tirée des variables `cast(...)`, section « Composants du fichier » (`Prim`, `Salon`…) |
| Reviewer : orientation | idem, `episodeAspect` | Lue dans `episode.json`, sinon dans `src/studio.config.ts`. Plus de 16:9 par défaut sans vérifier |
| Reviewer : mesure des amorces | idem, `staticMetrics` | Amorce = `<Foreground>` seulement. Les `focus=` sont comptés à part. Les plans `who=` comptent comme plans avec personnages |
| Reviewer : consigne | idem, prompt système | « Avant de dire qu'un personnage manque, lis “personnages cités”. Un insert qui illustre le texte n'est pas un défaut » |
| Planche périmée | `src/tools/whatif.ts`, `boardStale` | `render` refusé si `shots.tsx` est plus récent que `storyboard.jpg` |
| Plans à la main | `src/tools/whatif.ts`, `shotsAudit` | Si le moteur a `shot.tsx` et que **plus de la moitié** des plans avec personnages (hors `insert` et `establishing`) n'appellent pas `shot(`, la planche est refusée avec la marche à suivre |
| Insert téléphone | `engine-overlay/files/src/engine/shot.tsx`, `phoneShot` | Écrit, **jamais compilé dans un projet ni rendu** |
| Salon de manucure | `engine-overlay/files/src/engine/rooms.tsx`, recette `nails` | Écrite, **jamais rendue** |

**Mesuré sur le vrai `shots.tsx` de telephone-salon :**
- S3 → « personnages cités : NARR, LUISA, MARC » ;
- S4 → « MARC » ;
- amorces : **7/36** (avant : 27/36).

### `phoneShot`, l'insert téléphone

```tsx
export const S5 = phoneShot({
  name: 'Camille', back: place('nails'), battery: 2,
  messages: [{ at: 36, text: 'Tu me manques tellement' }, { at: 60, text: 'Ce soir ?', from: 'me' }],
  notify: { at: 10, text: '…' }, typing: { at: 80, text: 'tutu', dur: 20 }, case: '#1F4E79',
});
```

`screen: 'lock'` donne l'écran verrouillé avec une bannière. Le téléphone remplit le cadre en 16:9 comme en 9:16 ; la main et le pouce s'affichent (`skin: null` les retire). Les bulles arrivent sur leur image et la conversation défile.

### Recette `nails`

Mur vert sauge, deux étagères de vernis, une fenêtre, un tableau de prix. Deux tables `t1` et `t2`, chacune avec une chaise technicienne (`tech1`, `tech2`) et une chaise cliente (`client1`, `client2`). Le contrechamp montre un comptoir et une porte.

## 2. Compléments réalisés, testés et rendus (2026-11-10)

### Tests corrigés et nouveaux tests ajoutés (`npm test` : 32 réussis, 0 en échec)

1. **Libellé `staticMetrics` aligné** dans `test/smoke.test.mjs` (`amorce floue au premier plan (Foreground)` vs `flou de profondeur (pas une amorce)`), avec test positif (`Foreground`) et négatif (`focus=`).
2. **Fixture figée `test/fixtures/telephone-salon/`** extraite de l'instantané git `2b35574` avant reclassement de `S6` en `insert` : `S9`, `S10`, `S12` résolvent `Prim -> Staged`, `S6` et `S19` restent signalés `character presence unknown` sur toute machine.
3. **Nouveaux tests couverts dans `test/smoke.test.mjs`** :
   - `paceTarget(160, '9:16')` (`20` coupes/min, `5 s`) vs `paceTarget(160, '16:9')` (`10` coupes/min, `9 s`), et `projectAspect` avec repli sur `src/studio.config.ts`.
   - `pipeline/shotlist.py` sur un épisode 9:16 de 160 s (`>= 55` plans, soit ~`seconds / 2.4`) contre un découpage plus posé en 16:9.
   - `summarizeShotsCode` (`<Prim who={NARR}>` liste `NARR` ; composants locaux extraits sous `### Composants du fichier`).
   - `reviewEpisodeBoard` avec un `episode.json` > 25 Ko (script intégral conservé dans le prompt envoyé au fournisseur), orientation 9:16 lue depuis `studio.config.ts`, et écarts de taille `DIRECTOR.md` ↔ `episode.json` remontés dans `## 6. Mesures automatiques`.
   - `boardStale` : `shots.tsx` plus récent que `storyboard.jpg` bloque `render` ; planche fraîche acceptée.
   - Règle « à la main » (`> 50 %` des plans personnages sans `shot(` refusés ; inserts et `phoneShot` acceptés).
   - `portraitFramingErrors` (reflet `translate(0 1080) scale(1 -1)`, plafond/fond 16:9 `y=0 width=1920`, zoom 16:9 `<= 1.05` autour de `y=480..680`) et `directorSizeMismatches` (`S6: close` contre `insert`), testés sur la vraie fixture `telephone-salon`.
   - Simulation des garde-fous de bout en bout sur un épisode 9:16 de 160 s (`whatif_run` refuse 36 plans trop lents, accepte 60 plans, puis refuse `render` tant que `storyboard.jpg` est plus ancien que `shots.tsx`).

### Éléments complétés dans le moteur, l'orchestrateur et les outils

1. **Guide de l'agent** (`src/orchestrator/director-guide.ts`) : `phoneShot`, recette `nails` (`t1`/`t2`, `tech1`/`client1`/`tech2`/`client2`), règle « à la main uniquement pour ce que `shot()`/`phoneShot()` ne sait pas dessiner », et cadence verticale 9:16 (`>= 20` coupes/min, `<= 5 s`).
2. **Contrôle du cadrage 9:16** (`portraitFramingErrors` dans `src/tools/whatif.ts`) : activé dans `shotsAudit` pour les projets 9:16 disposant de `shot.tsx`.
3. **Cohérence `DIRECTOR.md` ↔ `episode.json`** (`directorSizeMismatches` dans `src/tools/whatif.ts` et `src/orchestrator/reviewer.ts`) : avertissement injecté lors de `stills`/`board` et ligne dédiée dans `## 6. Mesures automatiques` du Reviewer.
4. **Rendus locaux vérifiés (`tsc --noEmit` : 0 erreur + vignettes Remotion 9:16 et 16:9)** :
   - `phoneShot` (`shot.tsx`) : `<clipPath>` de la zone chat, bulles bien contenues, pouce abaissé sur la barre de saisie sans masquer la dernière bulle, bannière placée sous l'heure sur `screen: 'lock'`, mode sans main (`skin: null`).
   - `place('nails')` (`rooms.tsx` + `shot.tsx`) : dossiers latéraux des chaises (`opt.face: 'right' | 'left'`) et orientation automatique `seatYaw` face à face de part et d'autre des tables `t1`/`t2` (y compris en contrechamp `view: 'reverse'`), cadrage `cam: 'wide'` centré sur le groupe.

## Validation

- `tsc` de l'application et d'un projet complet avec `engine-overlay` : **0 erreur**.
- `npm test` : **32 réussis, 0 en échec**.
- Rendus Remotion 9:16 et 16:9 inspectés visuellement (`phoneShot` chat, écran verrouillé + bannière, sans main ; `place('nails')` large, moyen + amorce, contrechamp).

## Commit proposé (après correction des tests)

`feat(review,pace): reviewer reads the whole episode and the cast per shot, vertical videos keep the short pace, render waits for a fresh board, phone insert and nail salon`
