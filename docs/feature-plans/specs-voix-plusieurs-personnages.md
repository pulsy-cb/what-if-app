# Specs : plusieurs voix (narrateur, mixte, personnages seuls)

**Date** 2026-11-12 · **Palier** P3 · **Pour** un agent IA qui code et teste · **Contexte** `docs/feature-plans/voix-plusieurs-personnages.md`

Ce document se suffit à lui-même. Il décrit : ce qu'il faut d'abord relever sur le serveur `:8005` (§2), le contrat à ajouter sur ce serveur (§3), les formats de données (§4), les modifications fichier par fichier dans `what-if-app` (§5) et dans le skill (§6), les tests (§7), l'ordre de travail (§8).

**Ce qui est vérifié et ce qui ne l'est pas.** Tout ce qui concerne `what-if-app` a été lu dans le code (commit `2bf27a6`). Le code du serveur `:8005` (« nouveau ») **n'a pas été lu** : il n'est pas dans ce dépôt. Le §3 est donc un contrat à adapter à son code réel, après le relevé du §2.

---

## 1. But et vocabulaire

Aujourd'hui un épisode n'a qu'une voix : le script est une liste de blocs `{ "text" }`, envoyée en un seul appel de synthèse vocale avec une seule voix (Hugo ou Léa). Aucun mot ne sait qui le dit.

On veut trois modes, portés par un seul mécanisme : **chaque bloc du script dit qui parle.**

| Mode (`episode.mode`) | Contenu du script |
|---|---|
| `narrator` | Tous les blocs sont au narrateur. C'est le comportement actuel et la valeur par défaut |
| `mixed` | Le narrateur raconte, les personnages disent leurs répliques |
| `cast` | Aucun narrateur : uniquement des répliques de personnages |

- **Locuteur** (`speaker`) : `NARR` pour le narrateur, sinon le nom en majuscules d'un personnage (`PROF`, `MAYA`). C'est le même nom que la constante exportée par `shared.tsx` et que `people[].who` dans les fiches de mise en scène (`src/tools/staging.ts`).
- **Réplique** : un bloc du script dit par un personnage.
- **Tour** : une suite de blocs consécutifs du même locuteur. Un tour = un appel de synthèse vocale.

**Règle de compatibilité, non négociable :** un épisode sans `mode` et sans `speaker` se comporte exactement comme aujourd'hui. Tous les tests existants doivent passer sans être modifiés.

---

## 2. À relever sur le serveur `:8005` AVANT de coder

Lecture seule, aucun coût. Enregistrer chaque réponse dans `docs/notes/8005-releve-<date>/` (dossier de travail, non commité) et résumer dans `docs/notes/8005-releve-<date>/RESUME.md`.

```bash
B=http://127.0.0.1:8005
curl -s $B/api/health
curl -s $B/api/voice-catalog            # déjà appelé par pipeline/nouveau_client.py (voice_catalog)
curl -s $B/api/elevenlabs-tts/status
curl -s $B/api/fish-audio-tts/status
curl -s $B/api/inworld-tts/status
curl -s $B/openapi.json                 # si le serveur en publie un (FastAPI : /openapi.json ou /docs)
curl -s $B/api/videos/<videoId>/tts/check
curl -s $B/api/videos/<videoId>/translations
```

Questions auxquelles le relevé doit répondre :

| # | Question | Pourquoi |
|---|---|---|
| Q1 | `voice-catalog` : quels champs par voix (id, nom, fournisseur, langue, genre, âge, description) ? Combien de voix françaises, par genre et par âge ? | Le casting des voix (§5.3) en dépend. Le code ne connaît que Hugo `3Tp5mYhT9wrfnry9pzvV` et Léa `KSyQzmsYhFbuOhqj1Xxv` |
| Q2 | `POST /api/videos/<id>/tts/elevenlabs` : accepte-t-il **plusieurs appels pour la même vidéo** sans écraser le précédent ? Que renvoie-t-il exactement (`audioPath`, `id`, autres) ? Où range-t-il le fichier ? | La génération par tour (§5.4) fait N appels par épisode |
| Q3 | `GET /tts/check` : renvoie-t-il un seul fichier « courant » par vidéo ? | Aujourd'hui `voice_fish.py` réutilise ce fichier. Avec N tours, cette réutilisation doit être désactivée ou indexée |
| Q4 | Le fournisseur a-t-il un **mode dialogue** (plusieurs voix en un appel, avec les instants par locuteur) ? Lire la doc officielle du fournisseur, ne pas supposer | Si oui, variante B du §3.2 |
| Q5 | `POST /translate/generate` : quelles valeurs de `scriptMode` existent ? Que contient une proposition (`text`, blocs, autre) ? | Le script français vient de cette route (`pipeline/source_import.py`, ligne 116 : `--script-mode`, défaut `elevenlabs`) |
| Q6 | `POST /deepgram/diarize` : que renvoie-t-il (locuteurs par segment) ? Est-ce conservé avec la vidéo ? | Pour attribuer les répliques de la source à des personnages (§3.3) |
| Q7 | `POST /tts/transcribe` : limite de taille, coût par appel ? | Variante d'alignement par tour (§5.4) |
| Q8 | Y a-t-il une limite de débit ou de parallélisme sur les routes TTS ? | N appels à la suite |
| Q9 | Où est le code de `:8005`, quel langage, qui le modifie ? | §3 |

**Si le serveur est injoignable :** s'arrêter et le dire. Ne rien inventer sur ses réponses.

---

## 3. Contrat à ajouter sur le serveur `:8005`

À adapter au code réel après le §2. Trois ajouts, par ordre d'utilité. **Le §5 est écrit pour fonctionner avec le minimum (3.1 seul).**

### 3.1 Synthèse d'un tour sans écraser les autres (indispensable)

Si Q2 montre que la route actuelle écrase ou ne garde qu'un fichier par vidéo, ajouter un paramètre **optionnel** aux routes existantes `POST /api/videos/<id>/tts/elevenlabs` et `/tts/fish` :

```json
{ "text": "Ton téléphone. Tout de suite.", "voiceId": "…", "modelId": "eleven_v4", "speed": 1.15,
  "segment": "t003" }
```

- `segment` absent : comportement actuel, inchangé.
- `segment` présent : le fichier est rangé sous un nom qui contient `segment` (par exemple `/downloads/tts/<videoId>-t003.mp3`), il **ne remplace pas** le fichier « courant » renvoyé par `/tts/check`, et la réponse garde la même forme (`audioPath`, `id`).
- Idempotence souhaitée : même `text` + `voiceId` + `modelId` + `speed` + `segment` → renvoyer le fichier existant sans rappeler le fournisseur (champ `reused: true`). C'est ce qui évite de repayer tout l'épisode quand une seule réplique change.

Si Q2 montre que plusieurs appels coexistent déjà (un `audioPath` distinct par appel), **ne rien modifier** sur le serveur pour ce point.

### 3.2 Catalogue de voix exploitable (indispensable si Q1 est insuffisant)

`GET /api/voice-catalog` doit permettre de choisir une voix sans connaissance humaine. Champs nécessaires par voix :

```json
{ "id": "…", "name": "Léa", "provider": "elevenlabs", "lang": "fr",
  "gender": "female", "age": "adult", "style": "narration", "description": "…" }
```

- `gender` : `male` | `female`. `age` : `child` | `teen` | `adult` | `senior`. `style` : `narration` | `character`.
- Si le fournisseur ne donne pas ces champs, les renseigner à la main dans un fichier de configuration du serveur. Sans eux, `what-if-app` ne peut pas assortir une voix à un personnage.
- Cible minimale pour démarrer : 2 voix de narration (déjà là) + au moins 2 voix adultes par genre + 1 voix adolescente par genre, en français.

**Variante B (seulement si Q4 = oui) :** une route `POST /api/videos/<id>/tts/dialogue` qui reçoit tous les tours `[{ segment, speaker, voiceId, text }]`, appelle le mode dialogue du fournisseur, et renvoie un seul fichier plus les bornes de chaque tour `[{ segment, start, end }]`. Avantage : enchaînements plus naturels, un seul appel. À ne faire qu'après que la variante par tour fonctionne.

### 3.3 Script avec locuteurs (pour les modes `mixed` et `cast` à partir d'une vidéo source)

Le script français est produit par `POST /api/videos/<id>/translate/generate` (`scriptMode`). Ajouter deux valeurs de `scriptMode` : `dialogue-mixed` et `dialogue-cast`. Pour ces valeurs, chaque proposition contient en plus :

```json
{ "blocks": [ { "speaker": "NARR", "text": "…" }, { "speaker": "PROF", "text": "…", "tone": "angry" } ],
  "speakers": [ { "id": "PROF", "label": "la remplaçante", "gender": "female", "age": "adult" },
                { "id": "MAYA", "label": "l'élève", "gender": "female", "age": "teen" } ] }
```

- Les locuteurs viennent de la diarisation de la source (`/deepgram/diarize`, Q6) quand elle existe, sinon du texte.
- `id` : majuscules, lettres, chiffres, `_` ; unique ; `NARR` réservé.
- `dialogue-cast` : aucun bloc `NARR`.
- `text` reste le texte complet à plat, pour compatibilité.
- Contraintes d'écriture à mettre dans le prompt du serveur : une réplique ≤ 18 mots ; le narrateur ne répète jamais une réplique ; pas plus de 4 personnages qui parlent ; en `mixed`, au moins 30 % et au plus 70 % des mots au narrateur.

**Solution de repli si le serveur n'est pas modifié :** c'est l'agent de `what-if-app` qui réécrit le script en blocs avec locuteurs (§5.8). Le §5 doit fonctionner dans les deux cas.

---

## 4. Formats de données (dans `what-if-app`)

### 4.1 `src/episodes/<slug>/episode.json`

```json
{
  "mode": "mixed",
  "script": [
    { "speaker": "NARR", "text": "Ce jour-là, la remplaçante frappe la table." },
    { "speaker": "PROF", "text": "Ton téléphone. Tout de suite.", "tone": "angry" },
    { "speaker": "MAYA", "text": "Je ne l'ai pas, madame.", "tone": "scared" }
  ],
  "speakers": [
    { "id": "PROF", "label": "la remplaçante", "gender": "female", "age": "adult" },
    { "id": "MAYA", "label": "l'élève", "gender": "female", "age": "teen" }
  ],
  "voice": {
    "provider": "elevenlabs", "modelId": "eleven_v4", "speakingRate": 1.15,
    "voiceId": "KSyQzmsYhFbuOhqj1Xxv", "voiceName": "Léa", "narratorGender": "female", "narratorPov": "third",
    "voices": { "NARR": { "voiceId": "KSyQzmsYhFbuOhqj1Xxv", "name": "Léa" },
                "PROF": { "voiceId": "…", "name": "…" },
                "MAYA": { "voiceId": "…", "name": "…", "speakingRate": 1.2 } }
  }
}
```

Règles :
- `mode` absent ⇒ `narrator`. `speaker` absent sur un bloc ⇒ `NARR`.
- `voice.voiceId` reste la voix du narrateur (rien ne casse pour le code actuel). `voice.voices.NARR` vaut la même chose.
- `tone` est facultatif : `neutral`, `angry`, `scared`, `sad`, `happy`, `whisper`, `shout`. Il est traduit en balise audio du fournisseur (les balises `[tense]`, `[whispers]` existent déjà dans les scripts et sont retirées de `words.json` par `proj.strip_tts_tags`).

### 4.2 `src/episodes/<slug>/words.json`

Aujourd'hui : `[{ "w": "Être", "s": 0.0, "e": 0.32, "p": "" }]`. On ajoute **un champ** :

```json
{ "w": "Ton", "s": 3.10, "e": 3.31, "p": "", "sp": "PROF" }
```

`sp` absent ⇒ `NARR`. Tous les lecteurs actuels de `words.json` ignorent les champs inconnus : à vérifier par les tests existants.

### 4.3 `src/episodes/<slug>/timeline.json` (écrit par `plan.py`, dans le skill)

Ajouter au niveau racine une liste que le moteur lit :

```json
"speech": [ { "sp": "PROF", "a": 93, "b": 141 }, { "sp": "MAYA", "a": 150, "b": 196 } ]
```

`a` et `b` sont des images absolues de l'épisode (30 images/s), un intervalle par tour **de personnage** (jamais `NARR`). Deux mots du même locuteur séparés de moins de 0,25 s appartiennent au même intervalle.

### 4.4 Fiche de mise en scène (`episode.json`, `shots[].stage`)

Ajouter `speaks?: string[]` : les locuteurs (hors `NARR`) dont des mots tombent dans le plan. **Calculé par le code, pas écrit par l'agent** (§5.6).

---

## 5. Modifications dans `what-if-app`, fichier par fichier

Chemins depuis la racine du dépôt. Les numéros de ligne valent pour le commit `2bf27a6` ; chercher par nom de fonction s'ils ont bougé.

### 5.1 `pipeline/proj.py` — lecture du script avec locuteurs

Ajouter trois fonctions pures, utilisées par toutes les étapes Python :

- `episode_mode(ep) -> str` : `narrator` | `mixed` | `cast` ; valeur inconnue ⇒ erreur claire.
- `script_blocks(ep) -> list[dict]` : chaque bloc normalisé en `{ "speaker", "text", "tone" }`, `speaker` en majuscules, défaut `NARR`.
- `script_turns(ep) -> list[dict]` : fusion des blocs consécutifs du même locuteur **et du même ton** en `{ "speaker", "text", "tone", "blocks": [indices] }`.

Validation dans une quatrième fonction `script_problems(ep) -> list[str]` :
- `cast` avec un bloc `NARR` ⇒ erreur ; `narrator` avec un autre locuteur que `NARR` ⇒ erreur ;
- locuteur qui ne respecte pas `^[A-Z][A-Z0-9_]*$` ⇒ erreur ;
- locuteur absent de `ep.speakers` (hors `NARR`) ⇒ erreur ;
- plus de 4 locuteurs hors `NARR` ⇒ avertissement ;
- réplique de personnage de plus de 25 mots ⇒ avertissement.

### 5.2 `pipeline/nouveau_client.py`

- `tts_elevenlabs(...)` (ligne 183) et `tts_fish(...)` (ligne 210) : paramètre facultatif `segment: Optional[str] = None`, ajouté au corps de la requête seulement s'il est donné.
- Nouvelle fonction `voices_for(catalog, gender=None, age=None, lang="fr", style=None) -> list[dict]` : filtre le résultat de `voice_catalog()` (ligne 128). Tolérer les champs absents (les traiter comme inconnus, jamais comme correspondants).
- Nouvelle fonction `cast_voices(speakers, catalog, narrator_voice) -> dict` : une voix par locuteur.
  - Narrateur : la voix choisie par `detect_narrator_voice` (ligne 515), inchangé.
  - Personnage : première voix du catalogue qui correspond à `gender` et `age`, **différente de toutes les voix déjà attribuées**, narrateur compris. Préférer `style: character`.
  - Choix stable : trier les candidats par `id` et choisir avec un hachage de `slug + speaker.id`, pour qu'un même épisode garde ses voix d'un lancement à l'autre.
  - Aucun candidat : assouplir l'âge, puis lever une erreur qui nomme le personnage et ce qui manque au catalogue. **Jamais** deux locuteurs avec la même voix.
- Ne pas toucher à `ELEVENLABS_VOICES` (lignes 29 à 37) ni à `detect_narrator_voice`.

### 5.3 `pipeline/source_import.py` — récupérer le mode et les locuteurs

- Nouvel argument `--mode narrator|mixed|cast` (défaut `narrator`).
- Ligne 116 : quand `--mode` vaut `mixed` ou `cast`, demander au serveur `scriptMode=dialogue-mixed` / `dialogue-cast` (§3.3).
- Si la proposition renvoyée contient `blocks` et `speakers` : les écrire dans `episode.json` (`script`, `speakers`, `mode`).
- Si elle n'en contient pas (serveur non modifié) : écrire `mode` dans `episode.json`, garder le script à plat, et afficher sur la sortie `[source] the server returned no speakers: the agent must split the script into speaker blocks (see the dialogue rules)`. Ne pas échouer.
- Appeler `proj.script_problems` et afficher les avertissements.

### 5.4 `pipeline/voice_fish.py` — une voix par tour, assemblage, mots avec locuteur

Le chemin actuel (un appel, lignes 380 à 498) reste **tel quel** quand `episode_mode(ep) == "narrator"` et qu'aucun bloc n'a de `speaker`. Ajouter un second chemin `multi_voice(...)` pour les autres cas :

1. `turns = proj.script_turns(ep)`.
2. Voix : si `ep.voice.voices` ne couvre pas tous les locuteurs, appeler `cast_voices` avec `nv.voice_catalog()` et **écrire le résultat dans `episode.json`** (comme le fait déjà la détection du narrateur, lignes 307 à 321).
3. Pour chaque tour `i` : `segment = f"t{i:03d}"`, texte = balise de ton + texte ; appel `nv.tts_elevenlabs(..., voice_id=voix du locuteur, segment=segment)` ; téléchargement (`nv.fetch`) vers `out/<slug>/turns/t003.mp3` ; décodage (`decode`, ligne 56).
4. Alignement par tour : `nv.tts_transcribe` sur le fichier du tour, puis `realign(blocs du tour, asr, durée)` (ligne 79). En cas d'échec, repli proportionnel déjà prévu.
5. Assemblage : concaténer les tours avec un silence qui dépend de la transition, réglable dans `ep.gaps` :
   - même locuteur : 0,12 s (`gaps.sameSpeaker`) ;
   - changement de personnage : 0,28 s (`gaps.turn`) ;
   - narrateur ↔ personnage : 0,35 s (`gaps.narrator`).
   Décaler les instants des mots de chaque tour, ajouter `"sp": locuteur` à chaque mot.
6. Niveau sonore : normaliser chaque tour à la même puissance moyenne (RMS) avant l'assemblage, sinon une voix sort plus fort qu'une autre.
7. `tighten` (ligne 173) : il resserre les silences **à l'intérieur** d'un fichier. L'appliquer tour par tour, **avant** l'assemblage, pour ne pas manger les silences entre répliques.
8. Écrire `public/<slug>/voice_raw.mp3` n'a plus de sens : écrire `public/<slug>/voice.wav`, `words.json`, `out/<slug>/words_raw.json`, et dans `out/<slug>/voice_meta.json` la liste des tours `{ segment, speaker, voiceId, chars, duration, reused }`.
9. Cache : la signature (`sig`) devient une signature **par tour** (`texte + voix + modèle + vitesse`). Un tour inchangé n'est pas regénéré : on relit `out/<slug>/turns/tNNN.mp3`. C'est ce qui rend une retouche de réplique rapide et peu chère.
10. Coûts : une ligne `costs.json` par tour généré, même forme qu'aujourd'hui (lignes 476 à 489) plus `speaker` et `segment`.
11. La réutilisation du fichier du serveur (`tts_check`, lignes 340 à 378) est **désactivée** dans ce chemin.
12. Résultat (`proj.result`) : ajouter `mode`, `turns`, `voices`.

Erreurs à rendre lisibles : locuteur sans voix ; catalogue vide ; un tour qui échoue (nommer le tour, le locuteur et le début du texte, ne pas tout perdre : les tours déjà faits restent en cache).

### 5.5 `pipeline/shotlist.py` — couper au changement de locuteur

- `boundary_score` (ligne 316) : une frontière entre deux mots de `sp` différent reçoit un bonus fort (plus que la fin de phrase). Une coupe **à l'intérieur** d'un tour de moins de 1,2 s est interdite.
- `choose_cuts` (ligne 349) : tout changement de locuteur est une coupe obligatoire, sauf si le tour suivant dure moins de 0,6 s (une interjection reste dans le plan).
- `infer_shot_size` (ligne 425) : un plan dont les mots sont à un personnage est `medium` ou `close`, jamais `insert` ni `establishing`. Alterner les tailles entre deux répliques qui se répondent.
- Chaque plan écrit reçoit `"speaks": ["PROF"]` (locuteurs hors `NARR` qui ont des mots dans le plan, dans l'ordre) à côté de `"stage": None` (ligne 788).
- Mode `narrator` : aucun changement de résultat. Le test existant du rythme vertical (`test/smoke.test.mjs`, « vertical 9:16 pace ») doit rester vert sans modification.

### 5.6 `src/tools/staging.ts` et `src/tools/whatif.ts` — celui qui parle est à l'image

Dans `src/tools/staging.ts` :
- `stageCardProblems` : si le plan a `speaks` (lu sur le plan, pas sur la fiche), chaque locuteur doit figurer dans `card.people[].who`. Sinon erreur : `S12: PROF speaks in this shot but is not on the card: put PROF in the shot, or set "offscreen": ["PROF"] on the card for a voice heard from outside the frame`.
- Nouveau champ de fiche `offscreen?: string[]` (voix hors champ voulue), à ajouter au schéma de l'outil `stage_shots` et à `formatStageCards` (ligne « sujet »).
- `stagingCodeProblems` : pour chaque locuteur du plan non déclaré `offscreen`, le code du plan doit contenir la constante (`\bPROF\b`). C'est déjà la règle pour `people` : la réutiliser.

Dans `src/tools/whatif.ts`, `shotsAudit` (ligne 553) : rien de plus, `stagingProblems` et `stagingCodeProblems` y sont déjà appelés.

### 5.7 Moteur : la bonne bouche bouge toute seule

Fichier `engine-overlay/files/src/engine/shot.tsx` (calque appliqué sur chaque projet par `src/tools/engine-overlay.ts`).

- Le composant d'un plan reçoit `{ t, len, f }` (`ShotProps`, ligne 21) : `f` est l'image absolue de l'épisode. Vérifier dans `engine-overlay/files/src/engine/` et dans le `index.tsx` d'un épisode réel comment `f` est passé ; si `f` n'est pas l'image absolue, passer le début du plan en plus.
- Nouveau champ sur une personne : `voice?: string` — le locuteur que cette personne incarne (`'PROF'`). **Par défaut, il est déduit** : `cast()` connaît le nom du personnage (voir `engine-overlay/files/src/engine/cast.ts`) ; exposer ce nom et l'utiliser. Si la déduction est impossible, `voice` est obligatoire dès que l'épisode a un `speech` non vide.
- Les intervalles `speech` de `timeline.json` doivent être accessibles au plan. Deux voies, choisir la plus simple après lecture de `index.tsx` / `defineEpisode` : (a) un contexte React fourni par `defineEpisode`, (b) un module généré `speech.ts` à côté de `timeline.json`. Ne pas demander à l'agent de recopier des intervalles à la main.
- Dans `shot()`, pour chaque personne : `talking = un intervalle speech de son locuteur contient f`. Quand `talking` :
  - la bouche bouge (`talk`, comme le font déjà les gestes `talk` / `explain` dans `actions.ts`, fonction `mouth`) ;
  - si la personne n'a pas d'`act`, elle prend le geste `talk`.
  - Les **autres** personnes du plan sans `look` tournent le regard vers celle qui parle (`yawToward`, déjà dans `shot.tsx`).
- Quand personne ne parle (narrateur, silence) : comportement actuel, à l'identique.
- La caméra : si le plan a plusieurs personnes et que `on` n'est pas donné, la caméra se place sur celle qui parle en premier dans le plan. Un changement de locuteur dans le plan déclenche un battement de caméra (`CamBeat` avec `on`), sauf si le plan dure moins de 45 images.
- Interdit : une bouche qui bouge sur la voix du narrateur ; une bouche qui bouge chez un personnage pendant que c'est un autre qui parle.

Fichier `engine-overlay/files/src/engine/actions.ts` : exporter `mouth` (aujourd'hui locale, autour de la ligne 36) pour que `shot.tsx` l'utilise. Aucun autre changement.

### 5.8 Consignes de l'agent

`src/orchestrator/context.ts` :
- Étape 2 (ligne 44, `whatif_run voice`) : ajouter une phrase sur les trois modes et sur le fait que la voix est générée par tour.
- Chaîne (ligne 100) : inchangée.
- Nouvelle section courte « Dialogue » : comment écrire des blocs avec locuteur quand le serveur n'en fournit pas (§5.3, repli) ; règles d'écriture du §3.3 ; `speakers` obligatoire ; les identifiants de `speakers` sont ceux de `shared.tsx`.
- Le bloc épinglé (ligne 510, narrateur) : ajouter le mode et la liste « personnage → voix ».

`src/orchestrator/director-guide.ts` :
- Dans « Staging cards first » : `speaks` est donné par la shotlist ; celui qui parle doit être à l'image ou déclaré `offscreen`.
- Dans `shot({...})` : ne plus écrire `act: 'talk'` à la main pour un personnage qui a une réplique ; `voice` si la déduction échoue ; champ / contrechamp entre deux répliques (alterner `view: 'reverse'` ou `on`).

`src/tools/shot-words.ts` : afficher le locuteur devant chaque groupe de mots, par exemple `S12 [medium] (48f): PROF: Ton@0 téléphone@9 | MAYA: Je@30 ne@34`. Pour cela, étendre `shotWordFrames` (`src/orchestrator/context.ts`, ligne 441) afin qu'il lise `sp`.

### 5.9 Reviewer

`src/orchestrator/reviewer.ts` :
- `staticMetrics` : une ligne `dialogue : N répliques, M plans où le locuteur n'est pas à l'image` (calculée avec `speaks` et le code du plan).
- Consigne système (autour de la ligne 54) : un point de plus — « quand un personnage parle, c'est sa bouche qui bouge, il est visible ou déclaré hors champ, et sa voix correspond à son âge et à son genre ». Le Reviewer n'entend pas le son : il juge sur la table « personnage → voix » jointe au prompt.
- Joindre cette table au prompt (dans les deux modes de revue, lignes 629 et 692, à côté des fiches).

### 5.10 Lancement et interface

- `src/tools/whatif.ts`, outil `whatif_new` (autour de la ligne 1242) et étape `source` (ligne 1097) : paramètre `mode`, transmis à `source_import.py`. Défaut `narrator`.
- `src/orchestrator/main.ts`, création de projet (ligne 275) : accepter `body.mode` et le transmettre, comme `body.aspect`.
- Interface web : un sélecteur à trois valeurs à côté de celui du format. Trouver le fichier de l'interface avec `ast-grep` sur l'usage de `aspect` ; ne modifier que ce qui concerne ce sélecteur.

---

## 6. Modifications dans le skill `what-if-animation` (autre dépôt)

`scripts/plan.py` écrit `timeline.json`. Ajouter :
- la liste `speech` du §4.3, calculée à partir de `words.json` (`sp`, `s`, `e`) ;
- rien d'autre : les segments et les plans ne changent pas.

Si le skill ne peut pas être modifié tout de suite : calculer `speech` dans `what-if-app` après l'étape `plan` (dans `src/tools/whatif.ts`, à la suite de l'exécution de `plan.py`) et l'écrire dans `timeline.json`. Le dire dans le compte rendu.

---

## 7. Tests à écrire

Dans `test/smoke.test.mjs` (même style que les tests existants : `node --test`, dossiers temporaires, pas de réseau). Les tests Python passent par `spawnSync('python3', …)` comme le test « vertical 9:16 pace ». Trois tests ont besoin de `numpy` : utiliser le drapeau `NEEDS_NUMPY` déjà défini dans le fichier.

| # | Test | Ce qu'il prouve |
|---|---|---|
| T1 | `proj.script_blocks` / `script_turns` / `script_problems` sur 6 scripts | défauts (`NARR`), fusion des tours, erreurs des trois modes |
| T2 | Compatibilité : un `episode.json` actuel (sans `mode`) passe par `voice_fish.py` avec un faux serveur | **un seul** appel TTS, `words.json` sans `sp`, sortie identique à aujourd'hui |
| T3 | `voice_fish.py` en `mixed` avec un faux serveur HTTP local (qui renvoie un petit MP3 ou WAV et une transcription) | un appel par tour, la bonne `voiceId` par locuteur, `segment` distinct, `sp` sur chaque mot, instants croissants, silences selon la transition |
| T4 | Cache par tour : changer une réplique, relancer | un seul nouvel appel TTS |
| T5 | `cast_voices` | jamais deux locuteurs avec la même voix, choix stable, erreur claire si le catalogue ne suffit pas |
| T6 | `shotlist.py` sur des `words.json` fabriqués avec `sp` | coupe à chaque changement de locuteur, pas de coupe dans un tour court, `speaks` écrit, résultat inchangé en `narrator` |
| T7 | `stageCardProblems` / `stagingCodeProblems` avec `speaks` | locuteur absent de la fiche refusé, `offscreen` accepté, locuteur absent du code refusé |
| T8 | Moteur : test qui exécute `actions.ts` et la fonction pure qui dit « qui parle à l'image f » | bouche active seulement dans l'intervalle du bon locuteur, jamais pour `NARR` |
| T9 | `shot_words` | locuteur affiché devant ses mots |
| T10 | Reviewer : métrique « locuteur pas à l'image » | comptage juste sur un épisode fabriqué |

Pour le faux serveur : un petit serveur HTTP lancé dans le test (voir comment le test « codex provider » ou « agy provider » simule un service). La variable d'environnement `WHATIF_NOUVEAU_URL` donne l'adresse du serveur à `pipeline/nouveau_client.py` (`base_url`, ligne 51).

**Règles de preuve (obligatoires dans ce dépôt) :**
- Chaque test neuf subit une mutation : on casse la règle dans le code, le test doit échouer. Noter le résultat (« N détectées sur N »).
- Interdits : `skip`, assertion affaiblie, `@ts-ignore`, `any` ajouté, délai allongé pour masquer une course.
- `npm test` complet vert à la fin. Aujourd'hui : 58/58 avec `numpy`.
- `npx tsc --noEmit -p .` : 0 erreur.
- Le moteur se vérifie **à l'image** : appliquer le calque dans un projet réel, rendre des vignettes avec Remotion (`npx remotion still`) à trois instants d'un plan à deux personnages, et regarder que la bonne bouche est ouverte. Un test de texte ne suffit pas.

**Essai réel (demande l'accord de Pulsy, appels payants) :** un dialogue de 20 secondes à 2 personnages en mode `cast`, puis le même en `mixed`. À écouter : voix distinctes, niveaux égaux, silences naturels. À regarder : bouche synchronisée.

---

## 8. Ordre de travail

1. **Relevé du §2.** Sans lui, ne pas coder le §3.
2. §5.1 (lecture du script) + T1.
3. §5.2 et §5.4 avec le faux serveur + T2 à T5. La compatibilité `narrator` (T2) d'abord.
4. §5.5 (shotlist) + T6.
5. §6 (`speech` dans la timeline).
6. §5.7 (moteur) + T8 + rendus regardés.
7. §5.6 (fiches) + T7 ; §5.8 (consignes) ; §5.9 (Reviewer) + T9, T10.
8. §3 sur le serveur `:8005`, selon le relevé. §5.3 et §5.10 ensuite.
9. Essai réel de 20 secondes, puis un épisode complet en `mixed`.

Les étapes 2 à 7 ne demandent ni le serveur `:8005` ni service payant.

---

## 9. Critères d'acceptation

1. Un épisode existant, relancé, donne le même `words.json` et la même vidéo qu'avant.
2. En `mixed` et en `cast`, chaque personnage a sa propre voix, la même pendant tout l'épisode.
3. Chaque mot de `words.json` porte son locuteur.
4. La shotlist coupe à chaque changement de locuteur.
5. À l'image, seule la bouche de celui qui parle bouge ; le narrateur ne fait bouger aucune bouche.
6. Un plan où celui qui parle n'est ni à l'image ni déclaré hors champ est refusé avant les vignettes.
7. Changer une réplique ne regénère que son tour.
8. `npm test` vert, mutations notées, rendus regardés, essai réel écouté.

---

## 10. Règles du dépôt à respecter

- Réponses et comptes rendus dans un fichier `.md` sous `docs/` ; mettre à jour `docs/context-state.md` et `docs/feature-plans/voix-plusieurs-personnages.md` après chaque étape.
- Recherche de code avec `ast-grep` (`--lang ts` / `tsx` / `python`), pas `grep`, et jamais dans `node_modules/`.
- `git` : pas de `commit` ni de `push` sans demande de Pulsy ; jamais `reset`, `rebase`, `merge`, ni `git add -A`. Fichiers nommés un par un. Aucune image dans un commit.
- Ne pas modifier `data/projects/` : travailler sur des copies hors du dépôt.
- Ne jamais afficher ni copier une clé d'API (`data/app.db` en contient).
- Service payant (synthèse vocale, LLM) : seulement avec l'accord de Pulsy.
- Jamais de validation inventée : chaque « OK » renvoie à une commande réellement exécutée. Ce qui n'a pas tourné s'écrit « non exécuté ».

---

## 11. Points ouverts (décisions de Pulsy)

1. Service et voix : ElevenLabs, Fish, autre ? Liste des voix françaises disponibles (réponse par le relevé Q1).
2. Mode par lequel commencer : `mixed` est recommandé.
3. Choix du mode : imposé au lancement (ce que décrit le §5.10) ou proposé automatiquement d'après la source ?
4. Qui modifie le serveur `:8005` (Q9) ?
5. Les voix d'un personnage récurrent doivent-elles rester les mêmes d'un épisode à l'autre ? Ces specs choisissent par épisode.
