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
// Minutes : separateur ":" mais aussi "." (8.15pm) et "h" (8h15), frequents sur
// les flyers latino/europeens.
const TIME_RE = /^(\d{1,2}(?:[:.h]\d{2})?\s*(?:[ap]\.?m?\.?)?(?:\s*[-–a]\s*\d{1,2}(?:[:.h]\d{2})?\s*(?:[ap]\.?m?\.?)?)?)(?!\w)/i;

// Une DUREE n'est pas une heure de debut : "1.30 hs de clase", "2 horas de
// practica", "90 min de social". Motif = nombre (+separateur) + unite de duree
// SUIVIE d'un mot. Garde-fou : "19:00 h –" (h = suffixe horaire espagnol, suivi
// d'un tiret, pas d'un mot) reste une heure valide.
const DURATION_RE = /^\d{1,2}(?:[.,:h]\d{1,2})?\s*(?:horas?|hrs?|hs?|min(?:utos?)?)\b\s+(?:de\s+|of\s+)?[a-záéíóúñ]/i;

function parseTime(line) {
  const clean = stripLead(line);
  // Rejette "50%", "2x1"... : un nombre suivi de "%" ou "x" n'est jamais une heure.
  if (/^\d{1,2}\s*[%x]/i.test(clean)) return null;
  // Rejette les durees ("1.30 hs de clase") pour ne pas creer un faux cours.
  if (DURATION_RE.test(clean)) return null;
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

// Lieu annonce par un label textuel (sans 📍) : "Zona: ZAZIL-HA", "Lugar: ...",
// "Venue: ...". Capture la valeur apres le deux-points.
const VENUE_LABEL_RE = /^(?:zona|lugar|ubicaci[oó]n|location|venue|lieu|place|d[oó]nde|where|address|adresse|direcci[oó]n)\s*[:：]\s*(.+)$/i;

// Mots-jours (ES/EN/FR) a retirer d'un titre extrait de la ligne-jour.
const DAY_WORDS_RE = /\b(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|sunday|monday|tuesday|wednesday|thursday|friday|saturday|dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)s?\b/gi;
// Filler devant un titre ("PRÓXIMO SÁBADO ...", "EVERY THURSDAY ...") — on ne
// retire PAS les articles (el/la/los) pour ne pas amputer "La Fonda".
const TITLE_FILLER_RE = /\b(pr[oó]ximo?|este|esta|next|this|every|cada|todos\s+los|todas\s+las|ce|cet|cette)\b/gi;
// Ligne purement "date" ("20 de junio", "june 20", "el 20") : pas un titre.
const DATE_LINE_RE = /^\s*(?:el\s+|le\s+)?\d{1,2}(?:\s*(?:de|of)\s+)?\s*(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\w*\s*\d{0,4}\s*$/i;
// Lignes-parasites a ne jamais retenir comme titre ("English Below", "Ver abajo").
const NOISE_TITLE_RE = /^\s*(?:english\s+below|espa[nñ]ol\s+(?:abajo|below)|below|abajo|ver\s+abajo|see\s+below|info|menu)\s*$/i;
// Pertinence danse : un event SANS horaire n'est synthetise que si son titre
// evoque la danse (workshop bachazouk OUI ; "match du Mundial" / "Estamos de
// fiesta" NON) -> evite de polluer le feed avec des annonces non-danse.
const DANCE_RE = /\b(salsa|bachata|bachazouk|zouk|kizomba|kiz|merengue|cumbia|timba|son\s+cubano|cha[\s-]?cha|tango|forr[oó]|samba|reggaeton|lady\s*style|rueda|casino|social(?:es)?|baile|danc(?:e|ing)|workshop|taller|clase|class|pr[aá]ctica|practice|latin[oa]?|noche\s+latina|fiesta\s+latina)\b/i;

function looksLikeTitle(s) {
  if (!s) return false;
  if (ONLY_URL_RE.test(s)) return false;
  if (ONLY_TIME_RE.test(s)) return false;
  if (DATE_LINE_RE.test(s)) return false;
  if (NOISE_TITLE_RE.test(s)) return false;
  return true;
}

// Retire TOUS les emojis + modificateurs (variation selectors, ZWJ, skin tones).
function stripEmoji(s) {
  return (s || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{2640}\u{2642}]/gu, ' ');
}

// Extrait un titre candidat d'une ligne-jour sans tiret : retire emojis,
// markdown, mots-jours et filler, puis valide.
function titleFromDayLine(line) {
  let t = stripEmoji(line);
  t = stripMarkdown(t);
  t = t.replace(DAY_WORDS_RE, ' ').replace(TITLE_FILLER_RE, ' ').replace(/\s+/g, ' ').trim();
  t = stripFillerPrefix(t);
  return looksLikeTitle(t) ? t : '';
}

// Parse un bloc texte WhatsApp en une liste d'evenements (un par jour trouve).
export function parseMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const events = [];
  let current = null;
  // Titre orphelin a reporter : titre vu avant le 1er jour, ou titre d'un bloc
  // incomplet (lieu sur un bloc-jour suivant du meme flyer).
  let pendingTitle = '';

  const push = () => {
    if (!current) return;
    const hasRealVenue = current.venue && !ONLY_URL_RE.test(current.venue);
    // Event annonce SANS horaire (workshop : "Sábado, Zona: X, $250") : si on a un
    // vrai lieu ET un vrai titre mais aucune activite, on synthetise une activite
    // sans heure depuis le titre — sinon la regle "lieu + activite" le jetterait.
    if (
      !current.activities.length &&
      hasRealVenue &&
      looksLikeTitle(current.title) &&
      DANCE_RE.test(current.title)
    ) {
      current.activities.push({ time: '', name: current.title });
    }
    const hasActivity = current.activities.length > 0;
    if (hasRealVenue && hasActivity) {
      events.push(current);
    } else if (looksLikeTitle(current.title)) {
      // Bloc incomplet mais titre exploitable -> on le reporte au bloc suivant.
      pendingTitle = current.title;
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const day = detectDay(line);
    if (day) {
      // Nouveau bloc jour. Titre = ce qui suit un tiret, sinon derive de la ligne.
      push();
      let title = '';
      const dash = line.split(/[–-]/);
      if (dash.length > 1) {
        title = stripMarkdown(stripEmoji(dash.slice(1).join('-')).trim());
        title = stripFillerPrefix(title);
        if (!looksLikeTitle(title)) title = '';
      } else {
        // Pas de tiret : derive le titre de la ligne (retire jour + filler).
        title = titleFromDayLine(line);
      }
      // Titre vide mais un titre orphelin attend -> on l'adopte.
      if (!title && pendingTitle) title = pendingTitle;
      pendingTitle = '';
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

    if (!current) {
      // Avant le premier jour : memorise une ligne-titre potentielle (nom de
      // l'event place en tete du flyer, avant la mention du jour).
      if (!pendingTitle) {
        const cand = stripFillerPrefix(stripMarkdown(stripLead(line)));
        if (cand.length >= 4 && looksLikeTitle(cand)) pendingTitle = cand;
      }
      continue;
    }

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

    // Lieu via label textuel ("Zona: ZAZIL-HA", "Lugar: ...") quand il n'y a pas
    // de 📍. On ne remplace pas un venue deja capture (le 📍 reste prioritaire).
    if (!current.venue) {
      const vlabel = stripLead(line).match(VENUE_LABEL_RE);
      if (vlabel) {
        let val = stripMarkdown(vlabel[1].trim());
        const urlIn = val.match(MAP_URL_RE);
        if (urlIn && isMapUrl(urlIn[1])) {
          if (!current.mapUrl) current.mapUrl = toMapUrl(urlIn[1]);
          val = val.replace(urlIn[0], '').replace(/[\s,;|]+$/, '').trim();
        }
        if (val && !ONLY_URL_RE.test(val)) current.venue = val;
        continue;
      }
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
