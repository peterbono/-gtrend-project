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

// Detecte un nom de jour espagnol present dans une ligne.
// Renvoie { day, dayIndex } ou null.
export function detectDay(line) {
  const norm = normalize(line);
  for (const [day, dayIndex] of Object.entries(DAY_INDEX)) {
    // \b ne marche pas avec les accents normalises, on borne manuellement.
    const re = new RegExp(`(^|[^A-Z])${day}([^A-Z]|$)`);
    if (re.test(norm)) return { day, dayIndex };
  }
  return null;
}
