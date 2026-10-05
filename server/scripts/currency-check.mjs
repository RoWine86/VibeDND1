// ─── Сценарий-проверка валюты (ROADMAP, шаг 6) ──────────────────────────────
// Запуск: node server/scripts/currency-check.mjs (после npm run build -w shared).
// Проверяет конверсию, canAfford, pay с автоматическим разменом, addCoins,
// earn, parseCost и rollStartingGold.

import {
  canAfford, pay, addCoins, earn, coinsToCp, costToCp, parseCost,
  costText, rollStartingGold, sequenceRng,
} from '@vibednd/shared';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const z = { cp: 0, sp: 0, gp: 0, pp: 0 };

console.log('1. конверсия');
{
  check('1 пм = 1000 мм', coinsToCp({ ...z, pp: 1 }) === 1000);
  check('1 зм = 100 мм', coinsToCp({ ...z, gp: 1 }) === 100);
  check('1 см = 10 мм', coinsToCp({ ...z, sp: 1 }) === 10);
  check('микс: 2пм+3зм+4см+5мм = 2345 мм',
    coinsToCp({ cp: 5, sp: 4, gp: 3, pp: 2 }) === 2345);
  check('costToCp 15 зм = 1500', costToCp({ amount: 15, currency: 'gp' }) === 1500);
}

console.log('2. canAfford');
{
  check('2 пм хватает на 15 зм', canAfford({ ...z, pp: 2 }, { amount: 15, currency: 'gp' }));
  check('14 зм не хватает на 15 зм', !canAfford({ ...z, gp: 14 }, { amount: 15, currency: 'gp' }));
  check('ровно хватает', canAfford({ ...z, gp: 15 }, { amount: 15, currency: 'gp' }));
  check('мм на пм: 1000 мм хватает на 1 пм', canAfford({ ...z, cp: 1000 }, { amount: 1, currency: 'pp' }));
}

console.log('3. pay с авторазменом');
{
  // канонический пример ROADMAP: 15 зм из «2 пм» → размен и сдача
  const r = pay({ ...z, pp: 2 }, { amount: 15, currency: 'gp' });
  check('15 зм из 2 пм — успех', r.ok);
  check('итог в меди: 2000-1500 = 500 мм', coinsToCp(r.coins) === 500, `got ${coinsToCp(r.coins)}`);
  check('сдача разменяна (без платины)', r.coins.pp === 0, JSON.stringify(r.coins));
  check('сдача 5 зм или мельче', r.coins.gp === 5, JSON.stringify(r.coins));

  // точная мелочь без размена
  const r2 = pay({ ...z, gp: 10, cp: 5 }, { amount: 7, currency: 'gp' });
  check('7 зм из 10 зм + 5 мм — без размена', r2.ok && r2.coins.gp === 3 && r2.coins.cp === 5);

  // размен серебряной монеты: 15 мм из «2 см» → обе см пущены в размен, сдача 5 мм
  const r3 = pay({ ...z, sp: 2 }, { amount: 15, currency: 'cp' });
  check('15 мм из 2 см: успех с разменом', r3.ok);
  check('осталось 5 мм', coinsToCp(r3.coins) === 5 && r3.coins.cp === 5, JSON.stringify(r3.coins));

  // нехватка даже с разменом: 1 пм + 2 зм = 12 зм < 15 зм
  const r4 = pay({ ...z, pp: 1, gp: 2 }, { amount: 15, currency: 'gp' });
  check('12 зм на 15 зм — отказ даже с платиной', !r4.ok);
}

console.log('3b. pay — отказ при нехватке');
{
  const r = pay({ ...z, gp: 12 }, { amount: 15, currency: 'gp' });
  check('12 зм на 15 зм — отказ', !r.ok && r.reason === 'Недостаточно денег');
  check('кошелёк не изменился', r.coins.gp === 12);
}

console.log('4. addCoins / earn');
{
  const a = addCoins({ ...z, gp: 5 }, { gp: 3, cp: 10 });
  check('addCoins 5зм+3зм+10мм', a.gp === 8 && a.cp === 10);
  const neg = addCoins({ ...z, gp: 2 }, { gp: -5 });
  check('addCoins не уходит в минус', neg.gp === 0);
  const e = earn({ ...z, gp: 5 }, { amount: 1, currency: 'pp' });
  // earn раскладывает итог по крупнейшим номиналам: 1500 мм → 1 пм + 5 зм
  check('earn 5зм + 1пм = 1500 мм (1 пм + 5 зм)',
    coinsToCp(e) === 1500 && e.pp === 1 && e.gp === 5, JSON.stringify(e));
}

console.log('5. parseCost / costText (миграция строк)');
{
  check('"15 зм"', JSON.stringify(parseCost('15 зм')) === '{"amount":15,"currency":"gp"}');
  check('"1 мм"', parseCost('1 мм')?.currency === 'cp');
  check('"2 см"', parseCost('2 см')?.currency === 'sp');
  check('"3 пм"', parseCost('3 пм')?.currency === 'pp');
  check('"—" → undefined', parseCost('—') === undefined);
  check('undefined → undefined', parseCost(undefined) === undefined);
  check('costText', costText({ amount: 15, currency: 'gp' }) === '15 зм');
  check('costText undefined', costText(undefined) === '—');
}

console.log('6. rollStartingGold');
{
  // воин-like 5d4 × 10, все кости = 4 (rng 0.999 → ceil(0.999*4)=4)
  const g = rollStartingGold({ startingGold: { dice: '5d4', multiply: 10 } }, sequenceRng([0.999, 0.999, 0.999, 0.999, 0.999]));
  check('5d4×10 максимум = 200', g === 200, `got ${g}`);
  // минимум: rng 0 → rollDie=1
  const g2 = rollStartingGold({ startingGold: { dice: '5d4', multiply: 10 } }, sequenceRng([0, 0, 0, 0, 0]));
  check('5d4×10 минимум = 50', g2 === 50, `got ${g2}`);
  // без startingGold → 0
  check('без startingGold → 0', rollStartingGold({}) === 0);
  // 2d4×10: rng 0.5 → каждая кость 1+floor(0.5*4)=3 → (3+3)×10 = 60
  const g3 = rollStartingGold({ startingGold: { dice: '2d4', multiply: 10 } }, sequenceRng([0.5, 0.5]));
  check('2d4×10 = 60 (3+3)', g3 === 60, `got ${g3}`);
}

console.log(`\nИтого: ${passed} пройдено, ${failed} провалено`);
process.exit(failed > 0 ? 1 : 0);
