# Plusieurs voix : narrateur, dialogues, ou les deux (2026-11-12)

**Palier** P3 (format des données de l'épisode, service de voix payant, toute la chaîne touchée). **Plan à valider par Pulsy avant code.**

Demande : aujourd'hui tout fonctionne comme s'il n'y avait qu'un narrateur. Il faut pouvoir faire des épisodes où plusieurs personnages se parlent, garder le cas du narrateur seul, et permettre le cas sans narrateur où les personnages jouent leur rôle.

## 1. Comment ça marche aujourd'hui

Lu dans `pipeline/voice_fish.py`, `pipeline/nouveau_client.py` et un `episode.json` réel (`prof`) :

1. Le script est une liste de blocs `{ "text": … }`. **Aucun bloc ne dit qui parle.**
2. Tout le texte est envoyé en **un seul appel** au service de voix (`:8005`, ElevenLabs par défaut), avec **une seule voix** : Hugo ou Léa, choisie d'après le genre et le point de vue du narrateur.
3. Deepgram renvoie l'instant de chaque mot → `words.json`. **Un mot ne sait pas qui le dit.**
4. La shotlist découpe d'après le rythme des mots. Elle ne sait pas qu'un autre personnage prend la parole.
5. À l'image, c'est l'agent qui met `act: 'talk'` à la main sur quelqu'un. Rien ne relie la bouche qui bouge à la voix qu'on entend.

Le narrateur unique n'est donc pas un réglage : c'est la forme même des données.

## 2. Ce que je propose : trois modes, une seule mécanique

Un seul changement de fond : **chaque bloc du script dit qui parle.** Les trois modes en découlent.

| Mode | Script | Exemple |
|---|---|---|
| `narrator` (actuel) | tous les blocs sont au narrateur | « Ce jour-là, la remplaçante frappe la table. » |
| `mixed` | le narrateur raconte, les personnages disent leurs répliques | Narrateur : « Elle exige le portable. » → PROF : « Donne-moi ça. Tout de suite. » |
| `cast` | aucun narrateur, uniquement des répliques | PROF : « Ton téléphone. » → MAYA : « Je ne l'ai pas, madame. » |

```json
"mode": "mixed",
"script": [
  { "speaker": "NARR", "text": "Ce jour-là, la remplaçante frappe la table." },
  { "speaker": "PROF", "text": "Ton téléphone. Tout de suite.", "tone": "angry" },
  { "speaker": "MAYA", "text": "Je ne l'ai pas, madame.", "tone": "scared" }
],
"voice": { "voices": { "NARR": "Léa", "PROF": "<voix adulte>", "MAYA": "<voix ado>" } }
```

Un épisode sans `speaker` reste un épisode à narrateur : les projets existants ne changent pas.

## 3. Ce que ça change, étape par étape

| Étape | Changement |
|---|---|
| **Script** | L'agent choisit le mode d'après la source, écrit les répliques, attribue chaque bloc. Règles d'écriture : répliques courtes (un short), pas de narrateur qui répète ce qu'un personnage vient de dire |
| **Casting des voix** | Une voix par personnage qui parle, choisie dans un catalogue (genre, âge, timbre). Deux personnages ne partagent jamais une voix. Le narrateur garde Hugo ou Léa |
| **Voix** | Un appel par bloc (ou par suite de blocs du même personnage), puis assemblage avec de courts silences entre les répliques. Les instants des mots sont décalés et chaque mot reçoit son personnage : `{ "w": "Ton", "s": 3.1, "e": 3.3, "sp": "PROF" }` |
| **Shotlist** | Coupe au changement de personnage. Champ / contrechamp automatique : la caméra est sur celui qui parle, avec de temps en temps un plan sur celui qui écoute |
| **Fiches de mise en scène** | La fiche reçoit « qui parle dans ce plan ». L'audit refuse un plan où celui qui parle n'est pas à l'image (sauf voix hors champ voulue) |
| **Moteur** | `shot()` fait bouger la bouche du bon personnage **tout seul**, sur les mots qu'il dit, à l'image près. Les autres écoutent (regard tourné vers lui). Plus de `act: 'talk'` à la main |
| **Reviewer** | Vérifie que la bouche qui bouge est celle du personnage qu'on entend, et que la voix correspond au personnage (âge, genre) |
| **Son** | Rien de structurel : le mixage reste « voix d'abord » |

Le narrateur, lui, ne fait bouger aucune bouche : c'est déjà le cas en point de vue « troisième personne ».

## 4. Ce qui est difficile ou incertain

1. **Le catalogue de voix.** Le code ne connaît que deux voix (Hugo, Léa). Il en faut plusieurs, classées par genre et âge, en français. **Je ne sais pas lesquelles ton compte ElevenLabs ou Fish offre** : c'est la première chose à regarder.
2. **Le coût et le temps.** Un appel par réplique au lieu d'un seul. À mesurer ; non chiffré ici.
3. **Le naturel des enchaînements.** Des répliques générées une par une peuvent sonner collées. Les silences entre répliques et le ton (`tone`) comptent. Certains services ont un mode « dialogue » qui génère plusieurs voix en un appel : **à vérifier dans la doc du service et dans `:8005`, je ne l'ai pas vérifié.**
4. **Le service `:8005`** n'est pas dans ce dépôt. S'il faut y ajouter une route (voix par réplique, liste des voix), c'est un travail de l'autre côté.
5. **L'alignement des mots.** Aujourd'hui Deepgram aligne un seul fichier. Par réplique, on aligne chaque morceau puis on décale : plus simple et plus sûr, mais plus d'appels.
6. **L'écriture.** Un bon dialogue de 60 secondes est plus dur à écrire qu'une narration. Le mode `mixed` est le plus sûr pour commencer.

## 5. Ordre proposé

1. **Regarder les voix disponibles** et ce que `:8005` accepte (lecture seule, aucun coût).
2. **Format** : `speaker` dans le script, `sp` dans les mots, `voices` dans l'épisode, mode de l'épisode. Avec compatibilité des anciens projets.
3. **Voix** : génération par réplique et assemblage. Essai sur 20 secondes de dialogue, à écouter.
4. **Moteur** : bouche automatique d'après `sp`, regard des autres.
5. **Shotlist et fiches** : coupes au changement de personnage, personnage qui parle à l'image.
6. **Script** : consignes d'écriture des trois modes dans le prompt de l'agent.
7. **Reviewer**, puis un épisode complet en mode `mixed`.

Les étapes 2, 4 et 5 se testent sans service payant, avec des mots fabriqués. L'étape 3 demande ton accord (appels payants).

## Hypothèses

- Le service de voix sait générer un texte court avec une voix donnée, comme il le fait déjà pour le texte entier.
- Les voix par personnage restent les mêmes d'un épisode à l'autre seulement si on le demande ; par défaut elles sont choisies par épisode.

## Risques

- Voix mal assorties (un adulte pour une adolescente) : d'où le catalogue classé et le contrôle du Reviewer.
- Régression sur les épisodes à narrateur : couverte par la compatibilité (pas de `speaker` = narrateur) et par les tests existants de la voix.
- Durée de l'étape voix multipliée : à mesurer à l'étape 3.

## Décisions attendues de Pulsy

1. Quel service et quelles voix : ElevenLabs, Fish, autre ? Peux-tu me donner la liste des voix françaises de ton compte, ou l'accès en lecture à `:8005` ?
2. Par quel mode commencer : `mixed` (ma recommandation) ou `cast` ?
3. Le choix du mode : automatique d'après la source, ou imposé par toi au lancement ?
4. Le code de `:8005` est-il modifiable, et par qui ?

## Validation

- Lecture de `pipeline/voice_fish.py`, `pipeline/nouveau_client.py`, et de `episode.json` / `words.json` de `prof`.
- **Non exécuté :** aucun code, aucun appel au service de voix, aucune vérification des voix disponibles ni d'un mode dialogue chez le fournisseur.
