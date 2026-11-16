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

## Audit des runs réels (2026-11-10)
- `docs/audits/audit-runs-2026-11-10.md` : système complet et propre (6 erreurs au lieu de 112), mais 4 à 5 fois moins d’animation par plan, vidéo longue plafonnée à 36 plans, rendu et allers-retours trop longs.
- En attente : décision de Pulsy (rythme cible des vidéos longues, ordre des chantiers ; recommandé : priorité 1).

## Rythme et cohérence (2026-11-10)
- Priorités 1 à 3 de l’audit faites, plus un premier lot de la priorité 4 : `docs/feature-plans/rythme-et-coherence.md`. Tests 26/26, simulation complète OK.
- Reste : contrechamp, catalogue de lieux et d’extérieurs, personnage assis vu de face, angles ; mesurer un vrai short sur l’autre machine. Non commité.

## Contrechamp et lieux (2026-11-10)
- `docs/feature-plans/contrechamp-et-lieux.md` : contrechamp (`view: reverse`), 17 lieux nouveaux d’après l’analyse de la chaîne, giron des personnages assis, angles bas/haut. Tests 26/26, 4 moteurs OK. Non commité.

## Personnages de la chaîne (2026-11-10)
- `docs/feature-plans/personnages-de-la-chaine.md` : héroïne récurrente (`as: heroine`), 13 types, yeux vairons, chignon tressé, jogging à bande, robe. Tests 27/27. Non commité. En attente : retour du short lancé par Pulsy.

## 2026-11-10 (soir) — audit du run telephone-salon
- main (`a00ac2f`, `787ca30`) appliqué sans commit : la branche a divergé, et merge/rebase sont interdits. Fichiers : `whatif.ts`, `package*.json`, 2 tests.
- Données du zip restaurées. Sauvegarde : `data/app.db.bak-avant-telephone-2026-11-10`.
- `npm test` 28/29 : le test de main lié aux données échoue aussi sur `origin/main`.
- Audit : `docs/audits/audit-run-telephone-salon-2026-11-10.md`. Cause principale : l'agent contourne `shot()`, et le Reviewer est aveugle (`episode.json` de plus de 25 Ko non lu). Solution P2 en attente de validation.
- Suite (complétée, 32/32 tests + rendus 9:16/16:9 vérifiés + rendu Modal vidéo découpé en parallèle sur `main`) : `docs/feature-plans/suite-telephone-salon.md`

## 2026-11-12 — main récupéré, nouvelles données
- `main` passé de `b31632d` à `474cb3a` (`pull --ff-only`). La branche `feat/visual-director-engine-overlay` et la suite telephone-salon sont incluses.
- Modifications locales mises de côté : `stash@{0}` « local-avant-pull-main-2026-11-12 ». Tout leur contenu est déjà dans main ; c'est une simple sauvegarde.
- Captures locales copiées dans `../screenshots-local-backup-2026-11-12`. Elles sont identiques à celles que main versionne désormais.
- Données : zip `what-if-data-code-db-20261112-095841.zip` restauré, 34 projets, `integrity_check` ok. Sauvegarde : `data/app.db.bak-avant-zip-2026-11-12`.
- `npm test` 49/49, avec un python qui a numpy. Avec le python système, 46/49 : les 3 échecs viennent de numpy manquant.
- Audit des nouveautés et des 16 projets : `docs/audits/audit-nouveautes-2026-11-12.md` (corrections P2 en attente de validation)
- Corrections de l'audit du 12 nov. faites (14 points), non commitées : `docs/feature-plans/corrections-audit-2026-11-12.md`. Tests 54/54 (avec numpy).
- Plan « plusieurs voix » (narrateur, dialogues, ou les deux : `speaker` par bloc du script, une voix par personnage, bouche automatique) : **en attente de validation Pulsy et de la liste des voix**, `docs/feature-plans/voix-plusieurs-personnages.md`. **Specs pour un autre agent écrites** (relevé à faire sur `:8005`, contrat du serveur, fichiers à modifier, tests) : `docs/feature-plans/specs-voix-plusieurs-personnages.md`. Aucun code.
- Plan « améliorer la mise en scène sans image » (fiche par plan `stage_shots`, code vérifié contre la fiche, `walkTo`, `hold`, plan d'ensemble vertical) : **codé, 57/57 tests, essai Codex fait sur une copie de `prof` (15 min, idle 26 → 4, 4 objets tenus, refusé au dernier tour avec 4 défauts), commité `229f580`**. **Lot 2 non commité** : gestes ouverts (`defineAction`, geste écrit sur la personne), `lean`/`rummage`/`slam`/`give`/`read`, `behind`, `cam: 'deep'`, fiches avec `subject` et refus des verbes vagues ; 58/58 tests, 6 mutations sur 6, pas encore de nouvel essai LLM, `docs/feature-plans/ameliorer-mise-en-scene.md`. La génération d'image est mise de côté.
- **Feuille de route** (lots A à F, méthode « un lot, un lancement, un audit ») : `docs/feature-plans/feuille-de-route.md`. **Lot A fait, non commité** : décor non refusé dans `objects`, `hold` tolérant et `{ node }`, narrateur refusé sur les fiches, angle de la fiche appliqué au plan, revue plafonnée à 3 ; 59/59 tests, 4 mutations sur 4. **Lots B, C (2 points sur 3) et D (2 points sur 3) faits aussi, non commités** : main à portée de bras (`stepIn`), profondeur exigée dans un tiers des plans à deux en 9:16, `idle` refusé sur une fiche d'action, main éloignée cachée, lecture des fiches par le Reviewer avant le code, arrêt de la revue après 3 refus d'un même plan ; **lot E niveaux 1 et 2 fait** (`worn.tsx` : 23 accessoires portés avec `wear`, 9 têtes d'animaux avec `animal`) ; 63/63 tests, 20 mutations sur 20, rendus regardés. Restent : scènes avant les plans, siège derrière le pupitre (décision Pulsy), animal à quatre pattes, lancements réels. Plusieurs voix : mis de côté par Pulsy.
- Audit des 8 lancements du 12-13 nov. (zip `what-if-app-data-sans-medias-20261113-124950.zip`, non importé dans `data/`) : fiches et `hold` utilisés partout, 1 projet accepté sur 5, plus de 150 refus à tort (décor mis dans `objects`), contact main-objet = moitié des défauts, `deep`/`defineAction`/`behind` presque jamais utilisés ; 10 corrections proposées : `docs/audits/audit-lancements-2026-11-13.md`. Non commité.
- **Génération d'image mise de côté (décision Pulsy, 2026-11-13)** : pas assez précise pour être ajoutée. À la place, 16 hypothèses d'amélioration du système actuel, avec leur vérification et un ordre proposé : `docs/feature-plans/hypotheses-amelioration-systeme.md`. En attente du résultat du lancement de Pulsy sur l'autre machine. Non commité.
- Essai Qwen-Image-2.1-Turbo sur Modal (2026-11-13) : 8 images, juste jusqu'à 2 personnages, identités mélangées à 3, échec à 4 avec planche de groupe, §11. Scènes chargées par retouche d'une mise en place du moteur (4 et 7 personnages, 3 graines) : le nombre et les places tiennent, mais rôles et traits sont brassés et le résultat change d'une graine à l'autre ; §12. Non commité.
- Essai images de référence (étape 1, épisode `prof`) : premier essai sur l'API gflow (`nano2-lite`) : 3 images générées, envoi des planches du moteur bloqué par les conditions d'envoi de Flow (à accepter par Pulsy), résultats au §7 ; essai Agnes Image 2.5 Flash avec les planches du moteur : style et décor fidèles, identité des personnages fragile à 3, résultats au §8 ; deuxième tour en 2K : 5 images sur 6 (limite du compte gratuit), objets et poses bons, un personnage en trop dans chaque image, §9 ; réponse sur les directions trop vagues, §10 : `docs/feature-plans/essai-images-de-reference.md`

## 2026-11-13 (soir) : import des vidéos custom (non commité)

- **Constat** (`prime-custom-1794568426-4ddb37d8`) : une vidéo custom n'a ni fichier vidéo ni transcription anglaise ; l'import exigeait la transcription, donc HTTP 500 « Failed to extract audio », puis 6 relances de l'orchestrateur pour rien.
- **Corrigé** : `pipeline/source_import.py` ne demande plus de transcription quand un texte français existe sur `:8005` ; sans proposition « hook », il prend la proposition **sélectionnée** (avant : la première de la liste, soit la variante de 971 caractères au lieu du texte de 4 186). `src/orchestrator/agent.ts` : `source` s'arrête au 2e échec de même cause.
- **Validation** : test ciblé `wrong-gender TTS cache guard` 1/1, 3 mutations sur 3 font échouer, `tsc` 0 erreur. Suite complète non relancée. Import réel sur `:8005` non lancé (il écrit une sélection sur le serveur) ; choix simulé en lecture seule : proposition 1351.
- **Audit du lancement `custom-1794568426-4ddb37d8-2`** (zip `…-165510.zip`, non importé) : `docs/audits/audit-lancement-custom-2026-11-13.md`. Import custom OK, `idle` 0 %, arrêt de la revue au tour 3 OK. Refusé avec 10 défauts, 65 min. Cause n°1 : la relecture des fiches (lot D) tourne en boucle après le code (26 passages, 138 réécritures de fiches) ; l'agent affaiblit la fiche au lieu de corriger le plan. 6 défauts sur 10 : objet à poser / pousser / lancer. **Corrections proposées, en attente de Pulsy.**
- **Corrections de cet audit faites, non commitées** (§6 du même fichier) : relecture des fiches une fois avant le code, fiche figée après la planche, `render` redemandé 3 fois = vidéo livrée avec défauts, `tray` / `plate` / `bottle`, `hold.level`, `hold.release` (poser, lancer, lâcher), `phoneShot` écran photo. `npm test` 64/64, 7 mutations sur 7, 6 plans de `prof` identiques au pixel. Aucun lancement réel.
- **Revue rouverte au retour de l'utilisateur** (§7 du même audit), non commité : un nouveau message sur un projet à revue close remet les compteurs à zéro et fait revoir les plans modifiés. `npm test` 64/64, 4 mutations sur 4.

## 2026-11-16 — récupération de `origin/main`

- `origin/main` avait 11 commits de plus (jusqu'à `3e8ca5d`) et `main` local 8 commits jamais poussés : pas d'avance rapide possible. Le distant contient déjà tout le contenu des 8 commits locaux (importé par zip), vérifié fichier par fichier : rien n'existe seulement en local.
- Branche de travail : **`suivi-origin-main`**, qui suit `origin/main`. `main` local est laissé tel quel (8 commits en double, à supprimer ou réaligner par Pulsy : `reset` m'est interdit).
- `npm test` sur `3e8ca5d` : 71/71, avec un python qui a numpy (nouveau venv du scratchpad ; l'ancien ne chargeait plus numpy).
- Nouveautés du distant depuis mon dernier commit : 6 vues de caméra (`view`), `cam: 'ots'` / `'pov'`, `foreground`, `zone`, mouvements `track` / `whip`, catalogue `providers.json`, durcissement sécurité, compaction en cours de tour, relance après la vidéo finale, épisodes en anglais.
- **Audit du 16 novembre** (11 nouveaux projets, code `3e8ca5d`, 403 images rendues) : `docs/audits/audit-2026-11-16.md`. 6 bugs vérifiés, tous petits (repo_map, guide contre types, accessoire sans `on`, cadrage à genoux, vues latérales en extérieur, texte de compaction recopié). Défaut de qualité n°1 : 21 % des plans de personnages de dos, à cause de `view: 'reverse'` attribué automatiquement. Personnages : 9 expressions réelles, gestes semblables, postures manquantes. Feuille de route en 6 lots au §6. **Rien n'est codé, en attente de Pulsy.**
- **Lots 1 et 2 de cet audit faits, non commités** (§7) : visages gardés en contrechamp, plus de contrechamp automatique, vues latérales d'extérieur, cadrage à genoux, accessoire au sol, `stamp.tone` / `tag.sub`, `repo_map`, compaction, sièges d'auditorium. `npm test` 72/72, 5 mutations sur 5, 65 plans comparés au pixel (0 différence inattendue). Suite proposée : lot 3 (visages).
- Lots 1 et 2 commités (`7e2f860`, non poussé). **Lot 3 fait, non commité** (§8) : 10 visages ajoutés (19 au total), `sad` / `angry` / `scared` dessinés à part, guide mis à jour. `npm test` 73/73, 64 plans sur 65 identiques au pixel (le 65e est un insert de téléphone sans visage). Reste du lot : regard, sourcils séparés. Suite : lot 4 (le corps).
- **Lot 4, première partie, fait, non commité** (§9) : `stance: 'lie'` et `'floor'`, `act: 'call'`, bras devant le buste (`armsFront`), `body: 'child'` et `'elder'`. `npm test` 74/74, 57 plans identiques au pixel et 8 différents attendus. Lots 3 et 4 non commités sur `suivi-origin-main`.
- **Pieds, lot 5, lot 4 bis, lot 3 bis, objets en mouvement : faits, non commités** (§10 de l'audit du 16 nov.). `npm test` 75/75, 5 mutations sur 5, projet réel re-rendu sans erreur. Reste : lancement réel, animation (lot 6), planche de non-régression en commande.
- **Audit du projet `4v9iyhecgpu-1`** (premier lancement réel avec `bdf3fdd`, zip du 16 nov. 14 h 43) : `docs/audits/audit-2026-11-16-projet-4v9.md`. Chaîne sans blocage (30 min). 2 bugs : revue finale perdue (réponse du Reviewer illisible), `v` inversé entre `reach` et `props`. Garde-fous manquants : sujet hors cadre, objet au sol. Dessin : profil `curls`, feuille debout, cadres 9:16 vides. Lots A à D proposés, aucun code modifié.
- **Audit audio** (code + 57 projets, sans écoute : pas de média dans les zips) : `docs/audits/audit-audio-2026-11-16.md`. Son figé avant le code des plans (79 % des plans récents sans bruitage), murmure de classe qui déborde sur les autres lieux, niveaux des bruitages sans effet (`0.6731` partout), aucun son écrit par l'agent, plus de musique. Lots S1 à S6 proposés ; S5 et S6 payants, à décider par Pulsy.
- **Lot A de l'audit `4v9` fait, non commité** (§9) : réponse du Reviewer au JSON invalide lue champ par champ et gardée (`raw`) ; `reach` lit `v` comme une hauteur (0 sol … 1 tête). `npm test` 75/75, 1 mutation détectée, S5 et S14 re-rendus corrects. Lot B (sujet dans le cadre, objet bas sur un meuble, refus de `as never`) : plan en §10, à valider.
- **Lot B de l'audit `4v9` fait, non commité** (§11) : le moteur mesure à l'image clé la tête du sujet (dans le cadre, cachée) et les accessoires bas sous un meuble ; l'audit des plans refuse, ainsi que `as never` dans un plan. Calibré sur 1 601 plans : 20 refus, 5 cas limites regardés, 0 à tort. `npm test` 76/76, 4 mutations sur 4. Lot C (profil `curls`, objet à plat, cadres 9:16) : plan en §12, à valider.
- **Lots A et B commités** (`72509a6`, non poussé). **Lots C, D et audio S1 à S3 faits, non commités** : profil `curls`, `props.flat`, plan large seul resserré en 9:16, alias de lieux, message d'identifiant introuvable ; son reconstruit depuis le code des plans (5 → 23 événements sur `4v9iyhecgpu-1`), murmure limité à la classe, niveaux sur une seule échelle, musique baissée sous les mots, rattrapage du niveau final. `npm test` 77/77, 4 mutations audio sur 4. **Aucune écoute possible sur ce poste** : densité sonore à juger sur une vraie vidéo. Restent S5 et S6 (payants, décision Pulsy).
