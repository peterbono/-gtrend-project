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

# 1) Tester la web app TOUT DE SUITE avec des données de démo (sans WhatsApp)
npm run seed
npm start                   # http://localhost:3000

# 2) Brancher l'écoute WhatsApp en temps réel (dans un 2e terminal)
npm run listen              # scanne le QR code affiché avec ton téléphone
```

`npm run listen` ouvre une session WhatsApp Web liée à ton compte : scanne le QR depuis
**WhatsApp > Appareils connectés**. La session est sauvegardée (pas besoin de re-scanner).

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
| `src/seed.js` | Données de démo pour tester sans WhatsApp |
