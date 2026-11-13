# Audit des lancements du 12 et 13 novembre (2026-11-13)

**Palier** P0 (audit, lecture seule). **Source :** `what-if-app-data-sans-medias-20261113-124950.zip`, dézippé hors du dépôt. 43 projets dans la base, dont **8 créés après nos changements** (un neuvième est vide). Les médias ne sont pas dans le zip : **je n'ai regardé aucune image**, seulement la base, le code des plans, les fiches et les revues.

Les 8 projets ont bien le code des deux lots (fiches, `hold`, `walkTo`, `defineAction`, `cam: 'deep'`).

## 1. Les 8 projets

| Projet | Agent | Durée | Étapes | Plans | Reviewer |
|---|---|---|---|---|---|
| `jkjhmawdti0` | gpt-6.1-terra | 22 min | 56 | 18 | **accepté** (tour 6) |
| `7705348232817151262` | gpt-6.1-terra | 46 min | 113 | 36 | refusé au tour 8, 5 défauts |
| `x8-puu4qtfi` | gemini-3.8-flash | 39 min | non journalisées | 20 | pas de revue dans le zip |
| `gmr2wkbwwxo` | gemini-3.8-flash | 26 min | non journalisées | 19 | pas de revue dans le zip |
| `gmr2wkbwwxo-2` | DeepSeek | 39 min | 190 | 19 | refusé au tour 8, 8 défauts |
| `7674902316163616014` | DeepSeek | 77 min | 375 | 27 | refusé au tour 8, 6 défauts |
| `7641245977160027405` | DeepSeek | 108 min | 446 | 24 | refusé au tour 8, 7 défauts |
| `o2av-bo21ay` (16:9) | gpt-6.1-terra | 6 min | 46 | 61, dont 42 avec fiche | en cours au moment de l'export |

**Un seul projet sur cinq est accepté par le Reviewer.** Les quatre autres vont jusqu'au tour 8 et sortent avec une liste de défauts. Le serveur de l'autre machine autorise donc 8 tours (le défaut du code est 2).

## 2. Ce qui marche

1. **Les fiches sont écrites partout** : 205 fiches sur les projets terminés, phrase « ce qu'on voit » de 75 caractères en médiane.
2. **Les objets en main sont utilisés** : `hold` dans 6 projets sur 7 (jusqu'à 13 fois), `props` dans 5.
3. **La marche avec déplacement** : `walkTo` dans 4 projets. Plus aucune marche sur place signalée.
4. **Les angles de caméra** : 30 dans le code (1 seul sur `prof` avant).

## 3. Ce qui ne marche pas

### 3.1 Mes règles refusent à tort (à corriger en premier)

Sur 77 refus de l'audit des plans, la majorité vient de règles que j'ai écrites trop strictes :

| Refus | Nombre | Cause |
|---|---|---|
| « la fiche montre *barreaux / escaliers / chaise / table / télé / canapé / lit / bureau…* mais le code ne dessine aucun objet » | **plus de 150 lignes** | L'agent met le **mobilier et le décor** dans `objects`. Ma règle exige alors `hold` ou `props`, alors que ces éléments sont déjà dans le lieu |
| « la fiche demande un angle haut / bas mais le code n'en a pas » | 53 | 42 fiches demandent un angle, 30 plans en ont un. L'agent écrit l'angle dans la fiche puis l'oublie dans le code |
| `hold: no object "undefined"` (plantage) | 39 | L'agent écrit `hold: { … }` sans le champ `what` (autre nom de champ). Le message d'erreur ne dit pas lequel est attendu |
| « la fiche met NARRATOR dans le plan mais le code ne l'utilise pas » | 17 | L'agent met le narrateur dans `people` de la fiche |

Ces refus coûtent des allers-retours sans rien améliorer à l'image.

### 3.2 Le contact main-objet est le premier défaut refusé par le Reviewer

Sur les 26 défauts restants au dernier tour : **13 portent sur une main, un contact ou un objet tenu** (main isolée sans avant-bras, objet et main déplacés séparément, main dans le vide), 7 sur le cadre, 6 sur le reste.

C'est l'hypothèse H1 de `hypotheses-amelioration-systeme.md`, confirmée par les chiffres.

### 3.3 Les nouveautés du lot 2 ne sont presque pas utilisées

| Nouveauté | Usage |
|---|---|
| `cam: 'deep'` (deux profondeurs) | **2 plans sur 106** cadres nommés |
| `defineAction` (geste créé) | **0** |
| `behind` (dessin derrière les personnages) | **0** |
| `lean`, `rummage`, `slam`, `give`, `read` | 0 dans les 14 gestes les plus fréquents |

L'agent ne s'en sert pas spontanément : les décrire dans le guide ne suffit pas. C'est l'hypothèse H2.

### 3.4 Les gestes restent pauvres

330 gestes : `idle` **89** (27 %), `hold` 32, `point` 26, `explain` 23, `cheer` 23, `cross-arms` 23. `idle` reste en tête, loin devant. Le contrôle des fiches refuse une action répétée dans le texte, mais rien ne relie le texte de la fiche au geste codé.

### 3.5 L'agent dessine à la main ce que le moteur n'a pas

Deux projets contiennent des personnages ou objets dessinés dans `extra` : une crinière, une gueule avec des dents, une radio, un portefeuille, un collier, une manette. Le Reviewer y trouve la plupart des défauts de contact (« l'ellipse de la main reste isolée, sans avant-bras »).

Deux manques réels du moteur :
- **Objets tenus hors bibliothèque** : les agents recolorent `box` ou `paper` pour simuler autre chose, ou dessinent une main à part.
- **Personnages non humains** (un animal, un masque) : rien n'existe.

### 3.6 Les petits modèles ne corrigent pas ce qu'on leur signale

Sur `7641245977160027405` (DeepSeek), le Reviewer écrit « 5e signalement, correctif toujours non appliqué » et « aucun des quatre points signalés n'a été corrigé ». Huit tours de revue, 108 minutes, pour finir refusé. Le garde-fou « pas de revue sans changement » ne suffit pas quand l'agent modifie le plan sans traiter la remarque.

### 3.7 Divers

- 29 tentatives de `render` refusées (21 fois « le Reviewer a refusé cette planche », 8 fois « planche périmée ») : l'agent essaie de rendre avant d'avoir corrigé.
- Les deux projets Gemini n'ont ni étapes journalisées ni `review.json` dans le zip. **Je ne sais pas** si la revue a tourné.
- `o2av-bo21ay` a 61 plans dont 19 sans fiche : export pris en cours de route.

## 4. Corrections proposées, par ordre

### À corriger tout de suite (mes règles)

1. **`objects` de la fiche = seulement ce qu'un personnage tient ou manipule.** Le dire dans l'outil et le guide, et ne plus refuser quand l'objet cité est une pièce du lieu ou un mot de décor. Cible : supprimer les 150 refus à tort.
2. **`hold` tolérant** : accepter `kind`, `name`, `object`, `item` comme synonymes de `what`, et un message clair sinon. Accepter aussi **un dessin libre** : `hold: { node: <g>…</g> }`, pour les objets hors bibliothèque, attachés à la main (plus de main dessinée à part).
3. **Narrateur** : refuser `NARRATOR` / `NARR` dans `people` de la fiche dès l'outil `stage_shots`, avec la raison, au lieu de le découvrir à l'audit.
4. **Angle** : quand la fiche donne un angle, l'appliquer au plan automatiquement si le code n'en a pas, au lieu de refuser.

### Ensuite (qualité de l'image)

5. **H1, la main qui touche** : c'est la moitié des défauts restants.
6. **H2, la profondeur par défaut en vertical** : un plan à deux en 9:16 sans `deep` ni justification devient un avertissement de l'audit.
7. **Geste lié à la fiche** : `idle` refusé quand la fiche décrit une action ; proposer dans le message les gestes proches (`lean`, `rummage`, `give`…).
8. **Personnages non humains et accessoires portés** (masque, collier) : à cadrer avant de coder, c'est un chantier.

### Temps

9. **Plafond de tours de revue** : 8 tours pour finir refusé ne sert à rien. Revenir à 3, ou arrêter quand le même défaut est signalé trois fois.
10. **Modèle** : les trois projets DeepSeek font 39, 77 et 108 minutes et sont tous refusés. gpt-6.1-terra fait 22 et 46 minutes, dont le seul accepté.

## Validation

- Comptages faits sur la base et les fichiers du zip (messages d'outil, `review.json`, `episode.json`, `shots/S*.tsx`) pour les 8 projets créés à partir du 2026-11-12 15:45.
- Le classement des défauts du Reviewer est fait par mots-clés : approximatif.
- **Non fait :** aucune image regardée (pas de médias), aucun rendu refait, aucune vidéo écoutée. La cause exacte des 39 `hold` « undefined » est déduite du message, le code fautif n'est plus dans les fichiers finaux.
