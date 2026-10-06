# Graph Report - VibeDND  (2026-10-03)

## Corpus Check
- 53 files · ~206,013 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .css 5, (none) 3)

## Summary
- 520 nodes · 944 edges · 30 communities (27 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.86)
- Token cost: 137,461 input · 0 output

## Community Hubs (Navigation)
- Game Server & SQLite
- Web App Shell & Routing
- Build Plan & Steps
- Map Canvas Rendering
- Web Dependencies
- Server Dependencies
- Game Rules Engine
- Character Sheet Component
- Shared Type Definitions
- WebSocket Realtime Layer
- Spell View & Player Page
- Entity Library & Monster Editor
- Adventure & Map Editor
- Root Workspace Config
- Character Creation Wizard
- WS Protocol Contract
- Shared Package Config
- Base TypeScript Config
- Item Editor
- Server TS Config
- Spell Editor
- Web TS Config
- Shared TS Config
- Equipment Rules
- Battle Map Upload
- Proficiency Rules
- Agent Build Workflow
- Seed Content & Editors
- Token Download Script
- Grid Battle Map Photo

## God Nodes (most connected - your core abstractions)
1. `react` - 19 edges
2. `lucide-react` - 18 edges
3. `api` - 16 edges
4. `MapCanvas()` - 14 edges
5. `SessionSocket` - 14 edges
6. `react-router-dom` - 13 edges
7. `App()` - 13 edges
8. `compilerOptions` - 12 edges
9. `SpellCard()` - 10 edges
10. `DmPage()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Locked Mobile Viewport and Dark Theme Color` --conceptually_related_to--> `Player Phone View (/player/:characterId)`  [INFERRED]
  web/index.html → DESIGN.md
- `Cinzel Heading Font (Google Fonts)` --conceptually_related_to--> `Open Free Asset Sources (Google Fonts, Lucide, game-icons.net, CSS animations)`  [INFERRED]
  web/index.html → DESIGN.md
- `Noto Sans Body Font (Google Fonts)` --conceptually_related_to--> `Open Free Asset Sources (Google Fonts, Lucide, game-icons.net, CSS animations)`  [INFERRED]
  web/index.html → DESIGN.md
- `Existing Monorepo Scaffold (shared/server/web workspaces)` --references--> `Web Entry HTML Page (web/index.html)`  [EXTRACTED]
  BUILD-PLAN.md → web/index.html
- `Open-Only Design Resources Policy` --references--> `Web Entry HTML Page (web/index.html)`  [EXTRACTED]
  BUILD-PLAN.md → web/index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Subagent Build Pipeline (Steps 1-7)** — build_plan_subagent_workflow, build_plan_step_1_server, build_plan_step_2_seed, build_plan_step_3_characters, build_plan_step_4_map, build_plan_step_5_player, build_plan_step_6_adventures, build_plan_step_7_entity_editors [EXTRACTED 1.00]
- **VibeDND Data Model (Character / Adventure / Session)** — design_data_model_character, design_data_model_adventure, design_data_model_session [EXTRACTED 1.00]
- **Build Steps Bound by the shared/src Contract** — build_plan_shared_contract, build_plan_step_2_seed, build_plan_step_3_characters, build_plan_step_4_map, build_plan_step_5_player, build_plan_step_6_adventures, build_plan_step_7_entity_editors [EXTRACTED 1.00]

## Communities (30 total, 3 thin omitted)

### Community 0 - "Game Server & SQLite"
Cohesion: 0.06
Nodes (42): express, DATA_DIR, db, DB_PATH, deleteAdventure(), deleteCharacter(), deleteRow(), deleteSession() (+34 more)

### Community 1 - "Web App Shell & Routing"
Cohesion: 0.13
Nodes (24): lucide-react, react-router-dom, api, App(), AdventureLibrary(), formatDate(), BoardPage(), ECC_TABLE (+16 more)

### Community 2 - "Build Plan & Steps"
Cohesion: 0.08
Nodes (33): VibeDND Step-by-Step Build Plan, game-icons.net Token Icons (CC-BY 3.0), Existing Monorepo Scaffold (shared/server/web workspaces), Shared Types and WS Protocol Contract (shared/src), Step 10 — Manual Tabletop Run Checklist, Step 1 — Game Server (Express, SQLite, REST, WebSocket), Step 3 — Character Library, Creation Wizard, Character Sheet, Step 4 — Map Engine, Board Page, DM Console (+25 more)

### Community 3 - "Map Canvas Rendering"
Cohesion: 0.09
Nodes (25): Camera, clamp(), CONDITION_SHORT, DRAW_COLORS, drawFog(), drawGrid(), drawStrokeShape(), FEET_PER_CELL (+17 more)

### Community 4 - "Web Dependencies"
Cohesion: 0.07
Nodes (27): react, react-dom, @types/react, @types/react-dom, vite, @vitejs/plugin-react, dependencies, lucide-react (+19 more)

### Community 5 - "Server Dependencies"
Cohesion: 0.07
Nodes (27): better-sqlite3, tsx, @types/better-sqlite3, @types/express, @types/ws, ws, dependencies, better-sqlite3 (+19 more)

### Community 6 - "Game Rules Engine"
Cohesion: 0.09
Nodes (20): abilityModifier(), ALL_ARMOR_TYPES, ALL_WEAPON_CATS, averageHpGain(), CLASS_PROFICIENCIES, DiceRoll, EquipCheck, firstLevelHp() (+12 more)

### Community 7 - "Character Sheet Component"
Cohesion: 0.13
Nodes (8): CharacterSheet(), CharacterSheetProps, CONDITION_KEYS, FeatureLine(), RollResult, SKILL_KEYS, SpellCard(), CharacterEdit()

### Community 8 - "Shared Type Definitions"
Cohesion: 0.08
Nodes (24): ABILITIES, ABILITY_NAMES_RU, Adventure, AdventureMap, ArmorProficiency, AttackEntry, Background, characterLevel (+16 more)

### Community 9 - "WebSocket Realtime Layer"
Cohesion: 0.20
Nodes (16): attachWebSocket(), broadcast(), Client, clients, filterSessionForRole(), handleMessage(), liveSessions, loadSession() (+8 more)

### Community 10 - "Spell View & Player Page"
Cohesion: 0.15
Nodes (8): SpellDetails(), spellLevelText(), CATEGORY_RU, HpBar(), SpellRow(), Tab, TabContent(), TABS

### Community 11 - "Entity Library & Monster Editor"
Cohesion: 0.14
Nodes (13): emptyAttack(), emptyMonster(), MonsterEditor(), NameDesc, Props, SPELL_SCHOOL_NAMES_RU, AnyEntity, EntityLibrary() (+5 more)

### Community 12 - "Adventure & Map Editor"
Cohesion: 0.14
Nodes (12): AdventureEdit(), DEFAULT_GRID, KIND_LABEL, MapDims, MapEditor(), MapEditorProps, pct(), StageSize (+4 more)

### Community 13 - "Root Workspace Config"
Cohesion: 0.12
Nodes (15): allowScripts, better-sqlite3@12.11.1, esbuild@0.21.5, esbuild@0.28.2, devDependencies, concurrently, name, private (+7 more)

### Community 14 - "Character Creation Wizard"
Cohesion: 0.15
Nodes (5): CharacterNew(), bgBonusObj(), buildAttacks(), Refs, STEP_NAMES

### Community 15 - "WS Protocol Contract"
Cohesion: 0.14
Nodes (12): ClientMsg, Role, ServerMsg, Character, ConditionKey, DiceLogEntry, DrawStroke, FogShape (+4 more)

### Community 16 - "Shared Package Config"
Cohesion: 0.15
Nodes (12): devDependencies, typescript, exports, typescript, main, name, private, scripts (+4 more)

### Community 17 - "Base TypeScript Config"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution, noUncheckedIndexedAccess, resolveJsonModule (+4 more)

### Community 18 - "Item Editor"
Cohesion: 0.22
Nodes (6): CATEGORIES, CATEGORY_NAMES_RU, emptyItem(), ItemCategory, ItemEditor(), Props

### Community 19 - "Server TS Config"
Cohesion: 0.22
Nodes (8): compilerOptions, module, moduleResolution, outDir, rootDir, extends, include, ../tsconfig.base.json

### Community 20 - "Spell Editor"
Cohesion: 0.28
Nodes (6): emptySpell(), LEVEL_NAMES(), Props, SCHOOL_NAMES_RU, SCHOOLS, SpellEditor()

### Community 21 - "Web TS Config"
Cohesion: 0.25
Nodes (7): compilerOptions, jsx, lib, noEmit, extends, include, ../tsconfig.base.json

### Community 22 - "Shared TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, ../tsconfig.base.json

### Community 23 - "Equipment Rules"
Cohesion: 0.47
Nodes (6): armorTypeOf(), canEquip(), isBodyArmor(), isShieldItem(), isTwoHanded(), usedHands()

### Community 24 - "Battle Map Upload"
Cohesion: 0.67
Nodes (4): Fantasy Village Battle Map (upload), Stone Castle Tower with Red Conical Roof, River, Dirt Roads and Terrain, Village Houses, Bridge, Tents and Palisades

### Community 25 - "Proficiency Rules"
Cohesion: 0.50
Nodes (4): classArmorProfs(), classWeaponProfs(), isProficientWith(), weaponCategoryOf()

### Community 27 - "Seed Content & Editors"
Cohesion: 0.67
Nodes (3): Step 2 — D&D 2024 Seed Content (species, classes, spells, monsters), Step 7 — Monster/Spell/Item Entity Editors, Content Import and MVP Entity Editors (monster, spell, item)

## Knowledge Gaps
- **196 isolated node(s):** `name`, `private`, `version`, `workspaces`, `dev` (+191 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 232 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Web Dependencies` to `Web App Shell & Routing`, `Map Canvas Rendering`, `Character Sheet Component`, `Spell View & Player Page`, `Entity Library & Monster Editor`, `Adventure & Map Editor`, `Character Creation Wizard`, `Item Editor`, `Spell Editor`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `Web App Shell & Routing` to `Map Canvas Rendering`, `Web Dependencies`, `Character Sheet Component`, `Spell View & Player Page`, `Entity Library & Monster Editor`, `Adventure & Map Editor`, `Character Creation Wizard`, `Item Editor`, `Spell Editor`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `ws` connect `Server Dependencies` to `WebSocket Realtime Layer`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _196 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Game Server & SQLite` be split into smaller, more focused modules?**
  _Cohesion score 0.056107539450613676 - nodes in this community are weakly interconnected._
- **Should `Web App Shell & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.12944523470839261 - nodes in this community are weakly interconnected._
- **Should `Build Plan & Steps` be split into smaller, more focused modules?**
  _Cohesion score 0.07657657657657657 - nodes in this community are weakly interconnected._