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

## ☁️ Hébergement 100 % cloud, toujours allumé (Railway / Render) — recommandé

Le moyen le plus simple d'avoir un lien public **sans laisser ton PC allumé** : héberger
**listener + web app dans un seul service** (entrée `src/app.js`, via le `Dockerfile` fourni).
Le QR se scanne **depuis le navigateur** sur `/qr`.

### Railway (le plus simple)

1. [railway.app](https://railway.app) → *New Project → Deploy from GitHub repo* → ce repo (branche `main`).
2. L'app est à la racine, Railway détecte le `Dockerfile` automatiquement (rien à régler).
3. Variable `GROUP_NAME=PDC Dance Socials`. Génère un domaine public (Settings → Networking).
4. Ajoute un **Volume** monté sur `/app/.wwebjs_auth` (garde la session WhatsApp entre redéploiements).
5. Ouvre `https://ton-app.up.railway.app/qr` → **scanne le QR avec ton téléphone**. C'est en ligne 🎉

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
