// ─── Доска (/board/:sessionId): чистый экран для ТВ/проектора ──────────────
// Карта во весь экран (mode="board"), сверху трекер инициативы, снизу лента
// последних 5 бросков (скрытые броски мастера сюда не доходят). Без боя —
// QR-код подключения игроков и список подключённых персонажей.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Dices, QrCode, Users } from 'lucide-react';
import type { Adventure } from '@vibednd/shared';
import { SessionProvider, useSessionStore } from '../sessionStore';
import { api } from '../api';
import MapCanvas from '../components/MapCanvas';
import '../styles/map.css';

// ─── QR-код на canvas (автономная реализация, без библиотек) ───────────────
// Поддерживаются версии 1–10, byte mode, маска 0. Блоки ECC (версии 4–10)
// чередуются по стандарту; 271 байт (v10-L) хватает с запасом на URL вида
// http://192.168.x.x:5173/player/<uuid>.

type EcLevel = 0 | 1 | 2 | 3; // L M Q H

// Биты формата для уровней ECC (ISO/IEC 18004, таблица C.2): L=001, M=000,
// Q=011, H=010. Без этой подмены сканер не читает формат-строку и бракует код.
const FORMAT_ECL_BITS: Record<EcLevel, number> = { 0: 1, 1: 0, 2: 3, 3: 2 };

// Число кодов ECC на блок и группы блоков [кол-во блоков, байт данных в блоке]
// для версий 1–10 (ISO/IEC 18004, таблица 9). Сверено с RS_BLOCK_TABLE
// библиотеки python-qrcode (qrcode/base.py): все 40 строк совпадают по
// данным, ECC на блок и разбиению на группы.
const ECC_TABLE: Record<EcLevel, { ec: number; g1: [number, number]; g2: [number, number] }[]> = {
  0: [ // L
    { ec: 7, g1: [1, 19], g2: [0, 0] }, { ec: 10, g1: [1, 34], g2: [0, 0] },
    { ec: 15, g1: [1, 55], g2: [0, 0] }, { ec: 20, g1: [1, 80], g2: [0, 0] },
    { ec: 26, g1: [1, 108], g2: [0, 0] }, { ec: 18, g1: [2, 68], g2: [0, 0] },
    { ec: 20, g1: [2, 78], g2: [0, 0] }, { ec: 24, g1: [2, 97], g2: [0, 0] },
    { ec: 30, g1: [2, 116], g2: [0, 0] }, { ec: 18, g1: [2, 68], g2: [2, 69] },
  ],
  1: [ // M
    { ec: 10, g1: [1, 16], g2: [0, 0] }, { ec: 16, g1: [1, 28], g2: [0, 0] },
    { ec: 26, g1: [1, 44], g2: [0, 0] }, { ec: 18, g1: [2, 32], g2: [0, 0] },
    { ec: 24, g1: [2, 43], g2: [0, 0] }, { ec: 16, g1: [4, 27], g2: [0, 0] },
    { ec: 18, g1: [4, 31], g2: [0, 0] }, { ec: 22, g1: [2, 38], g2: [2, 39] },
    { ec: 22, g1: [3, 36], g2: [2, 37] }, { ec: 26, g1: [4, 43], g2: [1, 44] },
  ],
  2: [ // Q
    { ec: 13, g1: [1, 13], g2: [0, 0] }, { ec: 22, g1: [1, 22], g2: [0, 0] },
    { ec: 18, g1: [2, 17], g2: [0, 0] }, { ec: 26, g1: [2, 24], g2: [0, 0] },
    { ec: 18, g1: [2, 15], g2: [2, 16] }, { ec: 24, g1: [4, 19], g2: [0, 0] },
    { ec: 18, g1: [2, 14], g2: [4, 15] }, { ec: 22, g1: [4, 18], g2: [2, 19] },
    { ec: 20, g1: [4, 16], g2: [4, 17] }, { ec: 24, g1: [6, 15], g2: [2, 16] },
  ],
  3: [ // H
    { ec: 17, g1: [1, 9], g2: [0, 0] }, { ec: 28, g1: [1, 16], g2: [0, 0] },
    { ec: 22, g1: [2, 13], g2: [0, 0] }, { ec: 16, g1: [4, 9], g2: [0, 0] },
    { ec: 22, g1: [2, 11], g2: [2, 12] }, { ec: 28, g1: [4, 15], g2: [0, 0] },
    { ec: 26, g1: [4, 13], g2: [1, 14] }, { ec: 26, g1: [4, 14], g2: [2, 15] },
    { ec: 24, g1: [4, 12], g2: [4, 13] }, { ec: 28, g1: [6, 15], g2: [2, 16] },
  ],
};

// Центры паттернов выравнивания для версий 2–6 (ISO/IEC 18004, таблица E.1).
// Для 7+ центры выводятся формулой ниже.
const ALIGN_COORDS: Record<number, number[]> = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
};

interface QrCode {
  size: number;
  modules: Uint8Array;
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    if (((y >>> i) & 1) !== 0) z ^= x;
  }
  return z;
}

function qrGenerator(degree: number): Uint8Array {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < degree) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  return result;
}

function qrRemainder(data: Uint8Array, gen: Uint8Array): Uint8Array {
  const result: number[] = new Array<number>(gen.length).fill(0);
  data.forEach((b) => {
    const factor = b ^ result.shift()!;
    result.push(0);
    gen.forEach((g, i) => {
      result[i]! ^= gfMul(g, factor);
    });
  });
  return Uint8Array.from(result);
}

function toUtf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >>> 18),
        0x80 | ((cp >>> 12) & 0x3f),
        0x80 | ((cp >>> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

function qrCompute(text: string, ecl: EcLevel, version: number): QrCode {
  const bytes = toUtf8Bytes(text);
  const cfg = ECC_TABLE[ecl][version - 1]!;
  const dataCapacity = cfg.g1[0] * cfg.g1[1] + cfg.g2[0] * cfg.g2[1];
  const lenBits = version >= 10 ? 16 : 8; // счётчик в byte mode: 8 бит (v1–9), 16 бит (v10+)
  if (bytes.length > dataCapacity || bytes.length >= 1 << lenBits) {
    throw new Error('Строка слишком длинная для этой версии QR');
  }

  // поток бит: режим 0100, счётчик, данные, терминатор, выравнивание, заполнители
  const bits: number[] = [];
  const pushBits = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, lenBits);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, dataCapacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const pads = [0xec, 0x11];
  for (let i = 0; bits.length < dataCapacity * 8; i++) pushBits(pads[i & 1]!, 8);

  const dataBytes = Uint8Array.from(
    Array.from({ length: dataCapacity }, (_, i) =>
      bits.slice(i * 8, i * 8 + 8).reduce((acc, b) => (acc << 1) | b, 0)),
  );

  // разбивка на блоки и ECC
  const gen = qrGenerator(cfg.ec);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let off = 0;
  for (const [count, size] of [cfg.g1, cfg.g2]) {
    for (let i = 0; i < count; i++) {
      const block = dataBytes.slice(off, off + size);
      off += size;
      dataBlocks.push(block);
      ecBlocks.push(qrRemainder(block, gen));
    }
  }
  // чередование: сначала данные по байту из каждого блока, затем ECC
  const codewords: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of dataBlocks) if (i < b.length) codewords.push(b[i]!);
  }
  for (let i = 0; i < cfg.ec; i++) {
    for (const b of ecBlocks) codewords.push(b[i]!);
  }

  const size = 17 + version * 4;
  const modules = new Uint8Array(size * size).fill(2); // 2 = ещё не задано
  const isFunc = new Uint8Array(size * size);
  const set = (x: number, y: number, dark: boolean, func: boolean) => {
    modules[y * size + x] = dark ? 1 : 0;
    if (func) isFunc[y * size + x] = 1;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4, true);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // паттерны выравнивания (версии 2+): центры из таблицы или формулы
  if (version >= 2) {
    let coords: number[];
    if (ALIGN_COORDS[version]) {
      coords = ALIGN_COORDS[version]!;
    } else {
      const numAlign = Math.floor(version / 7) + 2;
      const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
      coords = [6];
      for (let i = numAlign - 1; i >= 1; i--) coords.push(size - 7 - (i - 1) * step);
    }
    for (const cy of coords) {
      for (const cx of coords) {
        // пропускаем углы, занятые паттернами поиска
        if (isFunc[cy * size + cx]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, true);
          }
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0, true);
    set(6, i, i % 2 === 0, true);
  }
  set(8, size - 8, true, true); // тёмный модуль
  // зарезервировать области формата
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false, true);
      set(i, 8, false, true);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false, true);
    set(8, size - 1 - i, false, true);
  }
  // зарезервировать области версии (версии 7+): те же координаты, что и при
  // записи значения ниже, иначе данные затирают версию и оставляют дыры в коде
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = Math.floor(i / 3);
      const b = i % 3;
      set(size - 11 + b, a, false, true);
      set(a, size - 11 + b, false, true);
    }
  }
  // данные зигзагом справа налево
  let bit = 0;
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x = 5;
    for (let i = 0; i < size; i++) {
      const y = upward ? size - 1 - i : i;
      for (const xx of [x, x - 1]) {
        const idx = y * size + xx;
        if (isFunc[idx]) continue;
        const byteIdx = bit >>> 3;
        const bitVal = byteIdx < codewords.length ? (codewords[byteIdx]! >>> (7 - (bit & 7))) & 1 : 0;
        modules[idx] = bitVal;
        bit++;
      }
    }
    upward = !upward;
  }
  // маска 0: (x + y) % 2 === 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!isFunc[idx] && (x + y) % 2 === 0) modules[idx]! ^= 1;
    }
  }
  // формат: ecl + маска 0, БЧХ(15,5)
  const fmtData = (FORMAT_ECL_BITS[ecl] << 3) | 0;
  let rem = fmtData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const fmt = (((fmtData << 10) | rem) ^ 0x5412) & 0x7fff;
  const fmtBit = (i: number) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, fmtBit(i), true);
  set(8, 7, fmtBit(6), true);
  set(8, 8, fmtBit(7), true);
  set(7, 8, fmtBit(8), true);
  for (let i = 9; i < 15; i++) set(14 - i, 8, fmtBit(i), true);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fmtBit(i), true);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, fmtBit(i), true);
  set(8, size - 8, true, true);
  // информация о версии (версии 7+): БЧХ(18,6). Бит i → (строка i/3, столбец i%3)
  // в блоке у правого нижнего угла и его транспонированная копия (Nayuki,
  // addVersionInformation): при записи по столбцам сканер не читает версию.
  if (version >= 7) {
    let vrem = version;
    for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
    const vbits = (version << 12) | vrem;
    for (let i = 0; i < 18; i++) {
      const dark = ((vbits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      set(size - 11 + b, a, dark, true);
      set(a, size - 11 + b, dark, true);
    }
  }
  return { size, modules };
}

function qrForUrl(url: string): QrCode {
  let lastErr: unknown = null;
  for (const ecl of [3, 2, 1, 0] as EcLevel[]) {
    for (let version = 1; version <= 10; version++) {
      try {
        return qrCompute(url, ecl, version);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

function QrCanvas({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    setFailed(false);
    try {
      const qr = qrForUrl(url);
      // Чем больше версия, тем меньше модуль: целимся в ~300px по ширине
      const scalePx = Math.max(2, Math.floor(300 / qr.size));
      const border = 4;
      canvas.width = (qr.size + border * 2) * scalePx;
      canvas.height = canvas.width;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
          if (qr.modules[y * qr.size + x] === 1) {
            ctx.fillRect((x + border) * scalePx, (y + border) * scalePx, scalePx, scalePx);
          }
        }
      }
    } catch {
      // слишком длинный URL — покажем текстовую ссылку вместо пустого холста
      setFailed(true);
    }
  }, [url]);
  if (failed) {
    return <p className="board-lobby-dim">QR не сформирован (ссылка слишком длинная) — используйте текстовую ссылку ниже.</p>;
  }
  return <canvas ref={ref} className="board-qr" />;
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function BoardPage() {
  const { sessionId = '' } = useParams();
  return (
    <SessionProvider role="board" sessionId={sessionId}>
      <BoardContent sessionId={sessionId} />
    </SessionProvider>
  );
}

function BoardContent({ sessionId }: { sessionId: string }) {
  const { session, characters, error } = useSessionStore();
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [joinUrl, setJoinUrl] = useState('');
  // Доска реагирует только на «Сессия не найдена» — прочие ошибки сервера
  // на чистом экране не показываются (прежнее поведение).
  const fatal = error === 'Сессия не найдена' ? error : '';

  // данные приключения (карты) и ссылка входа
  useEffect(() => {
    if (!session?.adventureId) return;
    api
      .get<Adventure>(`/adventures/${session.adventureId}`)
      .then(setAdventure)
      .catch(() => setAdventure(null));
  }, [session?.adventureId]);

  useEffect(() => {
    if (!sessionId) return;
    api
      .get<{ url: string }>(`/sessions/${sessionId}/join-info`)
      .then((info) => setJoinUrl(info.url))
      .catch(() => setJoinUrl(''));
  }, [sessionId]);

  const map = useMemo(
    () => adventure?.maps.find((m) => m.id === session?.activeMapId) ?? adventure?.maps[0],
    [adventure, session?.activeMapId],
  );

  const visibleTokens = useMemo(
    () => (session?.tokens ?? []).filter((t) => !t.hidden && t.mapId === map?.id),
    [session?.tokens, map?.id],
  );
  const fogReveals = useMemo(
    () => (session?.fogReveals ?? []).filter((r) => r.mapId === map?.id),
    [session?.fogReveals, map?.id],
  );
  const drawings = useMemo(
    () => (session?.drawings ?? []).filter((d) => d.mapId === map?.id),
    [session?.drawings, map?.id],
  );

  if (fatal) {
    return (
      <div className="board-root board-empty">
        <h1>Доска</h1>
        <p>{fatal}</p>
      </div>
    );
  }

  const combat = session?.combat;
  const lastRolls = (session?.diceLog ?? []).filter((e) => !e.hidden).slice(-5);
  const showLobby = !combat?.active;

  return (
    <div className="board-root">
      {/* Трекер инициативы */}
      {combat?.active && (
        <div className="board-initiative anim-fade-in">
          <div className="board-round">Раунд {combat.round}</div>
          <div className="board-init-list">
            {combat.entries.map((e, i) => (
              <div
                key={e.id}
                className={`board-init-entry kind-${e.kind}${i === combat.currentIndex ? ' current' : ''}`}
              >
                <span className="board-init-roll">{e.roll}</span>
                <span className="board-init-name">{e.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Карта во весь экран */}
      <div className="board-map">
        <MapCanvas
          map={map}
          tokens={visibleTokens}
          fogReveals={fogReveals}
          drawings={drawings}
          mode="board"
          characters={characters}
        />
      </div>

      {/* Лента последних бросков */}
      {lastRolls.length > 0 && (
        <div className="board-dice">
          {lastRolls.map((e) => (
            <div key={e.id} className="board-dice-entry anim-dice-pop">
              <Dices size={18} />
              <span className="bde-name">{e.rollerName}</span>
              <span className="bde-label">{e.label}</span>
              <span className="bde-formula">{e.formula}</span>
              <span className="bde-total">{e.total}</span>
            </div>
          ))}
        </div>
      )}

      {/* Лобби: QR и состав партии (когда боя нет) */}
      {showLobby && (
        <div className="board-lobby anim-fade-in">
          <div className="board-lobby-card">
            <h2><QrCode size={22} /> Подключение игроков</h2>
            {joinUrl ? (
              <>
                <QrCanvas url={joinUrl} />
                <div className="board-join-url">{joinUrl}</div>
              </>
            ) : (
              <p className="board-lobby-dim">Ссылка входа загружается…</p>
            )}
          </div>
          <div className="board-lobby-card">
            <h2><Users size={22} /> Партия</h2>
            {characters.length === 0 ? (
              <p className="board-lobby-dim">Персонажи ещё не добавлены в сессию.</p>
            ) : (
              <ul className="board-party">
                {characters.map((c) => (
                  <li key={c.id}>
                    <span className="bp-name">{c.name}</span>
                    <span className="bp-hp">
                      {c.currentHp}/{c.maxHp} HP
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
