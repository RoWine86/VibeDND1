// ─── Базовые типы домена VibeDND (D&D 2024) ────────────────────────────────

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

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
}

export type WeaponCategory = 'simple' | 'martial';
export type ArmorProficiency = 'light' | 'medium' | 'heavy' | 'shield';

export interface Item {
  id: string;
  nameRu: string;
  nameEn: string;
  category: 'weapon' | 'armor' | 'gear' | 'tool' | 'magic' | 'consumable';
  weight?: number;
  cost?: string;
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
  createdAt: string;
  updatedAt: string;
}

export type FogShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'brush'; points: number[]; radius: number };
