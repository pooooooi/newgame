const cardPool = CARD_POOL;
const cardMap = Object.fromEntries(cardPool.map(card => [card.id, card]));
const collectibleCards = cardPool.filter(card => card.collectible !== false);

const DECK_MIN = 20;
const DECK_MAX = 30;
const DECK_STORAGE_KEY = "monverse_selected_deck_v1";

const KEYWORD_LABELS = {
  ward: "守護",
  rush: "突進",
  storm: "疾走"
};

const state = {
  builderCounts: initializeBuilderCounts(),
  phase: "build"
};

function isBuilderPage() {
  return Boolean(document.getElementById("builderScreen"));
}

function isBattlePage() {
  return Boolean(document.getElementById("battleScreen"));
}

function saveSelectedDeck(counts) {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(counts));
}

function loadSelectedDeck() {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function initializeBuilderCounts() {
  const counts = {};
  for (const card of collectibleCards) counts[card.id] = 0;

  const starter = [
    ["unit_lizard", 2],
    ["unit_tortoise", 2],
    ["unit_cat", 2],
    ["unit_guard_golem", 2],
    ["unit_quick_raptor", 2],
    ["unit_scholar_owl", 2],
    ["spell_fire", 2],
    ["spell_heal", 2],
    ["spell_inspiration", 1],
    ["spell_blessing", 1],
    ["evo_lizard", 1],
    ["evo_tortoise", 1]
  ];

  for (const [id, n] of starter) counts[id] = n;
  return counts;
}

function getDeckCount(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function getTypeCount(counts) {
  return Object.values(counts).filter(n => n > 0).length;
}

function isDeckValid(counts) {
  const size = getDeckCount(counts);
  return size >= DECK_MIN && size <= DECK_MAX;
}

function buildDeckFromCounts(counts) {
  const deck = [];
  for (const [cardId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      const base = cardMap[cardId];
      if (base) deck.push(structuredClone(base));
    }
  }
  return deck;
}

function buildRandomCounts(size) {
  const counts = {};
  for (const card of collectibleCards) counts[card.id] = 0;

  for (let i = 0; i < size; i++) {
    const picked = collectibleCards[Math.floor(Math.random() * collectibleCards.length)];
    counts[picked.id] += 1;
  }
  return counts;
}

function buildRandomDeck(size) {
  return shuffle(buildDeckFromCounts(buildRandomCounts(size)));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomIndex(arr) {
  if (!arr.length) return -1;
  return Math.floor(Math.random() * arr.length);
}

function log(text) {
  state.log.push(text);
  if (state.log.length > 120) state.log.shift();
}

let fxLayer = null;

function ensureFxLayer() {
  if (!document.body) return null;
  if (fxLayer && fxLayer.isConnected) return fxLayer;
  fxLayer = document.createElement("div");
  fxLayer.className = "fx-layer";
  document.body.appendChild(fxLayer);
  return fxLayer;
}

function flashScreen() {
  document.body.classList.remove("screen-flash");
  // Force reflow so repeated flashes retrigger.
  void document.body.offsetWidth;
  document.body.classList.add("screen-flash");
  setTimeout(() => document.body.classList.remove("screen-flash"), 300);
}

function burstFx(kind = "magic", x = window.innerWidth * 0.5, y = window.innerHeight * 0.5) {
  const layer = ensureFxLayer();
  if (!layer) return;

  const pools = {
    hit: ["✦", "✹", "⚡", "✧"],
    play: ["◆", "◇", "✧", "✦"],
    evolve: ["✨", "✶", "✹", "✦"],
    heal: ["✿", "❈", "✧", "✦"],
    win: ["★", "☆", "✦", "✶"]
  };
  const symbols = pools[kind] || pools.play;
  const count = kind === "win" ? 26 : 16;

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "fx-particle";
    p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    p.style.left = `${x + (Math.random() - 0.5) * 40}px`;
    p.style.top = `${y + (Math.random() - 0.5) * 24}px`;
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 260}px`);
    p.style.setProperty("--dy", `${-70 - Math.random() * 220}px`);
    p.style.setProperty("--rot", `${(Math.random() - 0.5) * 460}deg`);
    const dur = 650 + Math.floor(Math.random() * 520);
    p.style.setProperty("--dur", `${dur}ms`);
    layer.appendChild(p);
    setTimeout(() => p.remove(), dur + 30);
  }

  flashScreen();
}

function getSideData(side) {
  if (side === "player") {
    return {
      board: state.playerBoard,
      enemyBoard: state.enemyBoard,
      hand: state.playerHand,
      enemyHand: state.enemyHand,
      getLeaderHp: () => state.playerHp,
      setLeaderHp: (v) => { state.playerHp = v; },
      getEnemyLeaderHp: () => state.enemyHp,
      setEnemyLeaderHp: (v) => { state.enemyHp = v; },
      sideName: "あなた",
      enemyName: "相手"
    };
  }

  return {
    board: state.enemyBoard,
    enemyBoard: state.playerBoard,
    hand: state.enemyHand,
    enemyHand: state.playerHand,
    getLeaderHp: () => state.enemyHp,
    setLeaderHp: (v) => { state.enemyHp = v; },
    getEnemyLeaderHp: () => state.playerHp,
    setEnemyLeaderHp: (v) => { state.playerHp = v; },
    sideName: "相手",
    enemyName: "あなた"
  };
}

function drawCard(side, amount = 1) {
  for (let i = 0; i < amount; i++) {
    const deck = side === "player" ? state.playerDeck : state.enemyDeck;
    const hand = side === "player" ? state.playerHand : state.enemyHand;
    if (!deck.length) return;
    hand.push(deck.shift());
  }
}

function toBoardUnit(card) {
  return {
    id: crypto.randomUUID(),
    baseId: card.id,
    name: card.name,
    atk: card.atk,
    hp: card.hp,
    maxHp: card.hp,
    canAttack: Boolean(card.keywords?.includes("rush") || card.keywords?.includes("storm")),
    summonedThisTurn: true,
    evolved: false,
    keywords: [...(card.keywords || [])],
    onPlay: card.onPlay ? structuredClone(card.onPlay) : [],
    onDeath: card.onDeath ? structuredClone(card.onDeath) : []
  };
}

function hasKeyword(unit, keyword) {
  return unit.keywords?.includes(keyword);
}

function getWardUnits(board) {
  return board.filter(unit => hasKeyword(unit, "ward"));
}

function canAttackFollower(unit) {
  if (!unit.canAttack) return false;
  if (!unit.summonedThisTurn) return true;
  return hasKeyword(unit, "rush") || hasKeyword(unit, "storm");
}

function canAttackLeader(unit) {
  if (!unit.canAttack) return false;
  if (!unit.summonedThisTurn) return true;
  return hasKeyword(unit, "storm");
}

function findEvoHandIndexForUnit(hand, unit) {
  return hand.findIndex(card => card.type === "evolution" && card.evolvesFrom === unit.baseId);
}

function applyEvolution(unit, evoCard, side, runtime = {}) {
  const missingHp = unit.maxHp - unit.hp;
  unit.name = evoCard.name;
  unit.atk = evoCard.atk;
  unit.maxHp = evoCard.hp;
  unit.hp = Math.max(1, unit.maxHp - missingHp);
  unit.evolved = true;

  const gained = evoCard.grantsKeywords || [];
  for (const key of gained) {
    if (!unit.keywords.includes(key)) unit.keywords.push(key);
  }

  if (unit.summonedThisTurn && hasKeyword(unit, "storm")) unit.canAttack = true;

  if (evoCard.onEvolve) resolveEffects(evoCard.onEvolve, side, runtime);
}

function destroyUnit(board, index, side, runtime = {}) {
  const [unit] = board.splice(index, 1);
  if (!unit) return;
  if (unit.onDeath && unit.onDeath.length) {
    resolveEffects(unit.onDeath, side, runtime);
  }
}

function cleanupDeadUnits(runtime = {}) {
  for (let i = state.playerBoard.length - 1; i >= 0; i--) {
    if (state.playerBoard[i].hp <= 0) destroyUnit(state.playerBoard, i, "player", runtime);
  }
  for (let i = state.enemyBoard.length - 1; i >= 0; i--) {
    if (state.enemyBoard[i].hp <= 0) destroyUnit(state.enemyBoard, i, "enemy", runtime);
  }
}

function summonUnitByCardId(cardId, side) {
  const data = getSideData(side);
  if (data.board.length >= 3) return false;

  const base = cardMap[cardId];
  if (!base || base.type !== "unit") return false;

  data.board.push(toBoardUnit(base));
  return true;
}

function resolveEffects(effects, side, runtime = {}) {
  const data = getSideData(side);

  for (const effect of effects || []) {
    if (effect.type === "draw") {
      drawCard(side, effect.amount || 1);
      continue;
    }

    if (effect.type === "heal_leader") {
      const next = Math.min(20, data.getLeaderHp() + (effect.amount || 0));
      data.setLeaderHp(next);
      continue;
    }

    if (effect.type === "self_damage") {
      data.setLeaderHp(data.getLeaderHp() - (effect.amount || 0));
      continue;
    }

    if (effect.type === "damage_enemy_leader") {
      data.setEnemyLeaderHp(data.getEnemyLeaderHp() - (effect.amount || 0));
      continue;
    }

    if (effect.type === "damage_random_enemy_unit") {
      if (!data.enemyBoard.length) continue;
      const idx = randomIndex(data.enemyBoard);
      if (idx >= 0) data.enemyBoard[idx].hp -= (effect.amount || 0);
      continue;
    }

    if (effect.type === "damage_all_enemy_units") {
      for (const unit of data.enemyBoard) unit.hp -= (effect.amount || 0);
      continue;
    }

    if (effect.type === "damage_enemy_unit_or_leader") {
      if (data.enemyBoard.length > 0) {
        data.enemyBoard[0].hp -= (effect.amount || 0);
      } else {
        data.setEnemyLeaderHp(data.getEnemyLeaderHp() - (effect.leaderFallback ?? effect.amount ?? 0));
      }
      continue;
    }

    if (effect.type === "summon") {
      const count = effect.count || 1;
      for (let i = 0; i < count; i++) {
        if (!summonUnitByCardId(effect.cardId, side)) break;
      }
      continue;
    }

    if (effect.type === "buff_all_allies") {
      for (const unit of data.board) {
        unit.atk += (effect.atk || 0);
        unit.maxHp += (effect.hp || 0);
        unit.hp += (effect.hp || 0);
      }
      continue;
    }

    if (effect.type === "heal_all_allies") {
      for (const unit of data.board) {
        unit.hp = Math.min(unit.maxHp, unit.hp + (effect.amount || 0));
      }
      continue;
    }

    if (effect.type === "gain_pp") {
      if (side === "player") {
        state.pp = Math.min(state.maxPp, state.pp + (effect.amount || 0));
      } else if (runtime.enemyPp) {
        runtime.enemyPp.value = Math.min(state.maxPp, runtime.enemyPp.value + (effect.amount || 0));
      }
      continue;
    }

    if (effect.type === "destroy_enemy_highest_atk") {
      if (!data.enemyBoard.length) continue;
      let bestIdx = 0;
      for (let i = 1; i < data.enemyBoard.length; i++) {
        if (data.enemyBoard[i].atk > data.enemyBoard[bestIdx].atk) bestIdx = i;
      }
      destroyUnit(data.enemyBoard, bestIdx, side === "player" ? "enemy" : "player", runtime);
      continue;
    }
  }

  cleanupDeadUnits(runtime);
  checkGameOver();
}

function playCardFromHand(side, handIndex, runtime = {}) {
  const data = getSideData(side);
  const card = data.hand[handIndex];
  if (!card) return false;

  if (card.type === "evolution") {
    if (side === "player") log(`進化カード ${card.name} は直接プレイできません。`);
    return false;
  }

  if (side === "player") {
    if (card.cost > state.pp) {
      log(`PP不足: ${card.name} (必要${card.cost})`);
      return false;
    }
    state.pp -= card.cost;
  } else {
    if (!runtime.enemyPp || card.cost > runtime.enemyPp.value) return false;
    runtime.enemyPp.value -= card.cost;
  }

  data.hand.splice(handIndex, 1);

  if (card.type === "unit") {
    if (data.board.length >= 3) {
      data.hand.push(card);
      if (side === "player") state.pp += card.cost;
      else runtime.enemyPp.value += card.cost;
      if (side === "player") log("場がいっぱいで出せない。カードは戻った。");
      return false;
    }

    const unit = toBoardUnit(card);
    data.board.push(unit);
    if (side === "player") log(`あなたは ${card.name} を召喚。`);
    else log(`相手は ${card.name} を召喚。`);
    if (side === "player") burstFx("play");

    if (unit.onPlay.length) resolveEffects(unit.onPlay, side, runtime);
    return true;
  }

  if (card.type === "spell") {
    if (side === "player") log(`あなたは ${card.name} を使用。`);
    else log(`相手は ${card.name} を使用。`);
    if (side === "player") burstFx(card.id === "spell_heal" ? "heal" : "play");
    resolveEffects(card.effects || [], side, runtime);
    return true;
  }

  return false;
}

function startGameFromBuilder() {
  if (!isDeckValid(state.builderCounts)) {
    renderBuilder();
    return;
  }
  saveSelectedDeck(state.builderCounts);
  showBattleScreen();
}

function initializeBattleFromDeck(deckCounts) {
  const deckSize = getDeckCount(deckCounts);

  state.turn = 1;
  state.playerHp = 20;
  state.enemyHp = 20;
  state.maxPp = 1;
  state.pp = 1;
  state.playerDeck = shuffle(buildDeckFromCounts(deckCounts));
  state.enemyDeck = buildRandomDeck(deckSize);
  state.playerHand = [];
  state.enemyHand = [];
  state.playerBoard = [];
  state.enemyBoard = [];
  state.selected = null;
  state.gameOver = false;
  state.log = [];
  state.phase = "battle";

  drawCard("player", 6);
  drawCard("enemy", 6);

  log("ゲーム開始。あなたのターンです。");
}

function playCard(handIndex) {
  if (state.phase !== "battle" || state.gameOver) return;
  playCardFromHand("player", handIndex);
  renderBattle();
}

function evolveUnit(index) {
  if (state.phase !== "battle" || state.gameOver) return;

  const unit = state.playerBoard[index];
  if (!unit || unit.evolved) return;

  const evoHandIndex = findEvoHandIndexForUnit(state.playerHand, unit);
  if (evoHandIndex < 0) {
    log(`${unit.name} は進化カードが手札にないため進化できない。`);
    renderBattle();
    return;
  }

  const evoCard = state.playerHand[evoHandIndex];
  if (state.pp < evoCard.cost) {
    log(`進化PP不足: ${evoCard.name} は${evoCard.cost}必要`);
    renderBattle();
    return;
  }

  state.pp -= evoCard.cost;
  state.playerHand.splice(evoHandIndex, 1);
  applyEvolution(unit, evoCard, "player");
  log(`${unit.name} に進化した。`);
  burstFx("evolve");
  renderBattle();
}

function selectAttacker(index) {
  if (state.phase !== "battle" || state.gameOver) return;
  const unit = state.playerBoard[index];
  if (!unit || !unit.canAttack) return;
  state.selected = index;
  renderBattle();
}

function attackEnemyUnit(targetIndex) {
  if (state.phase !== "battle" || state.gameOver) return;
  if (state.selected === null) return;

  const attacker = state.playerBoard[state.selected];
  const defender = state.enemyBoard[targetIndex];
  if (!attacker || !defender) return;
  if (!canAttackFollower(attacker)) {
    log(`${attacker.name} はこのターンまだフォロワーを攻撃できない。`);
    renderBattle();
    return;
  }

  const wards = getWardUnits(state.enemyBoard);
  if (wards.length && !hasKeyword(defender, "ward")) {
    log("守護がいるため、先に守護フォロワーを攻撃する必要がある。");
    renderBattle();
    return;
  }

  defender.hp -= attacker.atk;
  attacker.hp -= defender.atk;
  attacker.canAttack = false;

  log(`${attacker.name} が ${defender.name} を攻撃。`);
  burstFx("hit");

  cleanupDeadUnits();
  state.selected = null;
  checkGameOver();
  renderBattle();
}

function attackLeader() {
  if (state.phase !== "battle" || state.gameOver) return;
  if (state.selected === null) return;

  const attacker = state.playerBoard[state.selected];
  if (!attacker) return;
  if (!canAttackLeader(attacker)) {
    log(`${attacker.name} はこのターンまだリーダーを攻撃できない。`);
    renderBattle();
    return;
  }

  if (getWardUnits(state.enemyBoard).length > 0) {
    log("守護がいるためリーダーを攻撃できない。");
    renderBattle();
    return;
  }

  state.enemyHp -= attacker.atk;
  attacker.canAttack = false;
  log(`${attacker.name} が相手リーダーに ${attacker.atk} ダメージ。`);
  burstFx("hit");

  state.selected = null;
  checkGameOver();
  renderBattle();
}

function canSelectedAttackLeaderNow() {
  if (state.selected === null) return false;
  const attacker = state.playerBoard[state.selected];
  if (!attacker) return false;
  if (!canAttackLeader(attacker)) return false;
  if (getWardUnits(state.enemyBoard).length > 0) return false;
  return true;
}

function refreshBoardForTurn(side) {
  const board = side === "player" ? state.playerBoard : state.enemyBoard;
  for (const unit of board) {
    unit.canAttack = true;
    unit.summonedThisTurn = false;
  }
}

function startPlayerTurn() {
  state.maxPp = Math.min(10, state.maxPp + 1);
  state.pp = state.maxPp;
  drawCard("player", 1);
  refreshBoardForTurn("player");
  log(`ターン${state.turn}: あなたのターン。`);
}

function enemyTurn() {
  if (state.phase !== "battle" || state.gameOver) return;

  const enemyPp = { value: state.maxPp };
  drawCard("enemy", 1);
  refreshBoardForTurn("enemy");
  log("相手ターン開始。");

  let acted = true;
  let safety = 0;
  while (acted && safety < 20) {
    acted = false;
    safety += 1;

    for (let i = 0; i < state.enemyHand.length; i++) {
      const card = state.enemyHand[i];
      if (card.type === "evolution") continue;
      if (card.cost > enemyPp.value) continue;

      if (card.type === "spell" && Math.random() < 0.35) continue;
      if (card.type === "unit" && state.enemyBoard.length >= 3) continue;

      if (playCardFromHand("enemy", i, { enemyPp })) {
        acted = true;
        break;
      }
    }
  }

  for (const unit of state.enemyBoard) {
    if (unit.evolved) continue;

    const evoHandIndex = findEvoHandIndexForUnit(state.enemyHand, unit);
    if (evoHandIndex < 0) continue;

    const evoCard = state.enemyHand[evoHandIndex];
    if (evoCard.cost > enemyPp.value || Math.random() < 0.45) continue;

    enemyPp.value -= evoCard.cost;
    state.enemyHand.splice(evoHandIndex, 1);
    applyEvolution(unit, evoCard, "enemy", { enemyPp });
    log(`相手の ${unit.name} が進化。`);
  }

  for (let i = 0; i < state.enemyBoard.length; i++) {
    const enemy = state.enemyBoard[i];
    if (!enemy || !enemy.canAttack) continue;

    const playerWards = getWardUnits(state.playerBoard);
    if (playerWards.length > 0 && canAttackFollower(enemy)) {
      const target = playerWards[0];
      target.hp -= enemy.atk;
      enemy.hp -= target.atk;
      enemy.canAttack = false;
      log(`相手の ${enemy.name} が守護 ${target.name} を攻撃。`);
      cleanupDeadUnits();
      if (checkGameOver()) return;
      continue;
    }

    if (state.playerBoard.length > 0 && canAttackFollower(enemy) && Math.random() > 0.42) {
      const target = state.playerBoard[0];
      target.hp -= enemy.atk;
      enemy.hp -= target.atk;
      enemy.canAttack = false;
      log(`相手の ${enemy.name} が ${target.name} を攻撃。`);
      cleanupDeadUnits();
      if (checkGameOver()) return;
      continue;
    }

    if (canAttackLeader(enemy)) {
      state.playerHp -= enemy.atk;
      enemy.canAttack = false;
      log(`相手の ${enemy.name} がリーダーへ ${enemy.atk} ダメージ。`);
      if (checkGameOver()) return;
    }
  }

  log("相手ターン終了。");
}

function endTurn() {
  if (state.phase !== "battle" || state.gameOver) return;

  state.selected = null;
  state.playerBoard.forEach(unit => { unit.canAttack = false; });

  enemyTurn();
  if (checkGameOver()) {
    renderBattle();
    return;
  }

  state.turn += 1;
  startPlayerTurn();
  burstFx("play");
  renderBattle();
}

function checkGameOver() {
  if (state.enemyHp <= 0) {
    state.gameOver = true;
    log("あなたの勝ち！");
    burstFx("win");
    return true;
  }
  if (state.playerHp <= 0) {
    state.gameOver = true;
    log("あなたの負け...");
    burstFx("hit");
    return true;
  }
  return false;
}

function formatKeywords(keywords = []) {
  if (!keywords.length) return "";
  return keywords.map(key => KEYWORD_LABELS[key] || key).join("/");
}

function effectToText(effect) {
  if (effect.type === "draw") return `カードを${effect.amount || 1}枚引く`;
  if (effect.type === "heal_leader") return `リーダーを${effect.amount || 0}回復`;
  if (effect.type === "damage_enemy_leader") return `相手リーダーに${effect.amount || 0}ダメージ`;
  if (effect.type === "damage_random_enemy_unit") return `相手フォロワー1体に${effect.amount || 0}ダメージ`;
  if (effect.type === "damage_all_enemy_units") return `相手フォロワー全体に${effect.amount || 0}ダメージ`;
  if (effect.type === "damage_enemy_unit_or_leader") return `相手フォロワー1体に${effect.amount || 0}ダメージ（いなければリーダーに${effect.leaderFallback ?? effect.amount ?? 0}）`;
  if (effect.type === "summon") return `${cardMap[effect.cardId]?.name || "ユニット"}を${effect.count || 1}体出す`;
  if (effect.type === "buff_all_allies") return `味方全体を+${effect.atk || 0}/+${effect.hp || 0}`;
  if (effect.type === "gain_pp") return `PPを${effect.amount || 0}回復`;
  if (effect.type === "destroy_enemy_highest_atk") return "相手の攻撃力最大フォロワーを破壊";
  if (effect.type === "heal_all_allies") return `味方全体を${effect.amount || 0}回復`;
  if (effect.type === "self_damage") return `自リーダーに${effect.amount || 0}ダメージ`;
  return effect.type;
}

function cardDescription(card) {
  const lines = [];

  if (card.type === "unit") {
    lines.push(`ユニット ${card.atk}/${card.hp}`);
    const kw = formatKeywords(card.keywords);
    if (kw) lines.push(`能力: ${kw}`);
    if (card.onPlay?.length) lines.push(`ファンファーレ: ${card.onPlay.map(effectToText).join(" / ")}`);
    if (card.onDeath?.length) lines.push(`ラストワード: ${card.onDeath.map(effectToText).join(" / ")}`);
  }

  if (card.type === "spell") {
    lines.push(`スペル: ${(card.effects || []).map(effectToText).join(" / ")}`);
  }

  if (card.type === "evolution") {
    const fromName = cardMap[card.evolvesFrom]?.name || "?";
    lines.push(`進化: ${fromName} -> ${card.name}`);
    lines.push(`進化後 ${card.atk}/${card.hp}`);
    const kw = formatKeywords(card.grantsKeywords || []);
    if (kw) lines.push(`付与: ${kw}`);
    if (card.onEvolve?.length) lines.push(`進化時: ${card.onEvolve.map(effectToText).join(" / ")}`);
  }

  return lines.join(" | ");
}

function getFactionVisual(cardLike) {
  const id = cardLike.baseId || cardLike.id || "";
  if (/(lizard|drake|fire)/.test(id)) return { cls: "art-dragon", icon: "🐉", label: "DRAGON" };
  if (/(cat|fairy|seed|forest)/.test(id)) return { cls: "art-forest", icon: "🌿", label: "FOREST" };
  if (/(tortoise|frost|crab|hydro)/.test(id)) return { cls: "art-sea", icon: "🌊", label: "SEA" };
  if (/(angel|priest|hymn|holy|blessing)/.test(id)) return { cls: "art-holy", icon: "✨", label: "HOLY" };
  if (/(necro|zombie|soul|reanimate|arcane|assassinate)/.test(id)) return { cls: "art-shadow", icon: "☾", label: "SHADOW" };
  return { cls: "art-neutral", icon: "⚔", label: "NEUTRAL" };
}

function cardArtHtml(cardLike) {
  const f = getFactionVisual(cardLike);
  return `
    <div class="artFrame ${f.cls}">
      <div class="artSigil">${f.icon}</div>
      <div class="artName">${f.label}</div>
    </div>
  `;
}

function keywordTagsHtml(keywords = []) {
  if (!keywords.length) return "";
  return `<div class="tags">${keywords.map(key => `<span class="tag">${KEYWORD_LABELS[key] || key}</span>`).join("")}</div>`;
}

function unitCardHtml(unit, text, cost = "") {
  return `
    <div class="cardTop">
      <div class="cardName">${unit.name}</div>
      ${cost !== "" ? `<div class="costOrb">${cost}</div>` : ""}
    </div>
    <div class="cardArt">
      ${cardArtHtml(unit)}
      <div class="cardText">${text || ""}</div>
    </div>
    <div class="cardBottom">
      ${keywordTagsHtml(unit.keywords || [])}
      <div style="display:flex; gap:4px;">
        <span class="stat statAtk">${unit.atk}</span>
        <span class="stat statHp">${unit.hp}</span>
      </div>
    </div>
  `;
}

function showBuilderScreen() {
  window.location.href = "deck.html";
}

function showBattleScreen() {
  window.location.href = "battle.html";
}

function unitLabel(unit) {
  const kw = formatKeywords(unit.keywords);
  return `${unit.name} [${unit.atk}/${unit.hp}]${unit.evolved ? " (進化済)" : ""}${kw ? ` <${kw}>` : ""}`;
}

function renderBuilder() {
  const deckCount = getDeckCount(state.builderCounts);
  const valid = isDeckValid(state.builderCounts);

  document.getElementById("deckCount").textContent = String(deckCount);
  document.getElementById("cardTypeCount").textContent = String(getTypeCount(state.builderCounts));

  const statusEl = document.getElementById("deckStatus");
  statusEl.textContent = valid ? "完成" : "未完成";
  statusEl.className = valid ? "statusGood" : "statusBad";

  const startBtn = document.getElementById("startGameBtn");
  startBtn.disabled = !valid;

  const catalog = document.getElementById("builderCatalog");
  catalog.innerHTML = "";

  for (const card of collectibleCards) {
    const row = document.createElement("div");
    row.className = "catalogRow";
    row.innerHTML = `
      <div>
        <strong>${card.name}</strong> (コスト${card.cost})
        <div class="catalogMeta">${cardDescription(card)}</div>
      </div>
      <div class="rowControls">
        <button data-card-id="${card.id}" data-delta="-1">-</button>
        <span class="qty">${state.builderCounts[card.id] || 0}</span>
        <button data-card-id="${card.id}" data-delta="1">+</button>
      </div>
    `;
    catalog.appendChild(row);
  }

  for (const button of catalog.querySelectorAll("button[data-card-id]")) {
    button.addEventListener("click", () => {
      const cardId = button.getAttribute("data-card-id");
      const delta = Number(button.getAttribute("data-delta"));
      const current = state.builderCounts[cardId] || 0;
      const total = getDeckCount(state.builderCounts);

      if (delta > 0 && total >= DECK_MAX) return;
      if (delta < 0 && current <= 0) return;

      state.builderCounts[cardId] = Math.max(0, current + delta);
      renderBuilder();
    });
  }

  const summary = document.getElementById("deckSummary");
  const lines = [];
  for (const card of collectibleCards) {
    const n = state.builderCounts[card.id] || 0;
    if (n > 0) lines.push(`${card.name} x${n}`);
  }

  summary.innerHTML = lines.length
    ? lines.map(line => `<div>${line}</div>`).join("")
    : `<div class="small">まだカードが入っていません。</div>`;
}

function renderBattle() {
  document.getElementById("turn").textContent = String(state.turn);
  document.getElementById("playerHp").textContent = String(Math.max(0, state.playerHp));
  document.getElementById("enemyHp").textContent = String(Math.max(0, state.enemyHp));
  document.getElementById("pp").textContent = `${state.pp}/${state.maxPp}`;
  document.getElementById("enemyLeaderAvatar").innerHTML = `
    <div class="leaderInner">
      <div class="leaderFace">🜏</div>
      <div class="leaderInfo">
        <div class="leaderName">Enemy Master</div>
        <div>HP ${Math.max(0, state.enemyHp)}</div>
      </div>
    </div>
  `;
  document.getElementById("playerLeaderAvatar").innerHTML = `
    <div class="leaderInner">
      <div class="leaderFace">✦</div>
      <div class="leaderInfo">
        <div class="leaderName">Player Master</div>
        <div>HP ${Math.max(0, state.playerHp)} / PP ${state.pp}</div>
      </div>
    </div>
  `;
  const enemyLeaderEl = document.getElementById("enemyLeaderAvatar");
  enemyLeaderEl.classList.toggle("leaderTargetable", canSelectedAttackLeaderNow());

  const enemyBoardEl = document.getElementById("enemyBoard");
  enemyBoardEl.className = "boardRow";
  enemyBoardEl.innerHTML = "";
  if (!state.enemyBoard.length) {
    enemyBoardEl.innerHTML = `<div class="emptySlot">相手フォロワーなし</div>`;
  } else {
    state.enemyBoard.forEach((unit, i) => {
      const div = document.createElement("div");
      div.className = "card battleCard";
      div.innerHTML = unitCardHtml(unit, `${unit.evolved ? "進化済" : "未進化"} / ${unit.canAttack ? "攻撃可" : "攻撃済"}`);
      div.addEventListener("click", () => attackEnemyUnit(i));
      enemyBoardEl.appendChild(div);
    });
  }

  const playerBoardEl = document.getElementById("playerBoard");
  playerBoardEl.className = "boardRow";
  playerBoardEl.innerHTML = "";
  if (!state.playerBoard.length) {
    playerBoardEl.innerHTML = `<div class="emptySlot">味方フォロワーなし</div>`;
  } else {
    state.playerBoard.forEach((unit, i) => {
      const selected = state.selected === i ? " selected" : "";
      const used = unit.canAttack ? "" : " used";
      const div = document.createElement("div");
      div.className = `card battleCard${selected}${used}`;

      const evoIdx = findEvoHandIndexForUnit(state.playerHand, unit);
      const evoCard = evoIdx >= 0 ? state.playerHand[evoIdx] : null;
      const evoHint = unit.evolved ? "" : evoCard ? ` / 進化可:${evoCard.name}` : " / 進化札なし";

      div.innerHTML = unitCardHtml(unit, `攻撃${unit.canAttack ? "可" : "済"}${evoHint}`);
      div.addEventListener("click", () => selectAttacker(i));

      if (!unit.evolved && evoCard) {
        const btn = document.createElement("button");
        btn.textContent = `進化 (${evoCard.cost}PP)`;
        btn.className = "evoBtn";
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          evolveUnit(i);
        });
        div.appendChild(btn);
      }

      playerBoardEl.appendChild(div);
    });
  }

  const handEl = document.getElementById("hand");
  handEl.className = "hand";
  handEl.innerHTML = "";
  if (!state.playerHand.length) {
    handEl.innerHTML = `<div class="small">手札がありません。</div>`;
  } else {
    state.playerHand.forEach((card, i) => {
      const div = document.createElement("div");
      const typeClass = card.type === "spell" ? " spellCard" : card.type === "evolution" ? " evolutionCard" : "";
      div.className = `card battleCard${typeClass}`;

      if (card.type === "unit") {
        div.innerHTML = unitCardHtml(card, cardDescription(card), card.cost);
      } else if (card.type === "evolution") {
        div.innerHTML = `
          <div class="cardTop">
            <div class="cardName">${card.name}</div>
            <div class="costOrb">${card.cost}</div>
          </div>
          <div class="cardArt">
            ${cardArtHtml(card)}
            <div class="cardText">${cardDescription(card)}</div>
          </div>
          <div class="cardBottom">
            ${keywordTagsHtml(card.grantsKeywords || [])}
            <div style="display:flex; gap:4px;">
              <span class="stat statAtk">${card.atk}</span>
              <span class="stat statHp">${card.hp}</span>
            </div>
          </div>
        `;
      } else {
        div.innerHTML = `
          <div class="cardTop">
            <div class="cardName">${card.name}</div>
            <div class="costOrb">${card.cost}</div>
          </div>
          <div class="cardArt">
            ${cardArtHtml(card)}
            <div class="cardText">${cardDescription(card)}</div>
          </div>
          <div class="cardBottom">
            <span class="tag">SPELL</span>
          </div>
        `;
      }
      div.addEventListener("click", () => playCard(i));
      handEl.appendChild(div);
    });
  }

  const leaderBtn = document.getElementById("attackLeaderBtn");
  if (leaderBtn) {
    leaderBtn.disabled = state.selected === null || state.gameOver;
  }
  document.getElementById("endTurnBtn").disabled = state.gameOver;

  const logEl = document.getElementById("log");
  logEl.innerHTML = state.log.map(line => {
    if (line.includes("あなたの勝ち")) return `<div class="win">${line}</div>`;
    if (line.includes("あなたの負け")) return `<div class="lose">${line}</div>`;
    return `<div>${line}</div>`;
  }).join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function hydrateBuilderCountsFromStorage() {
  const stored = loadSelectedDeck();
  if (!stored) return;

  const next = {};
  for (const card of collectibleCards) {
    const n = Number(stored[card.id]);
    next[card.id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  state.builderCounts = next;
}

function setupBuilderPage() {
  state.phase = "build";
  hydrateBuilderCountsFromStorage();

  document.getElementById("startGameBtn").addEventListener("click", startGameFromBuilder);
  document.getElementById("clearDeckBtn").addEventListener("click", () => {
    for (const card of collectibleCards) state.builderCounts[card.id] = 0;
    renderBuilder();
  });

  document.getElementById("autoDeckBtn").addEventListener("click", () => {
    state.builderCounts = buildRandomCounts(20);
    renderBuilder();
  });

  renderBuilder();
}

function setupBattlePage() {
  const stored = loadSelectedDeck();
  if (!stored) {
    showBuilderScreen();
    return;
  }

  const deckCounts = {};
  for (const card of collectibleCards) {
    const n = Number(stored[card.id]);
    deckCounts[card.id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (!isDeckValid(deckCounts)) {
    showBuilderScreen();
    return;
  }

  initializeBattleFromDeck(deckCounts);

  const leaderBtn = document.getElementById("attackLeaderBtn");
  if (leaderBtn) leaderBtn.addEventListener("click", attackLeader);
  document.getElementById("enemyLeaderAvatar").addEventListener("click", attackLeader);
  document.getElementById("endTurnBtn").addEventListener("click", endTurn);
  document.getElementById("resetBtn").addEventListener("click", showBuilderScreen);

  renderBattle();
  burstFx("play");
}

if (isBuilderPage()) setupBuilderPage();
if (isBattlePage()) setupBattlePage();

