import { detectDay } from './days.js';

// Retire emojis / puces / espaces / chiffres "1️⃣ 2️⃣ ..." en debut de ligne.
// On utilise \p{Extended_Pictographic} pour couvrir TOUS les emojis (ES2018+)
// plus les modificateurs (skin tones, variation selectors, ZWJ).
function stripLead(line) {
  return line
    .replace(/^([\d]️⃣|️⃣)+/u, '') // keycaps "1️⃣"
    .replace(/^[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}•\-–·*►▶▪◆▫○●—→|]+/u, '')
    .trim();
}

// Markdown WhatsApp : *gras* / _italique_ / ~barre~ — on garde le texte, on vire la syntaxe.
function stripMarkdown(s) {
  return (s || '')
    .replace(/\*+([^*]+?)\*+/g, '$1')
    .replace(/_+([^_]+?)_+/g, '$1')
    .replace(/~+([^~]+?)~+/g, '$1')
    .replace(/&amp;/g, '&')
    .trim();
}

// Strippe filler espagnols/francais frequents devant un nom de lieu ou de titre.
function stripFillerPrefix(s) {
  return (s || '')
    .replace(/^\s*(lugar|lieu|place|venue|donde|where|adresse|address|direccion|dirección)\s*[:：]\s*/i, '')
    // "¿Dónde? Fiesta Inn" / "Donde? ..." : on exige ¿ ou ? pour ne pas
    // amputer un vrai nom de lieu commencant par "Donde ...".
    .replace(/^\s*(?:¿\s*d[oó]nde\s*\?*|d[oó]nde\s*\?+)\s*[:：]?\s*/i, '')
    .replace(/^\s*nos\s+vemos\s+en\s+/i, '')
    .replace(/^\s*[★⭐✨🎉]+\s*/u, '')
    .trim();
}

// Detecte une heure ou plage horaire en debut de ligne (case insensitive sur am/pm).
// Ex: "6p", "9-10p", "9p-1a", "7pm", "7-11p", "21:00", "5:00 PM – 7:30 PM", "8:00p.m.".
// Les points de "a.m."/"p.m." sont consommes pour ne pas laisser ".m." dans le nom.
// (?!\w) au lieu de \b : apres un "." final il n'y a pas de word boundary.
const TIME_RE = /^(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?(?:\s*[-–a]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?)?)(?!\w)/i;

function parseTime(line) {
  const clean = stripLead(line);
  // Rejette "50%", "2x1"... : un nombre suivi de "%" ou "x" n'est jamais une heure.
  if (/^\d{1,2}\s*[%x]/i.test(clean)) return null;
  const m = clean.match(TIME_RE);
  if (!m) return null;
  // Rejette les heures impossibles (> 23) : "50:00 foo" lu comme heure "50".
  const hour = parseInt(m[1], 10);
  if (hour > 23) return null;
  const time = m[1].replace(/\s+/g, '').toLowerCase();
  let name = clean.slice(m[0].length).replace(/^[\s:.–-]+/, '').trim();
  // Strippe le "h" espagnol/portugais ("19:00 h –", "19h –") + tirets restants.
  name = name.replace(/^h(?:rs?|oras?)?\b\s*/i, '');
  name = name.replace(/^[–\-—]+\s*/, '').trim();
  name = stripMarkdown(name);
  // Nettoie les keycaps residuels et les emoji isoles au milieu.
  name = name.replace(/[\d]️⃣/gu, '').replace(/️⃣/gu, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2) return null;
  return { time, name };
}

const URL_RE = /(https?:\/\/\S+)/i;
const ONLY_URL_RE = /^\s*https?:\/\/\S+\s*$/i;

// Domaines cartes reconnus : seuls ces liens deviennent mapUrl (bouton "Directions").
// Tout autre lien (Instagram, linkfly.to...) est ignore pour ne pas polluer mapUrl.
// Le protocole est optionnel : "maps.app.goo.gl/xyz" colle apres 📍 est frequent.
const MAP_DOMAINS = String.raw`maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]{2,10}\/maps|maps\.google\.[a-z.]{2,10}|share\.google|(?:www\.)?waze\.com|maps\.apple\.com|(?:www\.)?apple\.com\/maps`;
const MAP_URL_RE = new RegExp(String.raw`((?:https?:\/\/)?(?:${MAP_DOMAINS})\S*)`, 'i');
const MAP_URL_START_RE = new RegExp(String.raw`^(?:https?:\/\/)?(?:${MAP_DOMAINS})([\/?#]|$)`, 'i');
const ONLY_MAP_URL_RE = new RegExp(String.raw`^\s*(?:https?:\/\/)?(?:${MAP_DOMAINS})\S*\s*$`, 'i');

function isMapUrl(u) {
  return MAP_URL_START_RE.test((u || '').trim());
}
// Normalise un lien maps "nu" (sans protocole) en URL cliquable.
function toMapUrl(u) {
  const url = (u || '').trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
const ONLY_TIME_RE = /^\s*\d{1,2}(?::\d{2})?\s*(?:[apAP]m?)?\s*$/;
const PIN = '\u{1F4CD}'; // 📍

// Prix : capture montants ($200 MXN, $125, 750 pesos) ou mention "gratis/free/donation".
const PRICE_AMOUNT_RE = /\$\s?(\d+(?:[.,]\d+)?)\s*(MXN|USD|EUR|pesos?)?/i;
const PRICE_FREE_RE = /\b(free|gratis|gratuit|gratuito|sin\s*costo)\b/i;
const PRICE_DONATION_RE = /\b(cooperaci[oó]n\s*voluntaria|voluntary\s*donation|donaci[oó]n|donation)\b/i;

// Promos / tarifs : lignes "50% Discount", "2x1 drinks", "Cover $100", "Entrada libre"...
// Ces lignes doivent alimenter price (et NON devenir une activite horaire bidon).
// Le "free entry"/"gratis" reste capture en priorite par PRICE_FREE_RE plus haut.
const PRICE_PROMO_RE = /(\d+\s*%|\b\d+\s*x\s*\d+\b|\bdiscount\b|\bdescuento\b|\bcover\b|\bentrada\b|\badmission\b|\bpromo(?:ci[oó]n)?\b|\bfree\s+entry\b)/i;

// Nettoie un libelle de promo : vire la ponctuation/emphase finale (‼️, !!, ...) et les emojis.
function cleanPromoLabel(line) {
  let s = stripMarkdown(stripLead(line));
  s = s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+/gu, ' ');
  s = s.replace(/[!¡‼⁉]+/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

function parsePrice(line) {
  if (PRICE_FREE_RE.test(line)) return 'Free';
  if (PRICE_DONATION_RE.test(line)) return 'Donation';
  const m = line.match(PRICE_AMOUNT_RE);
  if (m) {
    const amount = m[1].replace(',', '.');
    const cur = (m[2] || 'MXN').toUpperCase().replace(/^PESOS?$/, 'MXN');
    return `$${amount} ${cur}`;
  }
  // Promo/tarif textuel ("50% Discount", "2x1 drinks", "Cover", "Entrada"...).
  if (PRICE_PROMO_RE.test(line)) {
    const label = cleanPromoLabel(line);
    if (label) return label;
  }
  return null;
}

function looksLikeTitle(s) {
  if (!s) return false;
  if (ONLY_URL_RE.test(s)) return false;
  if (ONLY_TIME_RE.test(s)) return false;
  return true;
}

// Parse un bloc texte WhatsApp en une liste d'evenements (un par jour trouve).
export function parseMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const events = [];
  let current = null;

  const push = () => {
    if (!current) return;
    // Regle metier : un event valide = un venue ET au moins une activite horaire.
    const hasRealVenue = current.venue && !ONLY_URL_RE.test(current.venue);
    const hasActivity = current.activities.length > 0;
    if (hasRealVenue && hasActivity) events.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const day = detectDay(line);
    if (day) {
      // Nouveau bloc jour. Titre = ce qui suit un tiret, sinon le reste de la ligne.
      push();
      let title = '';
      const dash = line.split(/[–-]/);
      if (dash.length > 1) title = dash.slice(1).join('-').trim();
      title = title.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').trim();
      title = stripMarkdown(title);
      title = stripFillerPrefix(title);
      // Garde le titre uniquement s'il a l'air d'un vrai titre (pas un timestamp ou une URL).
      if (!looksLikeTitle(title)) title = '';
      current = {
        day: day.day,
        dayIndex: day.dayIndex,
        title,
        venue: null,
        mapUrl: null,
        price: null,
        activities: [],
      };
      continue;
    }

    if (!current) continue; // lignes avant le premier jour : ignorees

    if (line.includes(PIN)) {
      const afterPin = stripFillerPrefix(stripMarkdown(line.split(PIN)[1].replace(/^[\s:]+/, '').trim()));
      if (afterPin) {
        if (ONLY_URL_RE.test(afterPin) || ONLY_MAP_URL_RE.test(afterPin)) {
          // 📍 lien seul (avec ou sans protocole) = jamais le nom du venue.
          // Lien maps -> mapUrl ; autre domaine (Instagram...) -> ignore.
          if (isMapUrl(afterPin)) current.mapUrl = toMapUrl(afterPin);
        } else {
          current.venue = afterPin;
          // Le venue peut contenir l'URL en suffixe : on la separe.
          const urlIn = afterPin.match(URL_RE) || afterPin.match(MAP_URL_RE);
          if (urlIn) {
            current.venue = afterPin.replace(urlIn[0], '').replace(/[\s,;|]+$/, '').trim();
            if (!current.mapUrl && isMapUrl(urlIn[1])) current.mapUrl = toMapUrl(urlIn[1]);
          }
        }
      }
      continue;
    }

    const url = line.match(URL_RE) || line.match(MAP_URL_RE);
    if (url) {
      // Seuls les liens cartes alimentent mapUrl ; un lien Instagram/linkfly
      // est consomme (la ligne reste ignoree) mais jamais stocke.
      if (isMapUrl(url[1])) current.mapUrl = current.mapUrl || toMapUrl(url[1]);
      continue;
    }

    // Prix : on capture le premier prix non-nul rencontre (sauf si "Free"/"Donation"
    // qui sont prioritaires sur un montant chiffre).
    const priceCandidate = parsePrice(line);
    if (priceCandidate) {
      if (!current.price || priceCandidate === 'Free' || priceCandidate === 'Donation') {
        current.price = priceCandidate;
      }
    }

    const t = parseTime(line);
    if (t) {
      current.activities.push(t);
      continue;
    }

    // Ligne non-horaire qui matche un motif promo ("50% Discount for locals ‼️",
    // "2x1 drinks") : on l'a deja routee vers price ci-dessus, on ne la transforme
    // PAS en activite avec un nom et une heure bidon.
    if (PRICE_PROMO_RE.test(line)) continue;
  }

  push();
  return events;
}

const ARTICLES = new Set(['the', 'la', 'el', 'le', 'les', 'los', 'las', 'a', 'an']);

// Cle venue normalisee : 1-2 tokens significatifs (sans article ni nombre),
// utilisee pour fusionner deux evenements qui referencent le meme lieu sous des noms differents.
// Ex : "the WAREHOUSE, AVENIDA 20..." et "The Warehouse" -> "warehouse".
export function venueKey(ev) {
  let v = ev.venue || '';
  if (ONLY_URL_RE.test(v)) v = '';
  if (!v && ev.title && !ONLY_URL_RE.test(ev.title) && !ONLY_TIME_RE.test(ev.title)) v = ev.title;
  if (!v) return null;
  v = v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  v = v.split(/[,;:|()/]/)[0];
  const tokens = v
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t && !ARTICLES.has(t) && !/^\d+$/.test(t));
  if (!tokens.length) return null;
  return tokens.slice(0, 2).join('-');
}

// Identifiant stable d'un evenement (pour dedup / upsert).
export function eventId(ev) {
  const vk = venueKey(ev);
  if (vk) return `${ev.dayIndex}-${vk}`;
  const fallback = (ev.title || ev.day).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${ev.dayIndex}-${fallback}`;
}
