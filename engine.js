// Forkcast engine: tastes → a week of meals → a shopping list → the best basket at each supermarket.
// Pure functions; the server supplies recipes, the ingredient catalogue and live search results.
(function () {

// ---------------------------------------------------------------- planning --
// A seeded random so "regenerate" gives a new week but the same answers give the same week.
function rng(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

const NO = "no", LOVE = "love";
// Does this recipe fit what the person told us? Returns null (never) or a score (higher = better).
function fit(r, p) {
  const diet = p.diet || "none";
  if (diet === "vegan" && !r.diet.includes("vegan")) return null;
  if (diet === "vegetarian" && !(r.diet.includes("vegetarian") || r.diet.includes("vegan"))) return null;
  if (diet === "pescatarian" && !(r.diet.includes("pescatarian") || r.diet.includes("vegetarian") || r.diet.includes("vegan"))) return null;
  if ((p.allergies || []).some(a => r.allergens.includes(a))) return null;
  for (const d of p.mustBe || []) if (!r.diet.includes(d)) return null;            // e.g. gluten-free
  const stars = (p.ratings || {})[r.id];
  if (stars === 1) return null;                                                 // "never again"
  if ((p.cuisines || {})[r.cuisine] === NO) return null;
  if ((p.proteins || {})[r.protein] === NO) return null;
  if (r.spice > (p.spice ?? 3)) return null;
  if ((p.avoid || []).some(a => avoids(r, a))) return null;
  const kit = p.kit || [];
  if (kit.length && r.tags.includes("air-fryer") && !kit.includes("air-fryer")) return null;
  if (kit.length && r.tags.includes("slow-cooker") && !kit.includes("slow-cooker")) return null;
  if (kit.includes("hob-only") && (r.tags.includes("traybake") || /\boven\b|°C/i.test(r.steps.join(" ")))) return null;

  let s = 1;
  // what you've liked before: favourites and 4–5 stars come round more often, 2 stars less
  if ((p.favourites || []).includes(r.id)) s += 1.3;
  // eaten in the last couple of weeks: give it a rest (favourites come back sooner)
  if ((p.recent || []).includes(r.id)) s -= (p.favourites || []).includes(r.id) ? 1.2 : 2.6;
  if (stars) s += ({ 2: -.9, 3: 0, 4: .7, 5: 1.3 })[stars] || 0;
  if ((p.cuisines || {})[r.cuisine] === LOVE) s += 1.2;
  if ((p.proteins || {})[r.protein] === LOVE) s += 1;
  if (diet === "flexitarian" && ["vegetarian", "vegan", "fish"].includes(r.protein)) s += .6;
  const limit = r.meal === "breakfast" ? (r.tags.includes("weekend") ? 45 : 15) : r.meal === "lunch" ? 30 : (p.weeknightTime || 45);
  if (r.time > limit) s -= Math.min(1.5, (r.time - limit) / 20);
  if ((p.confidence || 2) < r.difficulty) s -= .6 * (r.difficulty - (p.confidence || 2));
  const g = p.goal || "balanced";
  if (g === "high-protein") s += Math.min(1, (r.protein_g - 25) / 20);
  if (g === "lower-calorie") s += r.kcal < 550 ? .8 : r.kcal > 750 ? -.8 : 0;
  if (g === "lower-carb") s += r.carbs_g < 35 ? .8 : r.carbs_g > 70 ? -.6 : 0;
  if (g === "more-veg") s += Math.min(1, r.fibre_g / 10);
  // daily calorie and macro targets: meals that fit their share of the day, once the portion is set, come first
  if (hasTargets(p)) s -= 6 * macroErr(r, r.meal, p);
  if (p.style === "value" || (p.budget && p.budget / Math.max(1, people(p)) < 25)) s += r.tags.includes("budget") ? .6 : 0;
  if (r.tags.includes("family") && (p.children || 0) > 0) s += .5;
  return s;
}
// "olives" rules out black-olives but not olive-oil; "fresh-coriander" is that exact ingredient
function avoids(r, a) {
  const w = String(a).toLowerCase().trim(); if (!w) return false;
  const re = new RegExp(`(^|[ -])${w.replace(/[^a-z0-9]+/g, "[ -]")}($|[ -])`);
  return r.ingredients.some(i => i.item === w || re.test(i.item)) || re.test(r.name.toLowerCase().replace(/[^a-z0-9 ]/g, " "));
}
const people = p => (+p.adults || 2) + .6 * (+p.children || 0);

// --------------------------------------------------------------- targets --
// p.targets = { kcal, protein_g, carbs_g, fat_g } per person per day (any can be 0 = no target).
// Each meal aims at its share of the day; a day with only dinner planned aims dinner at 40%.
const SHARE = { breakfast: .25, lunch: .35, dinner: .4 }, MACROS = ["kcal", "protein_g", "carbs_g", "fat_g"];
const WEIGHT = { kcal: 1.5, protein_g: 1.2, carbs_g: .8, fat_g: .8 };
const hasTargets = p => MACROS.some(k => +(p.targets || {})[k] > 0);
// Portion size for a meal (1 = the recipe's own serving): scaled, within reason, to hit the calories.
function portion(r, meal, p) {
  const t = +(p.targets || {}).kcal;
  if (!t || p.scalePortions === false || !r.kcal) return 1;
  return Math.round(Math.min(1.5, Math.max(.75, t * SHARE[meal] / r.kcal)) * 20) / 20;
}
// How far a meal (at its portion) is from its share of the targets: 0 = spot on, 0.3 = 30% out on average.
function macroErr(r, meal, p) {
  const f = portion(r, meal, p);
  let err = 0, w = 0;
  for (const k of MACROS) {
    const t = +(p.targets || {})[k] * SHARE[meal]; if (!(t > 0)) continue;
    err += WEIGHT[k] * Math.min(1.5, Math.abs((r[k] || 0) * f - t) / t); w += WEIGHT[k];
  }
  return w ? err / w : 0;
}

// Pick `n` meals of `meal` type: best fits first, but spread cuisines and proteins, and favour
// recipes that share fresh ingredients with ones already chosen (less waste, smaller basket).
function pick(recipes, p, meal, n, rand, locked = []) {
  const pool = recipes.filter(r => r.meal === meal).map(r => ({ r, s: fit(r, p) })).filter(x => x.s !== null);
  const chosen = [...locked];
  const fresh = r => new Set(r.ingredients.map(i => i.item));
  while (chosen.length < n && pool.length) {
    const used = new Set(chosen.flatMap(c => [...fresh(c)]));
    let best = null, bs = -1e9;
    for (const x of pool) {
      if (chosen.some(c => c.id === x.r.id)) continue;
      let s = x.s + rand() * (p.variety === "repeat" ? .4 : 1.1);
      const sameC = chosen.filter(c => c.cuisine === x.r.cuisine).length, sameP = chosen.filter(c => c.protein === x.r.protein).length;
      s -= sameC * (p.variety === "repeat" ? .3 : .9) + sameP * .5;
      const shared = [...fresh(x.r)].filter(i => used.has(i)).length;
      s += Math.min(1, shared * .2);
      if (s > bs) { bs = s; best = x.r; }
    }
    if (!best) break;
    chosen.push(best);
  }
  // repeat favourites rather than leave nights empty if the filters are very tight
  for (let i = 0; chosen.length < n && chosen.length; i++) chosen.push(chosen[i]);
  return chosen;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MEALS = ["breakfast", "lunch", "dinner"];
const WEEKEND = new Set(["Sat", "Sun"]);
// Which meals to plan: { Mon: { dinner: "cook" }, Sat: { breakfast: "cook", lunch: "cook", dinner: "cook" }, Tue: { lunch: "leftovers" } … }
// "leftovers" (lunch only) means: cook double the night before and take the rest. Default: every dinner.
const PRESETS = {
  "weeknight-weekend": Object.fromEntries(DAYS.map(d => [d, WEEKEND.has(d) ? { breakfast: "cook", lunch: "cook", dinner: "cook" } : { dinner: "cook" }])),
  "dinners": Object.fromEntries(DAYS.map(d => [d, { dinner: "cook" }])),
  "everything": Object.fromEntries(DAYS.map(d => [d, { breakfast: "cook", lunch: "cook", dinner: "cook" }])),
  "work-lunches": Object.fromEntries(DAYS.map(d => [d, WEEKEND.has(d) ? { breakfast: "cook", lunch: "cook", dinner: "cook" } : { lunch: "leftovers", dinner: "cook" }])),
};
function slots(p) {
  const m = p.meals && Object.keys(p.meals).length ? p.meals : PRESETS[p.mealPreset] || (p.dinners ? Object.fromEntries(DAYS.slice(0, p.dinners).map(d => [d, { dinner: "cook" }])) : PRESETS.dinners);
  const out = [];
  DAYS.forEach((d, i) => MEALS.forEach(meal => { const v = m[d]?.[meal]; if (v === "cook" || (v === "leftovers" && meal === "lunch")) out.push({ day: d, i, meal, how: v }); }));
  // leftovers need a dinner the night before; without one, cook lunch fresh instead
  for (const s of out) if (s.how === "leftovers" && !out.some(x => x.meal === "dinner" && x.i === (s.i + 6) % 7)) s.how = "cook";
  return out;
}

// keep = { "Mon.dinner": recipeId, … } pins meals across reshuffles
function plan(recipes, p, seed = 1, keep = {}) {
  const rand = rng(seed), want = slots(p), days = DAYS.map(d => ({ day: d }));
  for (const meal of MEALS) {
    const mine = want.filter(s => s.meal === meal && s.how === "cook");
    if (!mine.length) continue;
    const pinned = mine.map(s => keep[`${s.day}.${meal}`]).filter(Boolean).map(id => recipes.find(r => r.id === id)).filter(Boolean);
    // weekend slots can take longer recipes: plan them with a relaxed time limit
    const chosen = pick(recipes, p, meal, mine.length, rand, pinned);
    const free = chosen.filter(r => !pinned.includes(r)), quick = [...free].sort((a, b) => a.time - b.time);
    for (const s of mine) {
      const k = keep[`${s.day}.${meal}`] && recipes.find(r => r.id === keep[`${s.day}.${meal}`]);
      let r = k;
      if (!r) r = WEEKEND.has(s.day) ? (quick.length ? quick.pop() : chosen[0]) : (quick.length ? quick.shift() : chosen[0]);
      if (r) days[s.i][meal] = r.id;                                             // nothing fits (e.g. no vegan breakfasts): leave it out
    }
  }
  for (const s of want.filter(s => s.how === "leftovers")) {
    const prev = days[(s.i + 6) % 7].dinner;
    if (prev) { days[s.i].lunch = prev; days[s.i].lunchLeftovers = true; }
  }
  setPortions({ days }, recipes, p);
  return { seed, days: days.filter(d => MEALS.some(m => d[m])) };
}
// day.portion = { dinner: 1.15, … } where a meal isn't the recipe's own serving (with calorie targets)
function setPortions(planObj, recipes, p) {
  const byId = Object.fromEntries(recipes.map(r => [r.id, r]));
  for (const d of planObj.days) {
    delete d.portion;
    for (const m of MEALS) { const r = byId[d[m]], f = r ? portion(r, m, p) : 1; if (f !== 1) (d.portion || (d.portion = {}))[m] = f; }
  }
  return planObj;
}
// ---------------------------------------------------------- shopping list --
// Every recipe serves `serves`; scale to the household (children count as ~0.6 of an adult).
function list(planObj, recipes, ingredients, p) {
  const byId = Object.fromEntries(recipes.map(r => [r.id, r])), need = {};
  const who = people(p);
  for (const d of planObj.days) for (const slot of MEALS) {
    const r = byId[d[slot]]; if (!r) continue;
    const k = who * (d.portion?.[slot] || 1) / (r.serves || 4);
    for (const i of r.ingredients) {
      const c = ingredients[i.item]; if (!c) continue;
      const n = need[i.item] || (need[i.item] = { item: i.item, name: c.name, unit: c.unit, qty: 0, aisle: c.aisle, pantry: !!c.pantry, for: [] });
      n.qty += i.qty * k;
      if (!n.for.includes(r.name)) n.for.push(r.name);
    }
  }
  // p.cupboard = { item: { qty } } what's already in: no qty means plenty, a qty comes off what's needed
  const have = new Set(p.pantryHave || []), cup = p.cupboard || {};
  return Object.values(need).map(n => {
    const want = Math.ceil(n.qty), c = cup[n.item], got = c ? (c.qty == null ? want : Math.min(want, Math.floor(c.qty))) : 0;
    return { ...n, need: want, have: got, qty: want - got, skip: (n.pantry && (p.pantryAll || have.has(n.item))) || want - got <= 0 };
  }).sort((a, b) => a.aisle < b.aisle ? -1 : a.aisle > b.aisle ? 1 : a.name < b.name ? -1 : 1);
}
// What's left in the cupboard once this week's shop is in and the meals are cooked: amounts used
// come off what was there, and the spare from long-life packs bought is added. Fresh food isn't kept.
// lines: the chosen shop's basket lines ({ item, packs, product }); returns the new cupboard.
function restock(cupboard, listLines, lines, ingredients) {
  const out = JSON.parse(JSON.stringify(cupboard || {})), bought = Object.fromEntries((lines || []).filter(l => !l.missing).map(l => [l.item, l]));
  const keeps = c => c && (!c.perishable || (c.shelfDays || 0) >= 30);
  for (const l of listLines || []) {
    const c = out[l.item];
    if (c && c.qty != null && l.have) { c.qty -= l.have; if (c.qty <= 0) delete out[l.item]; }
    const b = bought[l.item], cat = ingredients[l.item];
    if (!b || l.skip || !keeps(cat)) continue;
    if (parseSize(b.product.size, b.product.name, l.unit)?.perKg) continue;          // loose: weighed out, nothing spare
    const y = packYield(b.product, l, cat);
    const spare = y ? b.packs * y - l.qty : 0;
    if (spare >= Math.max(1, l.qty * .1) || (spare > 0 && l.unit === "each")) {
      const e = out[l.item] || (out[l.item] = { qty: 0, unit: l.unit, name: cat.name });
      if (e.qty != null) e.qty = Math.round(e.qty + spare);
      e.since = e.since || Date.now();
    }
  }
  return out;
}

// ------------------------------------------------------ product matching --
// Typical weight of one, for "each" ingredients sold by weight (onions in a 1kg net, etc.)
const EACH_G = { onion: 150, "red-onion": 150, shallot: 40, pepper: 160, lemon: 100, lime: 70, garlic: 50, potato: 200,
  "sweet-potato": 250, carrot: 80, avocado: 170, tomato: 90, egg: 60, courgette: 200, aubergine: 280, apple: 150,
  banana: 120, cucumber: 300, leek: 200, parsnip: 120, mango: 300, chilli: 15, ginger: 50, "spring-onion": 15 };
const eachGrams = item => { for (const k of Object.keys(EACH_G).sort((a, b) => b.length - a.length)) if (item.includes(k)) return EACH_G[k]; return 150; };

// "4 x 400g" → {qty: 1600, unit: "g", count: 4}; "1.5kg" → 1500 g; "2 pints" → 1136 ml; "6 pack" → 6 each
function parseSize(size, name, want) {
  const t = `${size || ""} ${name || ""}`.toLowerCase().replace(/,/g, "");
  if (/\bper kg\b|\bprice per kg\b/.test(String(size || "").toLowerCase())) return { qty: 1000, unit: "g", count: 1, perKg: true };   // loose, sold by weight
  let c = String(size || "").toLowerCase().match(/^(\d+)\s*(each|ea|pk|pack)$/);                       // Aldi "8Each"
  if (c) return { qty: +c[1], unit: "each", count: +c[1] };
  c = String(name || "").toLowerCase().match(/\b(\d{1,2})\s+(?:[a-z&'-]+\s+){0,4}(eggs|rolls|buns|wraps|tortillas|bagels|muffins|crumpets|flatbreads|naans?|pittas?|limes|lemons|peppers|onions|avocados|fillets|breasts|thighs|sausages|burgers|cobs|baps)\b/);
  if (c && !/\d\s*(g|kg|ml|l)\b/.test(String(size || "").toLowerCase())) return { qty: +c[1], unit: "each", count: +c[1] };
  let m = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|cl)\b/);
  if (m) return { qty: +m[1] * conv(+m[2], m[3]), unit: /g$/.test(m[3]) ? "g" : "ml", count: +m[1] };
  m = t.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|ltr|litre|l|cl)\b/);
  if (m) return { qty: conv(+m[1], m[2]), unit: /g$/.test(m[2]) ? "g" : "ml", count: 1 };
  m = t.match(/(\d+(?:\.\d+)?)\s*pints?\b/);
  if (m) return { qty: +m[1] * 568, unit: "ml", count: 1 };
  m = t.match(/(?:pack of|x)\s*(\d+)\b|\b(\d+)\s*(?:pack|pk|per pack|eggs|bulbs|limes|lemons|peppers|onions|avocados|ct)\b/);
  if (m) return { qty: +(m[1] || m[2]), unit: "each", count: +(m[1] || m[2]) };
  m = String(size || "").trim().match(/^(\d+)\s*s$/i);                            // Waitrose eggs: "12s"
  if (m) return { qty: +m[1], unit: "each", count: +m[1] };
  m = String(size || "").trim().match(/^(\d+(?:\.\d+)?)$/);                       // bare number: the site's unit is the ingredient's
  if (m) return { qty: +m[1], unit: want === "each" ? "each" : want, count: 1 };
  if (/\beach\b|\bloose\b|\bsingle\b/.test(t)) return { qty: 1, unit: "each", count: 1 };
  return null;
}
function conv(v, u) { return u === "kg" || u === "l" || u === "ltr" || u === "litre" ? v * 1000 : u === "cl" ? v * 10 : v; }

// How much of the ingredient one pack gives, in the ingredient's own unit (null = can't tell).
function packYield(prod, ing, cat = {}) {
  const each = cat.eachWeight || eachGrams(ing.item);
  const s = parseSize(prod.size, prod.name, ing.unit); if (!s) return ing.unit === "each" ? 1 : null;
  // spring onions, chillies, stock cubes: the shop's "each" is a bunch or box of several
  if (ing.unit === "each" && s.unit === "each" && s.count === 1 && !/\d/.test(prod.size || "") && (cat.typicalPack || 1) > 1 && (cat.eachWeight || 999) < 40) return cat.typicalPack;
  if (s.unit === ing.unit) return s.qty;
  if (ing.unit === "each" && s.unit === "g") return Math.max(1, Math.round(s.qty / each));
  if (ing.unit === "g" && s.unit === "each") return s.qty * (cat.eachWeight || (s.count === 1 && cat.typicalPack > 150 ? cat.typicalPack : each));
  if (ing.unit === "g" && s.unit === "ml") return s.qty;                         // close enough for sauces, yoghurt
  if (ing.unit === "ml" && s.unit === "g") return s.qty;
  return null;
}

const STOP = new Set(["of", "and", "the", "fresh", "british", "tin", "tinned", "can", "pack", "jar", "x", "g", "kg", "ml", "large", "small", "medium"]);
const words = s => String(s).toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
// Things a search drags in that are never the raw ingredient
const JUNK = /\b(crisps?|flavou?r(ed)?|dog|cat|baby|toddler|kids?\b|sweets?|ready meal|meal kit|sandwich|wrap(s)? filled|seasoning mix|pot noodle|smoothie)\b/i;

// Product types that mean "this is a different thing" unless the ingredient itself is one of them:
// "sesame seeds" must not match sesame seed buns, "chicken breast" must not match chicken soup.
const KINDS = ["bun", "buns", "bread", "loaf", "wrap", "wraps", "crisps", "bar", "bars", "biscuit", "biscuits", "cake", "cakes", "cookies",
  "sauce", "soup", "pie", "pies", "pizza", "sandwich", "kit", "dip", "crackers", "cereal", "oil", "paste", "stock", "gravy", "drink", "juice",
  "yoghurt", "yogurt", "cheese", "milk", "ice", "cream", "dressing", "mayonnaise", "seasoning", "marinade", "spread", "butter", "jam",
  "pudding", "dessert", "noodles", "pasta", "rice", "burger", "burgers", "sausages", "nuggets", "goujons", "kiev", "meal", "pot", "pots",
  "microwave", "microwaveable", "pouch", "instant", "tea", "coffee", "smoothie", "shot", "chocolate", "flavoured", "vinegar", "uht",
  "farfalle", "penne", "fusilli", "spaghetti", "tagliatelle", "linguine", "lasagne", "ravioli", "tortellini", "gnocchi", "macaroni", "risotto"];
// Describing words: nice to match, but the food word itself (beef, onions, rice, bagels) must be there
const MODIFIERS = new Set(["baby", "free", "range", "red", "brown", "white", "green", "yellow", "plain", "smoked", "roasted", "unsalted",
  "salted", "mature", "extra", "toasted", "flat", "long", "grain", "natural", "greek", "style", "whole", "boneless", "skinless", "raw",
  "cooked", "chopped", "dried", "ground", "light", "dark", "sweet", "hot", "mild", "stir", "fry", "strips", "fillets", "fillet", "diced",
  "sliced", "grated", "organic", "frozen", "chilled", "lean", "thick", "thin", "cut", "pieces", "chunks", "in", "juice", "water", "tin",
  "rolled", "fine", "coarse", "garden", "bunched", "loose", "pack", "mini", "king", "jumbo", "medium", "streaky", "back", "unsmoked",
  "skimmed", "semi", "full", "fat", "reduced", "low", "british", "italian", "english", "classic", "original", "fresh"]);
// free-from lines cost more and only make sense when someone needs them
const FREEFROM = /\b(gluten[ -]free|dairy[ -]free|free from|lactose[ -]free|wheat[ -]free)\b/i;
const wordIn = (w, text) => new RegExp(`\\b${w.replace(/(es|s)$/, "")}(s|es)?\\b`).test(text);

function relevant(prod, ing, cat, p = {}) {
  const n = prod.name.toLowerCase(), about = `${cat.name} ${cat.search || ""}`.toLowerCase();
  // With hand-written rules, singular "sweet"/"crisp" are adjectives ("sweet pickle", "crisp & crunchy little gem"), not sweets/crisps
  const junkName = cat.match ? n.replace(/\b(sweet|crisp)\b/g, "") : n;
  if (JUNK.test(junkName) && !JUNK.test(about)) return 0;
  const needFree = (p.mustBe || []).some(m => (m === "gluten-free" && (cat.allergens || []).includes("gluten")) || (m === "dairy-free" && (cat.allergens || []).includes("dairy")));
  if (cat.match) {
    // Hand-written rules in the catalogue: every "all" regex, at least one "any", no "none" must match the product name.
    const cache = relevant.re || (relevant.re = new WeakMap());
    let m = cache.get(cat.match);
    if (!m) cache.set(cat.match, m = Object.fromEntries(["all", "any", "none"].map(k => [k, (cat.match[k] || []).map(r => new RegExp(r, "i"))])));
    if (!m.all.every(r => r.test(n)) || (m.any.length && !m.any.some(r => r.test(n))) || m.none.some(r => r.test(n))) return 0;
    // free-from lines cost more: only picked when nothing ordinary matches (some shops' only bagels are gluten-free)
    if (FREEFROM.test(n) && !FREEFROM.test(about) && !needFree) return .5;
    if (needFree && !FREEFROM.test(n) && !/\b(gf|free)\b/.test(n)) return .4;        // shown only if nothing free-from exists
    return 1;
  }
  for (const k of KINDS) if (wordIn(k, n) && !wordIn(k, about)) return 0;
  if (FREEFROM.test(n) && !FREEFROM.test(about) && !needFree) return 0;
  if (needFree && !FREEFROM.test(n) && !/\b(gf|free)\b/.test(n)) return .4;          // shown only if nothing free-from exists
  if (cat.aisle === "frozen" && /\b(in water|tinned|tin|can)\b/.test(n)) return 0;
  const key = words(cat.name);
  if (!key.length) return 1;
  if (key.filter(w => !MODIFIERS.has(w)).some(w => !wordIn(w, n))) return 0;   // the food itself is missing
  if (key.includes("semi") && !/semi/.test(n)) return 0;                       // semi-skimmed isn't skimmed
  const hits = key.filter(w => wordIn(w, n)).length;
  return Math.max(.5, hits / key.length);
}

// Quality of a product for this ingredient: tier, welfare and provenance words, and whether a named
// brand is a genuine step up for this kind of ingredient (soy sauce, curry paste) or not (rice, tins).
const TIER_Q = { value: 1, own: 2, premium: 3, brand: 2.4 };
function quality(prod, cat) {
  let q = TIER_Q[prod.tier] ?? 2;
  if (prod.tier === "brand" && cat.brandMatters) q += .5;
  if (prod.tier === "brand" && !cat.brandMatters) q -= .3;
  const n = prod.name.toLowerCase();
  if (["meat", "fish", "eggs"].includes(cat.aisle)) {
    if (/free range|higher welfare|rspca|outdoor bred|organic|msc|responsibly sourced/.test(n)) q += .6;
    if (prod.tier === "value") q -= .4;                                          // welfare and water content
  }
  if (/organic/.test(n)) q += .2;
  return Math.max(.5, Math.min(4, q));
}

// The shopping styles. Each one scores a candidate line (cost in £, quality 0.5–4); lowest wins.
const STYLES = {
  value:    { label: "Cheapest",            score: (c, q) => c * (1 + .02 * (4 - q)) },
  balanced: { label: "Best balance",        score: (c, q) => c / Math.pow(q, .9) },
  premium:  { label: "Premium own-label",   score: (c, q, p) => c * (p.tier === "premium" ? .6 : p.tier === "own" ? 1 : 1.25) / Math.pow(q, .4) },
  brands:   { label: "Named brands",        score: (c, q, p) => c * (p.tier === "brand" ? .55 : 1) / Math.pow(q, .4) },
  auto:     { label: "Forkcast decides",    score: (c, q) => c / Math.pow(q, 1.15) },
};

// Choose the product and pack count for one list line from a retailer's search results.
function chooseLine(line, results, cat, p) {
  const style = STYLES[p.style] || STYLES.auto, loyal = !!p.loyalty;
  const cands = [];
  for (const prod of results || []) {
    if (prod.inStock === false || !(prod.price > 0)) continue;
    const rel = relevant(prod, line, cat, p); if (rel < .5) continue;
    const sz = parseSize(prod.size, prod.name, line.unit);
    // the shop sells it but doesn't say how big: one pack (the smallest sensible) covers the recipes
    const y = packYield(prod, line, cat) || Math.max(line.qty, cat.typicalPack || 0);
    const price = loyal && prod.loyaltyPrice > 0 ? prod.loyaltyPrice : prod.price;
    let packs, cost;
    if (sz && sz.perKg && line.unit === "g") { packs = 1; cost = price * Math.max(line.qty, 100) / 1000; }   // loose: weighed out
    else { packs = Math.max(1, Math.ceil(line.qty / y - .08)); cost = packs * price; }                     // 8% grace: 410 g from a 400 g pack is fine
    const q = quality(prod, cat);
    // leftover fresh food is money in the bin; leftover rice isn't
    const spare = sz && sz.perKg ? 0 : Math.max(0, packs * y - line.qty) / (packs * y);
    const waste = cat.perishable ? cost * spare * .5 : cost * spare * .05;
    cands.push({ prod, packs, price, cost, q, rel, waste, s: style.score(cost + waste, q, prod) * (rel < 1 ? 1.6 : 1) });   // a weaker match only wins when nothing better exists
  }
  cands.sort((a, b) => a.s - b.s);
  return { best: cands[0] || null, alts: cands.slice(1, 6) };
}

// Price the whole list at one retailer. results: { [item]: searchResults }
// more(item): search results for an ingredient that isn't on the list (used for substitutes)
function basket(list, results, ingredients, p, more = () => null) {
  const lines = [];
  let total = 0, qsum = 0, n = 0, missing = 0, waste = 0;
  for (const l of list) {
    if (l.skip) continue;
    const cat = ingredients[l.item] || { name: l.name, aisle: l.aisle };
    let { best, alts } = chooseLine(l, results[l.item], cat, p), sub = null;
    // not stocked: what a shopper would do, take the nearest substitute this shop does sell
    if (!best) for (const k of cat.substitutes || []) {
      const sc = ingredients[k]; if (!sc || sc.unit !== l.unit) continue;
      if ((sc.animal || "") !== (cat.animal || "") || (cat.vegan && !sc.vegan) || (cat.vegetarian && !sc.vegetarian)) continue;   // never swap meat for veg or the like
      if (["meat", "fish"].includes(cat.animal) && k.split("-")[0] !== l.item.split("-")[0]) continue;                           // beef stays beef, cod stays cod
      const r = chooseLine({ ...l, item: k }, results[k] || more(k), sc, p);
      if (r.best) { ({ best, alts } = r); sub = sc.name; break; }
    }
    if (!best) { missing++; lines.push({ item: l.item, name: l.name, qty: l.qty, unit: l.unit, missing: true }); continue; }
    total += best.cost; qsum += best.q; n++; waste += best.waste;
    lines.push({ item: l.item, name: l.name, qty: l.qty, unit: l.unit, sub, packs: best.packs, cost: +best.cost.toFixed(2), q: +best.q.toFixed(2),
      product: pickFields(best.prod, best.price), alts: alts.map(a => ({ packs: a.packs, cost: +a.cost.toFixed(2), q: +a.q.toFixed(2), product: pickFields(a.prod, a.price) })) });
  }
  return { total: +total.toFixed(2), quality: n ? +(qsum / n).toFixed(2) : 0, matched: n, missing, waste: +waste.toFixed(2), lines };
}
const pickFields = (x, price) => ({ id: x.id, name: x.name, size: x.size, price: +(+price).toFixed(2), shelf: +x.price, tier: x.tier, promo: x.promo || "", url: x.url, image: x.image, unitPrice: x.unitPrice, unitLabel: x.unitLabel });

// Nutrition for the week, per person per day, from the recipes (dinners + lunches chosen).
function nutrition(planObj, recipes, p = {}) {
  const byId = Object.fromEntries(recipes.map(r => [r.id, r])), t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, salt_g: 0 };
  let meals = 0;
  // and each day on its own, with the target for the meals planned that day (dinner only: 40% of the day)
  const days = planObj.days.map(d => {
    const day = { day: d.day, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, share: 0 };
    for (const slot of MEALS) {
      const r = byId[d[slot]]; if (!r) continue; meals++;
      const f = d.portion?.[slot] || 1;
      for (const k in t) t[k] += (r[k] || 0) * f;
      for (const k of MACROS) day[k] += (r[k] || 0) * f;
      day.share += SHARE[slot];
    }
    for (const k of MACROS) day[k] = Math.round(day[k]);
    day.share = Math.round(day.share * 100) / 100;
    if (hasTargets(p)) day.target = Object.fromEntries(MACROS.filter(k => +p.targets[k] > 0).map(k => [k, Math.round(p.targets[k] * day.share)]));
    return day;
  });
  return { perDay: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v / 7)])), meals, days };   // perDay: averaged over the whole week
}

const API = { PRESETS, MEALS, slots, fit, plan, list, parseSize, packYield, chooseLine, basket, nutrition, restock, setPortions, portion, SHARE, STYLES, DAYS, people };
if (typeof module !== "undefined" && module.exports) module.exports = API; else window.E = API;
})();
