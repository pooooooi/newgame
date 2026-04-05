const cardPool = CARD_POOL;
const cardMap = Object.fromEntries(cardPool.map(card => [card.id, card]));
const collectibleCards = cardPool.filter(card => card.collectible !== false);

const DECK_MIN = 20;
const DECK_MAX = 30;
const MAX_BOARD = 4;
const DECK_STORAGE_KEY = "monverse_selected_deck_v1";
const BATTLE_MODE_KEY = "monverse_battle_mode_v1";

const KEYWORD_LABELS = {
  ward: "守護",
  rush: "突進",
  storm: "疾走"
};

const KEYWORD_GLYPHS = {
  ward: "⬢",
  rush: "➤",
  storm: "⚡"
};

const MISSION_POOL = [
  {
    id: "play_2_cards",
    text: "このターン中にカードを2枚使う",
    rewardText: "報酬: 1ドロー",
    eval: (stats) => stats.cardsPlayed,
    target: 2,
    rewardEffects: [{ type: "draw", amount: 1 }]
  },
  {
    id: "summon_2_units",
    text: "このターン中にフォロワーを2体出す",
    rewardText: "報酬: ランダム味方+1/+1",
    eval: (stats) => stats.unitsSummoned,
    target: 2,
    rewardEffects: [{ type: "buff_random_ally", atk: 1, hp: 1 }]
  },
  {
    id: "deal_4_to_leader",
    text: "このターン中に相手リーダーへ4ダメージ",
    rewardText: "報酬: 自リーダー2回復",
    eval: (stats) => stats.leaderDamage,
    target: 4,
    rewardEffects: [{ type: "heal_leader", amount: 2 }]
  },
  {
    id: "evolve_once",
    text: "このターン中に1回進化する",
    rewardText: "報酬: 1ドロー+PP1回復",
    eval: (stats) => stats.evolves,
    target: 1,
    rewardEffects: [{ type: "draw", amount: 1 }, { type: "gain_pp", amount: 1 }]
  }
];

const state = {
  builderCounts: initializeBuilderCounts(),
  phase: "build",
  inspectCardId: null,
  secondSide: "enemy",
  handDrag: null,
  suppressHandClickUntil: 0
};

function cloneData(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Functions cannot be structured-cloned; fall through to safe deep copy.
    }
  }
  if (Array.isArray(value)) return value.map(cloneData);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneData(v);
    return out;
  }
  return value;
}

function isBuilderPage() {
  return Boolean(document.getElementById("builderScreen"));
}

function isBattlePage() {
  return Boolean(document.getElementById("battleScreen"));
}

function saveSelectedDeck(counts) {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(sanitizeBuilderCounts(counts)));
}

function saveBattleMode(mode) {
  localStorage.setItem(BATTLE_MODE_KEY, mode);
}

function loadBattleMode() {
  const mode = localStorage.getItem(BATTLE_MODE_KEY);
  return mode === "pvp" ? "pvp" : "ai";
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

function initMissionStats() {
  return { cardsPlayed: 0, unitsSummoned: 0, leaderDamage: 0, evolves: 0 };
}

function freshMission() {
  const base = MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
  return { ...cloneData(base), progress: 0, completed: false };
}

function sideTagCounts(side) {
  return side === "player" ? state.playerTagCounts : state.enemyTagCounts;
}

function missionFor(side) {
  return side === "player" ? state.playerMission : state.enemyMission;
}

function missionStatsFor(side) {
  return side === "player" ? state.playerMissionStats : state.enemyMissionStats;
}

function setMissionForTurn(side) {
  if (side === "player") {
    state.playerMission = freshMission();
    state.playerMissionStats = initMissionStats();
  } else {
    state.enemyMission = freshMission();
    state.enemyMissionStats = initMissionStats();
  }
}

function updateMissionProgress(side, runtime = {}) {
  const mission = missionFor(side);
  const stats = missionStatsFor(side);
  if (!mission || mission.completed) return;

  mission.progress = Math.min(mission.target, mission.eval(stats));
  if (mission.progress >= mission.target) {
    mission.completed = true;
    log(`${side === "player" ? "あなた" : "相手"}のミッション達成: ${mission.text}`);
    resolveEffects(missionRewardEffectsForSide(side, mission), side, runtime);
    if (isSecondPlayer(side)) {
      log(`${sideLabel(side)}に後攻補正ボーナスが適用された。`);
    }
  }
}

function registerMissionEvent(side, eventType, value = 1, runtime = {}) {
  const stats = missionStatsFor(side);
  if (!stats) return;
  if (eventType === "card_play") stats.cardsPlayed += value;
  if (eventType === "unit_summon") stats.unitsSummoned += value;
  if (eventType === "leader_damage") stats.leaderDamage += value;
  if (eventType === "evolve") stats.evolves += value;
  updateMissionProgress(side, runtime);
}

function registerTagsPlayed(side, tags = []) {
  const counts = sideTagCounts(side);
  for (const tag of tags) {
    counts[tag] = (counts[tag] || 0) + 1;
  }
}

function checkAndTriggerCombo(card, side, runtime = {}) {
  if (!card.combo) return;
  const { tag, threshold, effects, text } = card.combo;
  const counts = sideTagCounts(side);
  if ((counts[tag] || 0) < threshold) return;
  log(`${side === "player" ? "あなた" : "相手"}の ${card.name}: ${text}`);
  resolveEffects(effects || [], side, runtime);
}

function isAwakened(side, hpAtMost = 10) {
  const hp = side === "player" ? state.playerHp : state.enemyHp;
  return hp <= hpAtMost;
}

function otherSide(side) {
  return side === "player" ? "enemy" : "player";
}

function sideLabel(side) {
  if (state.battleMode === "pvp") return side === "player" ? "プレイヤー1" : "プレイヤー2";
  return side === "player" ? "あなた" : "相手";
}

function isSecondPlayer(side) {
  return side === state.secondSide;
}

function missionRewardEffectsForSide(side, mission) {
  const effects = cloneData(mission?.rewardEffects || []);
  if (!isSecondPlayer(side)) return effects;

  let boosted = false;
  for (const effect of effects) {
    if (effect.type === "draw" || effect.type === "gain_pp" || effect.type === "heal_leader") {
      effect.amount = (effect.amount || 0) + 1;
      boosted = true;
    }
  }

  if (!boosted) effects.push({ type: "draw", amount: 1 });
  return effects;
}

function missionRewardLabelForSide(side, mission) {
  if (!mission) return "";
  return isSecondPlayer(side) ? `${mission.rewardText} + 後攻補正` : mission.rewardText;
}

function activeSide() {
  return state.activeSide || "player";
}

function showPassOverlay(nextSide) {
  if (state.battleMode !== "pvp") return;
  const root = document.getElementById("passOverlay");
  if (!root) return;
  const title = document.getElementById("passTitle");
  const text = document.getElementById("passText");
  if (title) title.textContent = `${sideLabel(nextSide)}のターン`;
  if (text) text.textContent = "端末を次のプレイヤーに渡して「準備OK」を押してください";
  root.classList.remove("hidden");
}

function hidePassOverlay() {
  const root = document.getElementById("passOverlay");
  if (!root) return;
  root.classList.add("hidden");
}

function triggerAwakening(card, side, runtime = {}) {
  if (!card.awakening) return;
  if (!isAwakened(side, card.awakening.hpAtMost ?? 10)) return;
  log(`${side === "player" ? "あなた" : "相手"}の ${card.name} 覚醒: ${card.awakening.text}`);
  resolveEffects(card.awakening.effects || [], side, runtime);
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

function getBuilderBaseCount(counts, evolutionCard) {
  if (!evolutionCard?.evolvesFrom) return 0;
  return counts[evolutionCard.evolvesFrom] || 0;
}

function hasValidEvolutionDependencies(counts) {
  return collectibleCards.every((card) => {
    if (card.type !== "evolution") return true;
    if ((counts[card.id] || 0) <= 0) return true;
    return getBuilderBaseCount(counts, card) > 0;
  });
}

function sanitizeBuilderCounts(sourceCounts) {
  const next = {};
  for (const card of collectibleCards) {
    const n = Number(sourceCounts?.[card.id]);
    next[card.id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  for (const card of collectibleCards) {
    if (card.type !== "evolution") continue;
    if (next[card.id] <= 0) continue;
    if (getBuilderBaseCount(next, card) > 0) continue;
    next[card.id] = 0;
  }

  return next;
}

function canAddBuilderCard(counts, card) {
  if (card.type !== "evolution") return true;
  return getBuilderBaseCount(counts, card) > 0;
}

function canRemoveBuilderCard(counts, card) {
  if (card.type !== "unit" || !card.evolvesTo) return true;
  const evoCount = counts[card.evolvesTo] || 0;
  const nextBaseCount = Math.max(0, (counts[card.id] || 0) - 1);
  return evoCount <= 0 || nextBaseCount > 0;
}

function getDeckCount(counts) {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function getTypeCount(counts) {
  return Object.values(counts).filter(n => n > 0).length;
}

function isDeckValid(counts) {
  const size = getDeckCount(counts);
  return size >= DECK_MIN && size <= DECK_MAX && hasValidEvolutionDependencies(counts);
}

function buildDeckFromCounts(counts) {
  const deck = [];
  for (const [cardId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      const base = cardMap[cardId];
      if (base) deck.push(cloneData(base));
    }
  }
  return deck;
}

function buildRandomCounts(size) {
  const counts = {};
  for (const card of collectibleCards) counts[card.id] = 0;

  for (let i = 0; i < size; i++) {
    const selectable = collectibleCards.filter(card => canAddBuilderCard(counts, card));
    const pool = selectable.length ? selectable : collectibleCards.filter(card => card.type !== "evolution");
    const picked = pool[Math.floor(Math.random() * pool.length)];
    counts[picked.id] += 1;
  }
  return sanitizeBuilderCounts(counts);
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
    onPlay: card.onPlay ? cloneData(card.onPlay) : [],
    onDeath: card.onDeath ? cloneData(card.onDeath) : []
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
  if (data.board.length >= MAX_BOARD) return false;

  const base = cardMap[cardId];
  if (!base || base.type !== "unit") return false;

  data.board.push(toBoardUnit(base));
  registerMissionEvent(side, "unit_summon", 1);
  registerTagsPlayed(side, base.tags || []);
  return true;
}

function addCardToHand(side, cardId) {
  const base = cardMap[cardId];
  if (!base) return false;
  const data = getSideData(side);
  data.hand.push(cloneData(base));
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
      const amount = effect.amount || 0;
      data.setEnemyLeaderHp(data.getEnemyLeaderHp() - amount);
      registerMissionEvent(side, "leader_damage", amount, runtime);
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
        const amount = (effect.leaderFallback ?? effect.amount ?? 0);
        data.setEnemyLeaderHp(data.getEnemyLeaderHp() - amount);
        registerMissionEvent(side, "leader_damage", amount, runtime);
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

    if (effect.type === "buff_random_ally") {
      if (!data.board.length) continue;
      const idx = randomIndex(data.board);
      if (idx < 0) continue;
      const unit = data.board[idx];
      unit.atk += (effect.atk || 0);
      unit.maxHp += (effect.hp || 0);
      unit.hp += (effect.hp || 0);
      continue;
    }

    if (effect.type === "heal_all_allies") {
      for (const unit of data.board) {
        unit.hp = Math.min(unit.maxHp, unit.hp + (effect.amount || 0));
      }
      continue;
    }

    if (effect.type === "gain_pp") {
      if (side === "player" || state.battleMode === "pvp") {
        state.pp = Math.min(state.maxPp, state.pp + (effect.amount || 0));
      } else if (runtime.enemyPp) {
        runtime.enemyPp.value = Math.min(state.maxPp, runtime.enemyPp.value + (effect.amount || 0));
      }
      continue;
    }

    if (effect.type === "coin_pp") {
      if (side === "player" || state.battleMode === "pvp") {
        const before = state.pp;
        state.pp = Math.min(10, state.pp + (effect.amount || 0));
        log(`${sideLabel(side)}のPP: ${before} -> ${state.pp}（コイン）`);
      } else if (runtime.enemyPp) {
        runtime.enemyPp.value = Math.min(10, runtime.enemyPp.value + (effect.amount || 0));
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
    const transmuteCost = 1;
    const usesSharedPp = side === "player" || state.battleMode === "pvp";
    if (usesSharedPp) {
      if (transmuteCost > state.pp) {
        if (side === "player") log(`PP不足: ${card.name} の転用は${transmuteCost}必要`);
        return false;
      }
      state.pp -= transmuteCost;
    } else {
      if (!runtime.enemyPp || transmuteCost > runtime.enemyPp.value) return false;
      runtime.enemyPp.value -= transmuteCost;
    }

    data.hand.splice(handIndex, 1);
    resolveEffects([{ type: "heal_leader", amount: 2 }], side, runtime);
    registerMissionEvent(side, "card_play", 1, runtime);
    registerTagsPlayed(side, card.tags || []);
    log(`${sideLabel(side)}は ${card.name} を転用してリーダーを2回復。`);
    if (side === "player") burstFx("heal");
    return true;
  }

  const usesSharedPp = side === "player" || state.battleMode === "pvp";
  if (usesSharedPp) {
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
    if (data.board.length >= MAX_BOARD) {
      data.hand.push(card);
      if (usesSharedPp) state.pp += card.cost;
      else runtime.enemyPp.value += card.cost;
      if (side === "player") log("場がいっぱいで出せない。カードは戻った。");
      return false;
    }

    const unit = toBoardUnit(card);
    data.board.push(unit);
    registerMissionEvent(side, "card_play", 1, runtime);
    registerMissionEvent(side, "unit_summon", 1, runtime);
    registerTagsPlayed(side, card.tags || []);
    if (side === "player") log(`あなたは ${card.name} を召喚。`);
    else log(`相手は ${card.name} を召喚。`);
    if (side === "player") burstFx("play");

    if (unit.onPlay.length) resolveEffects(unit.onPlay, side, runtime);
    checkAndTriggerCombo(card, side, runtime);
    triggerAwakening(card, side, runtime);
    return true;
  }

  if (card.type === "spell") {
    registerMissionEvent(side, "card_play", 1, runtime);
    registerTagsPlayed(side, card.tags || []);
    if (side === "player") log(`あなたは ${card.name} を使用。`);
    else log(`相手は ${card.name} を使用。`);
    if (side === "player") burstFx(card.id === "spell_heal" ? "heal" : "play");
    resolveEffects(card.effects || [], side, runtime);
    checkAndTriggerCombo(card, side, runtime);
    triggerAwakening(card, side, runtime);
    return true;
  }

  return false;
}

function startGameFromBuilder() {
  if (!isDeckValid(state.builderCounts)) {
    renderBuilder();
    return;
  }
  saveBattleMode("ai");
  saveSelectedDeck(state.builderCounts);
  showBattleScreen();
}

function startPvpFromBuilder() {
  if (!isDeckValid(state.builderCounts)) {
    renderBuilder();
    return;
  }
  saveBattleMode("pvp");
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
  state.battleMode = loadBattleMode();
  state.playerDeck = shuffle(buildDeckFromCounts(deckCounts));
  state.enemyDeck = state.battleMode === "pvp"
    ? shuffle(buildDeckFromCounts(deckCounts))
    : buildRandomDeck(deckSize);
  state.playerHand = [];
  state.enemyHand = [];
  state.playerBoard = [];
  state.enemyBoard = [];
  state.playerTagCounts = {};
  state.enemyTagCounts = {};
  state.playerMission = null;
  state.enemyMission = null;
  state.playerMissionStats = initMissionStats();
  state.enemyMissionStats = initMissionStats();
  state.selected = null;
  state.inspectCardId = null;
  state.secondSide = "enemy";
  state.activeSide = "player";
  state.gameOver = false;
  state.log = [];
  state.phase = "battle";

  drawCard("player", 6);
  drawCard("enemy", 6);
  drawCard("enemy", 1);
  addCardToHand("enemy", "token_coin");
  beginTurn("player", false);

  log(`ゲーム開始。${sideLabel("player")}のターンです。`);
  log(`${sideLabel("enemy")}は後攻ボーナス: 初手+1枚 / コイン1枚。`);
}

function beginTurn(side, increasePp = true) {
  state.activeSide = side;
  setMissionForTurn(side);
  if (increasePp) state.maxPp = Math.min(10, state.maxPp + 1);
  state.pp = state.maxPp;
  drawCard(side, 1);
  refreshBoardForTurn(side);
  log(`ターン${state.turn}: ${sideLabel(side)}のターン。`);
}

function playCard(handIndex) {
  if (state.phase !== "battle" || state.gameOver) return;
  playCardFromHand(activeSide(), handIndex);
  renderBattle();
}

function nowMs() {
  return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
}

function clearHandDragVisuals() {
  const zone = document.getElementById("playerBoard");
  if (zone) zone.classList.remove("dropReady");
}

function cleanupHandDrag() {
  const drag = state.handDrag;
  if (!drag) return;
  if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  if (drag.sourceEl) drag.sourceEl.classList.remove("dragSource");
  clearHandDragVisuals();
  state.handDrag = null;
}

function isPointInsideElement(el, x, y) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function updateHandGhostPosition(ghost, x, y) {
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
}

function beginHandCardDrag(handIndex, sourceEl, startEv) {
  if (state.phase !== "battle" || state.gameOver) return;
  if (startEv.button !== undefined && startEv.button !== 0) return;

  const rect = sourceEl.getBoundingClientRect();
  state.handDrag = {
    handIndex,
    sourceEl,
    startX: startEv.clientX,
    startY: startEv.clientY,
    pointerId: startEv.pointerId,
    started: false,
    ghost: null,
    width: rect.width,
    height: rect.height
  };
}

function handleHandPointerMove(ev) {
  const drag = state.handDrag;
  if (!drag || ev.pointerId !== drag.pointerId) return;

  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  const dist = Math.hypot(dx, dy);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (!drag.started && adx > 12 && adx > ady + 6) {
    state.suppressHandClickUntil = nowMs() + 180;
    cleanupHandDrag();
    return;
  }

  if (!drag.started && dist < 12) return;

  if (!drag.started) {
    drag.started = true;
    drag.sourceEl.classList.add("dragSource");
    const ghost = drag.sourceEl.cloneNode(true);
    ghost.classList.add("dragGhost");
    ghost.style.width = `${drag.width}px`;
    ghost.style.height = `${drag.height}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
  }

  ev.preventDefault();
  updateHandGhostPosition(drag.ghost, ev.clientX, ev.clientY);

  const dropZone = document.getElementById("playerBoard");
  if (!dropZone) return;
  dropZone.classList.toggle("dropReady", isPointInsideElement(dropZone, ev.clientX, ev.clientY));
}

function finishHandPointer(ev, canceled = false) {
  const drag = state.handDrag;
  if (!drag || ev.pointerId !== drag.pointerId) return;

  const didDrag = drag.started;
  const dropZone = document.getElementById("playerBoard");
  const droppedOnBoard = !canceled && didDrag && isPointInsideElement(dropZone, ev.clientX, ev.clientY);
  const handIndex = drag.handIndex;

  cleanupHandDrag();

  if (didDrag) {
    state.suppressHandClickUntil = nowMs() + 250;
  }

  if (!droppedOnBoard) return;
  playCard(handIndex);
}

function evolveUnit(index) {
  if (state.phase !== "battle" || state.gameOver) return;

  const side = activeSide();
  const data = getSideData(side);
  const unit = data.board[index];
  if (!unit || unit.evolved) return;

  const evoHandIndex = findEvoHandIndexForUnit(data.hand, unit);
  if (evoHandIndex < 0) {
    log(`${unit.name} は進化カードが手札にないため進化できない。`);
    renderBattle();
    return;
  }

  const evoCard = data.hand[evoHandIndex];
  if (state.pp < evoCard.cost) {
    log(`進化PP不足: ${evoCard.name} は${evoCard.cost}必要`);
    renderBattle();
    return;
  }

  state.pp -= evoCard.cost;
  data.hand.splice(evoHandIndex, 1);
  registerMissionEvent(side, "evolve", 1);
  applyEvolution(unit, evoCard, side);
  log(`${unit.name} に進化した。`);
  burstFx("evolve");
  renderBattle();
}

function selectAttacker(index) {
  if (state.phase !== "battle" || state.gameOver) return;
  const unit = getSideData(activeSide()).board[index];
  if (!unit || !unit.canAttack) return;
  state.selected = index;
  renderBattle();
}

function attackEnemyUnit(targetIndex) {
  if (state.phase !== "battle" || state.gameOver) return;
  if (state.selected === null) return;

  const side = activeSide();
  const data = getSideData(side);
  const attacker = data.board[state.selected];
  const defender = data.enemyBoard[targetIndex];
  if (!attacker || !defender) return;
  if (!canAttackFollower(attacker)) {
    log(`${attacker.name} はこのターンまだフォロワーを攻撃できない。`);
    renderBattle();
    return;
  }

  const wards = getWardUnits(data.enemyBoard);
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

  const side = activeSide();
  const data = getSideData(side);
  const attacker = data.board[state.selected];
  if (!attacker) return;
  if (!canAttackLeader(attacker)) {
    log(`${attacker.name} はこのターンまだリーダーを攻撃できない。`);
    renderBattle();
    return;
  }

  if (getWardUnits(data.enemyBoard).length > 0) {
    log("守護がいるためリーダーを攻撃できない。");
    renderBattle();
    return;
  }

  const damage = attacker.atk;
  if (side === "player") state.enemyHp -= damage;
  else state.playerHp -= damage;
  registerMissionEvent(side, "leader_damage", damage);
  attacker.canAttack = false;
  log(`${attacker.name} が相手リーダーに ${damage} ダメージ。`);
  burstFx("hit");

  state.selected = null;
  checkGameOver();
  renderBattle();
}

function canSelectedAttackLeaderNow() {
  if (state.selected === null) return false;
  const side = activeSide();
  const data = getSideData(side);
  const attacker = data.board[state.selected];
  if (!attacker) return false;
  if (!canAttackLeader(attacker)) return false;
  if (getWardUnits(data.enemyBoard).length > 0) return false;
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
  beginTurn("player", true);
}

function enemyTurn() {
  if (state.phase !== "battle" || state.gameOver) return;

  setMissionForTurn("enemy");
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
      if (card.type === "unit" && state.enemyBoard.length >= MAX_BOARD) continue;

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
    registerMissionEvent("enemy", "evolve", 1, { enemyPp });
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
      registerMissionEvent("enemy", "leader_damage", enemy.atk, { enemyPp });
      enemy.canAttack = false;
      log(`相手の ${enemy.name} がリーダーへ ${enemy.atk} ダメージ。`);
      if (checkGameOver()) return;
    }
  }

  log("相手ターン終了。");
}

function endTurn() {
  if (state.phase !== "battle" || state.gameOver) return;

  const side = activeSide();
  state.selected = null;
  getSideData(side).board.forEach(unit => { unit.canAttack = false; });

  if (state.battleMode === "pvp") {
    const next = otherSide(side);
    const increasePp = next === "player";
    if (increasePp) state.turn += 1;
    beginTurn(next, increasePp);
    burstFx("play");
    showPassOverlay(next);
    renderBattle();
    return;
  }

  enemyTurn();
  if (checkGameOver()) {
    renderBattle();
    return;
  }

  state.turn += 1;
  beginTurn("player", true);
  burstFx("play");
  renderBattle();
}

function checkGameOver() {
  if (state.enemyHp <= 0) {
    state.gameOver = true;
    log(state.battleMode === "pvp" ? "プレイヤー1の勝ち！" : "あなたの勝ち！");
    burstFx("win");
    return true;
  }
  if (state.playerHp <= 0) {
    state.gameOver = true;
    log(state.battleMode === "pvp" ? "プレイヤー2の勝ち！" : "あなたの負け...");
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
  if (effect.type === "coin_pp") return `PPを${effect.amount || 0}増やす（上限超過可）`;
  if (effect.type === "destroy_enemy_highest_atk") return "相手の攻撃力最大フォロワーを破壊";
  if (effect.type === "heal_all_allies") return `味方全体を${effect.amount || 0}回復`;
  if (effect.type === "self_damage") return `自リーダーに${effect.amount || 0}ダメージ`;
  return effect.type;
}

function cardDescription(card) {
  const lines = [];
  if (card.tags?.length) lines.push(`タグ: ${card.tags.join("/")}`);

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
    lines.push("手札転用: 1PPでリーダーを2回復");
  }

  if (card.combo) {
    lines.push(card.combo.text);
  }

  if (card.awakening) {
    lines.push(card.awakening.text);
  }

  return lines.join(" | ");
}

function cardInspectDescription(card) {
  if (!card) return "";

  const parts = [];

  if (card.type === "unit") {
    const kw = formatKeywords(card.keywords);
    if (kw) parts.push(`能力 ${kw}`);
    if (card.onPlay?.length) parts.push(`登場 ${card.onPlay.map(effectToText).join(" / ")}`);
    if (card.onDeath?.length) parts.push(`退場 ${card.onDeath.map(effectToText).join(" / ")}`);
    if (!parts.length) parts.push(`${card.atk}/${card.hp} ユニット`);
  }

  if (card.type === "spell") {
    parts.push((card.effects || []).map(effectToText).join(" / ") || "効果なし");
  }

  if (card.type === "evolution") {
    parts.push(`進化後 ${card.atk}/${card.hp}`);
    const kw = formatKeywords(card.grantsKeywords || []);
    if (kw) parts.push(`付与 ${kw}`);
    if (card.onEvolve?.length) parts.push(`進化時 ${card.onEvolve.map(effectToText).join(" / ")}`);
    parts.push("転用 1PP 2回復");
  }

  if (card.combo?.text) parts.push(`コンボ ${card.combo.text}`);
  if (card.awakening?.text) parts.push(`覚醒 ${card.awakening.text}`);

  return parts.join("  /  ");
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

function keywordMarksHtml(keywords = []) {
  if (!keywords.length) return "";
  return `<div class="keymarks">${keywords.map((key) => `
    <span class="keymark key-${key}" title="${KEYWORD_LABELS[key] || key}">
      ${KEYWORD_GLYPHS[key] || "•"}
    </span>
  `).join("")}</div>`;
}

function keywordClassList(keywords = []) {
  return keywords.map((k) => `kw-${k}`).join(" ");
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
      ${keywordMarksHtml(unit.keywords || [])}
      <div style="display:flex; gap:4px;">
        <span class="stat statAtk">${unit.atk}</span>
        <span class="stat statHp">${unit.hp}</span>
      </div>
    </div>
  `;
}

function updateInspectPanel(card) {
  const titleEl = document.getElementById("inspectTitle");
  const textEl = document.getElementById("inspectText");
  if (!titleEl || !textEl) return;

  if (!card) {
    titleEl.textContent = "カード詳細";
    textEl.textContent = "カードの i ボタンで効果を確認できます。";
    return;
  }

  titleEl.textContent = `${card.name} (コスト${card.cost ?? "-"})`;
  textEl.textContent = cardInspectDescription(card) || cardDescription(card) || "効果テキストなし";
}

function showBuilderScreen() {
  window.location.href = "deck.html";
}

function showBattleScreen() {
  window.location.href = "battle.html";
}

function setLogModalOpen(open) {
  const modal = document.getElementById("logModal");
  if (!modal) return;
  modal.classList.toggle("hidden", !open);
  document.body.classList.toggle("modalOpen", open);
}

function unitLabel(unit) {
  const kw = formatKeywords(unit.keywords);
  return `${unit.name} [${unit.atk}/${unit.hp}]${unit.evolved ? " (進化済)" : ""}${kw ? ` <${kw}>` : ""}`;
}

function renderBuilder() {
  const deckCount = getDeckCount(state.builderCounts);
  const dependencyOk = hasValidEvolutionDependencies(state.builderCounts);
  const countOk = deckCount >= DECK_MIN && deckCount <= DECK_MAX;
  const valid = countOk && dependencyOk;

  document.getElementById("deckCount").textContent = String(deckCount);
  document.getElementById("cardTypeCount").textContent = String(getTypeCount(state.builderCounts));

  const statusEl = document.getElementById("deckStatus");
  statusEl.textContent = dependencyOk ? (valid ? "完成" : "未完成") : "進化元不足";
  statusEl.className = valid ? "statusGood" : "statusBad";

  const startBtn = document.getElementById("startGameBtn");
  startBtn.disabled = !valid;
  const startPvpBtn = document.getElementById("startPvpBtn");
  if (startPvpBtn) startPvpBtn.disabled = !valid;

  const catalog = document.getElementById("builderCatalog");
  catalog.innerHTML = "";

  for (const card of collectibleCards) {
    const lockedEvolution = card.type === "evolution" && !canAddBuilderCard(state.builderCounts, card);
    const lockText = lockedEvolution
      ? `進化元 ${cardMap[card.evolvesFrom]?.name || "対応ユニット"} を1枚以上入れると選べます。`
      : "";
    const row = document.createElement("div");
    row.className = `catalogRow${lockedEvolution ? " catalogRowLocked" : ""}`;
    row.innerHTML = `
      <div>
        <strong>${card.name}</strong> (コスト${card.cost})
        <div class="catalogMeta">${cardDescription(card)}</div>
        ${lockText ? `<div class="catalogLock">${lockText}</div>` : ""}
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
    const cardId = button.getAttribute("data-card-id");
    const delta = Number(button.getAttribute("data-delta"));
    const card = cardMap[cardId];
    const disabled = delta > 0
      ? getDeckCount(state.builderCounts) >= DECK_MAX || !canAddBuilderCard(state.builderCounts, card)
      : (state.builderCounts[cardId] || 0) <= 0 || !canRemoveBuilderCard(state.builderCounts, card);
    button.disabled = disabled;
    if (disabled && card?.type === "evolution" && delta > 0) {
      button.title = `先に ${cardMap[card.evolvesFrom]?.name || "進化元"} を入れてください`;
    } else if (disabled && card?.type === "unit" && delta < 0 && (state.builderCounts[card.evolvesTo] || 0) > 0) {
      button.title = `進化先 ${cardMap[card.evolvesTo]?.name || ""} が入っているため、0枚にはできません`;
    } else {
      button.title = "";
    }

    button.addEventListener("click", () => {
      const current = state.builderCounts[cardId] || 0;
      const total = getDeckCount(state.builderCounts);

      if (delta > 0 && total >= DECK_MAX) return;
      if (delta < 0 && current <= 0) return;
      if (delta > 0 && !canAddBuilderCard(state.builderCounts, card)) return;
      if (delta < 0 && !canRemoveBuilderCard(state.builderCounts, card)) return;

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
  const side = activeSide();
  const opp = otherSide(side);
  const me = getSideData(side);
  const foe = getSideData(opp);

  document.getElementById("turn").textContent = String(state.turn);
  document.getElementById("playerHp").textContent = String(Math.max(0, me.getLeaderHp()));
  document.getElementById("enemyHp").textContent = String(Math.max(0, me.getEnemyLeaderHp()));
  const ppCapForView = Math.max(state.maxPp, state.pp);
  document.getElementById("pp").textContent = `${state.pp}/${ppCapForView}`;
  const missionEl = document.getElementById("missionText");
  const missionChipEl = document.getElementById("missionChip");
  if (missionEl) {
    const m = missionFor(side);
    missionEl.textContent = m ? `${m.progress}/${m.target}` : "-";
    if (missionChipEl) {
      missionChipEl.title = m
        ? `${m.text} (${m.progress}/${m.target}) / ${missionRewardLabelForSide(side, m)}`
        : "ミッション未設定";
    }
  }
  const enemyHp = Math.max(0, me.getEnemyLeaderHp());
  const playerHp = Math.max(0, me.getLeaderHp());

  document.getElementById("enemyLeaderAvatar").innerHTML = `
    <div class="leaderInner mascotLeader">
      <div class="leaderMascot enemyMascot" role="img" aria-label="犬リーダー"></div>
      <div class="leaderVitals">
        <span class="hpBadge">${enemyHp}</span>
      </div>
    </div>
  `;
  document.getElementById("playerLeaderAvatar").innerHTML = `
    <div class="leaderInner mascotLeader">
      <div class="leaderMascot playerMascot" role="img" aria-label="猫リーダー"></div>
      <div class="leaderVitals">
        <span class="hpBadge">${playerHp}</span>
      </div>
    </div>
  `;
  const enemyLeaderEl = document.getElementById("enemyLeaderAvatar");
  enemyLeaderEl.title = `${sideLabel(opp)} HP ${enemyHp}`;
  enemyLeaderEl.setAttribute("data-hp", String(enemyHp));
  const playerLeaderEl = document.getElementById("playerLeaderAvatar");
  if (playerLeaderEl) {
    playerLeaderEl.title = `${sideLabel(side)} HP ${playerHp}`;
    playerLeaderEl.setAttribute("data-hp", String(playerHp));
  }
  enemyLeaderEl.classList.toggle("leaderTargetable", canSelectedAttackLeaderNow());

  const enemyBoardEl = document.getElementById("enemyBoard");
  enemyBoardEl.className = "boardRow";
  enemyBoardEl.innerHTML = "";
  if (!foe.board.length) {
    enemyBoardEl.innerHTML = `<div class="emptySlot" title="相手フォロワーなし">◇</div>`;
  } else {
    foe.board.forEach((unit, i) => {
      const div = document.createElement("div");
      div.className = `card battleCard ${keywordClassList(unit.keywords || [])}`.trim();
      div.innerHTML = unitCardHtml(unit, `${unit.evolved ? "進化済" : "未進化"} / ${unit.canAttack ? "攻撃可" : "攻撃済"}`);
      div.addEventListener("click", () => attackEnemyUnit(i));
      enemyBoardEl.appendChild(div);
    });
  }

  const playerBoardEl = document.getElementById("playerBoard");
  playerBoardEl.className = "boardRow";
  playerBoardEl.innerHTML = "";
  if (!me.board.length) {
    playerBoardEl.innerHTML = `<div class="emptySlot" title="味方フォロワーなし">◇</div>`;
  } else {
    me.board.forEach((unit, i) => {
      const selected = state.selected === i ? " selected" : "";
      const used = unit.canAttack ? "" : " used";
      const div = document.createElement("div");
      const kwClass = keywordClassList(unit.keywords || []);
      div.className = `card battleCard ${kwClass}${selected}${used}`.trim();

      const evoIdx = findEvoHandIndexForUnit(me.hand, unit);
      const evoCard = evoIdx >= 0 ? me.hand[evoIdx] : null;
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
  if (!me.hand.length) {
    handEl.innerHTML = `<div class="small">手札がありません。</div>`;
    updateInspectPanel(null);
  } else {
    let inspectMatched = false;
    me.hand.forEach((card, i) => {
      const div = document.createElement("div");
      const typeClass = card.type === "spell" ? " spellCard" : card.type === "evolution" ? " evolutionCard" : "";
      const kwClass = keywordClassList(card.keywords || card.grantsKeywords || []);
      div.className = `card battleCard handCardCompact ${kwClass}${typeClass}`.trim();
      div.setAttribute("data-cost", String(card.cost));

      if (card.type === "unit") {
        div.innerHTML = unitCardHtml(card, "", card.cost);
      } else if (card.type === "evolution") {
        div.innerHTML = `
          <div class="cardTop">
            <div class="cardName">${card.name}</div>
            <div class="costOrb">${card.cost}</div>
          </div>
          <div class="cardArt">
            ${cardArtHtml(card)}
          </div>
          <div class="cardBottom">
            ${keywordMarksHtml(card.grantsKeywords || [])}
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
          </div>
          <div class="cardBottom">
            <span class="keymark key-spell" title="スペル">✦</span>
          </div>
        `;
      }
      div.title = `${card.name} (コスト${card.cost})\n${cardDescription(card)}`;
      div.addEventListener("click", () => {
        if (state.suppressHandClickUntil > nowMs()) return;
        state.inspectCardId = card.id;
        updateInspectPanel(card);
      });
      div.addEventListener("pointerdown", (ev) => beginHandCardDrag(i, div, ev));

      const infoBtn = document.createElement("button");
      infoBtn.className = "miniInfoBtn";
      infoBtn.type = "button";
      infoBtn.textContent = "i";
      infoBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.inspectCardId = card.id;
        updateInspectPanel(card);
      });
      div.appendChild(infoBtn);

      handEl.appendChild(div);

      if (!inspectMatched && state.inspectCardId === card.id) {
        inspectMatched = true;
        updateInspectPanel(card);
      }
    });

    if (!inspectMatched) {
      state.inspectCardId = me.hand[0].id;
      updateInspectPanel(me.hand[0]);
    }
  }

  const leaderBtn = document.getElementById("attackLeaderBtn");
  if (leaderBtn) {
    leaderBtn.disabled = state.selected === null || state.gameOver;
  }
  document.getElementById("endTurnBtn").disabled = state.gameOver;

  const logHtml = state.log.map(line => {
    if (line.includes("勝ち")) return `<div class="win">${line}</div>`;
    if (line.includes("負け")) return `<div class="lose">${line}</div>`;
    return `<div>${line}</div>`;
  }).join("");

  const logTargets = [document.getElementById("log"), document.getElementById("logModalBody")];
  for (const target of logTargets) {
    if (!target) continue;
    target.innerHTML = logHtml;
    target.scrollTop = target.scrollHeight;
  }
}

function hydrateBuilderCountsFromStorage() {
  const stored = loadSelectedDeck();
  if (!stored) return;
  state.builderCounts = sanitizeBuilderCounts(stored);
}

function setupBuilderPage() {
  state.phase = "build";
  hydrateBuilderCountsFromStorage();

  document.getElementById("startGameBtn").addEventListener("click", startGameFromBuilder);
  const pvpBtn = document.getElementById("startPvpBtn");
  if (pvpBtn) pvpBtn.addEventListener("click", startPvpFromBuilder);
  document.getElementById("clearDeckBtn").addEventListener("click", () => {
    for (const card of collectibleCards) state.builderCounts[card.id] = 0;
    renderBuilder();
  });

  document.getElementById("autoDeckBtn").addEventListener("click", () => {
    state.builderCounts = sanitizeBuilderCounts(buildRandomCounts(20));
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
  const sanitizedDeckCounts = sanitizeBuilderCounts(deckCounts);
  if (!isDeckValid(sanitizedDeckCounts)) {
    showBuilderScreen();
    return;
  }

  try {
    initializeBattleFromDeck(sanitizedDeckCounts);

    const passReadyBtn = document.getElementById("passReadyBtn");
    if (passReadyBtn) passReadyBtn.addEventListener("click", hidePassOverlay);

    const leaderBtn = document.getElementById("attackLeaderBtn");
    if (leaderBtn) leaderBtn.addEventListener("click", attackLeader);
    document.getElementById("enemyLeaderAvatar").addEventListener("click", attackLeader);
    document.getElementById("endTurnBtn").addEventListener("click", endTurn);
    document.getElementById("resetBtn").addEventListener("click", showBuilderScreen);
    const logOpenBtn = document.getElementById("logOpenBtn");
    const logCloseBtn = document.getElementById("logCloseBtn");
    const logBackdrop = document.getElementById("logModalBackdrop");
    if (logOpenBtn) logOpenBtn.addEventListener("click", () => setLogModalOpen(true));
    if (logCloseBtn) logCloseBtn.addEventListener("click", () => setLogModalOpen(false));
    if (logBackdrop) logBackdrop.addEventListener("click", () => setLogModalOpen(false));
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") setLogModalOpen(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 760) setLogModalOpen(false);
    });
    window.addEventListener("pointermove", handleHandPointerMove, { passive: false });
    window.addEventListener("pointerup", (ev) => finishHandPointer(ev, false));
    window.addEventListener("pointercancel", (ev) => finishHandPointer(ev, true));

    renderBattle();
    hidePassOverlay();
    burstFx("play");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const logEl = document.getElementById("log");
    if (logEl) {
      logEl.innerHTML = `<div class="lose">初期化エラー: ${msg}</div>`;
    }
  }
}

if (isBuilderPage()) setupBuilderPage();
if (isBattlePage()) setupBattlePage();

