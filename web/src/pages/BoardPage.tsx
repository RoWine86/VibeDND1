// ─── Доска (/board/:sessionId): чистый экран для ТВ/проектора ──────────────
// Карта во весь экран (mode="board"), сверху трекер инициативы, снизу лента
// последних 5 бросков (скрытые броски мастера сюда не доходят). Без боя —
// QR-код подключения игроков и список подключённых персонажей.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Dices, QrCode, Users } from 'lucide-react';
import type { Adventure, Character, SessionState } from '@vibednd/shared';
import { SessionSocket } from '../ws';
import { api } from '../api';
import MapCanvas from '../components/MapCanvas';
import '../styles/map.css';

// ─── QR-код на canvas (автономная реализация, без библиотек) ───────────────

type EcLevel = 0 | 1 | 2 | 3; // L M Q H
const EC_CODEWORDS: Record<EcLevel, number> = { 0: 7, 1: 10, 2: 13, 3: 17 };

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

function qrCompute(text: string, ecl: EcLevel): QrCode {
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
  const capacity = 17; // версия 1, byte mode: 17 байт данных
  if (bytes.length > capacity) throw new Error('Строка слишком длинная для QR версии 1');
  const len = bytes.length;
  const packed: number[] = [0x40 | (len >>> 4), ((len & 0xf) << 4) | (bytes[0] ?? 0)];
  for (let i = 1; i < len; i++) {
    packed.push(((bytes[i - 1]! & 0xf) << 4) | (bytes[i]! >>> 4));
  }
  packed.push((bytes[len - 1]! & 0xf) << 4);
  const pads = [0xec, 0x11];
  for (let i = 0; packed.length < 19; i++) packed.push(pads[i & 1]!);
  const data = Uint8Array.from(packed);
  const ec = qrRemainder(data, qrGenerator(EC_CODEWORDS[ecl]));
  const codewords = new Uint8Array([...data, ...ec]);

  const size = 21;
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
  const fmtData = (ecl << 3) | 0;
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
  return { size, modules };
}

function qrForUrl(url: string): QrCode {
  let lastErr: unknown = null;
  for (const ecl of [3, 2, 1, 0] as EcLevel[]) {
    try {
      return qrCompute(url, ecl);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function QrCanvas({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      const qr = qrForUrl(url);
      const scalePx = 8;
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
      // слишком длинный URL — крупная текстовая ссылка ниже всё покажет
    }
  }, [url]);
  return <canvas ref={ref} className="board-qr" />;
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function BoardPage() {
  const { sessionId = '' } = useParams();
  const [session, setSession] = useState<SessionState | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [joinUrl, setJoinUrl] = useState('');
  const [fatal, setFatal] = useState('');
  const sockRef = useRef<SessionSocket | null>(null);

  // подключение к сессии
  useEffect(() => {
    if (!sessionId) return;
    const sock = new SessionSocket('board', sessionId);
    sockRef.current = sock;
    const off = sock.onMessage((msg) => {
      switch (msg.type) {
        case 'snapshot':
          setSession(msg.session);
          setCharacters(msg.characters);
          break;
        case 'tokenUpsert':
          setSession((s) => {
            if (!s) return s;
            // скрытые токены доске не присылаются в снимке, но tokenUpsert
            // идёт всем — фильтруем самостоятельно
            const rest = s.tokens.filter((t) => t.id !== msg.token.id);
            const tokens = msg.token.hidden ? rest : [...rest, msg.token];
            return { ...s, tokens };
          });
          break;
        case 'tokenRemoved':
          setSession((s) => (s ? { ...s, tokens: s.tokens.filter((t) => t.id !== msg.tokenId) } : s));
          break;
        case 'fogReveals':
          setSession((s) =>
            s
              ? {
                  ...s,
                  fogReveals: [
                    ...s.fogReveals.filter((r) => r.mapId !== msg.mapId),
                    ...msg.reveals.map((r) => ({ ...r, mapId: msg.mapId })),
                  ],
                }
              : s,
          );
          break;
        case 'strokeAdded':
          setSession((s) =>
            s ? { ...s, drawings: [...s.drawings.filter((d) => d.id !== msg.stroke.id), msg.stroke] } : s,
          );
          break;
        case 'strokeRemoved':
          setSession((s) => (s ? { ...s, drawings: s.drawings.filter((d) => d.id !== msg.strokeId) } : s));
          break;
        case 'drawingsCleared':
          setSession((s) => (s ? { ...s, drawings: s.drawings.filter((d) => d.mapId !== msg.mapId) } : s));
          break;
        case 'combat':
          setSession((s) => (s ? { ...s, combat: msg.combat } : s));
          break;
        case 'diceLog':
          if (msg.entry.hidden) break; // скрытые броски на доске не показываем
          setSession((s) => (s ? { ...s, diceLog: [...s.diceLog.slice(-49), msg.entry] } : s));
          break;
        case 'characterUpdated':
          setCharacters((chs) => {
            const rest = chs.filter((c) => c.id !== msg.character.id);
            return [...rest, msg.character];
          });
          break;
        case 'activeMap':
          setSession((s) => (s ? { ...s, activeMapId: msg.mapId } : s));
          break;
        case 'error':
          if (msg.message === 'Сессия не найдена') setFatal(msg.message);
          break;
      }
    });
    return () => {
      off();
      sock.close();
      sockRef.current = null;
    };
  }, [sessionId]);

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
