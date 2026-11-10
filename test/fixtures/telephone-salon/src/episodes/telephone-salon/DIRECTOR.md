# DIRECTOR — CE QUE J'AI VU SUR SON TÉLÉPHONE (9:16, 36 plans, 160 s)

## 1. Le lieu — `SALON` = place('blank', {...})

Un **salon de manucure de quartier**, le soir, raconté par une cliente (narratrice féminine, off).
Une seule pièce, un seul décor partagé par les 36 plans (continuité stricte DIRECTOR ↔ shots.tsx).

- Recette : `place('blank', { mood: 'night', palette: { wall: '#7E9C86', floor: '#4A3629', wood: '#C8A87C', fabric: '#E8C86A' }, pieces: [...], lights: [...] })`
- **Palette** : mur vert sauge `#7E9C86`, sol bois sombre `#4A3629`, formica crème `#EFE4D2` des tables (wood `#C8A87C`),
  accents rose néon `#FF6B8A`, vernis multicolores sur les étagères, lumière chaude `#FFD9A0`.
- **Mur du fond** : étagère-large `shelf` à droite (flacons de vernis), `window` à gauche sur la rue (nuit, néon rose de l'enseigne
  qui entre), `board`-slot remplacé par un panneau de prix / affiche « ONGLES 25€ » collé au mur, `clock` au centre.
- **Mobilier / personnages** : deux tables de manucure `table` (formica crème) — `t1` à gauche (LUISA), `t2` à droite (MARC),
  deux `chair` collées, un `counter` derrière (réception), une `plant` près de la fenêtre, un `rug` sous les tables.
- **Premier plan** : le bord d'une table + lampe de manucure (`floor-lamp` déplacée en `desk-lamp`-like) qui font amorce floue
  dans ~1 plan sur 3 (`<Foreground blur={16}>`).
- **Lumière** : la lampe de table chaude au-dessus de t2 (source visible), la fenêtre froide à gauche, le néon rose dehors.
  Pools de lumière + coins sombres, `LightVeil` 0.42.

## 2. Casting & silhouettes

| qui | seed | silhouette | rôle |
|---|---|---|---|
| **NARR** (Léa, la cliente) | `narr` | femme, cheveux `wavy` auburn, `sweater:cream` + `jeans`, boucles d'oreilles | la narratrice, première personne ; elle regarde, se retourne, sort son téléphone |
| **LUISA** | `luisa` | femme, `bun` noir, `apron:plum` sur `tshirt:teal`, `glasses:round` | technicienne habituelle, derrière t1 |
| **MARC** (le mari) | `marc` | homme, `sidepart` brown, `shirt:white` manches retroussées, `pants:navy`, `beard` | le mari technicien, à t2, son téléphone posé près de lui |

Narrateur : `narratorGender: "female"` (cohérent avec `episode.json.voice`).

**Objet-clé — LE TÉLÉPHONE DE MARC** : coque `#1F4E79` (bleu nuit) avec un sticker rose. Il fait partie du décor
posé sur t2 à partir de **S3** (« j'ai regardé le téléphone de son mari »), et **jamais avant**. C'est l'objet de tous
les inserts (S5, S11) et du macro zoom S8. Le téléphone de NARR, lui, est écran éteint jusqu'à **S21**.

**Le tutu** (S17) : rose pâle `#F6C6D0`, jamais porté — c'est une photo / un message, on ne le voit pas sur un personnage.

## 3. Découpage, continuité et chorégraphie

| plan | cadrage | action physique |
|---|---|---|
| S1 | large | établissement : le salon, NARR assise à t1, LUISA penchée sur ses mains, MARC à t2 |
| S2 | close | LUISA dit « pas de place pour moi » (face `worried`, main levée), se tourne vers MARC (f 110) |
| S3 | large | MARC prend la main de NARR (act `hold`), NARR regarde son téléphone (batterie) posé sur la table, puis le téléphone bleu de MARC (f 190) |
| S4 | medium | NARR lève les yeux, temps d'arrêt (2 frames), sourcils qui montent |
| S5 | insert | macro sur le téléphone bleu : bannière « Tu me manques tellement » qui apparaît (f 36) |
| S6 | close | NARR, oreille tendue, face `shock` sur « une fille » (f 64) |
| S7 | large | NARR fait mine d'être ailleurs (regard sur ses ongles), coup d'œil vers le téléphone |
| S8 | medium | MARC, téléphone en main, tape ; deuxième message qui arrive (f 40) |
| S9 | close | NARR, la main sur la poitrine sur « mon cœur s'est serré » (f 153) |
| S10 | medium | MARC range / lève le téléphone, ouvre une conversation (f 39) |
| S11 | insert | coin de l'œil : NARR en amorce floue, photo de profil floue en macro (f 136) |
| S12 | medium | NARR fronce les sourcils, la photo au centre du cadre, « extrêmement jeune » (f 58) |
| S13 | close | profil serré du téléphone / visage de NARR, realisation sur « treize ans » (f 60) |
| S14 | medium | MARC tape, les messages défilent (f 30 « tapait ») |
| S15 | close | MARC tape, hâte : accélération du geste (f 40) |
| S16 | medium | MARC regarde son écran, un sourire (`smug`) sur « le bon moment » |
| S17 | close | le pouce tape « tutu » ; NARR en amorce, dégoût |
| S18 | medium | MARC se tourne vers LUISA (yaw qui tourne à f 62), dit le mensonge |
| S19 | close | LUISA, visage qui se ferme, elle regarde son mari (f 31) |
| S20 | medium | MARC hausse les épaules, mensonge assumé |
| S21 | large | NARR sort son téléphone sous la table, tape « POLICE » (f 120) |
| S22 | close | NARR lit la réponse, regard vers la vitrine (f 67) |
| S23 | wide | NARR s'installe, demande du temps, MARC se penche |
| S24 | close | NARR, sourcils haussés, demande un « truc en plus » (f 33) |
| S25 | wide | NARR enlève sa chaussette, pied posé (f 40) |
| S26 | close | MARC finit le pied gauche, NARR tourne la tête vers la rue (f 70) |
| S27 | wide | deux officiers entrent (f 0), marchent vers MARC (act `walk`, f 40) |
| S28 | close | MARC montre son téléphone aux officiers (f 47) |
| S29 | medium | les officiers ne l'arrêtent pas, puis rient (f 120) |
| S30 | close | rire profond, ventre qui tremble |
| S31 | wide | NARR confuse demande « qu'est-ce qui se passe ? », les officiers viennent vers elle |
| S32 | medium | un officier explique, NARR comprend (f 58 : « sa fille biologique ») |
| S33 | close | NARR, les yeux qui s'écarquillent, son ex ne lui avait jamais dit |
| S34 | medium | MARC et LUISA, la relation qui se construit |
| S35 | close | MARC, gêné, regarde LUISA, il cache |
| S36 | medium | NARR, realisation douce-amère : « sa fête de treizième anniversaire » |

**Continuité** : NARR porte toujours le même pull crème et les mêmes boucles d'oreilles ; LUISA son tablier prune ;
MARC sa chemise blanche aux manches retroussées et sa barbe. Aucun plan ne change la disposition du décor.
**Bagues / cadre** : en 9:16 le centre est `(960, 540)`, zooms medium 1.3–1.7, close 2.4–3.4, Jacob large 0.9–1.1,
insert macro 2.4–4. Les personnages restent entre `u 0.25–0.75` en 9:16.
