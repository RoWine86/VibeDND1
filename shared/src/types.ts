// ─── Базовые типы домена VibeDND (D&D 2024) ────────────────────────────────

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// ─── Валюта (D&D 2024) ──────────────────────────────────────────────────────
// Четыре номинала: медь (мм/cp), серебро (см/sp), золото (зм/gp), платина
// (пм/pp). Конверсия: 1 пм = 10 зм = 100 см = 1000 мм. Электрума нет.

/** Ключи монет: cp/sp/gp/pp (в данных), русские сокращения — в COIN_NAMES_RU. */
export type Currency = 'cp' | 'sp' | 'gp' | 'pp';

export const CURRENCIES: Currency[] = ['cp', 'sp', 'gp', 'pp'];

export const COIN_NAMES_RU: Record<Currency, string> = {
  cp: 'мм', sp: 'см', gp: 'зм', pp: 'пм',
};

export const COIN_FULL_NAMES_RU: Record<Currency, string> = {
  cp: 'медные', sp: 'серебряные', gp: 'золотые', pp: 'платиновые',
};

/** Стоимость монеты в меди (мм) — для конверсии и сравнения. */
export const COIN_VALUE_IN_CP: Record<Currency, number> = {
  cp: 1, sp: 10, gp: 100, pp: 1000,
};

/** Кошелёк: четыре целых счётчика по номиналам. */
export interface Coins {
  cp: number;
  sp: number;
  gp: number;
  pp: number;
}

/** Цена предмета: сумма в одной валюте (структурно вместо строки «15 зм»). */
export interface Cost {
  amount: number;
  currency: Currency;
}

export const ABILITY_NAMES_RU: Record<Ability, string> = {
  str: 'Сила',
  dex: 'Ловкость',
  con: 'Телосложение',
  int: 'Интеллект',
  wis: 'Мудрость',
  cha: 'Харизма',
};

export type SkillKey =
  | 'acrobatics' | 'animal_handling' | 'arcana' | 'athletics' | 'deception'
  | 'history' | 'insight' | 'intimidation' | 'investigation' | 'medicine'
  | 'nature' | 'perception' | 'performance' | 'persuasion' | 'religion'
  | 'sleight_of_hand' | 'stealth' | 'survival';

export const SKILL_ABILITY: Record<SkillKey, Ability> = {
  acrobatics: 'dex', animal_handling: 'wis', arcana: 'int', athletics: 'str',
  deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha',
  investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int',
  sleight_of_hand: 'dex', stealth: 'dex', survival: 'wis',
};

export const SKILL_NAMES_RU: Record<SkillKey, string> = {
  acrobatics: 'Акробатика', animal_handling: 'Уход за животными', arcana: 'Магия',
  athletics: 'Атлетика', deception: 'Обман', history: 'История', insight: 'Проницательность',
  intimidation: 'Запугивание', investigation: 'Расследование', medicine: 'Медицина',
  nature: 'Природа', perception: 'Восприятие', performance: 'Выступление',
  persuasion: 'Убеждение', religion: 'Религия', sleight_of_hand: 'Ловкость рук',
  stealth: 'Скрытность', survival: 'Выживание',
};

export type ConditionKey =
  | 'blinded' | 'charmed' | 'deafened' | 'exhaustion' | 'frightened' | 'grappled'
  | 'incapacitated' | 'invisible' | 'paralyzed' | 'petrified' | 'poisoned'
  | 'prone' | 'restrained' | 'stunned' | 'unconscious';

export const CONDITION_NAMES_RU: Record<ConditionKey, string> = {
  blinded: 'Ослепление', charmed: 'Очарование', deafened: 'Глухота',
  exhaustion: 'Истощение', frightened: 'Испуг', grappled: 'Захват',
  incapacitated: 'Недееспособность', invisible: 'Невидимость', paralyzed: 'Паралич',
  petrified: 'Окаменение', poisoned: 'Отравление', prone: 'Сбит с ног',
  restrained: 'Опутанность', stunned: 'Оглушение', unconscious: 'Без сознания',
};

export type TokenKind = 'player' | 'enemy' | 'npc';

// ─── Справочные сущности (база контента) ────────────────────────────────────

export interface Species {
  id: string;
  nameRu: string;
  nameEn: string;
  size: 'S' | 'M';
  speed: number; // футы
  description: string;
  traits: { name: string; description: string }[];
}

export interface ClassLevelFeature {
  level: number;
  name: string;
  description: string;
}

export interface CharacterClass {
  id: string;
  nameRu: string;
  nameEn: string;
  hitDie: number; // 6/8/10/12
  primaryAbilities: Ability[];
  savingThrows: Ability[];
  spellcastingAbility?: Ability;
  // Лимиты известных заклинаний на 1 уровне: [заговоры, заклинания 1 ур.].
  // Без поля — лимитов нет.
  spellsKnownAt1?: [number, number];
  features: ClassLevelFeature[];
  spellSlotsByLevel?: Record<number, number[]>; // уровень персонажа → ячейки [ур1, ур2, ...]
  subclassLevel: number;
  /** Кости стартового золота (PHB 2024): бросок dice × multiply в зм.
   *  Например воин — { dice: '5d4', multiply: 10 }. */
  startingGold?: { dice: string; multiply: number };
  // Владение снаряжением (D&D 2024). Необязательно: если поле отсутствует,
  // профили владения выводятся по id класса (см. rules.ts).
  weaponProficiencies?: {
    categories: WeaponCategory[]; // категории оружия
    itemIds: string[];            // конкретные предметы сверх категорий
  };
  armorProficiencies?: ArmorProficiency[]; // типы брони и щиты
}

export interface Background {
  id: string;
  nameRu: string;
  nameEn: string;
  abilityScoreOptions: Ability[]; // из каких характеристик выбрать +2/+1
  skillProficiencies: SkillKey[];
  toolProficiency: string;
  feat: string;
  equipment: string;
  description: string;
}

export type SpellSchool = 'abjuration' | 'conjuration' | 'divination' | 'enchantment'
  | 'evocation' | 'illusion' | 'necromancy' | 'transmutation';

export interface Spell {
  id: string;
  nameRu: string;
  nameEn: string;
  level: number; // 0 = заговор
  school: SpellSchool;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  classes: string[]; // id классов

  // ── Оцифровка для боевого движка (ROADMAP, шаг 1) ────────────────────────
  // Все поля необязательны: отсутствие трактуется движком как «без урона».
  // Заговоры (level 0) кастуются без ячеек — это логика движка, не поле.
  /** Как разрешается эффект: атака заклинанием / спасбросок / без урона. */
  effectType?: 'attack' | 'save' | 'utility';
  /** Выбор целей: одна цель или область/мультивыбор. */
  targeting?: 'single' | 'area';
  /** Характеристика спасброска (при effectType === 'save'). */
  saveAbility?: Ability;
  /** Бросок атаки не совершается — попадание автоматически (волшебная стрела). */
  autoHit?: boolean;
  /**
   * Кости эффекта за одно попадание/дротик/луч (или на проваленном спасе),
   * напр. "8d6". Для лечащих заклинаний (heals) — кости лечения без
   * модификатора заклинательной характеристики (его добавляет движок).
   */
  damageDice?: string;
  /** Тип урона по-русски: огонь, излучение, силовое поле, звук… */
  damageType?: string;
  /** Заклинание лечит, а не наносит урон (cure wounds, healing word). */
  heals?: boolean;
  /**
   * Число дротиков/лучей при базовом касте, по каждому отдельный бросок
   * (magic missile — 3, scorching ray — 3). По умолчанию 1.
   */
  projectiles?: number;
  /** Успешный спас уменьшает урон вдвое; иначе при успехе урона нет. */
  halfOnSuccess?: boolean;
  /**
   * Масштабирование ячейкой выше базового уровня. perSlotLevel — строка из
   * книги: костяная прибавка ("+1d6", "+2d8") разрешается движком как доп.
   * урон/лечение за каждый уровень ячейки; прочее ("+1 цель", "+1 луч",
   * "+1 дротик", "+2 фута радиуса") — информация для UI и спецслучаев.
   */
  upcast?: { perSlotLevel: string };
}

export type WeaponCategory = 'simple' | 'martial';
export type ArmorProficiency = 'light' | 'medium' | 'heavy' | 'shield';

export interface Item {
  id: string;
  nameRu: string;
  nameEn: string;
  category: 'weapon' | 'armor' | 'gear' | 'tool' | 'magic' | 'consumable';
  weight?: number;
  /** Цена предмета (шаг 6): {amount, currency} вместо строки «15 зм». */
  cost?: Cost;
  description: string;
  // для оружия:
  damageDice?: string; // "1d8"
  damageType?: string;
  weaponAbility?: Ability; // обычно str/dex
  properties?: string[];
  weaponCategory?: WeaponCategory; // simple/martial; выводится из id, если не задано
  // для брони:
  armorClassBase?: number;
  addDexToAC?: boolean;
  maxDexBonus?: number;
  armorType?: 'light' | 'medium' | 'heavy'; // выводится из armorClassBase, если не задано (щит = id 'shield')
  isShield?: boolean; // щит: определяется по id 'shield', если не задано
  magic?: boolean; // магический предмет (может требовать настройки)
  requiresAttunement?: boolean;
  rarity?: 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary' | 'artifact';
}

export interface AttackEntry {
  name: string;
  attackBonus: number;
  damageDice: string;
  damageBonus: number;
  damageType: string;
}

export interface Monster {
  id: string;
  nameRu: string;
  nameEn: string;
  size: string;
  type: string;
  alignment: string;
  armorClass: number;
  hitPoints: number;
  hitDice: string;
  speed: string;
  abilities: Record<Ability, number>;
  savingThrows?: Partial<Record<Ability, number>>;
  skills?: Partial<Record<SkillKey, number>>;
  damageResistances?: string;
  damageImmunities?: string;
  conditionImmunities?: string;
  senses: string;
  languages: string;
  challengeRating: string;
  traits: { name: string; description: string }[];
  actions: { name: string; description: string }[];
  attacks: AttackEntry[];
  imagePath?: string;

  // ── Монстры-заклинатели (ROADMAP, шаг 1) ─────────────────────────────────
  // Только у явных кастеров; текущие ячейки живут на токене сессии, чтобы
  // два одинаковых монстра тратили их раздельно (максимум — отсюда).
  /** id заклинаний из spells.json. */
  spells?: string[];
  /** Ячейки по уровням 1..9 (индекс 0 = уровень 1). */
  spellSlots?: { max: number[]; current: number[] };
  /** Характеристика заклинаний монстра (СЛ и бонус атаки — от неё). */
  spellcastingAbility?: Ability;
  /** Уровень заклинателя монстра — для бонуса мастерства в СЛ/атаке. */
  casterLevel?: number;
}

// ─── Персонаж ───────────────────────────────────────────────────────────────

export interface AbilityScores {
  str: number; dex: number; con: number; int: number; wis: number; cha: number;
}

export interface CharacterLevel {
  classId: string;
  level: number;
  hpRolls: number[]; // броски кости хитов за каждый уровень после первого
  chosenSpells: string[]; // id заклинаний
}

export interface ClassResource {
  id: string;
  name: string;
  max: number;
  current: number;
  resetOn: 'short' | 'long';
}

export interface Character {
  id: string;
  name: string;
  playerName: string;
  speciesId: string;
  backgroundId: string;
  classes: CharacterLevel[]; // мультикласс поддерживается структурой
  abilityScores: AbilityScores; // базовые (до бонусов предыстории)
  backgroundBonuses: Partial<Record<Ability, number>>; // +2/+1
  skillProficiencies: SkillKey[];
  expertise: SkillKey[];
  savingThrowProficiencies: Ability[];

  maxHp: number;
  currentHp: number;
  tempHp: number;
  hitDiceTotal: number;
  hitDiceCurrent: number;
  hitDieType: number;
  // Бросок кости хитов при повышении уровня, ждущий подтверждения мастера.
  // Пока не null — прирост НЕ применён; переброс возможен только после сброса мастером.
  pendingHpGain?: { roll: number; classId: string; level: number } | null;

  spellSlotsMax: number[]; // по уровням 1..9
  spellSlotsCurrent: number[];
  knownSpells: string[];
  preparedSpells: string[];

  conditions: ConditionKey[];
  concentratingOn?: string; // id заклинания
  attunedItemIds: string[]; // макс 3
  inventory: { itemId: string; quantity: number; equipped: boolean }[];

  resources: ClassResource[];
  attacks: AttackEntry[];

  deathSaves: { successes: number; failures: number };
  inspiration: boolean;
  portraitPath?: string;
  notes: string;
  /** Кошелёк (шаг 6). У старых персонажей в базе поля нет — сервер
   *  подставляет нули при чтении (см. db.ts). */
  coins: Coins;
}

/** Персонаж без кошелька (старые снапшоты) — нормализуется в zeroCoins(). */
export function zeroCoins(): Coins {
  return { cp: 0, sp: 0, gp: 0, pp: 0 };
}

/** Персонаж как пришёл из хранилища: coins может отсутствовать. */
export function withCoins(ch: Character): Character {
  return ch.coins ? ch : { ...ch, coins: zeroCoins() };
}

export function characterLevel(ch: Character): number {
  return (ch.classes ?? []).reduce((sum, c) => sum + c.level, 0);
}

// ─── Приключение ────────────────────────────────────────────────────────────

export interface MapCalibration {
  originX: number; // px левого верхнего угла первой клетки на изображении
  originY: number;
  cellSize: number; // px на клетку
  cols: number;
  rows: number;
}

export interface AdventureMap {
  id: string;
  name: string;
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  grid: MapCalibration;
}

export interface TokenTemplate {
  id: string;
  mapId: string;
  kind: TokenKind;
  name: string;
  monsterId?: string;
  x: number; // клетки
  y: number;
  sizeCells: number; // 1 = средний
  imagePath?: string;
  hidden: boolean; // скрыт от доски до раскрытия мастером
}

export interface SceneNote {
  id: string;
  mapId: string;
  title: string;
  body: string;
  artPath?: string;
}

export interface Adventure {
  id: string;
  name: string;
  description: string;
  source: string; // откуда взято
  maps: AdventureMap[];
  tokens: TokenTemplate[];
  notes: SceneNote[];
  createdAt: string;
  updatedAt: string;
}

// ─── Сессия ─────────────────────────────────────────────────────────────────

export type DrawShape =
  | { tool: 'pen'; points: number[]; color: string; width: number }
  | { tool: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { tool: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { tool: 'circle'; cx: number; cy: number; r: number; color: string; width: number };

export interface DrawStroke {
  id: string;
  mapId: string;
  shape: DrawShape;
}

export interface LiveToken {
  id: string;
  mapId: string;
  kind: TokenKind;
  name: string;
  x: number;
  y: number;
  sizeCells: number;
  imagePath?: string;
  hidden: boolean;
  // боевое состояние (для врагов/НПС; у игроков HP берётся из персонажа)
  characterId?: string;
  monsterId?: string;
  currentHp: number;
  maxHp: number;
  conditions: ConditionKey[];
  // ячейки заклинаний монстра-кастера: живут на токене сессии, чтобы два
  // одинаковых монстра тратили их раздельно (максимум — из Monster.spellSlots)
  spellSlotsMax?: number[];
  spellSlotsCurrent?: number[];
  /** id заклинания, на котором токен держит концентрацию. */
  concentratingOn?: string;
}

export interface InitiativeEntry {
  id: string;
  name: string;
  roll: number;
  tokenId?: string;
  characterId?: string;
  kind: TokenKind;
}

export interface CombatState {
  active: boolean;
  round: number;
  entries: InitiativeEntry[];
  currentIndex: number;
}

// ─── Боевой движок (ROADMAP, шаг 2) ─────────────────────────────────────────

/**
 * Структурированное событие боя. Рассылается как ServerMsg 'combatEvent'
 * и копится в session.combatLog (снапшот отдаёт лог целиком).
 * Фаза задаёт смысл события; остальные поля заполняются по ситуации —
 * клиенты (анимации шага 5, лог доски шага 4) читают только нужные.
 */
export type CombatEventPhase =
  | 'cast'              // заклинание сотворено (до бросков урона/спасов)
  | 'attack'            // бросок атаки по цели (попадание/промах/крит)
  | 'damage'            // урон применён к цели
  | 'heal'              // лечение применено
  | 'save-request'      // создан запрос спасброска (ждёт в очереди)
  | 'save-result'       // спасбросок разрешён
  | 'concentration'     // авто-спас концентрации при уроне
  | 'death'             // токен достиг 0 хитов
  | 'rest';             // короткий/длинный отдых

export interface CombatAttackRoll {
  d20: number;
  bonus: number;
  total: number;
  ac: number;
  hit: boolean;
  crit: boolean;   // натуральная 20: автопопадание, кости урона удвоены
  fumble: boolean; // натуральная 1: автопромах
}

export interface CombatEvent {
  id: string;
  timestamp: number;
  phase: CombatEventPhase;
  // источник действия
  sourceName: string;
  sourceTokenId?: string;
  sourceCharacterId?: string;
  // цель (для событий по одной цели)
  targetName?: string;
  targetTokenId?: string;
  targetCharacterId?: string;
  // что применено
  spellId?: string;
  spellName?: string;
  school?: SpellSchool; // цвет анимации заклинания (шаг 5)
  attackName?: string;
  slotLevel?: number;
  // результаты бросков
  attack?: CombatAttackRoll;
  damage?: {
    dice: string;
    rolls: number[];
    bonus: number;
    total: number;      // итог до halved/применения
    halved: boolean;    // урон уменьшен вдвое успешным спасом
    applied: number;    // сколько реально списано хитов
    damageType?: string;
  };
  heal?: { dice: string; rolls: number[]; bonus: number; total: number; applied: number };
  save?: {
    requestId?: string;
    ability: Ability;
    dc: number;
    bonus: number;
    d20?: number;        // нет, пока бросок не сделан
    total?: number;
    success?: boolean;
    physical?: boolean;  // результат вписан с физического кубика
  };
  concentration?: {
    spellId?: string;
    spellName?: string;
    dc: number;
    d20: number;
    bonus: number;
    success: boolean;
    lost: boolean; // концентрация снята
  };
  rest?: { kind: 'short' | 'long'; healed?: number; hitDieRoll?: number };
  /** Человекочитаемая строка боевого лога (лента доски, шаг 4). */
  text: string;
}

/**
 * Запрос спасброска в очереди сессии. Кто кидает: монстров — мастер
 * (rollerIsDm, resolveSave); персонажа — владелец (saveRoll/saveResult),
 * мастер может вписать за игрока (фолбэк, тоже resolveSave).
 * Урон уже вычислен и ждёт в pendingDamage (halfOnSuccess применится
 * при разрешении).
 */
export interface SaveRequest {
  id: string;
  createdAt: number;
  ability: Ability;
  dc: number;
  /** Бонус спасброска кидающего (профицит персонажа или бонус монстра). */
  bonus: number;
  halfOnSuccess: boolean;
  // кто спасается
  tokenId?: string;
  characterId?: string;
  rollerName: string;
  rollerIsDm: boolean;
  // отложенный урон
  pendingDamage: {
    dice: string;
    rolls: number[];
    total: number; // сумма до спасброска
    damageType?: string;
  };
  // источник (лог и анимации)
  sourceName: string;
  sourceTokenId?: string;
  sourceCharacterId?: string;
  spellId?: string;
  spellName?: string;
}

/**
 * Скрытая заявка игрока мастеру (шаг 8): свободный текст («хочу незаметно
 * стащить ключ»), который видят только отправитель и мастер — в общий лог
 * не попадает. Мастер одобряет/отклоняет и может написать ответ.
 */
export interface SecretRequest {
  id: string;
  characterId: string;
  text: string;
  status: 'pending' | 'approved' | 'rejected';
  /** Необязательный ответ мастера («кинь Ловкость (Ловкость рук)»). */
  reply?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface DiceLogEntry {
  id: string;
  timestamp: number;
  rollerName: string;
  label: string; // "Атака мечом", "Проверка Восприятия"
  formula: string; // "1d20+5"
  total: number;
  rolls: number[];
  hidden: boolean; // скрытый бросок мастера — на доску не идёт
}

export interface SessionState {
  id: string;
  adventureId: string;
  name: string;
  activeMapId?: string;
  tokens: LiveToken[];
  // туман: список прямоугольных/кистевых областей, открытых мастером
  fogReveals: { id: string; mapId: string; shape: FogShape }[];
  drawings: DrawStroke[];
  combat: CombatState;
  characterIds: string[]; // партия
  diceLog: DiceLogEntry[];
  /** Очередь ожидающих спасбросков (шаг 2). Пусто для старых снапшотов. */
  saveRequests?: SaveRequest[];
  /** Лента структурных событий боя; старые сессии могут её не иметь. */
  combatLog?: CombatEvent[];
  /** Скрытые заявки игроков (шаг 8); видны только отправителю и мастеру. */
  secretRequests?: SecretRequest[];
  createdAt: string;
  updatedAt: string;
}

export type FogShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'brush'; points: number[]; radius: number };
