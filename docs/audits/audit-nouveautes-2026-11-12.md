# Audit des nouveautés de main et des 16 nouveaux projets (2026-11-12)

**Palier** P0 (audit, lecture seule). Les corrections proposées au §5 relèvent du P2 et attendent la validation de Pulsy.

**Sources :**
- main à `474cb3a` (13 commits depuis `c383374`, 47 fichiers, +11 900 lignes) ;
- base du zip `what-if-data-code-db-20261112-095841.zip` : 16 projets lancés du 10 au 11 novembre, 98 passages du Reviewer ;
- vignettes **refaites en local** (12 plans chacun) pour `la-promesse`, `prof` et `the-er`. Les médias ne sont pas dans le zip.

**Non fait :** relecture ligne à ligne des nouveaux fournisseurs (Codex, AGY), de l'interface web et du son ; écoute des vidéos ; vrai LLM ; Modal.

## 1. Ce qui s'est amélioré

| Sujet | Avant (telephone-salon, 10 nov.) | Maintenant |
|---|---|---|
| Vidéo terminée | 0 | **14 projets sur 16** ont un rendu |
| Durée d'un short avec un bon modèle | 47 min sans vidéo | **16 à 35 min** (gpt-6.1-terra, gemini-3.8-flash) |
| Plans écrits à la main | 36 sur 36 | `shot()` partout ; `edit_shot` est devenu l'outil principal (jusqu'à 219 appels par projet) |
| Image verticale | remplie au tiers | pleine (`prof`) |
| Rythme | 4,3 s par plan | `prof` : 30 plans en 67 s ; `la-promesse` : 61 plans en 192 s |
| Reviewer | aveugle | lit tout ; contre-visite ciblée plan par plan ; ses remarques sont précises et justes sur l'échantillon vérifié |

## 2. Les problèmes qui persistent (par gravité)

### 2.1 Une vidéo sort même quand le Reviewer la refuse encore

`z8nvytvrw5c` (agent GLM-5.3-Flash) : 8 refus de suite, puis le rendu se fait quand même. Le code final contient toujours les défauts signalés : `JULES_KID` dans S6, S7 et S8 après le saut de cinq ans. **Le Reviewer avait raison.**

Le dernier tour de revue n'est pas bloquant, par conception. Résultat : une vidéo fausse est livrée sans alerte visible.

### 2.2 Le Reviewer est rappelé alors que rien n'a changé

Sur `z8nvytvrw5c`, entre le tour 5 et le tour 6 : **aucune modification** de plan. L'agent a relancé `stills`, `board` et `render`, et le Reviewer a refait le même constat. 16 minutes et un appel payant pour rien.

### 2.3 Les boucles longues existent toujours avec les petits modèles

| Projet | Agent | Durée | Étapes | Refus | Vidéo |
|---|---|---|---|---|---|
| `phone-du-marie` | DeepSeek puis gpt | 118 min | 389 | 22 | **non** (16 arrêts automatiques) |
| `z8nvytvrw5c` | GLM-5.3-Flash | 124 min | 383 | 8 | oui, avec défauts |
| `grand-pa` | DeepSeek | 123 min | 525 | 4 | oui |
| `the-er` | DeepSeek | 157 min | 214 | 7 | oui |
| `ce-que-veulent-les-femme` | DeepSeek | 149 min | 129 | 1 | oui |

Pour comparaison : `prof` (gemini) 28 min, `la-promesse` (gpt) 26 min, `jscqwpvdpkg` (gpt) 16 min.

**Le modèle est maintenant le premier facteur de durée.** DeepSeek et GLM-Flash lisent sans cesse (211 et 330 `read_file`), et corrigent peu ou à côté.

### 2.4 Les erreurs qui reviennent dans l'écriture des plans

Refus de l'audit avant `stills` (32 fois) :

| Nombre | Cause | Ce que ça révèle |
|---|---|---|
| 17 | `no piece "t2"` / `"sofa"` dans ce lieu | l'agent devine le nom des meubles |
| 11 | plan sans personnage | plan d'objet non déclaré `insert` |
| 10 | geste inconnu : `facepalm`, `kneel`, `push`, `shout` | gestes demandés par les histoires, absents du moteur |
| 8 | objet React invalide `{p, id, at, len}` | une pièce de décor passée dans `extra` au lieu de `pieces` |
| 8 | `reading 'project'`, `pl.items is not a function` | un lieu mal passé à `shot()` |

Autres frictions :
- **62 commandes shell refusées** (métacaractères, commande hors liste). L'agent veut presque toujours lire ou filtrer `words.json` et `timeline.json` avec `python` ou un tube.
- **32 `edit_file` ratés** (texte introuvable ou non unique), surtout sur DIRECTOR.md et `episode.json`.
- **11 `edit_shot` refusés** : le code ne commence pas par `export const Sx =`.

### 2.5 Ce que le Reviewer reproche le plus (347 remarques)

| Thème | Remarques |
|---|---|
| Cadrage : personnage coupé, hors champ, au bord | **124** |
| Décor ou lieu | 66 |
| Objet clé, accessoire | 46 |
| Mauvais personnage ou personnage absent | 42 |
| Écart avec DIRECTOR.md | 33 |
| Vide ou trop sombre | 33 |

Le cadrage reste le défaut numéro un, alors que `shot()` est censé cadrer seul. À creuser : gros plans à deux, personne en mouvement, `cam` littérale.

## 3. Ce qu'on voit à l'image

Les trois épisodes sont **nettement meilleurs** que telephone-salon : décors lisibles, personnages distincts, expressions variées. Défauts relevés :

**`la-promesse` (16:9, gpt)**
1. Au théâtre, les personnages sont **debout derrière les rangées de sièges**, qui leur cachent le corps. Personne n'est assis.
2. Titre « PROMESSE » coupé en haut du premier plan.
3. Gros plans trop serrés : la tête remplit le cadre, le menton ou le haut du crâne est coupé, une main flotte au bord.

**`prof` (9:16, gemini)**
1. **Titre coupé à droite** (« SAUVÉE DU REN… ») : la carte-titre est plus large que le cadre vertical. C'est un bug du moteur.
2. Le texte du tableau est caché par les têtes, donc illisible.
3. **Le même geste, bras tendu, dans presque tous les plans** de la professeure.
4. Tiers bas de l'image vide (sol sombre) dans les plans larges.
5. L'amorce floue du premier plan est une grosse tache jaune.

**`the-er` (16:9, DeepSeek)**
1. **Visage peu lisible** : peau foncée et cheveux bruns presque de la même teinte, sans contour clair entre les deux.
2. Personnages **assis dans le vide** (S1, S6) : pas de siège sous eux.
3. Un gâteau flotte en l'air (S26).
4. Panneau « URGENCES » coupé en haut à gauche ; gros plans coupés.

**Commun aux trois :** le geste « bras tendu » revient partout, et les gros plans coupent les têtes.

## 4. Autres points relevés

1. **Tests** : 49/49, mais seulement avec un python qui a `numpy`. Sur ce Mac, 3 tests échouent (son, voix). À documenter ou à faire sauter proprement quand `numpy` manque.
2. **Captures d'écran commitées sur main** (46 images), contre la règle « aucune capture ne se commite ».
3. **Commit `b31d8a1 other`** : message vide de sens dans l'historique de main.
4. **Un `merge` a été fait sur main** (`cd2353e`) depuis l'autre machine, alors que la règle l'interdit. À toi de dire si la règle vaut aussi là-bas.
5. `reviewMaxRounds` vaut 2 par défaut dans le code, mais on compte jusqu'à 8 tours dans un seul lancement. Le serveur a donc une autre valeur, ou le compteur repart. **À vérifier.**
6. `master` ne figure pas comme réussi dans 6 projets qui ont pourtant un rendu. Probablement le master automatique (commit `6f98758`). **À vérifier.**

## 5. Corrections proposées, par ordre d'effet

### Bloquant pour la qualité livrée

1. **Ne plus livrer en silence une vidéo refusée.** Au dernier tour, si le Reviewer refuse encore, le rendu se fait mais le message final et le projet portent « livrée avec N défauts non corrigés », avec la liste. Option plus stricte : pas de rendu, et la main à Pulsy.
2. **Pas de nouvelle revue sans changement.** Si aucun des plans refusés n'a changé depuis la dernière revue, `board` ne rappelle pas le Reviewer et répond : « tu n'as modifié aucun des plans refusés : S6, S7, S8 ».
3. **Carte-titre en vertical** : réduire ou couper en deux lignes quand le titre dépasse 900 unités de large.

### Qualité de l'image

4. **Gros plans** : garder toute la tête dans le cadre (marge au-dessus du crâne et sous le menton), en 16:9 comme en 9:16.
5. **Assis sans siège** : `shot()` pose un tabouret ou refuse quand une personne est `sit` sans `on`. Les rangées de sièges (`seat-row`) doivent asseoir les gens au lieu de les cacher.
6. **Visage contre cheveux** : contour clair ou écart de teinte forcé quand la peau et les cheveux sont trop proches.
7. **Gestes** : ajouter `facepalm`, `kneel`, `push`, `shout`, avec des synonymes tolérés. Signaler au Reviewer quand le même geste dépasse un tiers des plans d'un personnage.
8. **Objets posés** : un objet dans `extra` sans support se pose sur le meuble le plus proche, ou l'audit le signale.

### Temps et coût

9. **Modèle par défaut** : gpt-6.1-terra ou gemini-3.8-flash pour l'agent. DeepSeek et GLM-Flash coûtent moins par token mais prennent 4 à 6 fois plus de temps et d'étapes. À chiffrer avec le `ledger` avant de trancher.
10. **Un outil pour lire les mots d'un plan** (`shot_words { id }`) : il supprimerait la plupart des 62 commandes shell refusées.
11. **Noms des meubles** : quand un `on:` ou un `reach` vise une pièce inconnue, proposer la plus proche au lieu de seulement lister. Mettre aussi la liste des pièces de chaque lieu utilisé dans le prompt.
12. **Tolérer une pièce de décor dans `extra`** : la dessiner comme une pièce, ou donner le message « mets-la dans `pieces` ».

### Dépôt

13. Retirer les captures de main, dans une PR dédiée.
14. Faire sauter les 3 tests quand `numpy` manque, avec un message clair.

## Validation

- Journal : 16 projets, `project_runs` et `messages` après le 10 nov. 16 h ; 98 revues, 347 remarques classées par mots-clés (classement approximatif).
- Code final de `z8nvytvrw5c` lu : `JULES_KID` toujours présent dans S6, S7, S8.
- Vignettes : 12 plans par épisode, Remotion 4.0.530 en local. Images dans le scratchpad, non commitées.
- `npm test` : 49/49 avec `numpy`, 46/49 sans.

## À surveiller

Décisions attendues de Pulsy :
- point 1 : livrer avec une alerte, ou bloquer le rendu ;
- point 9 : le modèle par défaut de l'agent ;
- l'ordre des corrections.
