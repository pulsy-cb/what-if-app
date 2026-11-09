# Context state — what-if-app (mis à jour 2026-11-09)

## Où on en est
- Audit visuel et système : `docs/audits/audit-visuel-2026-11-09.md`
- Recherche de skills/moteurs 2D par code : `docs/audits/recherche-skills-animation-2d-2026-11-09.md`
- Plan d'amélioration (lots 0 à 6) : `docs/feature-plans/amelioration-visuel-et-systeme.md`
- Conception de la réutilisation des décors : `docs/feature-plans/reutilisation-decors.md`

## Jalons
| Lot | Statut |
|---|---|
| 0 mesure (modèle par exécution, script de mesure) | fait, non commité |
| 1 savoir du skill (guide, zooms, exemples, digest, droits d'écriture) | fait, non commité |
| 2 contrôle visuel (planches, choix d'images, Reviewer) | fait, non commité |
| 3 réutilisation des décors | **expérience faite** (2/4 nettes, 2 moyennes) ; gabarit `Classroom` + pièces livrés via `engine-overlay/` (non commité). Reste : autres décors en gabarits, catalogue, Reviewer des pièces |
| 4 transitions | **abandonné** (décision Pulsy) |
| 5 vues du personnage (face, 3/4, profil, dos) | **fait, non commité** : `views.tsx` + correctif de `Hero` via `engine-overlay/` ; face inchangée (0 pixel) |
| 6 langage déclaratif | à faire : expérience d'abord |

## Branche / git
- `main`, ~12 fichiers modifiés + nouveaux (`engine-overlay/`, `src/tools/engine-overlay.ts`…), **aucun commit** (à faire par Pulsy). Message proposé dans le plan.

## Décisions
- Validation par le Reviewer, pas de validation manuelle (Pulsy, 2026-11-09).
- Reviewer à régler sur un modèle vision solide (`WHATIF_REVIEW_MODEL`).
- Sauvegarde base : `data/app.db.bak-2026-11-09` (migration `project_runs.model` au prochain démarrage).

## Prochaine étape
- **Run réel de `crush`** sur la machine qui a Docker et les clés : `docs/feature-plans/protocole-run-reel.md` (ce poste n'a pas l'environnement).
- En attendant, sans service payant : gabarits `Bedroom`/`Kitchen`/`Study`, ou expérience du langage déclaratif (lot 6).
- Le message de création d'épisode (`web/public/app.js`) a été aligné sur le guide (plus de `<DiningTable>` imposé).

## Conception en cours (2026-11-09)
- Personnages, garde-robe, actions, profondeur 2.5D : `docs/feature-plans/personnages-et-profondeur.md`. Décisions prises : style conservé, ados et adultes d'abord, coiffures et traits du visage ajoutés. Étapes A (`Stage`) et B (`Person`) commitées (`293d9cb`). Étape C (`cast()`) commitée (`90161fb`). Étape D (actions, `Duo`, sol automatique) intégrée au calque, **non commitée** ; 18/18 tests. Reste : E (décors `Bedroom`/`Kitchen`/`Study`, catalogue), F (langage déclaratif), run réel.

## Point d'arrêt (2026-11-09)
- Étapes A à F livrées, audit du run fait : `docs/audits/audit-run-reel-2026-11-09.md`. Tests locaux 22/22.
- Reste : pré-vol puis run réel sur l'autre machine (LLM, Modal, `:8005`, Docker jamais exécutés ici) ; décider de la promotion des pièces.
