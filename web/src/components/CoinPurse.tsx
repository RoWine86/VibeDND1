// ─── Кошелёк: четыре монеты (мм/см/зм/пм) ───────────────────────────────────
// Переиспользуемый блок: лист персонажа, телефон игрока, консоль мастера.
// editable — правка своих монет игроком (через onPatch → characterPatch).

import type { Character, Coins, Currency } from '@vibednd/shared';

export const COIN_META: Record<Currency, { short: string; color: string }> = {
  cp: { short: 'мм', color: '#b87333' },  // медь
  sp: { short: 'см', color: '#c0c0c8' },  // серебро
  gp: { short: 'зм', color: '#f0c948' },  // золото
  pp: { short: 'пм', color: '#9fd8e8' },  // платина
};

const ORDER: Currency[] = ['cp', 'sp', 'gp', 'pp'];

export default function CoinPurse({
  coins, editable = false, onChange,
}: {
  coins: Coins | undefined;
  editable?: boolean;
  onChange?: (coins: Coins) => void;
}) {
  const c: Coins = coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 };
  const setCoin = (cur: Currency, value: number) => {
    onChange?.({ ...c, [cur]: Math.max(0, Math.round(value)) });
  };
  return (
    <div className="coin-purse">
      {ORDER.map((cur) => (
        <div className="coin-cell" key={cur}>
          <span className="coin-icon" style={{ background: COIN_META[cur].color }} />
          {editable ? (
            <input
              type="number"
              min={0}
              value={c[cur]}
              onChange={(e) => setCoin(cur, Number(e.target.value) || 0)}
              aria-label={COIN_META[cur].short}
            />
          ) : (
            <span className="coin-amount">{c[cur]}</span>
          )}
          <span className="coin-label">{COIN_META[cur].short}</span>
        </div>
      ))}
    </div>
  );
}

/** Кошелёк персонажа в одну строку (для кратких сводок). */
export function coinSummary(ch: Pick<Character, 'coins'>): string {
  const c = ch.coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 };
  const parts = ORDER.filter((cur) => c[cur] > 0).map((cur) => `${c[cur]} ${COIN_META[cur].short}`);
  return parts.length > 0 ? parts.join(' · ') : 'пусто';
}
