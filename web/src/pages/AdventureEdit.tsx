// ─── Редактор приключения: общие поля, карты (загрузка + калибровка сетки
// двумя кликами), расстановка токенов (drag по карте, монстр из справочника
// или свободный НПС), сцены/заметки. Сохранение — PUT /api/adventures/:id ────

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BookOpen,
  Crosshair,
  Eye,
  EyeOff,
  Grid3X3,
  Image as ImageIcon,
  Map as MapIcon,
  NotebookPen,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  Adventure,
  AdventureMap,
  MapCalibration,
  Monster,
  SceneNote,
  TokenKind,
  TokenTemplate,
} from '@vibednd/shared';
import { api } from '../api';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const DEFAULT_GRID: MapCalibration = { originX: 0, originY: 0, cellSize: 50, cols: 10, rows: 10 };

const KIND_LABEL: Record<TokenKind, string> = {
  player: 'Персонаж',
  enemy: 'Враг',
  npc: 'НПС',
};

const TOKEN_COLORS: Record<TokenKind, string> = {
  player: '#4caf6d',
  enemy: '#c9403b',
  npc: '#c9a227',
};

/** Процент позиции/размера на сцене карты (координаты в пикселях картинки). */
const pct = (v: number, total: number) => `${((v / (total || 1)) * 100).toFixed(4)}%`;

type Tool = 'tokens' | 'calibrate';

interface MapDims {
  w: number;
  h: number;
}

/** Размеры картинки, реально загруженной в браузере — основа для оверлея. */
interface StageSize {
  w: number;
  h: number;
}

/** Общая загрузка файла на /api/upload (сервер ждёт сырые байты + x-filename). */
async function uploadFile(file: File): Promise<string> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'x-filename': file.name },
    body: file,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { path: string };
  return data.path;
}

// ─── Редактор одной карты: картинка, сетка, калибровка, drag токенов ────────

interface MapEditorProps {
  map: AdventureMap;
  tokens: TokenTemplate[];
  notes: SceneNote[];
  monsters: Monster[];
  uploading: boolean;
  onUploadImage: (file: File) => void;
  onChangeMap: (patch: Partial<AdventureMap>) => void;
  onAddToken: (mapId: string, x: number, y: number) => void;
  onUpdateToken: (id: string, patch: Partial<TokenTemplate>) => void;
  onRemoveToken: (id: string) => void;
  onAddNote: (mapId: string) => void;
  onUpdateNote: (id: string, patch: Partial<SceneNote>) => void;
  onRemoveNote: (id: string) => void;
  onUploadNoteArt: (noteId: string, file: File) => void;
  onRemoveMap: () => void;
}

function MapEditor(p: MapEditorProps) {
  const { map, tokens, notes, monsters } = p;
  const [tool, setTool] = useState<Tool>('tokens');
  const [calibPoints, setCalibPoints] = useState<{ x: number; y: number }[]>([]);
  const [activeTokenId, setActiveTokenId] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [stageSize, setStageSize] = useState<StageSize | null>(null);
  const [fitCols, setFitCols] = useState(30);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noteArtInputRef = useRef<HTMLInputElement>(null);
  const noteArtTargetRef = useRef<string>('');
  const dragRef = useRef<{ tokenId: string; pointerId: number } | null>(null);

  // Смена карты или картинки — сброс режима калибровки, выбора токена и оверлея
  useEffect(() => {
    setCalibPoints([]);
    setActiveTokenId(null);
    setStageSize(null);
    dragRef.current = null;
  }, [map.id, map.imagePath]);

  const toImage = (e: React.PointerEvent | React.MouseEvent): MapDims & { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return null;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * img.naturalWidth;
    const y = ((e.clientY - rect.top) / rect.height) * img.naturalHeight;
    return { x, y, w: img.naturalWidth, h: img.naturalHeight };
  };

  const commitImageSize = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    setStageSize({ w: img.naturalWidth, h: img.naturalHeight });
    if (img.naturalWidth !== map.imageWidth || img.naturalHeight !== map.imageHeight) {
      p.onChangeMap({ imageWidth: img.naturalWidth, imageHeight: img.naturalHeight });
    }
  };

  const onMapClick = (e: React.MouseEvent) => {
    if (tool !== 'calibrate' || dragRef.current) return;
    const pt = toImage(e);
    if (!pt) return;
    const next = [...calibPoints, { x: pt.x, y: pt.y }];
    if (next.length === 2) {
      const [a, b] = next as [{ x: number; y: number }, { x: number; y: number }];
      const originX = Math.min(a.x, b.x);
      const originY = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x);
      const h = Math.abs(a.y - b.y);
      if (w >= 4 && h >= 4) {
        const cellSize = Math.round((w + h) / 2);
        const cols = Math.max(1, Math.round((pt.w - originX) / cellSize));
        const rows = Math.max(1, Math.round((pt.h - originY) / cellSize));
        p.onChangeMap({
          grid: { originX: Math.round(originX), originY: Math.round(originY), cellSize, cols, rows },
        });
      }
      setCalibPoints([]);
    } else {
      setCalibPoints(next);
    }
  };

  const onPointerDownToken = (tokenId: string) => (e: React.PointerEvent) => {
    if (tool !== 'tokens') return;
    e.stopPropagation();
    dragRef.current = { tokenId, pointerId: e.pointerId };
    containerRef.current?.setPointerCapture(e.pointerId);
    setActiveTokenId(tokenId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pt = toImage(e);
    if (!pt) return;
    const g = map.grid;
    if (!g.cellSize) return;
    const token = tokens.find((t) => t.id === drag.tokenId);
    if (!token) return;
    // привязка к клетке по центру токена
    const half = token.sizeCells / 2;
    const cx = Math.round((pt.x - g.originX) / g.cellSize - half);
    const cy = Math.round((pt.y - g.originY) / g.cellSize - half);
    const x = Math.min(Math.max(0, cx), Math.max(0, g.cols - token.sizeCells));
    const y = Math.min(Math.max(0, cy), Math.max(0, g.rows - token.sizeCells));
    if (x !== token.x || y !== token.y) p.onUpdateToken(token.id, { x, y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const activeToken = tokens.find((t) => t.id === activeTokenId) ?? null;
  const g = map.grid;

  // Автоподгон: сетка ровно по картинке, N клеток в ширину
  const fitGridToImage = () => {
    const img = imgRef.current;
    const w = img?.naturalWidth || map.imageWidth;
    const h = img?.naturalHeight || map.imageHeight;
    const n = Math.max(1, Math.floor(fitCols));
    if (!w || !h || !n) return;
    const cellSize = Math.max(1, Math.round(w / n));
    const rows = Math.max(1, Math.round(h / cellSize));
    p.onChangeMap({
      imageWidth: w,
      imageHeight: h,
      grid: { originX: 0, originY: 0, cellSize, cols: n, rows },
    });
  };
  // Калибровка и токены работают, только когда размеры картинки известны
  const ready = !!stageSize && g.cellSize > 0;
  const W = stageSize?.w ?? 1;
  const H = stageSize?.h ?? 1;

  return (
    <div className="adv-map-editor">
      <div className="adv-map-head">
        <input
          className="adv-map-name"
          value={map.name}
          onChange={(e) => p.onChangeMap({ name: e.target.value })}
          placeholder="Название карты"
        />
        <div className="adv-map-head-actions">
          <button
            className={tool === 'tokens' ? 'primary' : ''}
            onClick={() => {
              setTool('tokens');
              setCalibPoints([]);
            }}
          >
            <Plus size={13} /> Токены
          </button>
          <button
            className={tool === 'calibrate' ? 'primary' : ''}
            onClick={() => {
              setTool('calibrate');
              setCalibPoints([]);
            }}
          >
            <Crosshair size={13} /> Калибровка
          </button>
          <button
            onClick={() => {
              fileInputRef.current?.click();
            }}
            disabled={p.uploading}
          >
            <Upload size={13} /> {p.uploading ? 'Загрузка…' : 'Заменить изображение'}
          </button>
          <button
            onClick={() => {
              setNoteOpen((v) => !v);
            }}
          >
            <NotebookPen size={13} /> Заметки ({notes.length})
          </button>
          <button className="danger" onClick={p.onRemoveMap}>
            <Trash2 size={13} /> Удалить карту
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onUploadImage(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="adv-map-gridfields">
        <span>
          Начало X <input type="number" value={g.originX} onChange={(e) => p.onChangeMap({ grid: { ...g, originX: Number(e.target.value) || 0 } })} />
        </span>
        <span>
          Y <input type="number" value={g.originY} onChange={(e) => p.onChangeMap({ grid: { ...g, originY: Number(e.target.value) || 0 } })} />
        </span>
        <span>
          Клетка, px <input type="number" value={g.cellSize} onChange={(e) => p.onChangeMap({ grid: { ...g, cellSize: Math.max(1, Number(e.target.value) || 1) } })} />
        </span>
        <span>
          Колонки <input type="number" value={g.cols} onChange={(e) => p.onChangeMap({ grid: { ...g, cols: Math.max(1, Number(e.target.value) || 1) } })} />
        </span>
        <span>
          Строки <input type="number" value={g.rows} onChange={(e) => p.onChangeMap({ grid: { ...g, rows: Math.max(1, Number(e.target.value) || 1) } })} />
        </span>
        <span style={{ color: 'var(--text-dim)' }}>
          {map.imageWidth > 0 ? `${map.imageWidth}×${map.imageHeight}px` : 'размер определится после загрузки'}
        </span>
        <span className="adv-map-autofit">
          <Grid3X3 size={14} style={{ verticalAlign: -3 }} />
          Клеток в ширину{' '}
          <input
            type="number"
            min={1}
            max={400}
            value={fitCols}
            onChange={(e) => setFitCols(Math.min(400, Math.max(1, Number(e.target.value) || 1)))}
          />
          <button
            disabled={!map.imagePath}
            title="Сетка ровно по картинке: cellSize = ширина/N, начало 0,0"
            onClick={fitGridToImage}
          >
            Подогнать под картинку
          </button>
        </span>
      </div>

      {tool === 'calibrate' && (
        <div className="hint-box">
          Кликните по двум противоположным углам одной клетки — размер клетки, начало сетки и
          колонки/строки посчитаются автоматически. Точку можно сбросить повторным входом в режим.
        </div>
      )}

      <div
        ref={containerRef}
        className={`adv-map-stage ${tool === 'calibrate' ? 'calibrating' : ''}`}
        onClick={onMapClick}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {map.imagePath ? (
          <div className="adv-map-frame">
            <img ref={imgRef} src={map.imagePath} alt={map.name} onLoad={commitImageSize} draggable={false} />
            {ready && (
              <div
                className="adv-grid"
                style={{
                  left: pct(g.originX, W),
                  top: pct(g.originY, H),
                  width: pct(g.cellSize * g.cols, W),
                  height: pct(g.cellSize * g.rows, H),
                  backgroundSize: `${pct(g.cellSize, W)} ${pct(g.cellSize, H)}`,
                }}
              />
            )}
            {calibPoints.map((pt, i) => (
              <div
                key={i}
                className="adv-calib-point"
                style={{
                  left: pct(pt.x, W),
                  top: pct(pt.y, H),
                }}
              />
            ))}
            {ready && tokens.map((t) => (
              <div
                key={t.id}
                className={`adv-token ${t.hidden ? 'is-hidden' : ''} ${t.id === activeTokenId ? 'is-active' : ''}`}
                style={{
                  left: pct(g.originX + t.x * g.cellSize, W),
                  top: pct(g.originY + t.y * g.cellSize, H),
                  width: pct(t.sizeCells * g.cellSize, W),
                  aspectRatio: '1',
                  borderColor: TOKEN_COLORS[t.kind],
                  touchAction: 'none',
                }}
                onPointerDown={onPointerDownToken(t.id)}
                title={t.name || KIND_LABEL[t.kind]}
              >
                {t.imagePath ? <img src={t.imagePath} alt="" draggable={false} /> : <span>{(t.name || '?').slice(0, 2)}</span>}
                {t.hidden && <EyeOff size={12} className="adv-token-hidden-badge" />}
              </div>
            ))}
          </div>
        ) : (
          <div className="adv-map-empty">
            <ImageIcon size={32} />
            <p>Изображение не загружено</p>
            <button
              className="primary"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              disabled={p.uploading}
            >
              <Upload size={14} style={{ verticalAlign: -2 }} /> {p.uploading ? 'Загрузка…' : 'Загрузить изображение карты'}
            </button>
          </div>
        )}
      </div>

      <div className="adv-tokens-bar">
        <div className="adv-tokens-bar-row">
          <button
            onClick={() => {
              p.onAddToken(map.id, 0, 0);
            }}
            disabled={!map.imagePath}
          >
            <Plus size={13} /> Добавить токен
          </button>
          {activeToken && (
            <div className="adv-token-form">
              <select
                value={activeToken.monsterId ?? ''}
                onChange={(e) => {
                  const monsterId = e.target.value || undefined;
                  if (monsterId) {
                    const m = monsters.find((mm) => mm.id === monsterId);
                    p.onUpdateToken(activeToken.id, {
                      monsterId,
                      kind: 'enemy',
                      name: m?.nameRu ?? activeToken.name,
                      imagePath: m?.imagePath ?? activeToken.imagePath,
                    });
                  } else {
                    p.onUpdateToken(activeToken.id, { monsterId: undefined });
                  }
                }}
              >
                <option value="">— Свободный НПС / вручную —</option>
                {monsters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameRu} (ПО {m.challengeRating})
                  </option>
                ))}
              </select>
              <input
                value={activeToken.name}
                placeholder="Имя токена"
                onChange={(e) => p.onUpdateToken(activeToken.id, { name: e.target.value })}
              />
              <select
                value={activeToken.kind}
                onChange={(e) => p.onUpdateToken(activeToken.id, { kind: e.target.value as TokenKind })}
              >
                {(Object.keys(KIND_LABEL) as TokenKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <label className="adv-token-size">
                Размер, кл.{' '}
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={activeToken.sizeCells}
                  onChange={(e) =>
                    p.onUpdateToken(activeToken.id, {
                      sizeCells: Math.min(8, Math.max(1, Number(e.target.value) || 1)),
                    })
                  }
                />
              </label>
              <button
                title={activeToken.hidden ? 'Скрыт от доски' : 'Виден на доске'}
                onClick={() => p.onUpdateToken(activeToken.id, { hidden: !activeToken.hidden })}
              >
                {activeToken.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                {activeToken.hidden ? ' Скрыт' : ' Виден'}
              </button>
              <button
                className="danger"
                onClick={() => {
                  p.onRemoveToken(activeToken.id);
                  setActiveTokenId(null);
                }}
              >
                <Trash2 size={13} />
              </button>
              <button
                onClick={() => {
                  setActiveTokenId(null);
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
        {!activeToken && tokens.length > 0 && (
          <div className="hint-box">Перетаскивайте токены по карте; клик по токену открывает его настройки.</div>
        )}
      </div>

      {noteOpen && (
        <div className="adv-notes">
          <div className="adv-notes-head">
            <h3>Сцены и заметки карты</h3>
            <button
              onClick={() => {
                p.onAddNote(map.id);
              }}
            >
              <Plus size={13} /> Добавить заметку
            </button>
          </div>
          {notes.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Заметок пока нет — они видны только мастеру в консоли.</p>}
          {notes.map((n) => (
            <div className="adv-note" key={n.id}>
              <div className="adv-note-main">
                <input
                  value={n.title}
                  placeholder="Заголовок сцены"
                  onChange={(e) => p.onUpdateNote(n.id, { title: e.target.value })}
                />
                <textarea
                  value={n.body}
                  placeholder="Текст для мастера: зачитать вслух, подсказки, ловушки…"
                  rows={3}
                  onChange={(e) => p.onUpdateNote(n.id, { body: e.target.value })}
                />
              </div>
              <div className="adv-note-side">
                {n.artPath && <img className="adv-note-art" src={n.artPath} alt="Арт сцены" />}
                <button
                  onClick={() => {
                    noteArtTargetRef.current = n.id;
                    noteArtInputRef.current?.click();
                  }}
                >
                  <ImageIcon size={13} /> Арт
                </button>
                <button className="danger" onClick={() => p.onRemoveNote(n.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          <input
            ref={noteArtInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && noteArtTargetRef.current) p.onUploadNoteArt(noteArtTargetRef.current, f);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Страница редактора ─────────────────────────────────────────────────────

export default function AdventureEdit() {
  const { id = '' } = useParams();
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeMapId, setActiveMapId] = useState<string>('');
  const savedFlash = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.get<Adventure>(`/adventures/${id}`), api.get<Monster[]>('/entities/monster')])
      .then(([adv, mons]) => {
        setAdventure(adv);
        setMonsters(mons);
        setActiveMapId(adv.maps[0]?.id ?? '');
      })
      .catch((e: Error) => setFatal(e.message));
  }, [id]);

  const mutate = useCallback((fn: (a: Adventure) => Adventure) => {
    setAdventure((a) => (a ? fn(a) : a));
    setDirty(true);
  }, []);

  // Автосохранение: иначе загруженная картинка карты (imagePath уже в памяти,
  // файл на сервере) теряется при уходе со страницы без кнопки «Сохранить».
  const loadedRef = useRef(false);
  const autoTimer = useRef<number | undefined>(undefined);
  const adventureRef = useRef<Adventure | null>(null);
  adventureRef.current = adventure;
  useEffect(() => {
    if (!adventure) return;
    if (!loadedRef.current) {
      loadedRef.current = true; // первая загрузка — не сохраняем
      return;
    }
    window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(() => {
      const a = adventureRef.current;
      if (!a) return;
      api.put<Adventure>(`/adventures/${a.id}`, a)
        .then(() => setDirty(false))
        .catch((e: Error) => setError(e.message));
    }, 1200);
    return () => window.clearTimeout(autoTimer.current);
  }, [adventure]);

  const save = async () => {
    if (!adventure || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.put<Adventure>(`/adventures/${adventure.id}`, adventure);
      setAdventure(updated);
      setDirty(false);
      setSavedTick(true);
      window.clearTimeout(savedFlash.current);
      savedFlash.current = window.setTimeout(() => setSavedTick(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(
    () => () => {
      window.clearTimeout(savedFlash.current);
    },
    [],
  );

  // ── Карты ──

  const addMap = () => {
    const map: AdventureMap = {
      id: uid(),
      name: `Карта ${(adventure?.maps.length ?? 0) + 1}`,
      imagePath: '',
      imageWidth: 0,
      imageHeight: 0,
      grid: { ...DEFAULT_GRID },
    };
    mutate((a) => ({ ...a, maps: [...a.maps, map] }));
    setActiveMapId(map.id);
  };

  const updateMap = (mapId: string, patch: Partial<AdventureMap>) =>
    mutate((a) => ({ ...a, maps: a.maps.map((m) => (m.id === mapId ? { ...m, ...patch } : m)) }));

  const removeMap = (mapId: string) => {
    if (!window.confirm('Удалить карту вместе с её токенами и заметками?')) return;
    mutate((a) => ({
      ...a,
      maps: a.maps.filter((m) => m.id !== mapId),
      tokens: a.tokens.filter((t) => t.mapId !== mapId),
      notes: a.notes.filter((n) => n.mapId !== mapId),
    }));
  };

  const uploadMapImage = async (mapId: string, file: File) => {
    setUploading(true);
    setError('');
    try {
      const path = await uploadFile(file);
      const dims = await new Promise<MapDims>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        img.src = path;
      });
      mutate((a) => ({
        ...a,
        maps: a.maps.map((m) =>
          m.id === mapId
            ? { ...m, imagePath: path, imageWidth: dims.w, imageHeight: dims.h }
            : m,
        ),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // ── Токены ──

  const addToken = (mapId: string, x: number, y: number) => {
    const token: TokenTemplate = {
      id: uid(),
      mapId,
      kind: 'npc',
      name: '',
      x,
      y,
      sizeCells: 1,
      hidden: true,
    };
    mutate((a) => ({ ...a, tokens: [...a.tokens, token] }));
  };

  const updateToken = (tokenId: string, patch: Partial<TokenTemplate>) =>
    mutate((a) => ({ ...a, tokens: a.tokens.map((t) => (t.id === tokenId ? { ...t, ...patch } : t)) }));

  const removeToken = (tokenId: string) =>
    mutate((a) => ({ ...a, tokens: a.tokens.filter((t) => t.id !== tokenId) }));

  // ── Заметки ──

  const addNote = (mapId: string) => {
    const note: SceneNote = { id: uid(), mapId, title: '', body: '' };
    mutate((a) => ({ ...a, notes: [...a.notes, note] }));
  };

  const updateNote = (noteId: string, patch: Partial<SceneNote>) =>
    mutate((a) => ({ ...a, notes: a.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) }));

  const removeNote = (noteId: string) =>
    mutate((a) => ({ ...a, notes: a.notes.filter((n) => n.id !== noteId) }));

  const uploadNoteArt = async (noteId: string, file: File) => {
    setUploading(true);
    setError('');
    try {
      const path = await uploadFile(file);
      updateNote(noteId, { artPath: path });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (fatal) {
    return (
      <div className="page anim-fade-in">
        <div className="error-box">Не удалось открыть приключение: {fatal}</div>
        <Link to="/adventures">
          <button>← К библиотеке приключений</button>
        </Link>
      </div>
    );
  }

  if (!adventure) {
    return (
      <div className="page anim-fade-in">
        <p style={{ color: 'var(--text-dim)' }}>Загрузка…</p>
      </div>
    );
  }

  const activeMap = adventure.maps.find((m) => m.id === activeMapId) ?? adventure.maps[0] ?? null;

  return (
    <div className="page anim-fade-in">
      <div className="lib-head">
        <h1>
          <BookOpen size={26} /> Редактор приключения
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {savedTick && <span style={{ color: 'var(--hp-green)', fontSize: 14 }}>Сохранено</span>}
          {dirty && !savedTick && <span style={{ color: 'var(--gold-bright)', fontSize: 14 }}>Есть несохранённые изменения</span>}
          <button className="primary" onClick={() => void save()} disabled={saving || !dirty}>
            <Save size={14} style={{ verticalAlign: -2 }} /> {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <Link to="/adventures">
            <button>← К списку</button>
          </Link>
        </div>
      </div>

      {error && <div className="error-box">Ошибка: {error}</div>}

      <div className="adv-section">
        <div className="adv-fields">
          <div className="form-field">
            <label>Название</label>
            <input
              value={adventure.name}
              onChange={(e) => mutate((a) => ({ ...a, name: e.target.value }))}
            />
          </div>
          <div className="form-field">
            <label>Источник</label>
            <input
              value={adventure.source}
              placeholder="Книга, сайт, домашняя игра…"
              onChange={(e) => mutate((a) => ({ ...a, source: e.target.value }))}
            />
          </div>
          <div className="form-field" style={{ gridColumn: '1 / -1' }}>
            <label>Описание</label>
            <textarea
              value={adventure.description}
              rows={3}
              placeholder="Краткий синопсис для мастера"
              onChange={(e) => mutate((a) => ({ ...a, description: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="adv-section">
        <div className="adv-section-head">
          <h2>
            <MapIcon size={18} style={{ verticalAlign: -3 }} /> Карты ({adventure.maps.length})
          </h2>
          <button onClick={addMap}>
            <Plus size={13} /> Добавить карту
          </button>
        </div>

        {adventure.maps.length === 0 && (
          <div className="empty-state">
            <h2>Карт пока нет</h2>
            <p>Добавьте карту, загрузите изображение и откалибруйте сетку.</p>
          </div>
        )}

        {adventure.maps.length > 0 && (
          <>
            <div className="adv-map-tabs">
              {adventure.maps.map((m) => (
                <button
                  key={m.id}
                  className={m.id === activeMap?.id ? 'primary' : ''}
                  onClick={() => setActiveMapId(m.id)}
                >
                  {m.name || 'Без названия'}
                </button>
              ))}
            </div>
            {activeMap && (
              <MapEditor
                map={activeMap}
                tokens={adventure.tokens.filter((t) => t.mapId === activeMap.id)}
                notes={adventure.notes.filter((n) => n.mapId === activeMap.id)}
                monsters={monsters}
                uploading={uploading}
                onUploadImage={(f) => void uploadMapImage(activeMap.id, f)}
                onChangeMap={(patch) => updateMap(activeMap.id, patch)}
                onAddToken={addToken}
                onUpdateToken={updateToken}
                onRemoveToken={removeToken}
                onAddNote={addNote}
                onUpdateNote={updateNote}
                onRemoveNote={removeNote}
                onUploadNoteArt={(noteId, f) => void uploadNoteArt(noteId, f)}
                onRemoveMap={() => removeMap(activeMap.id)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
