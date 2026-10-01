# VibeDND — пошаговый план сборки с готовыми промптами

Этот документ — самодостаточная инструкция. Открой **новый чат** в папке `/Users/deathking./Desktop/VibeDND` и выполняй шаги по порядку, вставляя промпты как есть. Дизайн зафиксирован в [DESIGN.md](DESIGN.md), контракт типов и WS-протокол — в `shared/src/`, каркас монорепо уже лежит в проекте.

## Что уже готово в репозитории (не пересоздавать)

- `DESIGN.md` — подтверждённый дизайн-документ.
- `package.json`, `tsconfig.base.json`, `.gitignore` — корень монорепы (workspaces: shared, server, web).
- `shared/src/types.ts` — все доменные типы (D&D 2024: персонаж, приключение, сессия, токены, туман, инициатива).
- `shared/src/rules.ts` — движок правил (модификаторы, standard array/point buy, кости, концентрация).
- `shared/src/protocol.ts` — протокол WebSocket (ClientMsg/ServerMsg).
- `server/package.json`, `server/tsconfig.json`, `server/src/index.ts` (заглушка).
- `web/package.json`, `web/vite.config.ts` (прокси /api, /uploads, /ws на :3001), `web/index.html` (шрифты Cinzel + Noto Sans), `web/src/main.tsx`, `web/src/App.tsx` (роутинг), `web/src/styles/global.css` (тёмная «гримуарная» тема, CSS-анимации), `web/src/ws.ts` (WS-клиент с автореконнектом), `web/src/api.ts` (REST-клиент), `web/src/pages/*.tsx` (заглушки 10 страниц).

## Дизайн-ресурсы (только открытые бесплатные)

- Шрифты: Google Fonts — Cinzel (заголовки), Noto Sans (текст). Уже подключены в `web/index.html`.
- Иконки UI: `lucide-react` (ISC) — уже в зависимостях web.
- Плейсхолдеры токенов: **game-icons.net** (CC-BY 3.0, скачать ~30 SVG в `web/public/tokens/`, указать атрибуцию в приложении: «Token icons: game-icons.net, CC-BY 3.0»).
- Анимации: чистый CSS (классы `anim-*` в global.css), без библиотек.

---

## Шаг 0 — Установка зависимостей

⚠️ npm install из песочницы может быть заблокирован сетевой политикой. Если так — выполни в своём терминале (Claude может открыть вкладку терминала командой).

**Промпт:**

> Выполни `npm install` в корне проекта. Если песочница блокирует доступ к registry.npmjs.org — запусти команду через инструмент терминала (mcp__terminal__run_in_terminal), чтобы она выполнилась в моей сессии. Затем проверь: `npm run build -w shared` должен собрать shared без ошибок. Застрявшие зависимости не меняй — сообщи мне.

---

## Шаг 1 — Сервер (агент)

Файлы, которые получатся: `server/src/{index,db,rest,ws,uploads}.ts`.

**Промпт:**

> Запусти субагента (Agent tool) со следующим заданием:
>
> «Ты реализуешь серверную часть VibeDND — локального веб-приложения для живых игр D&D 2024. Рабочая директория: /Users/deathking./Desktop/VibeDND. Сначала прочитай DESIGN.md, shared/src/types.ts, shared/src/protocol.ts, shared/src/rules.ts — это обязательный контракт. Пиши код ТОЛЬКО в server/src/ (index.ts — заглушка, перепиши). Комментарии и сообщения ошибок — на русском. TypeScript strict.
>
> 1. Express на порту 3001, express.json(). Статика: data/uploads/ отдаётся по /uploads/.
> 2. SQLite (better-sqlite3), файл data/vibednd.db. Таблицы: characters(id TEXT PK, data TEXT), adventures(id TEXT PK, data TEXT), sessions(id TEXT PK, data TEXT), entities(kind TEXT, id TEXT, data TEXT, PK(kind,id)) — записи как цельный JSON. Автосохранение: после каждой мутации сессии — синхронная запись в SQLite.
> 3. REST (/api): CRUD для characters, adventures; sessions: GET список/одна, POST {adventureId, name} (создаёт SessionState из Adventure: TokenTemplate[] → LiveToken[] с HP из статблока монстра, туман пустой), DELETE; entities: GET /api/entities/:kind, GET /:kind/:id, POST (upsert), DELETE; POST /api/upload — raw body (express.raw 50mb), имя файла из заголовка x-filename, сохранение в data/uploads/ под uuid-именем, ответ {path}; GET /api/health; GET /api/sessions/:id/join-info → {url: "http://<LAN-IP>:5173/player/<sessionId>"} (LAN IP через os.networkInterfaces).
> 4. WebSocket /ws (библиотека ws, тот же порт) по протоколу shared/src/protocol.ts: hello → комната сессии + snapshot (player получает только своего персонажа; скрытые броски — только dm). Обработчики всех ClientMsg: мутируют состояние, сохраняют в SQLite, рассылают ServerMsg в комнату. Права: сообщения мастера — только от dm; characterPatch — player только своего персонажа, dm любого; rollDice с hidden=true — только dm. Синхронизация HP: characterPatch ↔ токен с characterId в обе стороны (characterUpdated / tokenUpsert). rollDice через rollDice из @vibednd/shared, diceLog ≤ 200 записей. Инициатива: initiativeStart (сортировка по roll ↓, round 1), initiativeNext (с переходом раунда), initiativeEnd.
> 5. Стиль: модули db.ts, rest.ts, ws.ts, uploads.ts, index.ts. npm install НЕ запускать. В отчёте — список файлов и отклонения от ТЗ.»
>
> После завершения агента проверь сборку: `npm run build -w server`. Ошибки исправь сам или верни агенту через SendMessage.

---

## Шаг 2 — Сид контента 5.5e (агент)

**Промпт:**

> Запусти субагента со следующим заданием:
>
> «Подготовь стартовый контент D&D 2024 для VibeDND. Рабочая директория: /Users/deathking./Desktop/VibeDND. Прочитай shared/src/types.ts — данные должны строго соответствовать типам Species, CharacterClass, Background, Spell, Item, Monster. id — kebab-case латиницей, nameRu и nameEn обязательны.
>
> Создай валидные JSON (массивы объектов):
> - server/data/seed/species.json — 10 видов 2024: человек, эльф, дварф, полурослик, гном, драконорождённый, тифлинг, орк, голиаф, аасимар.
> - server/data/seed/classes.json — 12 классов: бард, варвар, воин, волшебник, друид, жрец, колдун, монах, паладин, плут, следопыт, чародей. Кость хитов, основные характеристики, спасброски, заклинательная характеристика, умения уровней 1–3, subclassLevel, spellSlotsByLevel (полные заклинатели — стандартная таблица 1–12; паладин/следопыт — полузаклинатели; колдун — pact magic).
> - server/data/seed/backgrounds.json — 8 предысторий 2024: аколит, преступник, мудрец, солдат, народный герой, шарлатан, ремесленник, беспризорник (ровно 3 abilityScoreOptions, 2 навыка, инструмент, черта, снаряжение).
> - server/data/seed/spells.json — 30 ходовых заклинаний уровней 0–3 (огненный шар, волшебная стрела, лечение ран, щит, благословение, удержание личности, туманный шаг, метка охотника…).
> - server/data/seed/items.json — 20 предметов: базовое оружие, броня, снаряжение, зелье лечения.
> - server/data/seed/monsters.json — 12 монстров низких уровней с полными статблоками и атаками (AttackEntry): гоблин, кобольд, скелет, зомби, волк, огр, багбер, хобгоблин, тень, гигантская крыса, псевдодракон, молодой зелёный дракон.
>
> И скрипт server/src/seed.ts: читает JSON, upsert в таблицу entities базы data/vibednd.db (CREATE TABLE IF NOT EXISTS …), в конце выводит счётчики по kind. npm install НЕ запускать. В отчёте — файлы и количество сущностей.»
>
> После завершения: `cd server && npx tsx src/seed.ts` (или добавь npm-скрипт seed) — проверь, что записи залились.

---

## Шаг 3 — Персонажи: библиотека, мастер создания, карточка (агент)

**Промпт:**

> Запусти субагента со следующим заданием:
>
> «Реализуй фронтенд-модуль персонажей VibeDND. Рабочая директория: /Users/deathking./Desktop/VibeDND. Прочитай DESIGN.md, shared/src/types.ts, shared/src/rules.ts, web/src/api.ts, web/src/styles/global.css. Интерфейс ТОЛЬКО на русском. Пиши ТОЛЬКО в перечисленные файлы (заглушки замени):
> - web/src/pages/CharacterLibrary.tsx — список персонажей: карточки (имя, игрок, вид/класс/уровень, портрет), кнопки «Создать», «Редактировать», «Удалить», «Повысить уровень».
> - web/src/pages/CharacterNew.tsx — пошаговый мастер создания по D&D 2024: 1) имя + игрок, 2) вид, 3) класс 1 ур., 4) предыстория с выбором +2/+1 из её трёх характеристик, 5) характеристики: переключатель «Стандартный набор» / «Покупка очками» (27 очков, остаток на экране) — STANDARD_ARRAY/POINT_BUY_COSTS из shared, 6) снаряжение предыстории + заклинания 1 ур. для заклинателей, 7) итог (HP = firstLevelHp, КД, пассивное восприятие) → POST /api/characters.
> - web/src/pages/CharacterEdit.tsx — редактирование + загрузка портрета (POST /api/upload, raw fetch с заголовком x-filename) + визард повышения уровня: класс (существующий или новый), HP (бросок или среднее averageHpGain), умения уровня из CharacterClass.features, новые заклинания, пересчёт ячеек из spellSlotsByLevel.
> - web/src/components/CharacterSheet.tsx + стили — переиспользуемая карточка: шапка, 6 характеристик с модификаторами (effectiveScores/abilityModifier), HP-блок (текущие/макс/временные, +/−), КД, инициатива, скорость, кость хитов, вдохновение, навыки и спасброски (владение подсвечено), атаки с кнопками броска, заклинания с ячейками, ресурсы класса, состояния, концентрация, настройка (3 слота), снаряжение, спасброски от смерти, «Короткий/длинный отдых». Пропсы: { character, onPatch?: (patch: Partial<Character>) => void, readonly?: boolean } — без onPatch всё readonly.
>
> Стиль: тёмная тема из global.css, lucide-react, анимации классами anim-* (pulse-hp при смене HP, dice-pop на бросках), адаптивность 375px+. НЕ трогай server/, App.tsx, ws.ts, другие страницы. npm install НЕ запускать.»
>
> После: `npx tsc -p web/tsconfig.json` — должно быть чисто (страницы-заглушки других агентов не трогаем).

---

## Шаг 4 — Карта: движок + доска + консоль мастера (агент, самый большой)

**Промпт:**

> Запусти субагента со следующим заданием:
>
> «Реализуй карту VibeDND: общий движок рендера, доску и консоль мастера. Рабочая директория: /Users/deathking./Desktop/VibeDND. Прочитай DESIGN.md, shared/src/types.ts, shared/src/protocol.ts, web/src/ws.ts, web/src/styles/global.css. Интерфейс на русском. Пиши ТОЛЬКО в:
> - web/src/components/MapCanvas.tsx — переиспользуемый canvas-рендер карты: слои (изображение карты → сетка по MapCalibration → токены → рисунки DrawStroke → туман войны). Панорама/зум (колесо + drag). Пропсы: { map: AdventureMap, tokens: LiveToken[], fogReveals, drawings, mode: 'board' | 'dm', onTokenMove?, onFog?, onDraw?, … }.
> - Токены: персонажи — круглые с золотой каймой и портретом/инициалами; враги — бордовая кайма; НПС — серая. Полоска HP, иконки состояний, значок «при смерти». Скрытые токены (hidden) доска не рисует. Двигает только мастер (drag в режиме dm → onTokenMove). Появление токена — anim-token-drop.
> - Туман войны: доска рисует чёрную завесу, открытые области (FogShape rect/brush) вырезаны. В режиме dm — инструменты «прямоугольник» и «кисть», каждый в режимах «открыть»/«скрыть», кнопка «Скрыть всё».
> - Рисование (слой поверх): перо, линия, круг, прямоугольник, 6 цветов, ластик (по штриху), «очистить слой». Штрихи уходят через onDraw.
> - Измерение: инструмент «радиус» — тянем от точки, круг с подписью в футах (клетка = 5 футов).
> - web/src/pages/BoardPage.tsx — /board/:sessionId: чистый экран для ТВ: MapCanvas mode="board" во весь экран, сверху трекер инициативы (из combat: имена по порядку, подсветка текущего, раунд), внизу лента последних 5 бросков (diceLog, скрытые не показывать). Без состояния боя — QR-код подключения (GET /api/sessions/:id/join-info → url, QR сгенерируй canvas-функцией сам, без библиотек, или отобрази URL крупно) и список подключённых персонажей.
> - web/src/pages/DmPage.tsx — /dm: консоль мастера: MapCanvas mode="dm" + боковая панель (выбор активной карты приключения, список токенов с HP/состояниями/уроном кликом, управление инициативой: форма ввода бросков или «Кинуть всем» (d20+мод инициативы), «Следующий ход», «Закончить бой», скрытые броски мастера, заметки сцены SceneNote).
>
> Связь — SessionSocket из web/src/ws.ts, сообщения строго по shared/src/protocol.ts. Плейсхолдеры токенов: SVG из web/public/tokens/ (game-icons.net), fallback — инициалы. НЕ трогай server/, другие страницы, App.tsx. npm install НЕ запускать.»

---

## Шаг 5 — Телефон игрока (агент, после шагов 3 и 4)

**Промпт:**

> Запусти субагента со следующим заданием:
>
> «Реализуй страницу игрока VibeDND. Рабочая директория: /Users/deathking./Desktop/VibeDND. Прочитай DESIGN.md, shared/src/types.ts, shared/src/protocol.ts, web/src/ws.ts, web/src/components/CharacterSheet.tsx (используй его). Пиши ТОЛЬКО в web/src/pages/PlayerPage.tsx (+ стили рядом):
> - Маршрут /player/:sessionId/:characterId. Подключение через SessionSocket(role 'player'). Получение своего персонажа из snapshot/characterUpdated.
> - Экран = CharacterSheet с onPatch → шлёт characterPatch. Мобильная вёрстка: большие кнопки, HP-блок сверху, вкладки (Бой / Заклинания / Снаряжение / Персонаж).
> - Вкладка «Бой»: атаки с кнопками (шлют rollDice: label = название атаки, formula из AttackEntry), кнопки проверок характеристик/навыков, своя лента бросков с анимацией dice-pop.
> - При уроне и активной концентрации — баннер-напоминание: «Проверка концентрации, СЛ {concentrationDC(damage)}» (функция из shared).
> - Карту НЕ показывать. НЕ трогай чужие файлы. npm install НЕ запускать.»

---

## Шаг 6 — Приключения: библиотека, редактор, сцены (агент)

**Промпт:**

> Запусти субагента со следующим заданием:
>
> «Реализуй приключения VibeDND. Рабочая директория: /Users/deathking./Desktop/VibeDND. Прочитай DESIGN.md, shared/src/types.ts, web/src/api.ts. Интерфейс на русском. Пиши ТОЛЬКО в:
> - web/src/pages/AdventureLibrary.tsx — список приключений (GET /api/adventures), «Создать», «Редактировать», «Удалить», «Начать сессию» (POST /api/sessions {adventureId, name} → переход в /session/:id).
> - web/src/pages/AdventureEdit.tsx — редактор приключения: название/описание/источник; список карт (загрузка изображения через POST /api/upload); калибровка сетки поверх картинки (мастер указывает размер клетки: два клика по углам клетки → cellSize/origin, поля cols/rows); расстановка токенов (выбор монстра из GET /api/entities/monster или свободный НПС, drag на карте, флаг hidden, размер в клетках); сцены/заметки (заголовок, текст, арт). Сохранение — PUT /api/adventures/:id.
> - web/src/pages/SessionPage.tsx — хаб запущенной сессии для мастера: ссылка/QR для игроков (GET /api/sessions/:id/join-info), добавление персонажей партии из библиотеки (sessionAddCharacter), кнопки «Открыть консоль мастера» (/dm) и «Открыть доску» (/board/:sessionId), список карт приключения.
> - web/src/pages/Lobby.tsx — главная: три крупные плитки «Персонажи», «Приключения», «Сессии» (список активных сессий с переходом).
>
> НЕ трогай MapCanvas/BoardPage/DmPage/PlayerPage и server/. npm install НЕ запускать.»

---

## Шаг 7 — Редакторы сущностей (агент)

**Промпт:**

> Запусти субагента со следующим заданием:
>
> «Реализуй простые редакторы сущностей VibeDND (монстр, заклинание, предмет). Рабочая директория: /Users/deathking./Desktop/VibeDND. Прочитай shared/src/types.ts, web/src/api.ts. Интерфейс на русском. Создай web/src/pages/EntityLibrary.tsx (список по kind с поиском) и web/src/components/editors/{MonsterEditor,SpellEditor,ItemEditor}.tsx (форма ↔ JSON типа, POST/DELETE /api/entities/:kind). Добавь маршруты в web/src/App.tsx: /entities/:kind и пункт в Lobby. Поля — строго по типам Monster/Spell/Item, включая атаки монстра (список AttackEntry). npm install НЕ запускать.»

---

## Шаг 8 — Токены-плейсхолдеры и иконки

**Промпт:**

> Скачай с game-icons.net (CC-BY 3.0) ~30 SVG для токенов: воин, маг, лучник, плут, жрец, гоблин, скелет, зомби, волк, огр, дракон, паук, крыса, сундук, NPC-торговец и т.п. в web/public/tokens/ (чёрные SVG, будем тонировать CSS-фильтром). Добавь web/public/tokens/ATTRIBUTION.md со списком иконок и ссылкой на game-icons.net. Если сеть недоступна из песочницы — дай мне готовый список URL для скачивания и команду curl.

---

## Шаг 9 — Интеграция и сборка

**Промпт:**

> Полная проверка сборки: `npm run build` (shared → server → web). Исправь все ошибки TypeScript на стыках модулей (чаще всего: расхождения имён полей с shared/src/types.ts, несогласованные пропсы MapCanvas/CharacterSheet). Запусти `npm run dev`, проверь: открывается Lobby, создаётся персонаж (мастер до итога), заливается сид (npx tsx server/src/seed.ts), создаётся приключение с картой, стартует сессия, доска показывает карту, токен двигается из консоли мастера и движение виден на доске, бросок с телефонной страницы появляется в логе доски. Прогон максимально автоматизируй через preview-инструменты браузера.

---

## Шаг 10 — Ручной прогон за столом (чек-лист)

- [ ] Доска на ТВ по Wi-Fi, телефоны подключаются по QR.
- [ ] Создание персонажа 1 ур. каждым классом партии, повышение до 2 ур.
- [ ] Короткий/длинный отдых сбрасывает ресурсы корректно.
- [ ] Бой: инициатива → ходы → урон врагам кликом → HP игроков с телефонов синхронно на токенах.
- [ ] Туман: кисть и прямоугольник, «скрыть всё».
- [ ] Рисование и измерение радиуса (огненный шар = 20 футов = 4 клетки).
- [ ] Закрыть сервер, открыть снова — сессия восстановилась (автосохранение).

---

## Правила для всех агентов (уже вшиты в промпты)

- Пишут только в свои файлы; общие контракты — `shared/src/` (не менять без необходимости).
- `npm install` не запускают (сеть ограничена).
- Интерфейс — русский; иконки lucide-react; анимации — классы `anim-*`; токены — game-icons.net с атрибуцией.
