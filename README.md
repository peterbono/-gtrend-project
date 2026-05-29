# 🌴 Playa Dance

Scrape **en temps réel** le groupe WhatsApp *PDC Dance Socials* et affiche dans une web app
**les soirées danse du jour** à Playa del Carmen (heure, lieu, lien Google Maps).

## Comment ça marche

```
Groupe WhatsApp  ──(appareil lié, comme WhatsApp Web)──▶  Listener (whatsapp-web.js)
                                                              │
                                          parsing TEXTE (gratuit, prioritaire)
                                          + vision flyers (optionnel, Claude)
                                                              │
                                                   data/events.json
                                                              │
                                         Web app Express  ──▶  "Soirées du jour"
```

- **Texte d'abord** : les messages structurés (`JUEVES – … 7p … 📍 lieu`) sont parsés gratuitement.
- **Vision en secours** : si un message ne contient **qu'une image** (flyer sans texte) et qu'une
  clé API Anthropic est configurée, le flyer est lu par Claude. Désactivé par défaut.

## Démarrage rapide

```bash
npm install
cp .env.example .env        # ajuste GROUP_NAME si besoin

# 1) Brancher l'écoute WhatsApp en temps réel
npm run listen              # affiche un QR -> scanne-le avec ton téléphone

# 2) Voir les soirées captées (dans un 2e terminal)
npm start                   # http://localhost:3000
```

`npm run listen` ouvre une session WhatsApp Web liée à ton compte : scanne le QR depuis
**WhatsApp > Appareils connectés** sur ton téléphone. La session est sauvegardée (pas besoin
de re-scanner ensuite). Dès qu'un message tombe dans le groupe, les soirées apparaissent.

> Le scan du QR est la **seule** étape que toi seul peux faire : c'est la sécurité WhatsApp,
> aucun service ne peut lier ton compte à ta place.

## Activer la vision (flyers image-only)

Dans `.env` :

```
ANTHROPIC_API_KEY=sk-ant-...
VISION_MODEL=claude-opus-4-8
```

## Tests

```bash
npm test    # teste le parser sur de vrais messages du groupe
```

## 🆓 Hébergement gratuit via cron GitHub Actions (recommandé)

Le listener WhatsApp tourne **par fenêtres de ~8 min, toutes les heures**, déclenché par
GitHub Actions. La session WhatsApp est persistée entre les runs via le cache du runner.
Les événements parsés sont écrits dans Upstash Redis ; la web app sur Vercel les affiche.

**Compromis** : entre 2 fenêtres tu peux avoir jusqu'à ~50 min sans capture en temps réel.
À la reconnexion, whatsapp-web.js resync l'historique des messages manqués, donc rien n'est
perdu tant que la session reste valide (~plusieurs jours).

### Bootstrap (à faire une seule fois)

1. Crée une base Redis gratuite sur [upstash.com](https://upstash.com) → onglet *REST API*
   → copie `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.
2. Sur le repo GitHub → *Settings → Secrets and variables → Actions* :
   - secret `UPSTASH_REDIS_REST_URL`
   - secret `UPSTASH_REDIS_REST_TOKEN`
   - secret `LINK_PHONE` (numéro E.164 sans `+`, ex Mexique : `5219991234567`)
   - secret `ANTHROPIC_API_KEY` (optionnel, pour la vision flyers)
   - variable `GROUP_NAME` (optionnel, défaut `PDC Dance Socials`)
3. *Actions* → workflow **Bootstrap WhatsApp session** → *Run workflow* → ouvre les logs en direct.
4. Quand le code de liaison s'affiche (gros et encadré dans les logs), va dans WhatsApp sur
   ton téléphone : *Réglages → Appareils connectés → Lier un appareil → Lier avec numéro de téléphone*
   et tape le code. Tu as ~60 s.
5. Le workflow continue jusqu'à *ready*, écoute 60 s puis sauve la session dans le cache. Fini.

### Mode normal (cron horaire)

Le workflow **WhatsApp listener (cron)** se lance automatiquement chaque heure à `:00`.
Tu peux aussi le déclencher manuellement (*Actions → Run workflow*) pour tester.
À chaque run : restore session → ready (~30-60 s) → écoute 8 min → flush Upstash → sauve session → exit.

### Web app sur Vercel

```bash
npx vercel link        # connecte le repo
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
npx vercel --prod
```

La web app lit la même base Redis que le listener → les soirées captées par le cron
apparaissent sur le lien public.

### Limites

- Comptes WhatsApp peuvent être bannis pour usage automatisé : préfère un **numéro dédié**
  ajouté au groupe (pas ton perso).
- Si la session WhatsApp expire (rare mais arrive), relance le workflow Bootstrap.
- Repo public requis pour Actions minutes illimitées (sinon 2000 min/mois suffisent largement :
  10 min × 24 runs × 30 j = 7200 min, donc passe le repo en public OU réduis le cron à
  toutes les 2-3 h).

## ☁️ Hébergement 100 % cloud, toujours allumé (Railway / Render / Fly) — payant

Le moyen le plus simple d'avoir un lien public **sans laisser ton PC allumé** : héberger
**listener + web app dans un seul service** (entrée `src/app.js`, via le `Dockerfile` fourni).
Le QR se scanne **depuis le navigateur** sur `/qr`.

### Railway (le plus simple)

1. [railway.app](https://railway.app) → *New Project → Deploy from GitHub repo* → ce repo (branche `main`).
2. L'app est à la racine, Railway détecte le `Dockerfile` automatiquement (rien à régler).
3. Variable `GROUP_NAME=PDC Dance Socials`. Génère un domaine public (Settings → Networking).
4. Ajoute un **Volume** monté sur `/app/.wwebjs_auth` (garde la session WhatsApp entre redéploiements).
5. Ouvre `https://ton-app.up.railway.app/qr` → **scanne le QR avec ton téléphone**. C'est en ligne 🎉

### Fly.io

`fly.toml` est fourni à la racine (Dockerfile + volume persistant pour la session WhatsApp).

```bash
fly auth login                              # 1) connexion (ouvre le navigateur)
fly launch --copy-config --no-deploy        # 2) crée l'app à partir de fly.toml
fly volumes create wwebjs_auth --region mia --size 1   # 3) volume pour la session
fly deploy                                  # 4) build + deploy
fly open /qr                                # 5) scanne le QR depuis le navigateur
```

Region par défaut : `mia` (Miami — proche de la Caraïbe/Mexique). Modifie `primary_region`
dans `fly.toml` si besoin. Le listener doit tourner H24, donc `auto_stop_machines = "off"`
et `min_machines_running = 1` sont déjà configurés.

> Fly.io facture au moins ~5 $/mois (plus de free tier depuis fin 2024).

### Render

`render.yaml` (Blueprint) est fourni. New → Blueprint → ce repo. Puis `…/qr` pour scanner.
(Le disque persistant pour la session WhatsApp nécessite un plan payant.)

### Tester l'image en local

```bash
docker build -t playa-dance .
docker run -p 3000:3000 -e GROUP_NAME="PDC Dance Socials" playa-dance
# puis http://localhost:3000/qr pour scanner, http://localhost:3000 pour les soirées
```

## 🚀 Alternative : web app sur Vercel (lien public)

Vercel héberge **la web app + l'API de lecture** (le listener WhatsApp, lui, reste sur ta machine).

```bash
npx vercel          # connexion + déploiement → te donne une URL https://...vercel.app
npx vercel --prod   # pour le déploiement de prod
```

Pour que le lien public affiche les **vraies** données captées par ton listener, les deux
partagent une base **Upstash Redis** (gratuit) :

1. Crée une base Redis sur [upstash.com](https://upstash.com) (ou Vercel → Marketplace → Redis).
   Récupère `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.
2. **Côté Vercel** : ajoute ces 2 variables dans Project → Settings → Environment Variables, puis `npx vercel --prod`.
3. **Côté listener** (ta machine, `.env`) : mets les **mêmes** 2 variables, puis `npm run listen`.

Résultat : ton listener écrit dans Redis → l'app Vercel lit Redis → le lien public affiche
les soirées en temps réel. Sans ces variables, le lien fonctionne mais reste vide (aucune donnée
de démo).

> Note : je ne peux pas générer le lien à ta place (il faut ton compte Vercel). La commande
> `npx vercel` ci-dessus le crée en ~1 min. Le **listener** ne tourne pas sur Vercel (process
> long + Chromium) : il reste sur ta machine ou un petit serveur toujours allumé.

## ⚠️ À savoir

- **WhatsApp n'a pas d'API officielle** pour lire un groupe : on passe par un *appareil lié*.
  C'est ton compte / ton groupe (usage légitime) mais c'est techniquement contre les CGU de
  WhatsApp. Risque faible de bannissement — préfère idéalement un **numéro dédié** ajouté au groupe.
- **Le listener doit tourner en permanence** : soit sur une machine à toi (PC, Raspberry Pi),
  soit hébergé (Railway / Render — voir plus haut, le plus simple).
- Le stockage est soit un fichier `data/events.json` (local, zéro config), soit Upstash Redis
  (partagé, pour un lien public live).

## Structure

| Fichier | Rôle |
|---|---|
| `src/parser.js` | Extrait jour / heure / lieu / url depuis le texte |
| `src/vision.js` | Secours : lit un flyer image via Claude (optionnel) |
| `src/whatsapp.js` | Cœur de l'écoute WhatsApp (reconnexion auto) |
| `src/store.js` | Stockage unifié : Upstash Redis si configuré, sinon JSON local |
| `src/web.js` | Routes API + sert le front |
| `src/listener.js` | Entrée **locale** : écoute + QR dans le terminal |
| `src/server.js` | Entrée **locale** : web app seule |
| `src/app.js` | Entrée **cloud** : web + écoute + QR sur `/qr` (1 process) |
| `Dockerfile` / `render.yaml` | Hébergement cloud (Railway / Render) |
| `api/` | Fonctions serverless (lecture) pour le déploiement Vercel |
| `public/` | Front mobile-first « Soirées du jour » |
