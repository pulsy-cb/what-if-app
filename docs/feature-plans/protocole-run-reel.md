# Protocole — run réel de `crush` avec les lots 1 à 5

**Palier P0** (procédure). À exécuter sur la machine qui a Docker, les clés (LLM, ElevenLabs, Modal) et le serveur `nouveau` (:8005). Ce poste ne peut pas.
**But :** savoir si les lots 1 à 5 améliorent vraiment le visuel avec **le même modèle** (GLM-5.3-Flash) et **la même vidéo source** que le run de référence.

## 0. Avant de lancer

**Mis à jour le 2026-11-09 :** lancer d'abord le pré-vol, `docker compose exec studio node pipeline/preflight.mjs`, puis commencer par un épisode court. Les nouveaux projets utilisent `shot()`, `place()` et `cast()`. État et limites : `docs/audits/audit-run-reel-2026-11-09.md`.

1. **Commiter** les changements (par toi) puis les récupérer sur la machine du run. Fichiers : voir « À faire par Pulsy » du plan d'avancement.
2. **Reconstruire l'image** : `docker compose up --build` (le `Dockerfile` copie maintenant `engine-overlay/`).
3. **Démarrage** : `data/app.db` sera migrée (colonne `project_runs.model`). Sauvegarde conseillée : `cp data/app.db data/app.db.bak-avant-run`.
4. **Réglages** (⚙ ou variables d'environnement) :
   - modèle de l'agent : **le même que le run de référence**, `zai-org/GLM-5.3-Flash` ;
   - **Reviewer** : un modèle vision solide, par exemple `WHATIF_REVIEW_MODEL=<modèle vision fort>`. Sans cela il hérite du modèle Flash et la validation reste faible ;
   - garder `WHATIF_APPROVALS=off`, `WHATIF_MAX_TOKENS=24000` comme pour `crush`.
5. Le skill doit être monté (`../what-if-animation:/skill:ro`) : sans lui `whatif_new` ne peut pas créer de projet.

## 1. Lancer

1. Dans l'app : bouton **+**, **nouveau projet** `crush-v2`, slug d'épisode **`crush`**, `video_id` **`7702138388547144990`**, format **9:16**, case « Lancer l'agent » cochée.
   - Un **projet neuf** : `whatif_new` applique le calque moteur tout seul (vérifier que sa réponse contient `engine overlay: added: … views.tsx`).
   - Ne pas réutiliser le dossier `crush` : il garde l'ancien moteur.
2. Le message de départ est généré par le formulaire. **Il a changé** (étapes 3 et 4 : plus de `<DiningTable>/<Desk>` imposés, orientation des personnages, planches de contact). Le run mesure donc le système complet, prompt de départ compris.
3. Laisser tourner jusqu'au mp4. Noter l'heure de début et de fin.

### Variante B (facultative, pour isoler le prompt de départ)
Même chose avec l'**ancien** message de `crush` (pour séparer l'effet du guide de celui du nouveau message). Créer le projet `crush-v2b` puis, à la place du message pré-rempli, coller le texte de `docs/feature-plans/protocole-run-reel.md` § « Ancien message » ci-dessous.

<details>
<summary>Ancien message (lu dans la base)</summary>

```
Nouvel épisode « crush » (format 9:16 vertical (1080×1920)) à partir de la vidéo nouveau 7702138388547144990. Fais tout, du début à la fin, sans me demander de validation.
1. whatif_run {step:"source", args:["--pick","hook","--apply"]} : récupère la proposition de traduction française du serveur :8005 dans out/crush/source.fr.md et l'applique directement dans episode.json.script. IMPORTANT : NE RACCOURCIS PAS et NE RÉÉCRIS PAS la traduction du serveur :8005 (un projet peut durer de 20s à plusieurs minutes ; garde l'intégralité du texte traduit dans episode.json.script, règle simplement "defaultSet" selon le lieu de l'histoire et conserve "aspect": "9:16").
2. Enchaîne voice, shotlist et plan.
3. Avant de coder shots.tsx, écris une vraie note de réalisation et mise en scène dans src/episodes/crush/DIRECTOR.md : (a) Construction riche des décors en 3 couches de profondeur (arrière-plan détaillé, plan moyen mobilier/table <DiningTable>/<Desk>, premier plan), (b) Casting et costumes (makeLook), (c) Découpage plan par plan avec vrais champs/contrechamps ou plans à deux (tableSit quand deux personnages sont à table) et chorégraphie physique précise des mains/bras quand un personnage prend, tient ou pose un objet (handRProp, handWorld, reachPose, grabAt — aucun accessoire ne doit flotter loin des mains).
4. Écris shots.tsx et index.tsx en suivant fidèlement DIRECTOR.md, lance stills et board, inspecte storyboard.jpg avec view_image et corrige si besoin.
5. Puis sfx, render et master jusqu'au mp4 final en 9:16 vertical (1080×1920), et résume-moi le résultat (durée, orientation, LUFS, fichiers).
```
</details>

## 2. Mesurer

Depuis la racine du dépôt (le dossier de données est `data/` ; en Docker, `./data` est monté) :

```bash
python3 scripts/measure-episode.py data/projects/crush-v2 crush --db data/app.db
```

Compare à la référence (`docs/audits/mesure-reference-2026-11-09.txt`, mesurée le 2026-11-09 sur `crush`) :

| Indicateur | Référence `crush` | **Seuil visé** (hypothèse posée avant le run) |
|---|---|---|
| plans orientés (non frontaux) | 2 / 36 | **≥ 50 % des plans avec personnage** (`not-father`, même modèle : 31/36) |
| valeurs `yaw` écrites | 0 | ≥ 20, dont au moins une vue de profil et un dos |
| plans avec amorce floue | 0 | **≥ 6** |
| erreurs d'outils | 112 / 501 (22 %) | **≤ 15 %** |
| modèle enregistré | non | `zai-org/GLM-5.3-Flash` présent dans `models_recorded` |
| plans par seconde (médiane) | 3,35 s | inchangé (± 0,5 s) : le rythme ne doit pas se dégrader |

Si le seuil n'est pas atteint, **c'est une information** (le guide ne suffit pas à ce modèle), pas un échec du protocole.

## 3. Regarder (ce que les chiffres ne disent pas)

Ouvrir `out/crush/sheets/sheet-01.jpg` à `sheet-05.jpg` (36 plans, 8 par planche) et vérifier :

1. la salle **se lit comme une classe** : tableau plat au mur, pupitres, pas de planche suspendue ;
2. aucun reste du décor de démo (« 7 × 8 = ? ») ni de ciel de crépuscule dans une scène de jour ;
3. les personnages ne sont pas tous de face ; les deux qui se parlent se font face ;
4. les groupes ne sont pas alignés en rang ;
5. au moins un plan de dos ou de profil net, au moins une amorce floue ;
6. `out/crush/review.json` existe : le Reviewer a tourné, avec quelles remarques ? Sont-elles justes ?

## 4. Me renvoyer

- la sortie de `measure-episode.py` ;
- `out/crush/sheets/*.jpg` et `out/crush/review.json` ;
- `src/episodes/crush/DIRECTOR.md` et `PROJECT.md` ;
- le nombre de refus d'écriture (`refused`) dans les résultats d'outils : ils comptent comme erreurs mais montrent que la liste d'autorisés agit ;
- toute anomalie (réponse coupée, boucle, plan écrit au mauvais endroit).

## 5. Si ça coince

| Symptôme | Piste |
|---|---|
| `whatif_new` : « no studio/ in /skill » | le skill n'est pas monté (`WHATIF_SKILL_DIR`) |
| pas de `sheets/` | `board_sheets.py` n'a pas tourné : regarder la note « contact sheets not built » dans le résultat de `board` (Pillow est dans l'image Docker) |
| l'agent écrit dans `src/engine` | refusé par construction ; si c'est utile, `WHATIF_ALLOW_ENGINE_WRITES=1` |
| Reviewer silencieux | il se déclenche après `board` seulement ; vérifier `⚙` (modèle du Reviewer) |
| accents manquants dans les légendes des planches | police DejaVu absente de l'image : ajouter `fonts-dejavu-core` au `Dockerfile` |
| épisode existant à passer au nouveau moteur | `whatif_sync_engine { apply: true }` dans ce projet |

## Validation de ce document
Procédure écrite d'après le code et la base ; **non exécutée**. Le message de la variante B est celui lu dans `data/app.db` le 2026-11-09. Les seuils sont des hypothèses fixées avant le run.
