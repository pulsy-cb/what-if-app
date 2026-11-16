# Audit de la partie audio — bruitages, ambiances, musique, mixage, niveau final

**Palier** P0 (audit seul, aucun code modifié).
**Périmètre** : `pipeline/sfx_run.py`, `pipeline/shotlist.py` (`build_default_sound`, `LIBRARY_CLIPS`), `pipeline/master_run.py`, lecture audio du moteur (`episode.tsx`), consignes de l'orchestrateur, et les données des 57 projets du zip du 16 novembre (48 ont une section `sound`, 41 un rapport final).
**Limite importante** : les zips ne contiennent aucun média et la bibliothèque `library/sfx` n'est pas sur ce poste. Je n'ai donc **rien écouté** : l'audit porte sur le code, sur `episode.json`, `timeline.json`, `report.json` et sur les journaux de l'étape `sfx`. Tout ce qui touche au rendu à l'oreille est marqué « à écouter ».

## 1. Résumé

La chaîne audio est fiable : 0 piste muette sur 41 rapports, aucun blocage, 3 échecs de l'étape `sfx` sur 40 projets. Le défaut n'est pas la fiabilité, c'est la **pauvreté** : depuis le retrait de la musique, un épisode récent se réduit à une ambiance continue, un impact au titre et deux sons à la fin.

| # | Sujet | Nature | Priorité |
|---|---|---|---|
| A1 | Le son est figé avant que les plans soient écrits : 79 % des plans sans aucun bruitage | conception | haute |
| A2 | Le murmure de classe continue dans les autres lieux | bug | haute |
| A3 | L'agent n'écrit jamais de son (0 son sur mesure en 48 projets) et le guide n'en parle pas | conception | haute |
| A4 | Le réglage de niveau des bruitages n'a aucun effet (même volume partout) | bug | moyenne |
| A5 | Le niveau des ambiances dépend du son le plus fort de l'épisode | bug | moyenne |
| A6 | Murmure de classe de 2 s répété en boucle | qualité, à écouter | moyenne |
| A7 | Aucune baisse des bruitages sous la voix | qualité | moyenne |
| A8 | Plus de musique du tout ; une seule musique en bibliothèque | décision produit | à trancher |
| A9 | Niveau final : médiane -14,5 LUFS, 7 vidéos sur 41 sous -14,8 | mineur | basse |
| A10 | Son inconnu remplacé en silence par un autre | mineur | basse |

## 2. Comment le son est fabriqué aujourd'hui

1. Étape `plan` / `shotlist` : `build_default_sound` écrit `episode.json.sound` à partir du découpage (taille, `accent`, `set`, mots de la note de chaque plan).
2. Étape `sfx` : `sfx_run.py` prend les clips dans `library/sfx` (ou les génère par ElevenLabs s'ils manquent et qu'une clé est présente), pose les événements sur une piste `sfx.wav`, calcule les volumes voix / bruitages / musique et les écrit dans `timeline.json`.
3. Rendu : le moteur lit deux ou trois pistes (`voice`, `sfx`, `music`) à volume fixe.
4. `master` : normalisation à -14 LUFS, pic à -1,2 dBTP.

## 3. Ce que disent les 48 projets

| Mesure | Projets récents sans musique (26) | Anciens avec musique (22) |
|---|---|---|
| Bruitages ponctuels par minute (médiane) | 6,7 | 14 à 40 |
| Plans sans aucun bruitage | 701 sur 891 (**79 %**) | presque 0 (un son par plan, en rotation mécanique) |
| Musique | non | oui, la même boucle de 17 s partout |

- Sons les plus posés, tous projets : `pop` 133, `paper_land` 131, `sparkle` 111, `select_draw` 99, `copy_click` 96, `paste_pop` 90, `ding` 88. Les sons concrets sont rares : `step` 21, `clink` 11, `gasp` 2. `shatter`, `crack`, `laugh`, `buzzer`, `bulb_pop`, `shades`, `big_step`, `power_down` : **jamais** utilisés.
- Sons sur mesure demandés par l'agent : **0**. Modifications de `sound` par l'agent : 2 en 40 projets.
- Journaux `sfx` récents : `0 new via ElevenLabs` partout ; tout vient de la bibliothèque.

Exemple, `4v9iyhecgpu-1` (34 s, 18 plans) : 5 événements en tout. Deux ambiances de S1 à la fin, `title_boom` en S1, `drone_hit` et `switch_off` en S18. Rien sur l'entrée d'Elijah, le carton qu'on déroule, le mètre ruban, les deux `burst` (dont la chute « PIEDS »), les trois `tag`, les deux `stamp`, les `vfx`.

## 4. Constats

### A1 — Le son est décidé avant que les plans existent

- **Cause** : `build_default_sound` lit le champ `accent` du découpage. Or ce champ est presque toujours vide : 788 plans sur 891 ont `accent: None`. Les effets sont choisis plus tard, dans le code des plans, et le son n'est jamais recalculé à partir de ce code.
- **Mesure de l'écart** : dans les 786 plans codés des projets récents, on trouve 171 `vfx`, 89 `tag`, 82 `walkTo`, 55 `stamp`, 22 `burst`, 21 `tabletopShot`, 15 `phoneShot`, 8 `release`. Presque aucun n'a de son.
- **Proposition** : à l'étape `sfx`, dériver les événements du **code réel des plans**, avec l'image exacte de chaque effet (`at`) :

| Dans le plan | Son | Calage |
|---|---|---|
| `burst` | impact court | image du `burst` |
| `tag` / `stamp` | `counter_tick` / `pop` | image `at` |
| `vfx: shock`, `anger`, `question`, `focus`, `sweat` | `gasp`, `drone_hit` léger, `pop`, `sparkle` | image `at` |
| `walkTo` | 2 à 4 `step` espacés | durée de la marche |
| `release` (`put`, `drop`, `throw`), `pour`, `slam` | `paper_land` / `clink` / `shatter` selon l'objet | image du contact |
| `phoneShot` | `pop` de message, vibration | arrivée du message |
| `tabletopShot` | `paper_land` ou `clink` selon les objets | début |
| changement de lieu | transition courte | coupe |

  C'est le changement qui rapporte le plus : le son suit l'image sans rien demander à l'agent.

### A2 — Le murmure de classe déborde sur les autres lieux (bug)

- **Constat** : 8 événements `class_murmur` sur 16 courent jusqu'à un plan qui n'est plus en classe. Dans `4v9iyhecgpu-1`, le prof seul dans son bureau, la nuit (S4, S5, S17, S18), garde le murmure d'élèves.
- **Cause** : `shotlist.py:736-747`. Les ambiances sont regroupées par clip (`room_tone` ou `roof_wind`). Classe et bureau donnent tous deux `room_tone`, donc un seul groupe ; le murmure démarre au premier plan de classe et s'arrête à la fin du **groupe**, pas à la fin de la classe.
- **Second défaut lié** : le lieu vient du champ `set` du découpage, pas du lieu réellement codé. Dans ce projet, S10 à S12 et S16 sont notés `study` alors que le code les place en classe.
- **Proposition** : une ambiance par lieu réel (lu dans le code des plans), coupée à chaque changement de lieu, et davantage d'ambiances : rue, restaurant, hôpital, voiture, nuit, cuisine. Aujourd'hui tout intérieur a le même `room_tone` et tout extérieur le même `roof_wind`.

### A3 — L'agent ne touche jamais au son

- Le guide de réalisation (`director-guide.ts`) ne contient aucune ligne sur le son. La consigne de l'orchestrateur dit seulement de ne pas ajouter de musique.
- Aucun outil ne permet d'ajouter un événement simplement ; il faut éditer `episode.json` à la main.
- **Proposition** : un champ `sound` directement dans le plan (`sound: [{ at: 33, clip: 'gasp' }]`), repris par l'étape `sfx`, et la liste des clips dans le guide. Vient après A1 : la dérivation automatique couvre l'essentiel, le champ sert aux cas que le code ne dit pas (une porte, un rire hors champ).

### A4 — Le réglage `sfx_lu` n'a aucun effet (bug)

- **Constat** : 10 des 12 dernières exécutions donnent exactement `sfx: 0.6731`, quelle que soit la voix (-18 à -23,4 LUFS) ou la piste de bruitages (-25,6 à -30,8 LUFS).
- **Cause** : `sfx_run.py:417`, `min(-1.5, v_lufs + sfx_lu - s_lufs)`. La piste de bruitages est mesurée en niveau moyen sur tout l'épisode ; comme elle est presque vide, sa mesure est très basse, le calcul demande toujours un gain positif, et le plafond de -1,5 dB gagne à chaque fois. Le réglage `levels` de `episode.json` est donc sans effet.
- **Conséquence** : avec une voix à -23 LUFS, les bruitages sont 5 dB plus forts par rapport à la voix qu'avec une voix à -18 LUFS.
- **Proposition** : régler chaque famille par rapport à la voix sur une mesure adaptée (niveau de crête court pour les impacts, niveau moyen pour les ambiances), ou d'abord ramener la voix à un niveau fixe.

### A5 — Le niveau des ambiances dépend du son le plus fort (bug)

- **Cause** : `write_wav(..., 0.98)` (`sfx_run.py:396`) ramène toute la piste à un pic de 0,98. Avec un `title_boom` (gain 0,52), l'ambiance (0,13) sort à un quart du pic. Sans `title_boom`, le son le plus fort est `drone_hit` (0,34) et la même ambiance sort 3,7 dB plus fort.
- **Proposition** : gains absolus par clip, sans normalisation de la piste entière ; un limiteur seulement en cas de dépassement.

### A6 — Murmure de classe : 2 secondes en boucle (à écouter)

- `class_murmur` dure 2,0 s (`LIBRARY_CLIPS`) et il est étalé sur toute la scène par répétition avec fondu : environ 17 répétitions en 34 s, avec une période d'environ 1,3 s. Risque net de motif audible.
- **Proposition** : régénérer les ambiances en 15 à 20 s. `room_tone` (12,5 s) et `roof_wind` (7 s) sont plus sûrs mais gagneraient aussi à être allongés.

### A7 — Rien ne baisse sous la voix

- Les pistes sont lues à volume constant (`episode.tsx:145-147`). Le `title_boom`, posé sur son pic au début de S1, tombe sur les premiers mots.
- **Proposition** : baisse automatique des bruitages et de la musique pendant les mots (les temps des mots sont déjà connus par `words.json`), 3 à 6 dB.

### A8 — Musique : décision à prendre

- État : désactivée par défaut (consigne « pas de boucle musicale sauf demande »). La bibliothèque n'a qu'**une** musique, « playful quirky », 17 s, qui ne convient ni à un drame ni à une tension.
- Sans musique et avec 79 % de plans sans bruitage, l'épisode repose presque entièrement sur la voix.
- **Options** :
  1. rester sans musique et densifier les bruitages (A1, A2) ;
  2. petite bibliothèque de fonds par ton (tension, tristesse, comédie, tendresse, mystère), 30 à 60 s chacun, choisis d'après le `look` et le ton du script, très bas sous la voix, avec coupure nette sur la chute ;
  3. option 2 plus des ponctuations musicales courtes (montée avant la révélation, accord final).
- Ma recommandation : option 2 après A1 et A7. C'est un choix de produit, donc à toi de trancher. Générer ces fonds par ElevenLabs est payant : pas sans ton accord.

### A9 — Niveau final un peu bas

- 41 rapports : médiane -14,5 LUFS, de -15,7 à -13,9 ; 7 vidéos sous -14,8. Pic maximal -0,5 dBTP sur une vidéo (cible -1,2).
- Le script accepte ±0,8 et affiche « within broadcast safety » au-delà : rien n'est refusé.
- **Proposition** : si l'écart dépasse 0,5 LUFS après la seconde passe, appliquer un gain de rattrapage simple. Petit.

### A10 — Remplacement silencieux d'un son inconnu

- `find_library_clip` (`sfx_run.py:130-165`) : sans clé ElevenLabs, un son sur mesure est remplacé par mots-clés (« door » donne `switch_off`), et en dernier recours par `pop`. Rien n'est signalé.
- Sans effet aujourd'hui (aucun son sur mesure), mais deviendra gênant dès que l'agent en demandera (A3).
- **Proposition** : écrire le remplacement dans la sortie de l'étape.

## 5. Ce qui fonctionne bien

- Étape `sfx` : 40 projets, 3 échecs, aucun repère de mot non résolu dans les journaux.
- Aucune piste muette ; le niveau final est régulier d'une vidéo à l'autre (écart total 1,8 LUFS).
- Ambiances étalées par fondu enchaîné, sans trou.
- La bibliothèque sert sans appel payant : 0 clip généré sur les lancements récents.

## 6. Lots proposés

| Lot | Contenu | Palier | Taille |
|---|---|---|---|
| S1 | A2 murmure et ambiance par lieu réel ; A4 et A5 niveaux ; A10 remplacement signalé | P1 | petit |
| S2 | A1 bruitages dérivés du code des plans, calés à l'image | P2 | moyen |
| S3 | A7 baisse sous la voix ; A9 rattrapage du niveau final | P1 | petit |
| S4 | A3 champ `sound` dans le plan + guide | P2 | moyen |
| S5 | A6 ambiances longues, nouvelles ambiances par lieu, sons concrets manquants (porte, sonnerie, clavier, foule, rire, chaise) | P2, **payant** (ElevenLabs) | selon la liste |
| S6 | A8 musique par ton | P2, **payant**, décision produit | moyen |

Ordre conseillé : S1, S2, S3. Ces trois lots n'utilisent que la bibliothèque existante et ne coûtent rien. S5 et S6 demandent ton accord (génération payante) et une écoute de ta part.

## 7. Validation

- Lecture complète de `sfx_run.py` (457 lignes), `master_run.py` (208 lignes), `build_default_sound` et `LIBRARY_CLIPS` dans `shotlist.py`.
- Script de mesure sur les 57 projets : 48 avec `sound`, 26 sans musique → 6,7 bruitages par minute, 701 plans sur 891 sans bruitage, 0 clip sur mesure.
- A2 : 16 événements `class_murmur`, 8 débordent ; vérifié à la main sur `4v9iyhecgpu-1`.
- A4 : 12 dernières sorties de l'étape `sfx` lues dans la base → 10 fois `0.6731`.
- A9 : 41 `report.json` lus.
- **Non fait** : aucune écoute (pas de média dans le zip, pas de bibliothèque sur ce poste). A6 et A7 sont déduits du code ; à confirmer à l'oreille sur une vidéo.
- `npm test` : non exécuté (aucun code modifié).

## 8. Lots S1, S2, S3 — faits, non commités (16 nov.)

**Palier** P2 (accord de Pulsy : « passe à l'audio »).

**Fait**
- **A2** `shotlist.py` : le murmure de classe s'arrête à la sortie de la classe, et reprend si on y revient.
- **A1 + A2** `sfx_run.py` : le son de l'épisode est reconstruit à chaque étape `sfx` à partir du **code des plans** : lieu réel de chaque plan (`real_places`), et un son calé sur l'image de chaque `burst`, `tag`, `stamp`, `vfx` (shock, focus, question, anger), `walkTo`, `release`, `slam`, `phoneShot`, `tabletopShot` (`code_events`). 4 sons au plus par plan.
- **A3 (version courte)** : les sons ajoutés par l'agent vont dans `sound.extra` et sont gardés à chaque reconstruction ; le guide l'explique et liste les clips.
- **A4** : le volume des bruitages suit la voix (1,5 dB sous une voix à -18 LUFS, plus bas si la voix est plus faible), réglable par `levels.sfx_db`.
- **A5** : une seule échelle pour tous les épisodes ; la piste n'est plus ramenée à son propre pic.
- **A7** : une musique, quand il y en a une, baisse de 5 dB pendant les mots et remonte dans les silences de 0,35 s et plus. Les bruitages ne sont pas baissés : la narration est presque continue, cela reviendrait à un simple volume plus bas, et les impacts doivent rester nets.
- **A9** `master_run.py` : si le niveau final s'écarte de plus de 0,4 LUFS de la cible, un gain de rattrapage est appliqué dans la limite du pic.
- **A10** : un son absent de la bibliothèque et remplacé par un autre est signalé dans la sortie de l'étape.

**Effet mesuré sur `4v9iyhecgpu-1`** (reconstruction à blanc, sans mixage) : 5 événements → 23. Le murmure couvre S1 à S3 et S6 à S16 (les plans en classe) et ne s'entend plus dans le bureau de nuit (S4, S5, S17, S18). Chute « PIEDS » (S16) : impact, compteur et souffle sur l'image 33.

**Compatibilité** : un épisode existant garde son son tel quel (pas de marque `auto`). La reconstruction ne s'applique qu'aux épisodes créés avec cette version, ou dont le son est absent.

**Validation**
- `npm test` → 77/77, dont le test existant de l'étape son (mixage réel avec des clips de synthèse) et celui du master.
- Test neuf « sound after the audio audit » ; 4 mutations sur 4 détectées (murmure jusqu'à la fin, lieu réel ignoré, `burst` sans son, pas de baisse sous les mots) ; fichiers restaurés, identiques.
- **Non fait : aucune écoute.** Ni bibliothèque ni voix sur ce poste. Les gains choisis (0,14 à 0,34) reprennent ceux déjà en usage, mais la densité nouvelle (23 sons en 34 s) est à juger à l'oreille sur une vraie vidéo. Si c'est trop chargé : `levels.sfx_db: -3` dans `episode.json`, ou me le dire et je baisse les gains par famille.
- Les clips `land`, `crack`, `shatter`, `gasp` n'avaient jamais servi : s'ils manquent dans la bibliothèque de l'autre machine, l'étape le dira (« plays in its place » ou « stays silent »).

**Restent** : S4 complet (champ `sound` dans le plan), S5 (ambiances longues et nouveaux sons) et S6 (musique par ton) — ces deux derniers sont payants et attendent ta décision.

**Commit proposé** (lots C, D et audio) : `feat(sound,engine): sounds read in the code of the shots and set on the frame, ambience by the real place, one scale for levels, music ducked under words, level catch-up; curls in profile, flat props, narrower solo wide in 9:16, place aliases, a clear message for an unknown video id`
