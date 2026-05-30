// Match un nom de groupe WhatsApp contre une liste de noms cibles.
// GROUP_NAME peut etre :
//   - un nom unique : "PDC Dance Socials 🔥"
//   - une liste separee par des virgules : "PDC Dance Socials 🔥,Let's Dance 🇲🇽"
// Le match est tolerant : NFKD + lowercase + trim, plus un fallback substring.

export function parseGroupNames(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const norm = (s) =>
  (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function matchesAnyGroup(chatName, configuredRaw) {
  const targets = parseGroupNames(configuredRaw);
  if (!targets.length) return false;
  if (targets.includes(chatName)) return true;
  const n = norm(chatName);
  return targets.some((t) => {
    const tn = norm(t);
    return n === tn || n.includes(tn);
  });
}

export function findGroups(chats, configuredRaw) {
  const targets = parseGroupNames(configuredRaw);
  if (!targets.length) return [];
  const groups = chats.filter((c) => c.isGroup);
  const found = new Map();
  for (const t of targets) {
    const tn = norm(t);
    const hit =
      groups.find((c) => c.name === t) ||
      groups.find((c) => norm(c.name) === tn) ||
      groups.find((c) => norm(c.name).includes(tn));
    if (hit && !found.has(hit.id?._serialized || hit.name)) {
      found.set(hit.id?._serialized || hit.name, hit);
    }
  }
  return [...found.values()];
}
