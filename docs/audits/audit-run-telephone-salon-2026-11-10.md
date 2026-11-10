# Audit du run `telephone-salon` (2026-11-10)

**Palier** P0 (audit, lecture seule). La solution du §6 relève du P2 et attend la validation de Pulsy.

**Sources :**
- `what-if-data-code-db-telephone-salon.zip` : base, journal des échanges et code du projet ;
- vignettes **refaites en local** à partir du code final du projet, car les médias sont exclus du zip ;
- lecture du code du Reviewer et de l'audit des plans.

## 0. Ce qui a été fait avant l'audit

**Récupération de main** (`a00ac2f` reconnaissance des personnages via `Prim → Staged`, et `787ca30` TypeScript dans les dépendances) :
- Le merge et le rebase sont interdits, et `pull --ff-only` est impossible : la branche locale et main ont divergé après `26029df`.
- Le diff de ces deux commits a donc été **appliqué sans commit** dans l'arbre de travail : `src/tools/whatif.ts`, `package.json`, `package-lock.json`, et les 2 tests de main ajoutés à `test/smoke.test.mjs`.
- `whatif.ts` est maintenant identique à main, sauf la borne `u` de l'audit, qui vient du commit `c383374`.

**Données :**
- Base sauvegardée dans `data/app.db.bak-avant-telephone-2026-11-10`, puis remplacée par celle du zip (`integrity_check` : ok).
- Projets mis à jour par `rsync` (aucune suppression).

**Tests :** `npm test` donne **28/29**. Le test en échec, « real telephone-salon shots… » (venu de main), dépend des données du projet. Il attend un avertissement sur S6, mais S6 a été passé ensuite en `insert` (commit `4bf2c64` de l'autre machine). **Le même échec se reproduit sur un worktree propre de `origin/main`** avec ces données. Ce n'est pas une régression ; c'est un test fragile, à réécrire sur une copie figée du projet.

## 1. Les faits du run

| | |
|---|---|
| Durée de l'agent | 3 tours : 8,3 + 8,2 + 30,8 min = **47 min**, plus les interventions à la main entre les tours. **Aucune vidéo produite** |
| Étapes | 124 + 82 + 205 = **411** |
| Arrêts automatiques | 3 : `stills` deux fois (faux « pas de personnage », corrigé depuis sur main), puis `render` (le Reviewer refuse) |
| Refus du Reviewer | 6 |
| Lectures | `read_file` **135** et `grep` 86 |
| Corrections de texte | `edit_file` 69, dont **14 « oldText introuvable »**, sur un `shots.tsx` de 60 Ko |
| Commandes shell refusées | **23** : métacaractères, commandes hors liste, chemins `/skill`, `/proc`, `/`. L'agent a fouillé le serveur pour trouver d'où venait l'erreur de l'audit |
| Cadence | 36 plans pour 160 s, médiane **4,3 s**, le plus long 7,0 s |

**La cause la plus lourde, dite par l'agent lui-même** (message 7260) :

> « primitive `Prim` maison : le `shot()` générique ne gère ni tables de manucure ni gros plans de téléphone »

`shots.tsx` contient **0 appel à `shot()`** et 0 `place()`. Tout est écrit à la main : `makeRoom`, un `Stage0` maison, des tables et une lampe dessinées à la main, et même une silhouette `Who` dessinée sans le moteur.

## 2. Qui a raison sur les images

Les vignettes ont été refaites en local avec Remotion, à 3 instants par plan, à partir du code final.

| Remarque du Reviewer (Nemotron) | Verdict | Ce qu'on voit / lit |
|---|---|---|
| S3 : « NARR absente » | **Faux** | Les 3 personnages sont dans le code et à l'image. Le Reviewer ne voyait que les 380 premiers caractères du plan : la caméra et l'indicateur de batterie, pas les personnages (§3) |
| S4 : MARC au lieu de NARR | **Vrai** | Le code ne met que MARC. À l'image, il est collé au bord droit et coupé, avec une table vide au premier plan |
| S6 : insert au lieu d'un gros plan de NARR | **Faux en soi** | L'insert du téléphone colle au texte (« la photo de profil… »). C'est DIRECTOR.md qui n'a pas suivi le changement |
| « Tous habillés en blanc » | **Faux** | Les tenues sont distinctes (pull crème, chemise blanche, tablier). Mais le cadre est petit et sombre, donc peu lisible |
| « Debout au lieu d'assis » | **Vrai à l'image** | S1 : NARR est debout au centre, sans chaise. S3 : les corps sont cachés derrière les tables, sans chaise. Le décor maison n'a pas de sièges, donc `seated` ne se lit pas |
| « 27 plans sur 36 avec amorce floue » | **Faux (mesure)** | La règle compte `focus=` comme une amorce. Il n'y a que 7 `<Foreground>` |
| En-tête 16:9 contre DIRECTOR 9:16 | **Faux, causé par le système** | `episode.json` n'est pas lu (§3), donc l'orientation par défaut « 16:9 » est envoyée |

**Défauts visibles que personne n'a relevés :**
1. **Image 9:16 remplie à moitié.** Le décor et la caméra sont pensés en 1920×1080 (caméra à `y` 620, reflet du sol calé sur 1080). Le haut est noir, le bas est une bande sombre, et la scène n'occupe que le tiers du milieu. Les personnages des plans larges sont minuscules.
2. **Image très sombre** : voile noir (`Scrim`) à 20 %, luminosité réduite, nuit.
3. **Une tache multicolore sur la bouche** de chaque personnage (S3, S4) : le plateau de vernis de la table maison est mal placé et dessiné par-dessus les visages.
4. **S6** : la carte « Camille en ligne » recouvre le message.

**Conclusion :** les torts sont partagés, mais le premier en cause est le **contournement du moteur**. Il produit à la fois les défauts visibles (9:16, sièges, taches) et l'aveuglement du Reviewer et de l'audit.

## 3. Le Reviewer travaille à l'aveugle (bugs du système, vérifiés dans le code)

| Défaut | Où | Effet ici |
|---|---|---|
| `episode.json` lu avec un plafond de 25 000 octets ; au-delà, `readText` renvoie `null` et le fichier est remplacé par `{}` | `src/orchestrator/reviewer.ts:180` | `episode.json` fait 27 535 octets : **ni script, ni liste des plans**, et l'orientation « 16:9 » par défaut |
| DIRECTOR.md coupé à 3 500 caractères dans le prompt | `reviewer.ts`, construction du prompt (§4) | Le tableau s'arrête à S6 : le Reviewer ne connaît pas la mise en scène des plans S7 à S36 |
| Code de chaque plan coupé à 380 caractères | `summarizeShotsCode` | Avec des plans écrits à la main, ces 380 caractères sont la caméra et les accessoires. D'où le faux « NARR absente » |
| Les composants maison (`Prim`, `Salon`, `Stage0`) ne sont pas montrés | idem | Le Reviewer ne peut pas savoir ce que `<Prim who={NARR}>` dessine |
| La mesure « amorce floue » compte `focus=` | `staticMetrics` | 27 au lieu de 7 : une erreur bloquante inventée |

## 4. Les autres causes

1. **`shot()` ne couvre pas ce récit.**
   - Pas d'insert de téléphone dans `shot()` (écran, bulles, notification), alors que c'est l'objet clé de la moitié des histoires de la chaîne.
   - Pas de salon de manucure. La recette `salon` (coiffure) et le contrechamp sont sur cette branche, **pas sur main** : l'autre machine ne les avait pas.
2. **Écrire à la main est trop facile et sans garde-fou.** Le guide le permet. Aucun contrôle ne voit qu'un fichier entier est hors moteur, ni que le cadre 9:16 est à moitié vide.
3. **Un fichier de 60 Ko corrigé par recherche de texte** : 14 `edit_file` ratés et 135 lectures. `edit_shot` existe, mais l'agent corrige surtout les composants partagés, qui sont hors plan.
4. **Les documents divergent.** DIRECTOR.md n'est pas mis à jour quand un plan change de nature (S6). Le code a aussi été modifié après les dernières planches, donc le refus portait en partie sur une version périmée.
5. **Un short de 160 s est traité comme une vidéo longue.** `paceTarget` décide par la durée seule : au-delà de 150 s, on vise environ 4,5 s par plan. Pulsy veut **plus de rythme pour les shorts** ; en 9:16, 4,3 s de médiane, c'est lent.
6. **Le modèle.** DeepSeek V4.1 Flash répète une étape bloquée au lieu de traiter le retour, et fouille le serveur. C'est une faiblesse réelle, mais secondaire : il a été poussé hors du moteur et jugé par un Reviewer à moitié aveugle.

## 5. Changer de modèle ?

**Pas avant les correctifs 1 et 2 du §6.** Tout modèle serait jugé par le même Reviewer aveugle, et écrirait aussi à la main là où `shot()` ne suffit pas.

Ensuite, d'après les tarifs relevés dans l'échange Hermes (non revérifiés ici) :
- **GLM-5.3** (environ 1,12 $ / 3,52 $ par million de tokens) pour une reprise ciblée, si DeepSeek s'enlise encore ;
- Kimi seulement si GLM échoue.

## 6. Solution proposée (P2, à valider), par ordre d'effet

1. **Reviewer qui voit tout** (environ 1 h) :
   - lire `episode.json` sans plafond et ne couper que le texte extrait ;
   - lire DIRECTOR.md en entier, ou seulement les lignes des plans concernés ;
   - par plan : environ 1 200 caractères, plus une section « composants du fichier » avec leurs définitions ;
   - prendre l'orientation dans `studio.config.ts` ;
   - corriger la mesure « amorce » ;
   - consigne : « avant de dire qu'un personnage manque, cherche son nom dans le code du plan ».
2. **Garder l'agent dans `shot()`** (une demi-journée) :
   - `shot({ insert: phone({ name, messages, notify, at }) })` : un insert de téléphone animé (bulles qui arrivent sur un mot, notification, saisie) ;
   - une recette `nails` (tables de manucure, étagères de vernis, lampes) et des tables où l'on s'assoit avec chaise ;
   - guide : un plan écrit à la main seulement pour ce que `shot()` ne sait pas faire, et un plan à la fois ;
   - audit : avertissement si plus d'un tiers des plans n'utilisent pas `shot()`, et refus si un plan 9:16 a une caméra pensée en 1920×1080.
3. **Planches et documents synchronisés** :
   - `render` refusé si `shots.tsx` est plus récent que la dernière planche relue ;
   - la taille des plans dans DIRECTOR.md vérifiée contre `episode.json`, avec une alerte en cas d'écart.
4. **Cadence des shorts** : en 9:16, appliquer la cadence courte (≥ 20 coupes/min, aucun plan > 5 s) quelle que soit la durée. **Décision de Pulsy.**
5. **Envoyer cette branche sur main**, pour que l'autre machine ait les lieux, le contrechamp, les personnages et le rythme. Commit et push seulement sur demande de Pulsy.
6. **Le test de main lié aux données** : le réécrire sur une copie figée des fichiers du projet.
7. Puis relancer `telephone-salon` en reprise (voix et source gardées), avec DeepSeek. Passer à GLM-5.3 seulement si l'agent s'enlise encore.

## Validation

- Journal analysé : `messages` du fil `c7976080…` (881 messages) et `project_runs` 5, 6, 7.
- Vignettes S1, S3, S4, S6 refaites en local (Remotion 4.0.530, code final du projet). Images dans le scratchpad, non commitées.
- `npm test` **28/29** ; l'échec est reproduit sur `origin/main` propre (§0).
- **Non exécuté :** vrai LLM, Modal, vérification des tarifs River.

## À surveiller

- Les modifications de main sont dans l'arbre de travail, **non commitées**, avec le lot « personnages ».
- Décisions attendues de Pulsy : §6 point 4 (cadence des shorts en 9:16), ordre des points 1 à 3, commit et push (point 5).
