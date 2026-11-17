# MCP `whatif-studio` : la revue peut être contournée

Date : 2026-11-17. Constat N7 de `docs/audits/audit-2026-11-17.md`. Rien n'est corrigé ici : ce sont des décisions à prendre.

## Le problème

Le serveur MCP bloque le rendu tant qu'un Reviewer indépendant n'a pas validé la planche. Trois points affaiblissent ce blocage :

1. **`--skip-review`** : `whatif_run` accepte cet argument (`src/mcp/service.ts:367`). L'agent client peut donc lancer le rendu sans revue, de sa propre initiative.
2. **Verdict écrit par le client** : `whatif_save_review` (`src/mcp/service.ts:220`) enregistre le verdict que le client lui envoie. Rien ne prouve qu'un sous-agent distinct l'a produit.
3. **Aucun journal** : un épisode fait par MCP ne laisse aucun message en base (0 pour `rycglebm0hs`). On ne peut pas retracer après coup ce que l'agent a fait.

## Ce qui a été constaté

- Sur `rycglebm0hs`, le seul épisode MCP audité, la revue a bien eu lieu : le sous-agent a refusé deux plans à juste titre.
- Le risque est donc structurel, pas constaté. Il repose sur la bonne conduite du client.

## Décisions à prendre

| # | Question | Recommandation |
|---|---|---|
| D1 | Garder `--skip-review` ouvert à l'agent ? | Non : le réserver à une demande explicite de l'utilisateur. |
| D2 | Consigner les appels MCP en base ? | Oui : c'est ce qui permet un audit. |
| D3 | Vérifier que le verdict vient d'un Reviewer distinct ? | Plus tard : plus lourd, à voir si D1 et D2 ne suffisent pas. |

## Corrections possibles

- **D1** (petit) : `--skip-review` refusé sauf si une variable du serveur l'autorise (par exemple `WHATIF_MCP_ALLOW_SKIP_REVIEW=1`), avec un message qui dit quoi faire à la place. Test : le rendu sans revue est refusé par défaut.
- **D2** (moyen) : chaque appel d'outil MCP écrit une ligne en base (outil, arguments, résultat court, durée) dans le fil du projet, comme le fait l'agent interne.
- **D3** (moyen) : `whatif_save_review` n'accepte un verdict que s'il cite les images du dernier `whatif_review_pack` (jeton à usage unique rendu par le pack). Cela prouve que le pack a été lu, pas que le lecteur est indépendant.

Palier : P3 (touche au contrôle d'accès du rendu). Plan à valider avant code.

## Déjà réglé à côté

- Le test du serveur MCP échouait hors de la machine de production, faute de `WHATIF_SKILL_DIR`. Il fabrique maintenant son propre dossier de skill (`test/smoke.test.mjs`). C'était un défaut du test, pas du serveur.
