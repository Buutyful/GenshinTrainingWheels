// Regenerates src/lib/roster.json and public/portraits/*.png.
//
//   node scripts/update-roster.mjs
//
// Character list: gi.yatta.moe (Project Amber). Aliases: gcsim's shortcut table, whose keys
// are also Genshin Optimizer's character keys. Characters not released yet come from EXTRA.
// Portraits are bundled with the app, which never goes online by itself.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outJson = join(root, 'src/lib/roster.json');
const outDir = join(root, 'public/portraits');
const UA = { 'User-Agent': 'Mozilla/5.0 (roster script)' };

const ELEMENT = { Fire: 'pyro', Water: 'hydro', Electric: 'electro', Ice: 'cryo', Wind: 'anemo', Rock: 'geo', Grass: 'dendro' };
const WEAPON = { SWORD_ONE_HAND: 'sword', CLAYMORE: 'claymore', POLE: 'polearm', BOW: 'bow', CATALYST: 'catalyst' };

/** Announced or leaked characters the public databases do not list yet. */
const EXTRA = [
  { name: 'Danica', element: 'electro', weapon: 'claymore', rarity: 5, version: '7.3', icon: 'https://enka.network/ui/UI_AvatarIcon_Danica.png', aliases: ['danica'] },
  { name: 'Tsaritsa', element: 'cryo', weapon: 'bow', rarity: 5, version: '7.3', icon: 'https://enka.network/ui/UI_AvatarIcon_Anastasya.png', aliases: ['tsaritsa', 'tsar', 'anastasya', 'anastasia'] },
];

/** Community short names gcsim does not have. */
const MORE_ALIASES = {
  Valeriy: ['valery', 'valerie'],
  Mitya: ['mitia'],
  Tartaglia: ['ajax'],
  RaidenShogun: ['ei', 'shogun'],
  KaedeharaKazuha: ['kz'],
  Yelan: ['yl'],
  Nahida: ['nah'],
  Furina: ['fur'],
  Neuvillette: ['neuvi'],
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const goKey = (name) => name.normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

async function json(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function gcsimAliases() {
  const r = await fetch('https://raw.githubusercontent.com/genshinsim/gcsim/main/pkg/shortcut/character.dm.go', { headers: UA });
  const text = await r.text();
  const out = {};
  for (const m of text.matchAll(/"([a-z0-9]+)":\s*keys\.([A-Za-z0-9]+)/g)) (out[m[2]] ??= []).push(m[1]);
  return out;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, file) {
  if (await exists(file)) return;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
}

const items = Object.values((await json('https://gi.yatta.moe/api/v2/en/avatar')).data.items);
const aliases = await gcsimAliases();
await mkdir(outDir, { recursive: true });

const roster = [];
const seen = new Set();
items.sort((a, b) => a.release - b.release);
for (const c of items) {
  const isTraveler = String(c.id).includes('-');
  if (isTraveler && !String(c.id).startsWith('10000007')) continue; // one Traveler per element
  const element = ELEMENT[c.element] ?? 'none';
  const name = isTraveler ? `Traveler (${element[0].toUpperCase()}${element.slice(1)})` : c.name;
  const key = isTraveler ? `Traveler${element[0].toUpperCase()}${element.slice(1)}` : goKey(c.name);
  const id = slug(name);
  if (seen.has(id)) continue;
  seen.add(id);
  const al = new Set([...(aliases[key] ?? []), ...(MORE_ALIASES[key] ?? [])]);
  if (isTraveler) {
    const El = element[0].toUpperCase() + element.slice(1);
    for (const k of [`Aether${El}`, `Lumine${El}`]) (aliases[k] ?? []).forEach((x) => al.add(x));
    for (const p of ['traveler', 'aether', 'lumine', 'mc']) al.add(p + element);
  }
  roster.push({
    id,
    name,
    key,
    element,
    weapon: WEAPON[c.weaponType.replace('WEAPON_', '')] ?? 'sword',
    rarity: c.rank,
    aliases: [...al].sort(),
  });
  await download(`https://gi.yatta.moe/assets/UI/${c.icon}.png`, join(outDir, `${id}.png`));
}

for (const e of EXTRA) {
  const id = slug(e.name);
  if (seen.has(id)) continue;
  roster.push({ id, name: e.name, key: goKey(e.name), element: e.element, weapon: e.weapon, rarity: e.rarity, aliases: e.aliases, upcoming: e.version });
  await download(e.icon, join(outDir, `${id}.png`));
}

await writeFile(outJson, JSON.stringify(roster, null, 1) + '\n');
console.log(`${roster.length} characters → ${outJson}`);
