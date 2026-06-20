// Jours en espagnol -> index JS Date.getDay() (Dimanche = 0 ... Samedi = 6)
export const DAY_INDEX = {
  DOMINGO: 0,
  LUNES: 1,
  MARTES: 2,
  MIERCOLES: 3,
  JUEVES: 4,
  VIERNES: 5,
  SABADO: 6,
};

// Libelle FR pour l'affichage
export const DAY_LABEL_FR = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
];

// Enleve les accents et passe en MAJUSCULES pour comparer les noms de jours.
export function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

// Noms de jours anglais -> index (Sunday = 0 ... Saturday = 6).
const DAY_INDEX_EN = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

// Noms de jours francais -> index (Dimanche = 0 ... Samedi = 6).
const DAY_INDEX_FR = {
  DIMANCHE: 0,
  LUNDI: 1,
  MARDI: 2,
  MERCREDI: 3,
  JEUDI: 4,
  VENDREDI: 5,
  SAMEDI: 6,
};

// Index -> nom canonique espagnol (le reste du code se base sur l'espagnol).
const SPANISH_BY_INDEX = Object.fromEntries(
  Object.entries(DAY_INDEX).map(([day, dayIndex]) => [dayIndex, day])
);

// Detecte un nom de jour (espagnol, anglais ou francais) present dans une ligne.
// Renvoie toujours le nom canonique espagnol : { day, dayIndex } ou null.
export function detectDay(line) {
  const norm = normalize(line);

  // Espagnol en priorite, comportement inchange (pas de pluriel optionnel).
  for (const [day, dayIndex] of Object.entries(DAY_INDEX)) {
    // \b ne marche pas avec les accents normalises, on borne manuellement.
    const re = new RegExp(`(^|[^A-Z])${day}([^A-Z]|$)`);
    if (re.test(norm)) return { day, dayIndex };
  }

  // Anglais puis francais, avec un "S" pluriel optionnel (MONDAYS, MARDIS...).
  for (const map of [DAY_INDEX_EN, DAY_INDEX_FR]) {
    for (const [day, dayIndex] of Object.entries(map)) {
      const re = new RegExp(`(^|[^A-Z])${day}S?([^A-Z]|$)`);
      if (re.test(norm)) {
        return { day: SPANISH_BY_INDEX[dayIndex], dayIndex };
      }
    }
  }

  return null;
}
