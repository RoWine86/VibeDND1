// ─── Сценарий-проверка веса и перегруза (ROADMAP, шаг 7) ────────────────────
// Запуск: node server/scripts/encumbrance-check.mjs (после npm run build -w shared).
// Ступени: ≤Сила×5 полная скорость, ≤Сила×10 −10 фт, ≤Сила×15 вдвое, >Сила×15 — 0.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  carryingCapacity, encumbranceTier, inventoryWeight, effectiveSpeed,
} from '@vibednd/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const items = new Map(
  JSON.parse(readFileSync(path.join(__dirname, '../data/seed/items.json'), 'utf8')).map((i) => [i.id, i]),
);

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// персонаж с Силой 10 (норма 50, нагружен 100, сильно 150)
const ch = (inv, str = 10) => ({
  inventory: inv,
  abilityScores: { str, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  backgroundBonuses: {},
});

console.log('1. carryingCapacity');
{
  check('Сила 10 → 50 фн', carryingCapacity(ch([])) === 50);
  check('Сила 16 → 80 фн', carryingCapacity(ch([], 16)) === 80);
  check('бонус предыстории +2 к Силе учитывается',
    carryingCapacity({ ...ch([]), backgroundBonuses: { str: 2 } }) === 60);
}

console.log('2. inventoryWeight (weight × quantity, монеты не весят)');
{
  check('longsword(3) + 2×dagger(1) = 5',
    inventoryWeight(ch([{ itemId: 'longsword', quantity: 1 }, { itemId: 'dagger', quantity: 2 }]), items) === 5);
  check('chain-mail(55) = 55', inventoryWeight(ch([{ itemId: 'chain-mail', quantity: 1 }]), items) === 55);
  check('пустой инвентарь = 0', inventoryWeight(ch([]), items) === 0);
  check('предмет без weight не падает', inventoryWeight(ch([{ itemId: 'нет-такого', quantity: 5 }]), items) === 0);
}

console.log('3. ступени перегруза (Сила 10: 50/100/150)');
{
  check('50 фн → normal', encumbranceTier(50, ch([])) === 'normal');
  check('51 фн → encumbered', encumbranceTier(51, ch([])) === 'encumbered');
  check('100 фн → encumbered', encumbranceTier(100, ch([])) === 'encumbered');
  check('101 фн → heavily', encumbranceTier(101, ch([])) === 'heavily');
  check('150 фн → heavily', encumbranceTier(150, ch([])) === 'heavily');
  check('151 фн → overloaded', encumbranceTier(151, ch([])) === 'overloaded');
}

console.log('4. скорость по ступеням (база 30)');
{
  check('normal → 30', effectiveSpeed(30, 'normal') === 30);
  check('encumbered → 20', effectiveSpeed(30, 'encumbered') === 20);
  check('heavily → 15', effectiveSpeed(30, 'heavily') === 15);
  check('overloaded → 0', effectiveSpeed(30, 'overloaded') === 0);
  check('нечётная база: heavily 25 → 12 (вниз)', effectiveSpeed(25, 'heavily') === 12);
  check('медленный вид: encumbered 20 → 10', effectiveSpeed(20, 'encumbered') === 10);
  check('encumbered минимум 5 фт', effectiveSpeed(10, 'encumbered') === 5);
}

console.log('5. seed: у всех 106 предметов есть weight');
{
  const all = [...items.values()];
  check('weight у всех', all.every((i) => typeof i.weight === 'number'),
    `нет у: ${all.filter((i) => typeof i.weight !== 'number').map((i) => i.id).join(',')}`);
  check('кольца/амулеты/жемчужина невесомы',
    items.get('ring-of-protection').weight === 0 && items.get('amulet-of-health').weight === 0
    && items.get('pearl-of-power').weight === 0 && items.get('ioun-stone-awareness').weight === 0);
  check('Доспех +1 = 40 (полудоспех)', items.get('armor-plus-1').weight === 40);
}

console.log(`\nИтого: ${passed} пройдено, ${failed} провалено`);
process.exit(failed > 0 ? 1 : 0);
