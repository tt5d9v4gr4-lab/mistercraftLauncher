# Medieval Fantasy 0.2.0 — отчёт аудита сборки (Minecraft 1.20.1 + Forge)

**Статус: НЕ ПРОВЕРЕНА ЗАПУСКОМ.** Аудит сделан по страницам Modrinth (поиск). В среде разработки нет Windows и нет доступа к API Modrinth, поэтому реальная установка и запуск игры не выполнялись. Зависимости ставит лаунчер при установке (по данным API); конфликты ниже — по документации проектов, не по запуску.

## Исправлены неверные названия из старого списка
| Было | Стало |
|---|---|
| epic-knights-armor-and-weapons | epic-knights-shields-armor-and-weapons |
| samurai-dynasty | epic-samurais |
| vampirism-become-a-vampire | vampirism |
| werewolves-become-a-werewolf | werewolves |
| ice-and-fire-ce | iceandfire-ce |

## Найдено на Modrinth (страницы версий для 1.20.1 видны в поиске)
Farmer's Delight, Delightful, Villager Recruits (Forge 1.20.1), Guard Villagers, Origins (Forge 1.10.x), Origins: Classes (Forge), Paxi (Forge 1.20), Punchy! Moves (Forge+1.20.1 по странице), EMF (forge-1.20.1), Particular Reforged, Subtle Effects (Forge), Client Sort (1.20.1-Forge), Serene Seasons (Forge 1.20.1), Tough As Nails (Forge 1.20.1), L_Ender's Cataclysm (1.20.1), When Dungeons Arise (1.20.1), Repurposed Structures (1.20.1-forge), YUNG's Better Dungeons/Nether Fortresses (Forge 1.20), Epic Samurai's (1.20.1-forge), Epic Fight (1.20.1), Better Combat (1.20.1-forge), Jaden's Nether Expansion (Forge).

## Не подошли под Forge 1.20.1 / не найдены
- **Zoomify** — у 1.20.1 только Fabric. Замена в манифесте: Ok Zoomer (наличие Forge-сборки для 1.20.1 не подтверждено — если нет, лаунчер пропустит и покажет в отчёте).
- **Touch'n Motion** — на Modrinth не найден (возможно, только CurseForge). Не добавлен.
- **MineColonies** (настоящие живые города с профессиями) — на Modrinth не найден. Вместо него: деревни (Towns and Towers, Epic Structures: Villages), Villager Recruits, Guard Villagers.
- **Реалистичная физика предметов** и **настоящая погода** (дождь/штормы) — проверенного мода в этом проходе не найдено. Serene Seasons даёт сезоны; Project Atmosphere найден, но отключён (экспериментальный, 1.20.1 не подтверждена).
- **Животноводство/разведение, кухонная мебель** — только Farmer's Delight + Delightful и животные Alex's Mobs; отдельного проверенного мода не добавлял.
- **Война королевств** — полноценной системы королевств не нашёл. Villager Recruits даёт армии, команды, стражу и осады; «королевства и дипломатия» — нет.
- **Мод Iron's Spells / Ars Nouveau / Emotecraft / ImmediatelyFast / Cursors Extended / Particle Interactions Forgified / FTB Quests / Ice and Fire CE / Bosses of Mass Destruction Forge** — проект существует, но Forge+1.20.1 по поиску не подтверждён до конца; их проверит установка.

## Не мод, а ресурс-пак (перенесено в «текстуры»)
Fluid & Foolish (нужен мод Punchy! Moves), Just Expressions (нужны EMF+ETF), Fresh Animations и Player Extension (нужны EMF+ETF), Recolourful Containers, Low Fire AND Low Shield, Simple Grass Flowers, Better Clouds Texture, Vibrant Fog, Cubic Sun & Moon.
Проект «Better Clouds» на Modrinth называется **Better Clouds Texture** — взят он. Cursor Extended = **Cursors Extended** (мод).

## Конфликты / дубли (решение)
- Epic Fight ⟷ Better Combat: оба меняют бой → оставлен **Better Combat**, Epic Fight отключён (`disabled`).
- Tough As Nails ⟷ Thirst Was Taken: оба жажда → оставлен **Tough As Nails**.
- MCA Reborn отключён: меняет жителей, совместимость с Recruits/Guard Villagers не подтверждена.
- Vampirism/Werewolves + Origins: расы из двух систем могут пересекаться; вампиров/оборотней даёт Vampirism/Werewolves, гоблина — датапак Origins: Goblin.
- Punchy! Moves + Better Combat — оба анимируют бой; конфликт не подтверждён и не исключён.

## Шейдеры: оставлено 2
**Complementary Reimagined** (стабильный, лучший баланс качества и FPS на Oculus) и **BSL** (реалистичный свет и небо). Убраны: Complementary Unbound (тот же движок) и Photon (стабильность на Oculus 1.20.1 не подтверждена). Выбор по репутации, визуально не сравнивался.

## Расы, классы, стартовое меню
Отдельный мод не нужен: **Origins** при первом входе в мир сам показывает экран выбора (раса → класс через Origins: Classes). Гоблин — датапак Origins: Goblin (через Paxi). Вампир/оборотень — Vampirism/Werewolves. Самурай и рыцарь — предметы/броня (Epic Samurai's, Epic Knights), отдельных «рас» нет. Выбор происходит **в мире, а не до его создания**. Свой Forge-мод не писался: собрать и проверить его здесь невозможно.

## Сюжет
Датапак `mf_story` (достижения): 4 цепочки — «Путь странника» (лёгкая), «Охотник» (средняя), «Врата Нижнего мира» (сложная), «Древние боссы» (боссы), награды: изумруды, XP, редкие предметы. Использует только ванильные триггеры/мобов. Подключается через Paxi; **загрузка папки-датапака Paxi в игре не проверялась**.

## Количество
Модов в манифесте: было 30, стало 51 (47 ставятся, 4 отключены намеренно) + 2 датапака + 2 шейдера + 11 ресурс-паков. Зависимости (Citadel, GeckoLib, Curios, Architectury, FTB Library, YUNG's API, Glitchcore и др.) лаунчер подтягивает сам по данным Modrinth.

## Запуск
Не проверен. Нужно на Windows: «Установить сборку» → «Играть», затем прислать `%APPDATA%\.mistercraft\MedievalFantasy\install-report.md` и `logs\latest.log`.
