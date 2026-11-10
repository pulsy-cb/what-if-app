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

## 2. Reste à faire (sur l'autre machine)

### Tests en échec, à corriger en premier (`npm test` : 25 réussis, 4 en échec)

1. **« reviewer: reads the contact sheets and the measured counts… »** : il attend sans doute l'ancien libellé « plans avec amorce floue ». Adapter l'attente au nouveau texte, sans affaiblir le test.
2. **« stage: the audit counts \<Staged\> as a character… »** et **« shot(): the audit sees its people… »** : très probablement la nouvelle règle « plus de la moitié des plans à la main », si leurs projets de test créent `src/engine/shot.tsx`.
   - Soit donner à ces projets de test des plans `shot(...)` ;
   - soit ne pas créer `shot.tsx` dans les tests qui ne portent pas sur cette règle.
   - Vérifier le message réel avant de choisir.
3. **« real telephone-salon shots… »** (vient de main) : il échoue aussi sur `origin/main` avec les données actuelles, car S6 est passé en `insert`. Le réécrire sur une copie figée de `shots.tsx`, `episode.json` et `timeline.json` (dossier `test/fixtures/`), avec la taille de S6 d'origine (`close`).

### Tests nouveaux à écrire (avec mutation pour chacun)

- `paceTarget(160, '9:16')` → 20 coupes/min et 5 s ; `paceTarget(160, '16:9')` → 10 coupes/min et 9 s.
- `shotlist.py` sur un épisode 9:16 de plus de 150 s → environ `seconds / 2.4` plans.
- `summarizeShotsCode` : un plan `<Prim who={NARR}>` liste NARR ; un composant local apparaît dans « Composants du fichier ».
- `staticMetrics` : `focus=` n'est pas compté comme amorce.
- Reviewer : `episode.json` de plus de 25 Ko → le script est bien dans le prompt (prompt capturé avec un faux fournisseur) ; orientation lue dans `studio.config.ts`.
- `boardStale` : `shots.tsx` plus récent que `storyboard.jpg` → `render` refusé ; l'inverse → accepté.
- Règle « à la main » : 6 plans dont 4 sans `shot(` → refus ; 4 inserts écrits à la main → pas de refus.

### Rendus à faire (Remotion local)

- `phoneShot` en 9:16 et 16:9 : chat, écran verrouillé, saisie, bannière, sans main. Vérifier que le texte ne sort pas des bulles et que le pouce ne cache pas la dernière bulle.
- `place('nails')` : plan large, moyen et contrechamp, avec 3 personnes assises sur `tech1`, `client1` et `tech2`. Vérifier que les chaises se font face et que la table est entre les deux.
- Calque compilé sur les 4 moteurs réels (`compat/`) et sur le projet telephone-salon.

### Pas encore codé

1. **Guide de l'agent** (`src/orchestrator/director-guide.ts`) :
   - `phoneShot` (inserts téléphone, messages sur un mot) ;
   - `place('nails')` ;
   - règle « à la main seulement pour ce que `shot()` ne sait pas faire, un plan à la fois » ;
   - cadence verticale.
2. **Contrôle du cadrage 9:16** pour les plans écrits à la main : repérer une caméra pensée en 1920×1080 (reflet calé sur 1080, `y` de caméra autour de 540–650 et image à moitié vide). Heuristique à concevoir.
3. **DIRECTOR.md contre `episode.json`** : alerte quand la taille d'un plan dans le tableau de DIRECTOR.md n'est plus celle d'`episode.json` (S6 : close contre insert).
4. **Simulation de bout en bout** (`sim/sim.mjs`) avec un épisode 9:16 de 160 s : cadence, refus « à la main », planche périmée.
5. **Commit, push et envoi sur main** (la branche contient aussi le rythme, les lieux, le contrechamp et les personnages), sur demande de Pulsy.
6. Relancer `telephone-salon` en reprise (voix et source gardées) avec DeepSeek ; GLM-5.3 seulement si l'agent s'enlise encore.

## Validation

- `tsc` de l'application : 0 erreur.
- `npm test` : **25 réussis, 4 en échec** (voir §2).
- **Non exécuté :** rendus de `phoneShot` et `nails`, calque sur les moteurs réels, mutations, simulation, vrai LLM, Modal.

## Commit proposé (après correction des tests)

`feat(review,pace): reviewer reads the whole episode and the cast per shot, vertical videos keep the short pace, render waits for a fresh board, phone insert and nail salon`
