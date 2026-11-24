'use strict';
// Генерирует датапак сюжета Medieval Fantasy (достижения-цепочки + награды). Запуск: node scripts/gen-story.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'mf', 'datapacks', 'mf_story');
const W = (rel, obj) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n'); };

W('pack.mcmeta', { pack: { pack_format: 15, description: 'MisterCraft Medieval Fantasy — сюжетные цепочки заданий' } });

// награды: уровни сложности
const item = (id, min, max, weight) => ({ type: 'minecraft:item', name: id, weight: weight || 1, functions: [{ function: 'minecraft:set_count', count: { min, max } }] });
const reward = (name, pools) => W(`data/mf_story/loot_tables/${name}.json`, { type: 'minecraft:advancement_reward', pools });
reward('reward_easy', [{ rolls: 1, entries: [item('minecraft:emerald', 3, 6, 4), item('minecraft:bread', 4, 8, 3), item('minecraft:iron_ingot', 2, 4, 2)] }]);
reward('reward_medium', [{ rolls: 2, entries: [item('minecraft:emerald', 6, 12, 4), item('minecraft:gold_ingot', 3, 6, 3), item('minecraft:iron_ingot', 4, 8, 3), item('minecraft:golden_apple', 1, 1, 1)] }]);
reward('reward_hard', [{ rolls: 3, entries: [item('minecraft:emerald', 12, 24, 4), item('minecraft:diamond', 1, 3, 3), item('minecraft:enchanted_golden_apple', 1, 1, 1), item('minecraft:experience_bottle', 4, 8, 3)] }]);
reward('reward_boss', [{ rolls: 3, entries: [item('minecraft:diamond', 3, 6, 4), item('minecraft:netherite_scrap', 1, 3, 3), item('minecraft:emerald', 24, 48, 3), item('minecraft:enchanted_golden_apple', 1, 2, 1)] }]);

const bg = 'minecraft:textures/gui/advancements/backgrounds/stone.png';
const tiers = { easy: 'mf_story:reward_easy', medium: 'mf_story:reward_medium', hard: 'mf_story:reward_hard', boss: 'mf_story:reward_boss' };
function adv(id, parent, icon, title, desc, criteria, o = {}) {
  const j = {
    display: { icon: { item: icon }, title: { text: title }, description: { text: desc }, frame: o.frame || 'task', show_toast: true, announce_to_chat: true, hidden: false, ...(parent ? {} : { background: bg }) },
    criteria,
    rewards: { experience: o.xp || 0, ...(o.tier ? { loot: [tiers[o.tier]] } : {}) },
  };
  if (parent) j.parent = `mf_story:${parent}`;
  if (o.mod) j.conditions = [{ type: 'forge:mod_loaded', modid: o.mod }]; // без мода достижение просто не загружается
  W(`data/mf_story/advancements/${id}.json`, j);
}
const kill = (t) => ({ k: { trigger: 'minecraft:player_killed_entity', conditions: { entity: [{ condition: 'minecraft:entity_properties', predicate: { type: t }, entity: 'this' }] } } });
const tick = { start: { trigger: 'minecraft:tick' } };

// Корень
adv('root', null, 'minecraft:iron_sword', 'MisterCraft: Medieval Fantasy', 'Твоя история начинается. Следуй цепочкам заданий — или иди своим путём.', tick, { xp: 10, tier: 'easy' });

// Цепочка 1. Путь странника (лёгкая)
adv('wanderer_1', 'root', 'minecraft:emerald', 'Первая сделка', 'Поторгуй с жителем в ближайшем поселении.', { t: { trigger: 'minecraft:villager_trade' } }, { xp: 30, tier: 'easy' });
adv('wanderer_2', 'wanderer_1', 'minecraft:emerald_block', 'Кошелёк странника', 'Накопи 16 изумрудов — местную валюту.', { e: { trigger: 'minecraft:inventory_changed', conditions: { items: [{ items: ['minecraft:emerald'], count: { min: 16 } }] } } }, { xp: 50, tier: 'easy' });
adv('wanderer_3', 'wanderer_2', 'minecraft:shield', 'Щит деревни', 'Защити поселение от рейда и стань Героем деревни.', { h: { trigger: 'minecraft:hero_of_the_village' } }, { xp: 150, tier: 'medium', frame: 'goal' });

// Цепочка 2. Охотник на чудовищ (средняя)
adv('hunter_1', 'root', 'minecraft:bow', 'Первая охота', 'Победи зомби, бродящего у поселения.', kill('minecraft:zombie'), { xp: 30, tier: 'easy' });
adv('hunter_2', 'hunter_1', 'minecraft:crossbow', 'Налётчики', 'Одолей разбойника-пиллагера.', kill('minecraft:pillager'), { xp: 80, tier: 'medium' });
adv('hunter_3', 'hunter_2', 'minecraft:totem_of_undying', 'Тёмный колдун', 'Победи вызывателя (эвокера) — тёмного мага.', kill('minecraft:evoker'), { xp: 150, tier: 'hard', frame: 'goal' });

// Цепочка 3. Врата Нижнего мира (сложная)
adv('nether_1', 'root', 'minecraft:obsidian', 'Врата', 'Войди в Нижний мир.', { n: { trigger: 'minecraft:changed_dimension', conditions: { to: 'minecraft:the_nether' } } }, { xp: 80, tier: 'medium' });
adv('nether_2', 'nether_1', 'minecraft:blaze_rod', 'Огненный страж', 'Победи пламенного (блейза) в адской крепости.', kill('minecraft:blaze'), { xp: 120, tier: 'medium' });
adv('nether_3', 'nether_2', 'minecraft:wither_skeleton_skull', 'Череп короля', 'Победи скелета-иссушителя.', kill('minecraft:wither_skeleton'), { xp: 150, tier: 'hard' });
adv('nether_4', 'nether_3', 'minecraft:nether_star', 'Падение иссушителя', 'Победи босса — Иссушителя.', kill('minecraft:wither'), { xp: 500, tier: 'boss', frame: 'challenge' });

// Цепочка 4. Древние боссы
adv('boss_1', 'hunter_3', 'minecraft:prismarine_shard', 'Хозяин глубин', 'Победи древнего стража (элдер-гардиана).', kill('minecraft:elder_guardian'), { xp: 300, tier: 'hard' });
adv('boss_2', 'boss_1', 'minecraft:sculk_shrieker', 'Тишина', 'Победи Хранителя (Warden).', kill('minecraft:warden'), { xp: 500, tier: 'boss', frame: 'challenge' });
adv('boss_3', 'boss_2', 'minecraft:dragon_head', 'Конец истории', 'Победи Дракона Края.', kill('minecraft:ender_dragon'), { xp: 1000, tier: 'boss', frame: 'challenge' });

// Модовые боссы (ID предоставлены пользователем; без соответствующего мода цепочка не загружается)
function bossChain(mod, prefix, parent, icon0, list) {
  let prev = parent;
  list.forEach(([key, entity, icon, title, desc, tier, xp], i) => {
    const id = `${prefix}_${key}`;
    adv(id, prev, icon, title, desc, kill(entity), { xp, tier, frame: tier === 'boss' ? 'challenge' : 'goal', mod });
    prev = id;
  });
}
bossChain('cataclysm', 'cata', 'root', null, [
  ['ignis', 'cataclysm:ignis', 'minecraft:blaze_powder', 'Огненный рыцарь', 'Победи Игниса.', 'hard', 300],
  ['monstrosity', 'cataclysm:netherite_monstrosity', 'minecraft:netherite_ingot', 'Незеритовое чудовище', 'Победи Незеритовое Чудовище.', 'hard', 350],
  ['ender_guardian', 'cataclysm:ender_guardian', 'minecraft:end_stone_bricks', 'Страж Края', 'Победи Стража Края.', 'hard', 350],
  ['remnant', 'cataclysm:ancient_remnant', 'minecraft:sand', 'Древний остаток', 'Победи Древний Остаток.', 'hard', 400],
  ['harbinger', 'cataclysm:the_harbinger', 'minecraft:iron_block', 'Предвестник', 'Победи Предвестника.', 'boss', 500],
  ['leviathan', 'cataclysm:the_leviathan', 'minecraft:prismarine_crystals', 'Левиафан', 'Победи Левиафана.', 'boss', 600],
  ['scylla', 'cataclysm:scylla', 'minecraft:heart_of_the_sea', 'Сцилла', 'Победи Сциллу.', 'boss', 600],
  ['maledictus', 'cataclysm:maledictus', 'minecraft:soul_lantern', 'Малэдиктус', 'Победи Малэдиктуса.', 'boss', 700],
]);
bossChain('bosses_of_mass_destruction', 'bomd', 'root', null, [
  ['lich', 'bosses_of_mass_destruction:lich', 'minecraft:amethyst_shard', 'Ночной лич', 'Победи Ночного Лича.', 'hard', 300],
  ['obsidilith', 'bosses_of_mass_destruction:obsidilith', 'minecraft:obsidian', 'Обсидилит', 'Победи Обсидилита.', 'hard', 350],
  ['gauntlet', 'bosses_of_mass_destruction:gauntlet', 'minecraft:netherite_scrap', 'Адская перчатка', 'Победи Перчатку Нижнего мира.', 'hard', 350],
  ['void_blossom', 'bosses_of_mass_destruction:void_blossom', 'minecraft:chorus_flower', 'Цветок Пустоты', 'Победи Цветок Пустоты.', 'boss', 500],
]);
bossChain('iceandfire', 'dragon', 'root', null, [
  ['fire', 'iceandfire:fire_dragon', 'minecraft:fire_charge', 'Огненный дракон', 'Победи огненного дракона.', 'boss', 500],
  ['ice', 'iceandfire:ice_dragon', 'minecraft:blue_ice', 'Ледяной дракон', 'Победи ледяного дракона.', 'boss', 500],
  ['lightning', 'iceandfire:lightning_dragon', 'minecraft:lightning_rod', 'Электрический дракон', 'Победи электрического дракона.', 'boss', 600],
]);
console.log('ok');
