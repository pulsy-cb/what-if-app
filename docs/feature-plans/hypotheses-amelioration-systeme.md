# Hypothèses d'amélioration du système actuel (2026-11-13)

**Palier** P0 (réflexion, aucun code). Décision de Pulsy : la génération d'image n'est pas assez précise pour être ajoutée au studio. On la met de côté et on cherche ce qui peut améliorer le système tel qu'il est.

Chaque hypothèse dit : ce qu'on a observé, ce qu'on suppose, comment le vérifier à peu de frais, et ce qu'on gagnerait. Rien ici n'est prouvé tant que la colonne « vérification » n'est pas faite.

**Sources des constats :** l'essai Codex sur une copie de `prof` (`ameliorer-mise-en-scene.md` §5), les audits des 10 et 12 novembre, et les 25 images générées (`essai-images-de-reference.md`), qui servent ici de point de comparaison : elles montrent à quoi ressemble un bon plan dans notre style.

## 1. Ce que les images générées nous apprennent sur nos plans

Même si on ne les utilise pas, les images A à D de Qwen sont de meilleurs plans que les nôtres, avec les mêmes personnages et le même décor. Les différences sont précises :

| Dans les bonnes images | Dans nos plans |
|---|---|
| La main **touche** le pupitre, le sac, le combiné | La main s'arrête dans le vide (défaut S4 de l'essai) |
| Les objets de l'histoire sont **sur la table ou en main** | Ils sont surtout dans des inserts à part |
| Deux personnages sont **proches et se chevauchent** en profondeur | Ils sont côte à côte, écartés, à la même profondeur |
| Le cadre est **serré sur l'action** | Le tiers bas est du sol vide |
| Les visages **réagissent** (bouche ouverte, sourcils) | `neutral` et `worried` dominent |

Ces cinq écarts donnent les hypothèses H1 à H5.

## 2. Hypothèses sur l'image

| # | Constat | Hypothèse | Vérification à peu de frais | Gain attendu |
|---|---|---|---|---|
| **H1** | La main n'atteint pas le meuble : `reach` vise un point trop loin, le bras reste tendu dans le vide | Si `shot()` rapproche lui-même la personne du meuble visé (ou refuse quand la distance dépasse la longueur du bras), le contact devient lisible sans que l'agent calcule des positions | Rendre 5 plans `reach: { to: 'd4' }` à des distances croissantes ; mesurer à quelle distance la main décroche | Supprime une famille de refus du Reviewer (« main dans le vide ») |
| **H2** | En 9:16, le tiers bas est vide dans les plans larges et moyens à deux | Le cadre est calculé sur la largeur du groupe. Si l'agent place par défaut les gens **en profondeur** (un devant, un derrière) au lieu de côte à côte, la hauteur se remplit. `cam: 'deep'` existe mais rien ne pousse à l'utiliser | Compter dans le prochain épisode combien de plans à deux utilisent `deep`. Puis rendre les mêmes plans des deux façons et comparer la part de sol vide (mesurable en pixels) | Le défaut visuel le plus fréquent du format vertical |
| **H3** | Les objets cités par l'histoire sont absents des plans de personnages | Une liste « objets de l'épisode » décidée une fois (dans `DIRECTOR.md` ou `episode.json`), avec pour chacun qui le tient et quand, donnerait des objets suivis d'un plan à l'autre | Sur `prof` : lister à la main les objets du script (téléphone, sac, combiné, feuille) et compter dans combien de plans chacun apparaît | Continuité : le sac ne disparaît plus entre deux plans |
| **H4** | Trois gestes font encore plus de la moitié (cross-arms, think, point) | L'agent choisit dans une liste plate de noms. S'il choisit d'abord **l'intention** (accuser, se défendre, fouiller, céder, triompher) et que chaque intention propose 3 ou 4 gestes, la variété monte sans effort | Classer à la main les 30 fiches de l'essai par intention ; voir si les gestes répétés tombent tous dans 2 ou 3 intentions | Variété des poses, lisibilité de l'émotion |
| **H5** | Les visages sont peu expressifs | Le visage est réglé une fois par plan. Un changement d'expression **sur le mot clé** (déjà possible avec `beats`) est sous-utilisé | Compter les `beats` avec `face` dans l'essai, par plan | Des plans qui vivent sans mouvement de caméra |
| **H6** | La main du bras éloigné dépasse sous la veste (forme blanche) | Défaut de dessin du personnage de trois quarts | Rendre un personnage à 5 angles, bras au repos | Propreté, visible dans presque chaque plan de la prof |
| **H7** | Assis sans pupitre devant soi dans les cadres serrés | En plan serré, le meuble sort du cadre et la personne semble flotter | Rendre `on: 'd4'` en `medium` et `close` | Propreté |
| **H8** | Se pencher (`tilt`) ne se voit que de profil | De face, un buste penché devrait se traduire par un tassement et une tête qui avance | Rendre `lean` à 3 angles | Rend `lean`, `rummage`, `slam` utilisables de face |

## 3. Hypothèses sur la direction (ce que l'agent décide)

| # | Constat | Hypothèse | Vérification | Gain attendu |
|---|---|---|---|---|
| **H9** | Les fiches sont écrites au minimum, une par une, sans vue d'ensemble | Écrire d'abord **la scène** (5 à 8 scènes par épisode : lieu, qui est là, où est chacun, ce qui change), puis les fiches de plans à l'intérieur. Les places des personnages seraient fixées une fois par scène | Découper `prof` à la main en scènes ; voir si les défauts de continuité relevés par le Reviewer tombent aux frontières de scène | Cohérence des places d'un plan à l'autre, moins de fiches à corriger |
| **H10** | Le Reviewer découvre les problèmes après le code | Faire relire **les fiches** par le Reviewer avant tout code (texte seul, rapide, peu cher) attraperait les plans faibles avant qu'ils coûtent du temps | Donner les 30 fiches de l'essai au Reviewer et regarder s'il signale déjà S4, S12, S14, S20 | Moins de tours de revue après le rendu |
| **H11** | L'agent refait des plans entiers pour un petit défaut | Les remarques du Reviewer sont en prose. Si elles étaient ramenées à un réglage (« rapproche PROF de d4 », « élargis le cadre »), l'agent corrigerait en une ligne | Classer les 347 remarques de l'audit du 12 novembre : quelle part se ramène à un réglage unique ? | Tours de correction plus courts |
| **H12** | Aucune mémoire d'un épisode à l'autre | Un fichier « ce qui a marché » par type de scène (dispute à deux, entrée d'un personnage, objet révélé) servirait de point de départ | Comparer deux épisodes proches (`prof`, `telephone-salon`) : y a-t-il des plans réutilisables ? | Qualité plus régulière, moins d'invention à chaque fois |

## 4. Hypothèses sur le temps et les erreurs

| # | Constat | Hypothèse | Vérification | Gain attendu |
|---|---|---|---|---|
| **H13** | 33 retours en erreur sur 123 appels d'outil dans l'essai, dont 13 commandes shell refusées | L'agent cherche encore à lire des fichiers par le shell. Lister ces 13 commandes dira quel outil manque | Relire les 13 commandes dans la base de l'essai | Moins d'étapes perdues |
| **H14** | L'agent lance `voice` et `render` alors qu'on lui dit de ne pas le faire | La consigne « enchaîne tout sans t'arrêter » du prompt l'emporte sur la demande du moment | Relire le prompt (`context.ts`, « How you work ») | Un agent qu'on peut arrêter à une étape |
| **H15** | La durée dépend d'abord du modèle (16 à 35 min contre plus de 2 h) | Un contrôle au lancement qui avertit quand le modèle choisi est connu pour être lent éviterait des lancements perdus | Aucune : c'est déjà mesuré dans l'audit du 12 novembre | Évite les lancements de 2 h |
| **H16** | L'audit refuse, l'agent corrige, l'audit refuse autre chose | L'audit s'arrête aux 10 premières erreurs. Les donner **groupées par plan** permettrait de corriger un plan en une fois | Compter dans un lancement le nombre d'allers-retours d'audit avant les vignettes | Moins d'allers-retours |

## 5. Par où commencer

Classement par rapport entre l'effet attendu et l'effort, d'après ce qu'on sait aujourd'hui :

1. **H1, la main qui touche.** Petit, dans le moteur, et c'est un défaut que le Reviewer refuse.
2. **H2, la profondeur par défaut en vertical.** Le moteur sait déjà le faire ; il manque la règle et la mesure.
3. **H10, le Reviewer relit les fiches avant le code.** Peu de code, et il attaque le coût principal : les tours de revue.
4. **H9, la scène avant le plan.** Le plus structurant, mais le plus gros.
5. **H6, H7, H8**, de petites corrections de dessin à regrouper.

H3, H4, H5, H11 à H16 demandent d'abord leur vérification : ce sont des comptages sur des données qu'on a déjà.

**Ce qu'il faut avant de trancher :** le résultat de ton lancement sur l'autre machine. Il dira si l'agent utilise ce qu'on a ajouté (fiches, `hold`, `walkTo`, `deep`, gestes créés), ce qui change l'ordre ci-dessus.

## 6. La génération d'image : où on en est

Mise de côté. Bilan en une ligne : fiable à un ou deux personnages, pas au-delà ; et même fiable, elle n'apporte pas une précision que le moteur n'a pas. Les essais restent documentés dans `essai-images-de-reference.md` (§7 à §12). Si on y revient un jour, ce sera pour des images d'intention par scène, pas par plan.

## Validation

- Constats repris de documents existants, cités en tête. Aucun nouveau comptage n'a été fait pour cette note.
- **Non vérifié :** toutes les hypothèses. Les colonnes « vérification » disent comment.
