// ─── MapCanvas: переиспользуемый canvas-рендер карты VibeDND ───────────────
// Слои (снизу вверх): изображение карты → сетка по MapCalibration → токены →
// боевые эффекты (fx) → рисунки (DrawStroke) → туман войны. Панорама (drag)
// и зум (колесо). Режим 'board' — только просмотр (скрытые токены не
// рисуются, туман глухой). Режим 'dm' — инструменты: перемещение токенов,
// туман, рисование, измерение.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  CloudFog,
  CloudOff,
  Eraser,
  Minus,
  Move,
  PenLine,
  Hand,
  Ruler,
  Square,
  Circle,
  Trash2,
  Undo2,
} from 'lucide-react';
import type {
  AdventureMap,
  Character,
  CombatEvent,
  ConditionKey,
  DrawShape,
  DrawStroke,
  FogShape,
  LiveToken,
} from '@vibednd/shared';

export type MapMode = 'board' | 'dm';
export type ToolId =
  | 'pan'
  | 'move'
  | 'fog-rect'
  | 'fog-brush'
  | 'draw-pen'
  | 'draw-line'
  | 'draw-rect'
  | 'draw-circle'
  | 'eraser'
  | 'measure';

export interface FogReveal {
  id: string;
  mapId: string;
  shape: FogShape;
}

export interface MapCanvasProps {
  map?: AdventureMap;
  tokens: LiveToken[];
  fogReveals: FogReveal[];
  drawings: DrawStroke[];
  mode: MapMode;
  /** Персонажи сессии: портреты для токенов, привязанных через characterId. */
  characters?: Character[];
  onTokenMove?: (tokenId: string, x: number, y: number) => void;
  onFog?: (shape: FogShape, fogMode: 'reveal' | 'hide') => void;
  onFogReset?: () => void;
  onFogUndo?: () => void;
  onDraw?: (shape: DrawShape) => void;
  onErase?: (strokeId: string) => void;
  onClearDrawings?: () => void;
  /** Клик по карте без перетаскивания (координаты в клетках сетки).
   *  Используется мастером для размещения нового токена. */
  onMapClick?: (x: number, y: number) => void;
  /** Лента событий боя — источник анимаций слоя fx (шаг 5). */
  combatEvents?: CombatEvent[];
  /** Включены ли анимации боя (переключатель на доске, localStorage). */
  animationsEnabled?: boolean;
  /** id токенов с перегрузом (вес > Сила×5) — маленький бейдж на токене (шаг 7). */
  encumberedTokenIds?: ReadonlySet<string>;
  /** Тулбар инструментов (только режим dm). По умолчанию виден. */
  showToolbar?: boolean;
  /** Начальная активная вкладка тулбара. По умолчанию 'draw'. */
  defaultPanel?: 'draw' | 'fog';
}

// ─── Константы ──────────────────────────────────────────────────────────────

export const FEET_PER_CELL = 5;

export const DRAW_COLORS = ['#f0c948', '#c9403b', '#4caf6d', '#4a90d9', '#e8e2d5', '#b06fd4'];

const KIND_COLORS: Record<LiveToken['kind'], string> = {
  player: '#c9a227', // персонажи — золотая кайма
  enemy: '#b0303f', // враги — бордовая
  npc: '#8d8d9a', // НПС — серая
};

// Короткие метки состояний для значков на токене (полное имя — в title подсказке)
const CONDITION_SHORT: Partial<Record<ConditionKey, string>> = {
  blinded: 'Осл',
  charmed: 'Очр',
  deafened: 'Глх',
  exhaustion: 'Ист',
  frightened: 'Исп',
  grappled: 'Зах',
  incapacitated: 'Нед',
  invisible: 'Нев',
  paralyzed: 'Пар',
  petrified: 'Окам',
  poisoned: 'Отр',
  prone: 'Сбит',
  restrained: 'Опут',
  stunned: 'Огл',
  unconscious: 'Без',
};

// ─── Камера и утилиты ───────────────────────────────────────────────────────

interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Вместить карту в видимую область с небольшим отступом. */
function fitCamera(vw: number, vh: number, map: AdventureMap): Camera {
  const scale = clamp(Math.min(vw / map.imageWidth, vh / map.imageHeight) * 0.94, 0.05, 8);
  return {
    scale,
    tx: (vw - map.imageWidth * scale) / 2,
    ty: (vh - map.imageHeight * scale) / 2,
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts[1]?.[0];
  return (first + (second ?? '')).toUpperCase();
}

/** Портрет токена: портрет персонажа в приоритете над картинкой токена. */
function tokenPortrait(token: LiveToken, characters: Character[] | undefined): string | undefined {
  if (token.characterId) {
    const ch = characters?.find((c) => c.id === token.characterId);
    if (ch?.portraitPath) return ch.portraitPath;
  }
  return token.imagePath;
}

/** Попадание в токен с учётом размера (в координатах карты). */
function hitToken(map: AdventureMap, t: LiveToken, px: number, py: number): boolean {
  const cell = map.grid.cellSize;
  const cx = map.grid.originX + (t.x + t.sizeCells / 2) * cell;
  const cy = map.grid.originY + (t.y + t.sizeCells / 2) * cell;
  const r = (t.sizeCells * cell) / 2;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r * 1.15;
}

/** Расстояние от точки до штриха — для ластика (в координатах карты). */
function strokeHit(shape: DrawShape, px: number, py: number, tol: number): boolean {
  const distToSeg = (x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = clamp(t, 0, 1);
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    return Math.hypot(px - cx, py - cy);
  };
  switch (shape.tool) {
    case 'pen': {
      for (let i = 0; i + 3 < shape.points.length; i += 2) {
        if (distToSeg(shape.points[i]!, shape.points[i + 1]!, shape.points[i + 2]!, shape.points[i + 3]!) <= tol) {
          return true;
        }
      }
      // одиночная точка
      if (shape.points.length >= 2 && Math.hypot(px - shape.points[0]!, py - shape.points[1]!) <= tol) return true;
      return false;
    }
    case 'line':
      return distToSeg(shape.x1, shape.y1, shape.x2, shape.y2) <= tol;
    case 'rect': {
      const { x, y, w, h } = shape;
      const edges: [number, number, number, number][] = [
        [x, y, x + w, y],
        [x + w, y, x + w, y + h],
        [x + w, y + h, x, y + h],
        [x, y + h, x, y],
      ];
      return edges.some(([a, b, c, d]) => distToSeg(a, b, c, d) <= tol);
    }
    case 'circle':
      return Math.abs(Math.hypot(px - shape.cx, py - shape.cy) - shape.r) <= tol;
  }
}

// ─── Отрисовка слоёв ────────────────────────────────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, map: AdventureMap): void {
  const { originX, originY, cellSize, cols, rows } = map.grid;
  ctx.strokeStyle = 'rgba(232, 226, 213, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= cols; c++) {
    const x = originX + c * cellSize;
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + rows * cellSize);
  }
  for (let r = 0; r <= rows; r++) {
    const y = originY + r * cellSize;
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + cols * cellSize, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232, 226, 213, 0.28)';
  ctx.strokeRect(originX, originY, cols * cellSize, rows * cellSize);
}

function drawStrokeShape(ctx: CanvasRenderingContext2D, shape: DrawShape): void {
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (shape.tool) {
    case 'pen': {
      if (shape.points.length < 2) return;
      if (shape.points.length === 2) {
        ctx.beginPath();
        ctx.arc(shape.points[0]!, shape.points[1]!, shape.width / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.moveTo(shape.points[0]!, shape.points[1]!);
      for (let i = 2; i < shape.points.length; i += 2) {
        ctx.lineTo(shape.points[i]!, shape.points[i + 1]!);
      }
      ctx.stroke();
      return;
    }
    case 'line':
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
      return;
    case 'rect':
      ctx.lineWidth = shape.width;
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
      return;
    case 'circle':
      ctx.lineWidth = shape.width;
      ctx.beginPath();
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      ctx.stroke();
      return;
  }
}

function traceFogShape(ctx: CanvasRenderingContext2D, shape: FogShape): void {
  if (shape.kind === 'rect') {
    ctx.rect(shape.x, shape.y, shape.w, shape.h);
    return;
  }
  // кисть: толстая ломаная по точкам
  if (shape.points.length < 2) return;
  if (shape.points.length === 2) {
    ctx.moveTo(shape.points[0]! + shape.radius, shape.points[1]!);
    ctx.arc(shape.points[0]!, shape.points[1]!, shape.radius, 0, Math.PI * 2);
    return;
  }
  ctx.moveTo(shape.points[0]!, shape.points[1]!);
  for (let i = 2; i < shape.points.length; i += 2) {
    ctx.lineTo(shape.points[i]!, shape.points[i + 1]!);
  }
}

function drawFog(
  ctx: CanvasRenderingContext2D,
  map: AdventureMap,
  reveals: FogReveal[],
  mode: MapMode,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, map.imageWidth, map.imageHeight);
  ctx.beginPath();
  for (const r of reveals) traceFogShape(ctx, r.shape);
  ctx.save();
  ctx.clip('evenodd'); // завеса минус открытые области
  ctx.fillStyle = 'rgba(4, 3, 8, 0.96)';
  ctx.fillRect(0, 0, map.imageWidth, map.imageHeight);
  ctx.restore();
  if (mode === 'dm') {
    // мастеру открытые области подсвечены контуром
    ctx.strokeStyle = 'rgba(201, 162, 39, 0.35)';
    ctx.lineWidth = 2;
    for (const r of reveals) {
      ctx.beginPath();
      traceFogShape(ctx, r.shape);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ─── Слой боевых эффектов (fx, шаг 5) ───────────────────────────────────────
// Эффекты живут в ref-списке, у каждого есть время жизни; по завершении
// удаляется. Хореография: cast — снаряд/взмах/луч ~0,4 с сразу по получении
// события; попадание — вспышка + всплывающая цифра; крит — золото и крупная
// цифра; промах — серое «мимо»; спас — щит; лечение — зелёное; смерть —
// затухание токена к ☠. Библиотек и звука нет.

/** Жёсткий лимит одновременных эффектов — деградируем, не роняя FPS. */
const MAX_FX = 20;
/** Лимит частиц в одной вспышке. */
const MAX_PARTICLES = 8;

type FxKind = 'projectile' | 'swing' | 'flash' | 'text' | 'shield' | 'sparkle';

interface Fx {
  kind: FxKind;
  start: number;
  dur: number;
  /** точка воздействия (цель), в координатах карты */
  x: number;
  y: number;
  /** начало полёта (projectile) */
  x0?: number;
  y0?: number;
  color: string;
  text?: string;
  big?: boolean;
  /** частицы вспышки: смещения и скорости, не более MAX_PARTICLES */
  particles?: { dx: number; dy: number }[];
}

/** Цвет эффекта по школе и типу урона (ROADMAP, шаг 5). */
function fxColor(ev: CombatEvent): string {
  const dt = ev.damage?.damageType ?? '';
  if (/огон|плам|fire/i.test(dt)) return '#ff7a29';      // огонь — оранжевый
  if (/холод|лёд|лед|cold/i.test(dt)) return '#4fc3f7';  // холод — голубой
  if (/электр|молни|light/i.test(dt)) return '#ffe14d';  // молния — жёлтая
  if (ev.school === 'necromancy') return '#b06fd4';      // некротика — фиолетовый
  return '#f0c948';                                       // остальное — золото
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

function drawFxLayer(ctx: CanvasRenderingContext2D, fxList: Fx[], now: number, cell: number): void {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const fx = fxList[i]!;
    const k = (now - fx.start) / fx.dur;
    if (k >= 1) {
      fxList.splice(i, 1); // эффект завершён — удаляем из отрисовки
      continue;
    }
    if (k < 0) continue; // эффект с задержкой — ещё не начался
    ctx.save();
    switch (fx.kind) {
      case 'projectile': {
        const t = easeOut(k);
        const px = fx.x0! + (fx.x - fx.x0!) * t;
        const py = fx.y0! + (fx.y - fx.y0!) * t;
        // хвост
        ctx.strokeStyle = fx.color;
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.lineWidth = Math.max(2, cell * 0.08);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx.x0!, fx.y0!);
        ctx.lineTo(px, py);
        ctx.stroke();
        // ядро снаряда
        ctx.globalAlpha = 1 - k * 0.3;
        const r = Math.max(3, cell * 0.14);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.4, fx.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'swing': {
        // дуга взмаха у цели
        const t = easeOut(k);
        ctx.globalAlpha = 0.85 * (1 - k);
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(2.5, cell * 0.1);
        ctx.lineCap = 'round';
        const r = cell * (0.5 + t * 0.35);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, -Math.PI * 0.75 + t * 0.9, Math.PI * 0.15 + t * 0.9);
        ctx.stroke();
        break;
      }
      case 'flash': {
        const t = easeOut(k);
        const r = cell * (fx.big ? 0.9 : 0.6) * (0.4 + t);
        ctx.globalAlpha = 0.9 * (1 - k);
        const grad = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, fx.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (fx.big) {
          // крит: золотое кольцо
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#f0c948';
          ctx.lineWidth = Math.max(2, cell * 0.09);
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, cell * (0.6 + t * 0.8), 0, Math.PI * 2);
          ctx.stroke();
        }
        // частицы
        if (fx.particles) {
          ctx.fillStyle = fx.color;
          for (const p of fx.particles) {
            ctx.globalAlpha = 0.8 * (1 - k);
            const px = fx.x + p.dx * cell * t * 1.4;
            const py = fx.y + p.dy * cell * t * 1.4;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1.5, cell * 0.05) * (1 - k * 0.6), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'text': {
        // всплывающая цифра
        const t = easeOut(k);
        const fontPx = fx.big ? cell * 0.95 : cell * 0.62;
        const ty = fx.y - cell * 0.4 - t * cell * 1.1;
        ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        ctx.font = `900 ${fontPx}px "Cinzel", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, fontPx * 0.16);
        ctx.strokeStyle = 'rgba(10, 8, 16, 0.9)';
        ctx.strokeText(fx.text!, fx.x, ty);
        ctx.fillStyle = fx.color;
        ctx.fillText(fx.text!, fx.x, ty);
        break;
      }
      case 'shield': {
        // символ щита у цели (спасбросок)
        const pulse = Math.sin(k * Math.PI);
        const h = cell * (0.7 + pulse * 0.25);
        ctx.globalAlpha = 0.35 + 0.55 * (1 - k);
        ctx.fillStyle = fx.color;
        ctx.strokeStyle = '#e8e2d5';
        ctx.lineWidth = Math.max(1.5, cell * 0.05);
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y - h * 0.6);
        ctx.lineTo(fx.x + h * 0.5, fx.y - h * 0.32);
        ctx.lineTo(fx.x + h * 0.5, fx.y + h * 0.12);
        ctx.quadraticCurveTo(fx.x, fx.y + h * 0.62, fx.x - h * 0.5, fx.y + h * 0.12);
        ctx.lineTo(fx.x - h * 0.5, fx.y - h * 0.32);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'sparkle': {
        // служебный каст: золотые искры у источника
        const t = easeOut(k);
        ctx.globalAlpha = 0.8 * (1 - k);
        ctx.fillStyle = fx.color;
        const n = fx.particles?.length ?? 0;
        for (let j = 0; j < n; j++) {
          const p = fx.particles![j]!;
          const px = fx.x + p.dx * cell * t;
          const py = fx.y + p.dy * cell * t - t * cell * 0.4;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1.5, cell * 0.06) * (1 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }
}

function makeParticles(n: number): { dx: number; dy: number }[] {
  const count = Math.min(n, MAX_PARTICLES);
  const out: { dx: number; dy: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random();
    const d = 0.5 + Math.random() * 0.5;
    out.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d });
  }
  return out;
}

// ─── Компонент ──────────────────────────────────────────────────────────────

export default function MapCanvas(props: MapCanvasProps) {
  const {
    map,
    tokens,
    fogReveals,
    drawings,
    mode,
    characters,
    onTokenMove,
    onFog,
    onFogReset,
    onFogUndo,
    onDraw,
    onErase,
    onClearDrawings,
    showToolbar = true,
    defaultPanel = 'draw',
    combatEvents,
    animationsEnabled = true,
    encumberedTokenIds,
  } = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ scale: 1, tx: 0, ty: 0 });
  const viewSizeRef = useRef({ w: 0, h: 0 });
  const [cameraTick, setCameraTick] = useState(0); // форсирует перерисовку при смене камеры
  const [, setRenderTick] = useState(0); // после загрузки изображений

  // инструменты (только dm)
  const [tool, setTool] = useState<ToolId>('pan');
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]!);
  const [fogMode, setFogMode] = useState<'reveal' | 'hide'>('reveal');
  const [panel, setPanel] = useState<'draw' | 'fog'>(defaultPanel);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const drawColorRef = useRef(drawColor);
  drawColorRef.current = drawColor;
  const fogModeRef = useRef(fogMode);
  fogModeRef.current = fogMode;

  // живые ссылки на пропсы для обработчиков событий (без перевешивания слушателей)
  const propsRef = useRef(props);
  propsRef.current = props;

  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageLoadedRef = useRef(false);
  const tokenImagesRef = useRef(new Map<string, HTMLImageElement>());
  const requestedImagesRef = useRef(new Set<string>());
  const dropAnimsRef = useRef(new Map<string, number>());
  const prevTokenIdsRef = useRef<Set<string>>(new Set());
  interface Interaction {
    kind: 'pan' | 'move' | 'fog-rect' | 'fog-brush' | 'draw-pen' | 'draw-shape' | 'measure';
    pointerId: number;
    startClient: { x: number; y: number };
    startMap: { x: number; y: number };
    lastMap: { x: number; y: number };
    cameraStart: Camera;
    tokenId?: string;
    moved: boolean;
    points: number[];
  }
  const interactRef = useRef<Interaction | null>(null);

  const mapRef = useRef(map);
  mapRef.current = map;
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  const requestRender = useCallback(() => setRenderTick((t) => t + 1), []);

  // ── Слой fx: боевые эффекты (шаг 5) ───────────────────────────────────────

  const fxRef = useRef<Fx[]>([]);
  const rafRef = useRef<number | null>(null);
  const processedEventsRef = useRef<Set<string>>(new Set());
  // затухание токена к ☠ после смерти: tokenId → время старта
  const deathFadeRef = useRef<Map<string, number>>(new Map());

  const animEnabledRef = useRef(animationsEnabled);
  animEnabledRef.current = animationsEnabled;

  /** Центр токена в координатах карты. */
  const tokenCenter = useCallback((tokenId: string | undefined): { x: number; y: number } | null => {
    if (!tokenId) return null;
    const m = mapRef.current;
    const t = tokensRef.current.find((tk) => tk.id === tokenId);
    if (!m || !t) return null;
    const cell = m.grid.cellSize;
    return {
      x: m.grid.originX + (t.x + t.sizeCells / 2) * cell,
      y: m.grid.originY + (t.y + t.sizeCells / 2) * cell,
    };
  }, []);

  const pushFx = useCallback((fx: Fx) => {
    // жёсткий лимит: если список полон — вытесняем самый старый
    if (fxRef.current.length >= MAX_FX) fxRef.current.shift();
    fxRef.current.push(fx);
  }, []);

  /** Превращает событие боя в набор эффектов (cast-фаза — сразу). */
  const spawnFromEvent = useCallback((ev: CombatEvent) => {
    if (!animEnabledRef.current) return;
    const cell = mapRef.current?.grid.cellSize ?? 30;
    const color = fxColor(ev);
    const target = tokenCenter(ev.targetTokenId);
    const source = tokenCenter(ev.sourceTokenId);

    if (ev.phase === 'cast') {
      // cast-фаза проигрывается сразу по получению. У событий cast нет цели
      // (цель приходит в attack/save-result), поэтому: у заклинаний — вспышка
      // школы у источника, у служебных — золотые искры.
      if (source) {
        pushFx({
          kind: ev.spellId ? 'flash' : 'sparkle',
          start: performance.now(),
          dur: ev.spellId ? 350 : 500,
          x: source.x,
          y: source.y,
          color: ev.spellId ? color : '#f0c948',
          particles: makeParticles(6),
        });
      }
      return;
    }

    if (ev.phase === 'attack' && target) {
      const t0 = performance.now();
      const crit = ev.attack?.crit === true;
      // снаряд/взмах летит от источника ~0,4 с, затем фаза попадания
      if (source) {
        pushFx({
          kind: ev.spellId ? 'projectile' : 'swing',
          start: t0,
          dur: 400,
          x: target.x,
          y: target.y,
          x0: source.x,
          y0: source.y,
          color,
        });
      }
      const impactAt = source ? t0 + 380 : t0;
      if (ev.attack && !ev.attack.hit) {
        pushFx({ kind: 'text', start: impactAt, dur: 900, x: target.x, y: target.y, color: '#9a90b8', text: 'мимо' });
        return;
      }
      pushFx({ kind: 'flash', start: impactAt, dur: 420, x: target.x, y: target.y, color: crit ? '#f0c948' : color, big: crit, particles: makeParticles(crit ? 8 : 5) });
      if (ev.damage && ev.damage.applied > 0) {
        pushFx({ kind: 'text', start: impactAt + 120, dur: 1000, x: target.x, y: target.y, color: crit ? '#f0c948' : '#ff6b5a', text: `${crit ? '✦' : ''}${ev.damage.applied}`, big: crit });
      }
      return;
    }

    if (ev.phase === 'heal' && target) {
      pushFx({ kind: 'flash', start: performance.now(), dur: 500, x: target.x, y: target.y, color: '#4caf6d', particles: makeParticles(5) });
      if (ev.heal && ev.heal.applied > 0) {
        pushFx({ kind: 'text', start: performance.now() + 100, dur: 1000, x: target.x, y: target.y, color: '#4caf6d', text: `+${ev.heal.applied}` });
      }
      return;
    }

    if (ev.phase === 'save-result' && target) {
      pushFx({ kind: 'shield', start: performance.now(), dur: 700, x: target.x, y: target.y, color: ev.save?.success ? '#4caf6d' : '#c9403b' });
      // урон по проваленному спасу — отдельно
      if (ev.damage && ev.damage.applied > 0) {
        pushFx({ kind: 'text', start: performance.now() + 150, dur: 1000, x: target.x, y: target.y, color: '#ff6b5a', text: `${ev.damage.applied}` });
      }
      return;
    }

    if (ev.phase === 'death' && ev.targetTokenId) {
      deathFadeRef.current.set(ev.targetTokenId, performance.now());
      return;
    }
  }, [pushFx, tokenCenter]);

  // подписка на новые события боя
  useEffect(() => {
    if (!combatEvents) return;
    const seen = processedEventsRef.current;
    for (const ev of combatEvents) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      spawnFromEvent(ev);
    }
    // чистим отметки обработанных, чтобы Set не рос бесконечно
    if (seen.size > 400) {
      const recent = new Set(combatEvents.slice(-200).map((e) => e.id));
      processedEventsRef.current = recent;
    }
  }, [combatEvents, spawnFromEvent]);

  // rAF-петля: работает только пока есть активные эффекты
  useEffect(() => {
    const tick = () => {
      rafRef.current = null;
      if (fxRef.current.length > 0 || deathFadeRef.current.size > 0) {
        requestRender();
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    if ((fxRef.current.length > 0 || deathFadeRef.current.size > 0) && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  });

  // ── Загрузка изображений ────────────────────────────────────────────────

  useEffect(() => {
    imageLoadedRef.current = false;
    imageRef.current = null;
    if (!map) return;
    const img = new Image();
    img.onload = () => {
      imageLoadedRef.current = true;
      requestRender();
    };
    img.src = map.imagePath;
    imageRef.current = img;
  }, [map, requestRender]);

  // портреты токенов: ленивая загрузка по запросу из рендера
  const getTokenImage = useCallback(
    (src: string): HTMLImageElement | null => {
      const cached = tokenImagesRef.current.get(src);
      if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
      if (!requestedImagesRef.current.has(src)) {
        requestedImagesRef.current.add(src);
        const img = new Image();
        img.onload = requestRender;
        img.src = src;
        tokenImagesRef.current.set(src, img);
      }
      return null;
    },
    [requestRender],
  );

  // ── Анимация появления токенов (anim-token-drop) ────────────────────────

  useEffect(() => {
    const seen = prevTokenIdsRef.current;
    for (const t of tokens) {
      if (!seen.has(t.id)) dropAnimsRef.current.set(t.id, performance.now());
    }
    prevTokenIdsRef.current = new Set(tokens.map((t) => t.id));
    requestRender();
  }, [tokens, requestRender]);

  // ── Камера ──────────────────────────────────────────────────────────────

  const resetView = useCallback(() => {
    const m = mapRef.current;
    const { w, h } = viewSizeRef.current;
    if (!m || !w || !h) return;
    cameraRef.current = fitCamera(w, h, m);
    setCameraTick((t) => t + 1);
  }, []);

  const mapFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const cam = cameraRef.current;
    return {
      x: (clientX - rect.left - cam.tx) / cam.scale,
      y: (clientY - rect.top - cam.ty) / cam.scale,
    };
  }, []);

  // колесо — зум к курсору (не через React-событие: нужен passive:false)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!mapRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = cameraRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = clamp(cam.scale * factor, 0.05, 8);
      const k = next / cam.scale;
      cameraRef.current = {
        scale: next,
        tx: sx - (sx - cam.tx) * k,
        ty: sy - (sy - cam.ty) * k,
      };
      setCameraTick((t) => t + 1);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ── Указатель: панорама / перемещение / инструменты ────────────────────

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = propsRef.current;
    const m = mapRef.current;
    if (!m) return;
    const startMap = mapFromClient(e.clientX, e.clientY);
    const startClient = { x: e.clientX, y: e.clientY };
    const base = {
      pointerId: e.pointerId,
      startClient,
      startMap,
      lastMap: startMap,
      cameraStart: { ...cameraRef.current },
      moved: false,
      points: [startMap.x, startMap.y],
    };
    let kind: Interaction['kind'] | null = null;
    let tokenId: string | undefined;

    const t = p.mode === 'dm' ? toolRef.current : 'pan';
    if (t === 'move') {
      const hit = [...tokensRef.current].reverse().find((tk) => hitToken(m, tk, startMap.x, startMap.y));
      kind = hit ? 'move' : 'pan';
      tokenId = hit?.id;
    } else if (t === 'fog-rect') {
      kind = 'fog-rect';
    } else if (t === 'fog-brush') {
      kind = 'fog-brush';
    } else if (t === 'draw-pen') {
      kind = 'draw-pen';
    } else if (t === 'draw-line' || t === 'draw-rect' || t === 'draw-circle') {
      kind = 'draw-shape';
    } else if (t === 'measure') {
      kind = 'measure';
    } else if (t === 'eraser') {
      // ластик: стираем штрих под курсором (верхний — последний)
      const tol = m.grid.cellSize * 0.35;
      const stroke = [...p.drawings].reverse().find((s) => strokeHit(s.shape, startMap.x, startMap.y, tol));
      if (stroke) p.onErase?.(stroke.id);
      return;
    } else {
      kind = 'pan';
    }
    if (!kind) return;
    interactRef.current = { ...base, kind, tokenId };
    canvasRef.current?.setPointerCapture(e.pointerId);
    requestRender();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const it = interactRef.current;
    if (!it || it.pointerId !== e.pointerId) return;
    const pos = mapFromClient(e.clientX, e.clientY);
    it.lastMap = pos;
    const dx = e.clientX - it.startClient.x;
    const dy = e.clientY - it.startClient.y;
    if (!it.moved && Math.hypot(dx, dy) > 3) it.moved = true;

    if (it.kind === 'pan') {
      cameraRef.current = {
        scale: it.cameraStart.scale,
        tx: it.cameraStart.tx + dx,
        ty: it.cameraStart.ty + dy,
      };
      setCameraTick((t) => t + 1);
      return;
    }
    if (it.kind === 'move' && it.moved) {
      const m = mapRef.current!;
      const cell = m.grid.cellSize;
      const tk = tokensRef.current.find((t) => t.id === it.tokenId);
      if (!tk) return;
      const nx = Math.round((pos.x - m.grid.originX) / cell - tk.sizeCells / 2);
      const ny = Math.round((pos.y - m.grid.originY) / cell - tk.sizeCells / 2);
      if (nx !== tk.x || ny !== tk.y) {
        propsRef.current.onTokenMove?.(tk.id, nx, ny);
      }
      return;
    }
    if (it.kind === 'draw-pen' && it.moved) {
      // рисуем пером только на достаточном удалении — меньше точек в штрихе
      const n = it.points.length;
      const lx = it.points[n - 2]!;
      const ly = it.points[n - 1]!;
      if (Math.hypot(pos.x - lx, pos.y - ly) >= mapRef.current!.grid.cellSize * 0.08) {
        it.points.push(pos.x, pos.y);
      }
      requestRender();
      return;
    }
    if (it.kind === 'fog-brush' && it.moved) {
      if (fogModeRef.current === 'reveal') {
        // кисть «открыть» — режим на множество мелких областей
        const n = it.points.length;
        const lx = it.points[n - 2]!;
        const ly = it.points[n - 1]!;
        const cell = mapRef.current!.grid.cellSize;
        if (Math.hypot(pos.x - lx, pos.y - ly) >= cell * 0.25) {
          it.points.push(pos.x, pos.y);
          propsRef.current.onFog?.(
            { kind: 'brush', points: [lx, ly, pos.x, pos.y], radius: cell * 0.7 },
            'reveal',
          );
        }
      }
      requestRender();
      return;
    }
    requestRender();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const it = interactRef.current;
    interactRef.current = null;
    if (!it || it.pointerId !== e.pointerId) return;
    const p = propsRef.current;
    const m = mapRef.current;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (!m) return;
    const cell = m.grid.cellSize;

    // клик без перетаскивания — координаты в клетках (для размещения токена)
    if (it.kind === 'pan' && !it.moved && p.onMapClick) {
      const gx = Math.floor((it.startMap.x - m.grid.originX) / cell);
      const gy = Math.floor((it.startMap.y - m.grid.originY) / cell);
      if (gx >= 0 && gy >= 0 && gx < m.grid.cols && gy < m.grid.rows) {
        p.onMapClick(gx, gy);
      }
      return;
    }

    if (it.kind === 'fog-rect' && it.moved) {
      const x = Math.min(it.startMap.x, it.lastMap.x);
      const y = Math.min(it.startMap.y, it.lastMap.y);
      const w = Math.abs(it.lastMap.x - it.startMap.x);
      const h = Math.abs(it.lastMap.y - it.startMap.y);
      if (w > 2 && h > 2) {
        p.onFog?.({ kind: 'rect', x, y, w, h }, fogModeRef.current);
      }
    } else if (it.kind === 'fog-brush') {
      if (fogModeRef.current === 'hide') {
        // кисть «скрыть» — одна область по всему мазку
        if (it.points.length >= 2) {
          p.onFog?.({ kind: 'brush', points: [...it.points], radius: cell * 0.8 }, 'hide');
        }
      }
    } else if (it.kind === 'draw-pen' && it.points.length >= 2) {
      p.onDraw?.({ tool: 'pen', points: [...it.points], color: drawColorRef.current, width: cell * 0.1 });
    } else if (it.kind === 'draw-shape' && it.moved) {
      const color = drawColorRef.current;
      const width = cell * 0.1;
      const t = toolRef.current;
      if (t === 'draw-line') {
        p.onDraw?.({ tool: 'line', x1: it.startMap.x, y1: it.startMap.y, x2: it.lastMap.x, y2: it.lastMap.y, color, width });
      } else if (t === 'draw-rect') {
        p.onDraw?.({
          tool: 'rect',
          x: Math.min(it.startMap.x, it.lastMap.x),
          y: Math.min(it.startMap.y, it.lastMap.y),
          w: Math.abs(it.lastMap.x - it.startMap.x),
          h: Math.abs(it.lastMap.y - it.startMap.y),
          color,
          width,
        });
      } else if (t === 'draw-circle') {
        const r = Math.hypot(it.lastMap.x - it.startMap.x, it.lastMap.y - it.startMap.y);
        if (r > 2) p.onDraw?.({ tool: 'circle', cx: it.startMap.x, cy: it.startMap.y, r, color, width });
      }
    }
    requestRender();
  };

  // ── Размеры канвы и подписка на resize ──────────────────────────────────

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      viewSizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      requestRender();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [requestRender]);

  // первая подгонка камеры под карту
  const firstFitRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (map && firstFitRef.current !== map.id) {
      firstFitRef.current = map.id;
      const { w, h } = viewSizeRef.current;
      if (w && h) {
        cameraRef.current = fitCamera(w, h, map);
        setCameraTick((t) => t + 1);
      }
    }
  }, [map]);

  // ── Главный рендер ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w: vw, h: vh } = viewSizeRef.current;
    const cam = cameraRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0, 0, vw, vh);

    if (!map) {
      ctx.fillStyle = 'rgba(154, 144, 184, 0.8)';
      ctx.font = '18px "Noto Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Карта не выбрана', vw / 2, vh / 2);
      return;
    }

    ctx.translate(cam.tx, cam.ty);
    ctx.scale(cam.scale, cam.scale);

    // 1. изображение карты
    if (imageLoadedRef.current && imageRef.current) {
      ctx.drawImage(imageRef.current, 0, 0, map.imageWidth, map.imageHeight);
    } else {
      ctx.fillStyle = '#1e1830';
      ctx.fillRect(0, 0, map.imageWidth, map.imageHeight);
    }

    // 2. сетка
    if (map.grid.cellSize > 0) drawGrid(ctx, map);

    const cell = map.grid.cellSize;
    const now = performance.now();

    // 3. токены
    for (const t of tokens) {
      if (mode === 'board' && t.hidden) continue;
      const cx = map.grid.originX + (t.x + t.sizeCells / 2) * cell;
      const cy = map.grid.originY + (t.y + t.sizeCells / 2) * cell;
      let r = (t.sizeCells * cell) / 2 - cell * 0.06;
      let alpha = 1;

      const dropAt = dropAnimsRef.current.get(t.id);
      if (dropAt !== undefined) {
        const k = (now - dropAt) / 200;
        if (k >= 1) {
          dropAnimsRef.current.delete(t.id);
        } else {
          r *= 1.4 - 0.4 * k;
          alpha = k;
        }
      }

      // затухание к ☠ после смерти (событие death, шаг 5)
      const fadeStart = deathFadeRef.current.get(t.id);
      if (fadeStart !== undefined) {
        const k = (now - fadeStart) / 900;
        if (k >= 1) {
          deathFadeRef.current.delete(t.id);
        } else {
          alpha *= 0.35 + 0.65 * (1 - k);
        }
      }

      ctx.save();
      ctx.globalAlpha = mode === 'dm' && t.hidden ? 0.5 : alpha;
      const ring = KIND_COLORS[t.kind];

      // тело токена
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1e1830';
      ctx.fill();

      // портрет (круговой клип) или инициалы
      const portrait = tokenPortrait(t, characters);
      const img = portrait ? getTokenImage(portrait) : null;
      if (img) {
        ctx.save();
        ctx.clip();
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(
          img,
          (img.naturalWidth - side) / 2,
          (img.naturalHeight - side) / 2,
          side,
          side,
          cx - r,
          cy - r,
          r * 2,
          r * 2,
        );
        ctx.restore();
      } else {
        ctx.fillStyle = ring;
        ctx.font = `700 ${Math.max(10, r * 0.8)}px "Noto Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(t.name), cx, cy + r * 0.05);
      }

      // кайма
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, cell * 0.08);
      ctx.strokeStyle = ring;
      ctx.stroke();

      // полоска HP
      if (t.maxHp > 0) {
        const barW = r * 2;
        const barH = Math.max(3, cell * 0.14);
        const bx = cx - r;
        const by = cy + r + cell * 0.08;
        const frac = clamp(t.currentHp / t.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(10, 8, 16, 0.85)';
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = frac > 0.5 ? '#4caf6d' : frac > 0.25 ? '#f0c948' : '#c9403b';
        ctx.fillRect(bx, by, barW * frac, barH);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, barW, barH);
      }

      // значок «при смерти»
      if (t.maxHp > 0 && t.currentHp <= 0) {
        const fontPx = r * 0.9;
        ctx.font = `900 ${fontPx}px "Cinzel", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, fontPx * 0.16);
        ctx.strokeStyle = 'rgba(10, 8, 16, 0.9)';
        ctx.strokeText('☠', cx, cy);
        ctx.fillStyle = '#c9403b';
        ctx.fillText('☠', cx, cy);
      }

      // иконки состояний (до 4)
      const conds = t.conditions.slice(0, 4);
      if (conds.length > 0) {
        const h = Math.max(10, cell * 0.34);
        const w = h * 1.9;
        conds.forEach((c, i) => {
          const bx = cx + r - w + 1;
          const by = cy - r + 2 + i * (h + 2);
          ctx.fillStyle = 'rgba(30, 24, 48, 0.92)';
          ctx.strokeStyle = ring;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx, by, w, h, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#e8e2d5';
          ctx.font = `600 ${h * 0.62}px "Noto Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(CONDITION_SHORT[c] ?? c.slice(0, 3), bx + w / 2, by + h / 2 + 0.5);
        });
      }

      // бейдж «перегружен» (шаг 7): маленький значок гири слева вверху
      if (encumberedTokenIds?.has(t.id)) {
        const h = Math.max(10, cell * 0.34);
        const bx = cx - r - 1;
        const by = cy - r + 2;
        ctx.fillStyle = 'rgba(30, 24, 48, 0.92)';
        ctx.strokeStyle = '#f0c948';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, h, h, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f0c948';
        ctx.font = `700 ${h * 0.66}px "Noto Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚖', bx + h / 2, by + h / 2 + 0.5);
      }

      ctx.restore();
    }

    // 4. боевые эффекты (fx) — поверх токенов, под рисунками
    if (animEnabledRef.current && fxRef.current.length > 0) {
      drawFxLayer(ctx, fxRef.current, now, cell);
    }

    // 5. рисунки
    for (const s of drawings) drawStrokeShape(ctx, s.shape);

    // превью текущего штриха во время рисования
    const it = interactRef.current;
    if (it && it.kind === 'draw-pen' && it.points.length >= 2) {
      drawStrokeShape(ctx, { tool: 'pen', points: it.points, color: drawColorRef.current, width: cell * 0.1 });
    } else if (it && it.kind === 'draw-shape' && it.moved) {
      const color = drawColorRef.current;
      const width = cell * 0.1;
      const t = toolRef.current;
      if (t === 'draw-line') {
        drawStrokeShape(ctx, { tool: 'line', x1: it.startMap.x, y1: it.startMap.y, x2: it.lastMap.x, y2: it.lastMap.y, color, width });
      } else if (t === 'draw-rect') {
        drawStrokeShape(ctx, {
          tool: 'rect',
          x: Math.min(it.startMap.x, it.lastMap.x),
          y: Math.min(it.startMap.y, it.lastMap.y),
          w: Math.abs(it.lastMap.x - it.startMap.x),
          h: Math.abs(it.lastMap.y - it.startMap.y),
          color,
          width,
        });
      } else if (t === 'draw-circle') {
        const r2 = Math.hypot(it.lastMap.x - it.startMap.x, it.lastMap.y - it.startMap.y);
        drawStrokeShape(ctx, { tool: 'circle', cx: it.startMap.x, cy: it.startMap.y, r: r2, color, width });
      }
    }

    // 6. туман войны
    drawFog(ctx, map, fogReveals, mode);

    // превью тумана во время выделения
    if (mode === 'dm' && it) {
      ctx.save();
      if (it.kind === 'fog-rect' && it.moved) {
        ctx.fillStyle = fogModeRef.current === 'reveal' ? 'rgba(201, 162, 39, 0.22)' : 'rgba(176, 48, 63, 0.25)';
        ctx.strokeStyle = fogModeRef.current === 'reveal' ? '#c9a227' : '#b0303f';
        ctx.lineWidth = 2;
        const x = Math.min(it.startMap.x, it.lastMap.x);
        const y = Math.min(it.startMap.y, it.lastMap.y);
        const w2 = Math.abs(it.lastMap.x - it.startMap.x);
        const h2 = Math.abs(it.lastMap.y - it.startMap.y);
        ctx.fillRect(x, y, w2, h2);
        ctx.strokeRect(x, y, w2, h2);
      } else if (it.kind === 'fog-brush' && fogModeRef.current === 'hide' && it.points.length >= 2) {
        ctx.strokeStyle = 'rgba(176, 48, 63, 0.55)';
        ctx.lineWidth = cell * 1.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(it.points[0]!, it.points[1]!);
        for (let i = 2; i < it.points.length; i += 2) ctx.lineTo(it.points[i]!, it.points[i + 1]!);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 7. измерение радиуса (поверх всего, не сохраняется)
    if (it && it.kind === 'measure' && it.moved) {
      const radius = Math.hypot(it.lastMap.x - it.startMap.x, it.lastMap.y - it.startMap.y);
      const feet = Math.round(radius / cell) * FEET_PER_CELL;
      ctx.save();
      ctx.strokeStyle = '#f0c948';
      ctx.fillStyle = 'rgba(240, 201, 72, 0.10)';
      ctx.lineWidth = 2;
      ctx.setLineDash([cell * 0.25, cell * 0.18]);
      ctx.beginPath();
      ctx.arc(it.startMap.x, it.startMap.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(it.startMap.x, it.startMap.y);
      ctx.lineTo(it.lastMap.x, it.lastMap.y);
      ctx.stroke();
      // подпись в футах
      const label = `${feet} фт`;
      const fontPx = Math.max(14, cell * 0.5);
      ctx.font = `700 ${fontPx}px "Noto Sans", sans-serif`;
      const tw = ctx.measureText(label).width;
      const lx = (it.startMap.x + it.lastMap.x) / 2;
      const ly = (it.startMap.y + it.lastMap.y) / 2 - fontPx * 0.4;
      ctx.fillStyle = 'rgba(13, 10, 20, 0.9)';
      ctx.beginPath();
      ctx.roundRect(lx - tw / 2 - 8, ly - fontPx / 2 - 6, tw + 16, fontPx + 12, 6);
      ctx.fill();
      ctx.fillStyle = '#f0c948';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly + 1);
      ctx.restore();
    }
  });

  // ── Тулбар мастера ──────────────────────────────────────────────────────

  const dmToolbar = mode === 'dm' && showToolbar && (
    <div className="mc-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="mc-group">
        <button
          className={`mc-btn${tool === 'pan' ? ' active' : ''}`}
          title="Панорама"
          onClick={() => setTool('pan')}
        >
          <Hand size={16} />
        </button>
        <button
          className={`mc-btn${tool === 'move' ? ' active' : ''}`}
          title="Перемещение токенов"
          onClick={() => setTool('move')}
        >
          <Move size={16} />
        </button>
        <button
          className={`mc-btn${tool === 'measure' ? ' active' : ''}`}
          title="Измерение радиуса (клетка = 5 футов)"
          onClick={() => setTool('measure')}
        >
          <Ruler size={16} />
        </button>
      </div>

      <div className="mc-group">
        <button
          className={`mc-btn${panel === 'draw' ? ' active' : ''}`}
          title="Рисование"
          onClick={() => setPanel('draw')}
        >
          <PenLine size={16} />
        </button>
        <button
          className={`mc-btn${panel === 'fog' ? ' active' : ''}`}
          title="Туман войны"
          onClick={() => setPanel('fog')}
        >
          <CloudFog size={16} />
        </button>
      </div>

      {panel === 'draw' && (
        <>
          <div className="mc-group">
            <button className={`mc-btn${tool === 'draw-pen' ? ' active' : ''}`} title="Перо" onClick={() => setTool('draw-pen')}>
              <PenLine size={16} />
            </button>
            <button className={`mc-btn${tool === 'draw-line' ? ' active' : ''}`} title="Линия" onClick={() => setTool('draw-line')}>
              <Minus size={16} />
            </button>
            <button className={`mc-btn${tool === 'draw-circle' ? ' active' : ''}`} title="Круг" onClick={() => setTool('draw-circle')}>
              <Circle size={16} />
            </button>
            <button className={`mc-btn${tool === 'draw-rect' ? ' active' : ''}`} title="Прямоугольник" onClick={() => setTool('draw-rect')}>
              <Square size={16} />
            </button>
            <button className={`mc-btn${tool === 'eraser' ? ' active' : ''}`} title="Ластик (по штриху)" onClick={() => setTool('eraser')}>
              <Eraser size={16} />
            </button>
            <button
              className="mc-btn"
              title="Очистить слой рисунков"
              onClick={() => {
                if (window.confirm('Очистить все рисунки на этой карте?')) onClearDrawings?.();
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="mc-group mc-colors">
            {DRAW_COLORS.map((c) => (
              <button
                key={c}
                className={`mc-color${drawColor === c ? ' active' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => setDrawColor(c)}
              />
            ))}
          </div>
        </>
      )}

      {panel === 'fog' && (
        <>
          <div className="mc-group">
            <button className={`mc-btn${tool === 'fog-rect' ? ' active' : ''}`} title="Туман: прямоугольник" onClick={() => setTool('fog-rect')}>
              <Square size={16} />
            </button>
            <button className={`mc-btn${tool === 'fog-brush' ? ' active' : ''}`} title="Туман: кисть" onClick={() => setTool('fog-brush')}>
              <CloudFog size={16} />
            </button>
          </div>
          <div className="mc-group">
            <button className={`mc-btn${fogMode === 'reveal' ? ' active' : ''}`} onClick={() => setFogMode('reveal')}>
              Открыть
            </button>
            <button className={`mc-btn${fogMode === 'hide' ? ' active' : ''}`} onClick={() => setFogMode('hide')}>
              Скрыть
            </button>
            <button
              className="mc-btn"
              title="Отменить последнее открытие"
              onClick={() => onFogUndo?.()}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="mc-btn"
              title="Скрыть всю карту"
              onClick={() => {
                if (window.confirm('Скрыть всю карту туманом?')) onFogReset?.();
              }}
            >
              <CloudOff size={16} />
            </button>
          </div>
        </>
      )}

      <div className="mc-group">
        <button className="mc-btn" title="Вписать карту в экран" onClick={resetView}>
          Вписать
        </button>
      </div>
    </div>
  );

  // курсор по инструменту
  let cursor = 'grab';
  if (mode === 'dm') {
    if (tool === 'move') cursor = 'move';
    else if (tool !== 'pan') cursor = 'crosshair';
  }

  return (
    <div className="map-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          interactRef.current = null;
          requestRender();
        }}
      />
      {dmToolbar}
      {/* cameraTick участвует в перерисовке через эффект выше */}
      <span style={{ display: 'none' }}>{cameraTick}</span>
    </div>
  );
}
