#!/bin/bash
# Скачивание токенов-плейсхолдеров с game-icons.net (CC-BY 3.0)
set -e
cd "$(dirname "$0")/../web/public/tokens"

BASE="https://game-icons.net/icons"

download() { # $1 = author-dir, $2 = file, $3 = local name
  curl -sfS -m 30 -o "$3" "$BASE/$1/originals/svg/$2" && echo "OK  $3" || echo "FAIL $3"
}

# --- Персонажи ---
download lorc swordman.svg fighter.svg
download lorc wizard-face.svg wizard.svg
download lorc archer.svg archer.svg
download lorc hooded-figure.svg rogue.svg
download lorc priest.svg cleric.svg
download lorc barbarian.svg barbarian.svg
download lorc druid.svg druid.svg
download lorc warlock-hood.svg warlock.svg
download lorc paladin-helmet.svg paladin.svg
download lorc monk-face.svg monk.svg
download lorc bard.svg bard.svg
download lorc ranger-hood.svg ranger.svg
download lorc sorcerer.svg sorcerer.svg

# --- Монстры ---
download lorc goblin-head.svg goblin.svg
download lorc kobold.svg kobold.svg
download lorc skeleton.svg skeleton.svg
download lorc shambling-zombie.svg zombie.svg
download lorc wolf-head.svg wolf.svg
download lorc ogre.svg ogre.svg
download lorc bugbear.svg bugbear.svg
download lorc hobgoblin.svg hobgoblin.svg
download lorc ghost.svg shadow.svg
download lorc rat.svg rat.svg
download lorc dragon-head.svg dragon.svg
download lorc spider-face.svg spider.svg
download lorc bat.svg bat.svg
download lorc slime.svg slime.svg
download lorc orc-head.svg orc.svg
download lorc minotaur.svg minotaur.svg

# --- NPC и прочее ---
download lorc farmer.svg npc-peasant.svg
download lorc merchant.svg npc-merchant.svg
download lorc guard-helmet.svg npc-guard.svg
download lorc chest.svg chest.svg
download lorc locked-chest.svg chest-locked.svg
download lorc campfire.svg campfire.svg
download lorc dungeon-gate.svg door.svg

echo "Готово. Скачано: $(ls *.svg 2>/dev/null | wc -l) файлов"
