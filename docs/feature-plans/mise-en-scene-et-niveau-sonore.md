# Mise en scène et niveau sonore — propositions

Date : 2026-11-19. Palier : P2 (moteur, audit, pipeline son). **Plan à valider avant code.** Suite de `docs/audits/audit-2026-11-19.md`.

## 1. Niveau sonore : traiter la voix à la source

### Mesures (vrais fichiers de `custom-shortlist-086`)

| Piste | Niveau | Pic |
|---|---|---|
| Voix seule | -18,9 LUFS | -1,0 dB |
| Bruitages seuls | -28,4 LUFS | -0,3 dB |
| Mixage brut | -20,7 LUFS | -1,3 dB |

- **La voix elle-même est le problème** : elle arrive avec 18 dB d'écart entre son niveau moyen et ses pics. Elle est déjà « pleine » en pics alors qu'elle est 5 dB trop basse en niveau.
- Le mixage la baisse encore (volume 0,8), d'où -20,7.
- Un compresseur classique ne change rien à cet écart (essayé : 3:1 et 4:1 donnent toujours 18 dB). Il faut un limiteur.
- Le lot K rattrape à la fin, mais en écrasant tout le mixage, bruitages compris.

### Proposition S — lot son (moyen)

1. Dans `sfx_run.py`, limiter **la voix seule** (pics tenus vers -9 dB), puis la porter à -16 LUFS.
2. Régler les bruitages par rapport à cette voix, comme aujourd'hui.
3. Le mastering n'a plus que 2 dB à ajouter, sans limiteur : -14,0 exact, et les bruitages gardent leur relief.
4. Le rattrapage du lot K reste en filet de sécurité.

À valider à l'oreille par Pulsy : une voix limitée peut sembler plus « serrée ». Je peux fournir deux versions du même épisode pour comparer.

## 2. Mise en scène

### M1 — Personnes qui se cachent entre elles (petit)

- Aujourd'hui l'audit ne refuse que si **le sujet** est caché. `zu8mxxygc68` S8 : trois personnes empilées, aucune n'est « le sujet caché ».
- Proposition : étendre le relevé à toute personne dont la tête est couverte à plus de 45 % par une autre (hors plan `ots`, où c'est voulu).
- Le moteur mesure déjà tout ; c'est une extension du relevé existant.

### M2 — Personnage devant un texte du décor (moyen)

- `mjo-zccs0am` S1, S3, S4, S8 : la tête cache « REMISE DES PRIX » sur l'écran de la salle.
- Proposition : les pièces qui portent un texte (tableau, écran, affiche) déclarent leur zone ; le moteur relève à l'image clé la part du texte couverte par une personne ; l'audit refuse au-delà d'un seuil, avec le remède (décaler la personne, ou changer de `view`).
- Mieux encore, en amont : `keepHeads` pourrait décaler la caméra pour dégager le texte quand c'est possible, comme il le fait pour les têtes.
- Risque : faux positifs quand le texte n'a pas besoin d'être lu. Calibrage sur les projets existants avant d'activer le refus.

### M3 — Épisode à un seul personnage et un seul lieu (moyen, le plus utile)

- `custom-shortlist-086` : 43 plans, un homme, un salon, un téléphone. Chaque plan est correct, l'ensemble est monotone.
- Une règle sur les gestes ne marche pas (mesuré le 17 : elle refuserait presque tous les projets).
- Proposition en deux temps :
  1. **À la liste des plans** (`shotlist.py`) : quand un seul décor couvre plus de 70 % des plans, imposer un plan « d'évocation » tous les 4 ou 5 plans : ce dont parle la narration, montré (insert d'objet, `screenShot`, `phoneShot`, autre lieu, souvenir).
  2. **À la lecture des fiches** : donner au Reviewer trois chiffres (lieux distincts, personnes distinctes, plus longue série dans le même cadre) pour qu'il demande de la variété avant le code, là où corriger ne coûte rien.
- C'est un choix éditorial : combien de plans d'évocation veux-tu, et acceptes-tu des lieux que le script ne nomme pas ?

## 3. Ordre conseillé

| Ordre | Lot | Taille | Pourquoi |
|---|---|---|---|
| 1 | M1 personnes empilées | petit | extension directe de l'existant |
| 2 | S voix à la source | moyen | règle le niveau proprement ; demande ton écoute |
| 3 | M3 variété | moyen | le plus visible pour le spectateur ; demande ta réponse éditoriale |
| 4 | M2 texte du décor | moyen | utile mais plus de risque de faux positifs |

## 4. Questions pour Pulsy

- S : d'accord pour limiter la voix, sous réserve d'écoute comparée ?
- M3 : plans d'évocation imposés dans les épisodes à un seul décor, oui ou non ? Lieux hors script acceptés ?

## 5. Décision de Pulsy (2026-11-19) et avancement

- **Voix : abandonné.** Pulsy ne veut pas de changement sur la voix. Le lot K (rattrapage à la fin) reste la seule action sur le niveau.
- **M3 variété : fait, non commité.** M1 et M2 non demandés, non faits.

### M3 — ce qui est codé

- `pipeline/shotlist.py`, `add_evocations` : dans un épisode de 12 plans ou plus, après cinq plans de suite sur un personnage, le sixième devient un **plan d'évocation** (`size: insert`, `evoke: true`, note « evocation: … »). Jamais le premier ni le dernier plan, jamais un plan qui porte un accent. La règle compte les plans, pas les décors : les décors de la liste ne sont pas fiables (`custom-shortlist-086` en avait deux sur le papier et un seul à l'image).
- `src/orchestrator/reviewer.ts`, `varietyFigures` : le Reviewer des fiches reçoit trois chiffres (lieux et personnes distincts, plus longue série de fiches avec les mêmes personnes, objet le plus présent). Au-delà de 6 fiches de suite ou d'un objet dans plus de 40 % des fiches, il doit désigner 1 à 3 fiches à transformer en plan d'évocation.
- Guide : ce qu'est un plan d'évocation, et l'interdiction de reprendre le même appareil que l'insert précédent.
- Choix pris par défaut : pas de lieu hors script ; l'évocation montre un objet, un écran, un document, le lieu vide ou un détail.

### Mesures

- Simulation sur les 59 épisodes existants : la règle ajoute entre 0 et 12 plans d'évocation selon l'épisode ; les épisodes déjà rythmés par des inserts n'en reçoivent aucun.
- Chiffres de variété sur les fiches réelles : `custom-shortlist-086` → série de 8, « phone » dans 86 % des fiches (signalé) ; `custom-shortlist-063` → série de 19 (signalé) ; `custom-shortlist-038` → série de 6 (non signalé) ; `mjo-zccs0am` → série de 3 (non signalé).

### Validation

- `npm test` → 87 sur 87. Mutations : règle désactivée → échec ; série jamais remise à zéro → échec.
- **Non vérifié** : aucun épisode réel n'a encore été produit avec la règle. La qualité des plans d'évocation dépend de ce que l'agent écrit sur la fiche ; à juger sur le prochain épisode.

**Commit proposé** : `feat(shotlist,reviewer): after five shots on a character the next one shows what the line talks about, the card reviewer gets the variety figures`
