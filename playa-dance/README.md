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
cd playa-dance
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

## 🚀 Déployer la web app sur Vercel (lien public)

Vercel héberge **la web app + l'API de lecture** (le listener WhatsApp, lui, reste sur ta machine).

```bash
cd playa-dance
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
- **Ça doit tourner en permanence** sur une machine allumée (ton PC, un Raspberry Pi, ou un petit
  VPS). Le conteneur cloud où ce code a été écrit est éphémère.
- Le stockage est un simple fichier `data/events.json` (aucune base à installer).

## Structure

| Fichier | Rôle |
|---|---|
| `src/parser.js` | Extrait jour / heure / lieu / url depuis le texte |
| `src/vision.js` | Secours : lit un flyer image via Claude (optionnel) |
| `src/listener.js` | Écoute WhatsApp en temps réel |
| `src/store.js` | Stockage `data/events.json` (upsert / dedup) |
| `src/server.js` | API + sert la web app |
| `public/` | Front mobile-first « Soirées du jour » |
| `api/` | Fonctions serverless (lecture) pour le déploiement Vercel |
