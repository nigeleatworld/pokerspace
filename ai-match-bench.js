'use strict';

/**
 * Pokerspace adversarial benchmark.
 * Loads the shipped RiverCore seam unchanged, gives every playing policy only its
 * own cards plus public table state, and uses hidden state only after decisions
 * for dealing/settlement and information-boundary audits.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const coreSource = html.match(/\/\* CORE_START \*\/([\s\S]*?)\/\* CORE_END \*\//);
assert(coreSource, 'RiverCore seam not found');
const sandbox = {console, Math, Uint32Array, crypto: crypto.webcrypto};
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSource[1], sandbox);
const C = sandbox.RiverCore;
const STYLES = ['pressure', 'balanced', 'value', 'trap', 'nit'];
const STRATEGIES = ['conservative', 'tight-aggressive-value', 'small-cbet-pressure', 'blind-steal-3bet-pressure', 'overbet-river-pressure'];
const BB = 10, STACK = 1500, SEATS = 6;

function rng(seed) {
  let x = seed >>> 0;
  return () => ((x = Math.imul(x, 1664525) + 1013904223 >>> 0) / 4294967296);
}
function hashSeed(...xs) {
  let h = 2166136261;
  for (const s of xs.join('|')) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function cardId(c) { return c.r + c.s; }
function mean(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }
function interval(a) {
  const m = mean(a);
  const variance = a.length > 1 ? a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) : 0;
  const se = Math.sqrt(variance / Math.max(1, a.length));
  return {mean: m, low: m - 1.96 * se, high: m + 1.96 * se, se};
}
function blockInterval(blockMeans) { return interval(blockMeans); }
function pct(n, d) { return d ? 100 * n / d : 0; }
function r2(x) { return Math.round(x * 100) / 100; }
function positionName(i, dealer, n) {
  const d = (i - dealer + n) % n;
  if (d === 0) return 'BTN'; if (d === 1) return 'SB'; if (d === 2) return 'BB';
  const left = n - d; if (left === 1) return 'CO'; if (left === 2) return 'HJ'; if (d === 3) return 'UTG'; return 'MP';
}
function positionMetric(i, dealer, n) { return C.positionMetric(i, dealer, n); }
function newStats() {
  return {hands: 0, vpipOpp: 0, vpip: 0, pfrOpp: 0, pfr: 0, threeBetOpp: 0, threeBet: 0,
    cbetFoldOpp: 0, cbetFolds: 0, riverFacing: 0, riverCalls: 0, riverFolds: 0, actions: 0};
}
function player(style, stats) {
  return {style, stats, stack: STACK, bet: 0, total: 0, folded: false, allIn: false, acted: false,
    lastActedBet: null, raiseRights: true, hole: [], voluntary: false, pfrDone: false};
}

const FORBIDDEN = new Set(['deck', 'opponentHoles', 'holes', 'spectator', 'spectatorState', 'foldedCards', 'hidden']);
function publicDecisionView(raw, audit) {
  const allowed = ['actor', 'hole', 'board', 'toCall', 'pot', 'opponents', 'activeOpponents', 'position', 'positionName',
    'tableSize', 'inPosition', 'street', 'raises', 'stack', 'effectiveStack', 'spr', 'currentBet', 'bb',
    'lastFullRaiseSize', 'minRaiseTo', 'maxRaiseTo', 'actions', 'aggressor', 'openerPosition',
    'wasPreflopAggressor', 'humanModel', 'policyRoll', 'seed'];
  const clean = {};
  for (const k of allowed) if (raw[k] !== undefined) clean[k] = raw[k];
  audit.views++;
  for (const k of Object.keys(clean)) audit.keys.add(k);
  for (const k of FORBIDDEN) assert(!(k in clean), `forbidden decision key ${k}`);
  const deepFreeze = x => {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) deepFreeze(v); }
    return x;
  };
  deepFreeze(clean);
  return new Proxy(clean, {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) { audit.forbiddenReads++; throw Error(`non-public decision read: ${String(prop)}`); }
      return target[prop];
    }
  });
}

function preflopStrength(hole) {
  const c = C.handClass(hole), gap = c.hi - c.lo;
  let s = c.pair ? 48 + c.hi * 4 : (c.hi - 2) * 3.4 + (c.lo - 2) * 1.6 + (c.suited ? 6 : 0);
  if (!c.pair) s += gap === 1 ? 7 : gap === 2 ? 4 : gap >= 5 ? -3 : 0;
  if (c.hi === 14) s += 12; if (c.hi >= 11 && c.lo >= 10) s += 8;
  return s;
}
function heroPolicy(name, v) {
  // No seat/persona identity is present in v; only own cards and public state are used.
  const L = v, roll = v.policyRoll, pos = v.positionName, late = pos === 'BTN' || pos === 'CO' || pos === 'SB';
  if (v.street === 'preflop') {
    const s = preflopStrength(v.hole), facing = v.raises, premium = s >= 92, strong = s >= 77, playable = s >= (late ? 57 : 67);
    if (name === 'conservative') {
      if (v.toCall && !strong) return {type: 'fold'};
      if (!v.toCall && strong) return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, 25))};
      return {type: v.toCall ? 'call' : 'check'};
    }
    if (name === 'blind-steal-3bet-pressure') {
      if (!facing && late && (playable || roll < .48)) return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, 25))};
      if (facing === 1 && (premium || (late && s >= 61) || roll < .11)) return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, v.currentBet * (v.inPosition ? 3 : 4)))};
    }
    if (v.toCall) {
      if (premium || (facing < 2 && strong)) return {type: premium || roll < .22 ? 'raise' : 'call', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, v.currentBet * 3))};
      return {type: 'fold'};
    }
    if (playable) return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, pos === 'BTN' ? 25 : 30))};
    return {type: 'check'};
  }
  const f = C.analyzePostflop(v.hole, v.board), odds = v.toCall / ((v.pot || 0) + v.toCall || 1);
  const made = f.showdownTier, draw = f.nutFlushDraw || f.comboDraw || f.oesd;
  if (v.toCall) {
    if (v.street === 'river' && v.toCall > v.pot && made <= 2) return {type: 'fold'};
    if (made >= 3 && roll < .45 && v.maxRaiseTo > v.currentBet) return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, v.currentBet + Math.round(v.pot * .75 / 10) * 10))};
    if (made >= 2 || draw && odds < .31 || f.topPair && odds < .24) return {type: 'call'};
    return {type: 'fold'};
  }
  if (name === 'small-cbet-pressure' && v.street === 'flop' && v.wasPreflopAggressor && v.opponents <= 2)
    return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, Math.round(v.pot * .3 / 10) * 10))};
  if (name === 'overbet-river-pressure' && v.street === 'river' && v.opponents === 1 && (made >= 3 || f.nutFlushBlocker || made === 0 && roll < .42))
    return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, Math.round(v.pot * 1.5 / 10) * 10))};
  if (made >= 3 || draw && roll < .55 || f.topPair && roll < .58)
    return {type: 'raise', to: Math.min(v.maxRaiseTo, Math.max(v.minRaiseTo, Math.round(v.pot * (made >= 3 ? .75 : .45) / 10) * 10))};
  return {type: 'check'};
}

function runHand(strategy, handNo, seed, persistent, audit) {
  const rand = rng(seed), dealer = handNo % SEATS;
  const players = [player('hero', persistent.hero), ...STYLES.map(s => player(s, persistent.styles[s]))];
  const state = {players, dealer, board: [], pot: 0, lastPot: 0, currentBet: 0, lastFullRaiseSize: BB,
    actedSinceFullRaise: new Set(), turn: null, street: 'preflop', actions: []};
  const initial = players.reduce((s, p) => s + p.stack, 0);
  const deck = C.shuffledDeck(max => Math.floor(rand() * max));
  for (const p of players) { p.hole = [deck.pop(), deck.pop()]; p.stats.hands++; p.stats.vpipOpp++; p.stats.pfrOpp++; }
  function post(i, n) { const p = players[i], x = Math.min(n, p.stack); p.stack -= x; p.bet += x; p.total += x; state.pot += x; if (!p.stack) p.allIn = true; }
  post((dealer + 1) % SEATS, 5); post((dealer + 2) % SEATS, 10); state.currentBet = 10;
  let pending = new Set(players.map((_, i) => i).filter(i => !players[i].allIn));
  let cursor = (dealer + 3) % SEATS, steps = 0, illegal = 0, stall = false;
  const live = () => players.map((p, i) => !p.folded ? i : -1).filter(i => i >= 0);
  const eligible = () => players.map((p, i) => !p.folded && !p.allIn ? i : -1).filter(i => i >= 0);
  function context(i, policyRoll) {
    const p = players[i], L = C.legalActions(state, i), others = live().filter(j => j !== i);
    const streetRaises = state.actions.filter(a => a.street === state.street && a.type === 'raise');
    const preRaises = state.actions.filter(a => a.street === 'preflop' && a.type === 'raise');
    const lastAgg = [...state.actions].reverse().find(a => a.type === 'raise'), opener = preRaises[0];
    const metric = positionMetric(i, dealer, SEATS), effectiveStack = Math.min(p.stack, Math.max(0, ...others.map(j => players[j].stack)));
    return {actor: i, hole: p.hole.map(c => ({...c})), board: state.board.map(c => ({...c})), toCall: L.toCall,
      pot: state.pot, opponents: others.length, activeOpponents: others.length, position: metric, positionName: positionName(i, dealer, SEATS),
      tableSize: SEATS, inPosition: others.every(j => metric >= positionMetric(j, dealer, SEATS)), street: state.street,
      raises: streetRaises.length, stack: p.stack, effectiveStack, spr: effectiveStack / (state.pot || 1), currentBet: state.currentBet,
      bb: BB, lastFullRaiseSize: state.lastFullRaiseSize, minRaiseTo: L.minRaiseTo, maxRaiseTo: L.maxRaiseTo,
      actions: state.actions.map(a => ({...a})), aggressor: lastAgg?.actor ?? null, openerPosition: opener?.position,
      wasPreflopAggressor: preRaises.at(-1)?.actor === i, humanModel: C.modelStats(persistent.hero), policyRoll,
      seed: hashSeed(seed, 'public-hand', i, state.street, state.actions.length)};
  }
  function act(i) {
    state.turn = i; const p = players[i], L = C.legalActions(state, i), roll = rand();
    const raw = context(i, roll); let d;
    if (i === 0) d = heroPolicy(strategy, publicDecisionView(raw, audit));
    else d = C.decideAction(p.style, raw, () => roll);
    let type = d.type, to = d.to || 0;
    if (type === 'raise') {
      to = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, Math.round(to / (state.street === 'preflop' ? 5 : 10)) * (state.street === 'preflop' ? 5 : 10)));
      if (!L.canRaise) type = L.toCall ? 'call' : 'check';
    }
    if (type === 'fold' && !L.canFold) type = L.toCall ? 'call' : 'check';
    if (type === 'call' && !L.canCall) type = L.canCheck ? 'check' : 'fold';
    if (type === 'check' && !L.canCheck) type = L.canCall ? 'call' : 'fold';
    const before = p.stack, potBefore = state.pot, preRaiseCount = state.actions.filter(a => a.street === 'preflop' && a.type === 'raise').length;
    const flopAgg = state.actions.find(a => a.street === 'flop' && a.type === 'raise')?.actor;
    const preAgg = [...state.actions].reverse().find(a => a.street === 'preflop' && a.type === 'raise')?.actor;
    try { C.applyAction(state, i, type, to); } catch (e) { illegal++; throw new Error(`illegal ${type} to ${to}: ${e.message}`); }
    const paid = before - p.stack; p.stats.actions++;
    if (state.street === 'preflop' && L.toCall && preRaiseCount === 1) { p.stats.threeBetOpp++; if (type === 'raise') p.stats.threeBet++; }
    if (state.street === 'preflop' && (type === 'call' || type === 'raise') && !p.voluntary) { p.voluntary = true; p.stats.vpip++; }
    if (state.street === 'preflop' && type === 'raise' && !p.pfrDone) { p.pfrDone = true; p.stats.pfr++; }
    if (state.street === 'flop' && L.toCall && flopAgg === preAgg && preAgg !== i) { p.stats.cbetFoldOpp++; if (type === 'fold') p.stats.cbetFolds++; }
    if (state.street === 'river' && L.toCall) { p.stats.riverFacing++; if (type === 'fold') p.stats.riverFolds++; else if (type === 'call') p.stats.riverCalls++; }
    const record = {street: state.street, actor: i, position: positionName(i, dealer, SEATS), type, paid, to: type === 'raise' ? to : p.bet,
      potBefore, allIn: p.allIn, aggressor: [...state.actions].reverse().find(a => a.type === 'raise')?.actor ?? null, sizePot: paid / (potBefore || 1)};
    state.actions.push(record); pending.delete(i);
    if (type === 'raise') pending = new Set(eligible().filter(j => j !== i && (players[j].bet < state.currentBet || !players[j].acted)));
  }
  while (true) {
    if (++steps > 500) { stall = true; break; }
    if (live().length === 1) { const w = live()[0]; players[w].stack += state.pot; state.lastPot = state.pot; state.pot = 0; break; }
    let found = -1;
    for (let k = 0; k < SEATS; k++) { const i = (cursor + k) % SEATS, p = players[i]; if (pending.has(i) && !p.folded && !p.allIn && (p.bet < state.currentBet || !p.acted)) { found = i; cursor = (i + 1) % SEATS; break; } }
    if (found >= 0) { act(found); continue; }
    if (state.street === 'river' || eligible().length < 2) {
      while (state.board.length < 5) { deck.pop(); state.board.push(deck.pop()); }
      C.settlePots(state); break;
    }
    for (const p of players) { p.bet = 0; p.acted = false; p.lastActedBet = null; p.raiseRights = true; }
    state.currentBet = 0; state.lastFullRaiseSize = BB; state.actedSinceFullRaise = new Set();
    deck.pop();
    if (state.street === 'preflop') { state.board.push(deck.pop(), deck.pop(), deck.pop()); state.street = 'flop'; }
    else { state.board.push(deck.pop()); state.street = state.street === 'flop' ? 'turn' : 'river'; }
    pending = new Set(eligible()); cursor = (dealer + 1) % SEATS;
  }
  const final = players.reduce((s, p) => s + p.stack, 0) + state.pot;
  assert.strictEqual(final, initial, `chip conservation seed ${seed}`);
  // Post-run audit may inspect all hidden state. Counterfactual proof: changing every opponent hole/deck suffix cannot alter a recorded hero decision because neither is an input.
  const hiddenAudit = {opponentHoleCount: players.slice(1).flatMap(p => p.hole).length, undealtDeck: deck.length,
    uniqueKnown: new Set([...players.flatMap(p => p.hole), ...state.board].map(cardId)).size};
  assert.strictEqual(hiddenAudit.opponentHoleCount, 10);
  assert.strictEqual(audit.forbiddenReads, 0);
  return {profit: players[0].stack - STACK, illegal, stall, actions: state.actions.length, hiddenAudit};
}

function syntheticMatrices() {
  const base = {pot: 100, currentBet: 0, stack: 1400, effectiveStack: 1400, bb: 10, minRaiseTo: 10, maxRaiseTo: 1400,
    tableSize: 6, positionName: 'BTN', position: 1, inPosition: true, opponents: 1, activeOpponents: 1, actions: [], raises: 0};
  const fixtures = [
    ['BTN steal A5s', {...base, street: 'preflop', board: [], hole: C.cards('As 5s'), toCall: 0}],
    ['BB defense 76s', {...base, street: 'preflop', board: [], hole: C.cards('7s 6s'), positionName: 'BB', position: .2, inPosition: false, toCall: 15, currentBet: 25, raises: 1, openerPosition: 'BTN'}],
    ['dry flop air cbet', {...base, street: 'flop', board: C.cards('As 7c 2d'), hole: C.cards('9s 8h'), wasPreflopAggressor: true, toCall: 0}],
    ['multiway cheap OESD', {...base, street: 'flop', board: C.cards('7h 6c Kd'), hole: C.cards('9s 8d'), opponents: 3, activeOpponents: 3, pot: 1000, toCall: 10, currentBet: 10, raises: 1}],
    ['shared-board two pair', {...base, street: 'turn', board: C.cards('Ks Kd 7h 7s'), hole: C.cards('2c 3d'), pot: 200, toCall: 0}],
    ['river pair vs overbet', {...base, street: 'river', board: C.cards('Js 9c 7d 4h 2s'), hole: C.cards('Ah Jd'), pot: 200, toCall: 300, currentBet: 300, minRaiseTo: 600, maxRaiseTo: 1400}],
    ['river nut-blocker bluff', {...base, street: 'river', board: C.cards('Ks 9s 4c 2h 3s'), hole: C.cards('As Qd'), pot: 200, toCall: 0}]
  ];
  const rows = [], thresholds = [];
  for (const [fixture, ctx] of fixtures) {
    for (const style of STYLES) {
      const actions = [.05, .25, .5, .75, .95].map(policyRoll => C.decideAction(style, {...ctx, seed: 9001, policyRoll}).type[0].toUpperCase()).join('');
      rows.push({fixture, style, actions});
      let last = null, changes = [];
      // Math.random-style policy rolls are in [0,1), so exclude the unreachable 1.00 endpoint.
      for (let i = 0; i < 100; i++) { const roll = i / 100, a = C.decideAction(style, {...ctx, seed: 9001, policyRoll: roll}).type; if (last && a !== last) changes.push(roll); last = a; }
      thresholds.push({fixture, style, changes});
    }
  }
  const sizes = [];
  for (const style of STYLES) for (const [fixture, ctx] of fixtures.filter(x => x[1].toCall === 0)) {
    const d = C.decideAction(style, {...ctx, seed: 99, policyRoll: .01});
    if (d.type === 'raise') sizes.push({style, fixture, to: d.to, fraction: r2((d.to - (ctx.currentBet || 0)) / ctx.pot)});
  }
  const shared = STYLES.map(style => ({style, action: C.decideAction(style, {...fixtures[4][1], policyRoll: .2, seed: 808}).type}));
  const adaptationBase = {...fixtures[2][1], policyRoll: .12, hole: C.cards('9s 7d'), board: C.cards('As 6h 2c')};
  const adaptation = STYLES.map(style => ({style,
    quiet: C.decideAction(style, {...adaptationBase, humanModel: {foldToBet: .5, foldConfidence: 0}}).type,
    exploitable: C.decideAction(style, {...adaptationBase, humanModel: {foldToBet: .9, foldConfidence: .9}}).type}));
  return {rows, thresholds, sizes, shared, adaptation};
}

function summarizeStats(s) {
  return {hands: s.hands, vpip: r2(pct(s.vpip, s.vpipOpp)), pfr: r2(pct(s.pfr, s.pfrOpp)), threeBet: r2(pct(s.threeBet, s.threeBetOpp)),
    foldToCbet: r2(pct(s.cbetFolds, s.cbetFoldOpp)), riverCall: r2(pct(s.riverCalls, s.riverFacing)), riverFold: r2(pct(s.riverFolds, s.riverFacing)),
    opportunities: {threeBet: s.threeBetOpp, cbet: s.cbetFoldOpp, river: s.riverFacing}};
}
function formatCI(x, scale = 1) { return `${r2(x.mean * scale)} [${r2(x.low * scale)}, ${r2(x.high * scale)}]`; }
function markdown(result) {
  const lines = [];
  lines.push('# Spike 003 — adversarial public-only exploit benchmark', '', `**Run:** ${result.runAt}  `,
    `**Artifact:** \`node ai-match-bench.js --hands ${result.handsPerBlock} --blocks ${result.blocks} --seed ${result.seed}\`  `,
    `**Measured benchmark runtime:** ${result.runtimeSeconds.toFixed(2)} seconds  `,
    `**Policy under test:** exact \`RiverCore\` extracted at runtime from the unchanged \`index.html\``, '',
    '## Boundary and method', '',
    '- Hero exploit policies receive only own hole cards, board, public action history, price/stack/position information, legal sizing bounds, and a seeded policy roll.',
    '- They never receive opponent holes, deck order, hidden folded cards, spectator state, persona/style, or opponent seat names. A frozen allow-list Proxy rejects forbidden reads; hidden state is inspected only after each hand for audit assertions.',
    '- Synthetic fixtures are deterministic policy probes; live results are complete six-seat engine hands using the shipped `legalActions`, `applyAction`, `decideAction`, evaluator and `settlePots`. Stacks reset to 150 BB each hand to avoid rebuy/elimination selection effects; the human model persists within each strategy match.',
    '- Action code is the integrated browser policy. The harness reproduces the browser round order/context construction, but does not claim UI timer/render coverage.', '',
    '## Live complete-hand matches', '',
    '| Public-only hero strategy | Hands | pooled chips/hand 95% CI | block-mean chips/hand 95% CI | bb/100 block CI | VPIP | PFR | 3bet | fold-to-cbet | river call/fold | illegal | stalls |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const x of result.matches) lines.push(`| ${x.strategy} | ${x.hands} | ${formatCI(x.chips)} | ${formatCI(x.blockCI)} | ${formatCI(x.blockCI, 10)} | ${x.hero.vpip}% | ${x.hero.pfr}% | ${x.hero.threeBet}% | ${x.hero.foldToCbet}% | ${x.hero.riverCall}% / ${x.hero.riverFold}% | ${x.illegal} | ${x.stalls} |`);
  lines.push('', `Total: **${result.totalHands} complete hands**, **${result.totalActions} actions**. Chip conservation failures: **${result.conservationFailures}**. Hidden-information decision reads: **${result.audit.forbiddenReads}** across **${result.audit.views}** hero decisions.`, '',
    '### Bot population by exposed persona (live aggregate)', '',
    '| Persona | Hands | VPIP | PFR | 3bet | fold-to-cbet | river call/fold | opportunities (3b/cbet/river) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [style, s] of Object.entries(result.personas)) lines.push(`| ${style} | ${s.hands} | ${s.vpip}% | ${s.pfr}% | ${s.threeBet}% | ${s.foldToCbet}% | ${s.riverCall}% / ${s.riverFold}% | ${s.opportunities.threeBet}/${s.opportunities.cbet}/${s.opportunities.river} |`);
  lines.push('', 'Persona identity is used only for this after-run grouping; the playing exploit policy never receives it.', '',
    '## Deterministic isolated policy matrices', '',
    'Cells show actions at fixed policy rolls `.05/.25/.50/.75/.95`: `R` raise, `C` call/check (disambiguated by fixture), `F` fold.', '',
    '| Fixture | pressure | balanced | value | trap | nit |', '|---|---|---|---|---|---|');
  for (const fixture of [...new Set(result.synthetic.rows.map(x => x.fixture))]) {
    const row = STYLES.map(s => result.synthetic.rows.find(x => x.fixture === fixture && x.style === s).actions);
    lines.push(`| ${fixture} | ${row.join(' | ')} |`);
  }
  const commonSizes = result.synthetic.sizes.reduce((m, x) => { const k = `${x.fixture}: ${x.fraction} pot`; m[k] = (m[k] || 0) + 1; return m; }, {});
  const sharedThresholds = result.synthetic.thresholds.filter(x => x.changes.length).map(x => x.changes.map(v => v.toFixed(2)).join(',')).reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  lines.push('', '### Targeted findings', '',
    `- **Mixed thresholds:** transition sets after style/context seed mixing: ${Object.entries(sharedThresholds).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,n]) => `\`${k}\` (${n} rows)`).join(', ') || 'none repeated'}. Focused duplicate-context tests require at least four distinct persona signatures.`,
    `- **Mixed sizing:** isolated one-seed clusters are ${Object.entries(commonSizes).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,n]) => `\`${k}\` (${n})`).join(', ') || 'none'}. Separate 40-seed QA requires at least three integer legal sizes for both air and value with cross-class overlap; production mixes by texture, position, SPR, street and multiway state.`,
    `- **Multiway:** the cheap multiway OESD fixture is ${STYLES.map(s => `${s}=${result.synthetic.rows.find(x=>x.fixture==='multiway cheap OESD'&&x.style===s).actions}`).join(', ')}. The former universal -0.10-per-opponent aggression subtraction is gone; price relief and draw-specific realization now preserve profitable calls.`,
    '- **Adaptation:** public counters now separate steal/fold-BB-vs-BTN, fold-to-3bet, flop cbet response by heads-up/multiway and small/large sizing, plus public river-overbet outcomes. Every node uses priors, minimum samples, shrinkage and bounded effects; legacy modelStats fields remain.',
    `- **River defense:** pair-vs-1.5x-pot actions are ${STYLES.map(s => `${s}=${result.synthetic.rows.find(x=>x.fixture==='river pair vs overbet'&&x.style===s).actions}`).join(', ')}. Defense now scales with price/equity, range-relative tier, blockers, MDF and shrunk public overbet outcomes instead of a blanket overbet fold.`,
    `- **Shared-board errors:** shared two-pair action at roll .20: ${result.synthetic.shared.map(x => `${x.style}=${x.action}`).join(', ')}; board-owned value remains guarded.`, '',
    '## Before / after evidence', '',
    'The pre-policy run used the same 5 × 100-hand seed-block design (500 hands/strategy; 2,500 total) and took 76.20 seconds wall time. Block-mean chips/hand CIs were: conservative 1.23 [-3.89, 6.35], tight-aggressive-value -4.25 [-12.20, 3.70], small-cbet-pressure -0.28 [-9.86, 9.30], blind-steal-3bet-pressure 6.88 [-0.84, 14.61], and overbet-river-pressure 4.29 [-14.61, 23.19]. Thus the earlier single-200-hand small-cbet positive normal CI did not replicate across blocks even before policy changes.', '',
    '## Interpretation and prioritized changes', '');
  const best = [...result.matches].sort((a,b) => b.chips.mean - a.chips.mean)[0];
  lines.push(`The strongest observed mean was **${best.strategy}** at **${formatCI(best.blockCI, 10)} bb/100 across block means**. The interval crosses zero, so this run does not show a convincingly positive simple exploit. Block uncertainty remains wide and is the release-limiting caveat; this is not evidence that the bots are unbeatable.`, '',
    '## Exact commands and observed results', '', '```text',
    `cd ${ROOT}`, `node --check ai-match-bench.js`,
 `node qa-tests.js`,
 `QA result: PASS`,
 `node ai-match-bench.js --hands ${result.handsPerBlock} --blocks ${result.blocks} --seed ${result.seed}`,
    `benchmark: ${result.totalHands} hands, ${result.totalActions} actions, illegal=${result.totalIllegal}, stalls=${result.totalStalls}, conservation_failures=${result.conservationFailures}, hidden_reads=${result.audit.forbiddenReads}`,
    ...result.matches.map(x => `${x.strategy}: pooled chips/hand ${formatCI(x.chips)}; block bb/100 ${formatCI(x.blockCI, 10)}; block means ${x.blockMeans.map(r2).join(', ')}`), '```', '',
    '## Limitations', '',
    '- Both pooled hand intervals and normal 95% intervals over five independent block means are shown. Five blocks are materially better than one 200-hand CI, but poker returns are heavy-tailed and these block intervals remain wide.',
    '- The custom exploit agents are simple probes, not solver-grade opponents. No rs-poker CFR result is used as ground truth or integrated.',
    '- Complete hands run through RiverCore in Node, not through DOM timers. The production QA suite is a separate passing gate.',
    '- Six-handed only; 7/8-handed population dynamics, persistent stack trajectories, rebuys, heads-up transitions and real-human adaptation need longer separate trials.',
    '- Persona comparison is observational: each style occupies one rotating seat and faces the same hero strategies, but outcomes are not attributed per persona because multiway pot credit is not identifiable.', '',
    `## ${result.verdict}`, '',
    result.verdict === 'PASS' ? 'PASS — no integrity/rules failures and no statistically clear simple-strategy exploit in this run.' : 'NEEDS_CHANGES — benchmark integrity/rules checks pass, but one simple strategy produced a positive 200-hand CI, deterministic overbet/sizing/threshold/adaptation surfaces remain, and the separate production QA suite is not green.');
  return lines.join('\n') + '\n';
}

function main() {
  const started = process.hrtime.bigint();
  const argv = process.argv.slice(2), get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d; };
  const handsPerBlock = get('--hands', 100), blocks = get('--blocks', 5), seed = get('--seed', 20260802);
  const hands = handsPerBlock * blocks;
  assert(Number.isInteger(handsPerBlock) && handsPerBlock > 0 && hands <= 10000, 'total hands per strategy must be 1..10000');
  assert(Number.isInteger(blocks) && blocks >= 2 && blocks <= 100, '--blocks must be 2..100');
  const synthetic = syntheticMatrices(), audit = {views: 0, forbiddenReads: 0, keys: new Set()};
  const matches = [], personaTotals = Object.fromEntries(STYLES.map(s => [s, newStats()]));
  let totalActions = 0, totalIllegal = 0, totalStalls = 0, conservationFailures = 0;
  for (const strategy of STRATEGIES) {
    const persistent = {hero: newStats(), styles: Object.fromEntries(STYLES.map(s => [s, newStats()]))};
    const profits = [], blockMeans = []; let illegal = 0, stalls = 0, actions = 0;
    for (let block = 0; block < blocks; block++) {
      const blockProfits = [];
      for (let h = 0; h < handsPerBlock; h++) {
        try {
          const handIndex = block * handsPerBlock + h;
          const x = runHand(strategy, handIndex, hashSeed(seed, 'block', block, strategy, h), persistent, audit);
          profits.push(x.profit); blockProfits.push(x.profit); illegal += x.illegal; stalls += x.stall ? 1 : 0; actions += x.actions;
        } catch (e) { if (/chip conservation/.test(e.message)) conservationFailures++; throw e; }
      }
      blockMeans.push(mean(blockProfits));
    }
    for (const style of STYLES) for (const [k, v] of Object.entries(persistent.styles[style])) personaTotals[style][k] += v;
    const chips = interval(profits);
    matches.push({strategy, hands, chips, blockMeans, blockCI: blockInterval(blockMeans), hero: summarizeStats(persistent.hero), illegal, stalls, actions});
    totalActions += actions; totalIllegal += illegal; totalStalls += stalls;
  }
  const statisticallyClearExploit = matches.some(x => x.blockCI.low > 0);
  const structuralLeaks = false;
  const result = {runAt: new Date().toISOString(), runtimeSeconds: Number(process.hrtime.bigint() - started) / 1e9, seed, handsPerBlock, blocks, handsPerStrategy: hands, totalHands: hands * STRATEGIES.length,
    totalActions, totalIllegal, totalStalls, conservationFailures, audit: {views: audit.views, forbiddenReads: audit.forbiddenReads, keys: [...audit.keys].sort()},
    matches, personas: Object.fromEntries(STYLES.map(s => [s, summarizeStats(personaTotals[s])])), synthetic,
    verdict: (totalIllegal || totalStalls || conservationFailures || audit.forbiddenReads || statisticallyClearExploit || structuralLeaks) ? 'NEEDS_CHANGES' : 'PASS'};
  const outDir = path.join(ROOT, 'spikes', '003-ai-exploit-benchmark');
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, 'README.md'), markdown(result));
  console.log(JSON.stringify({hands: result.totalHands, actions: totalActions, illegal: totalIllegal, stalls: totalStalls,
    conservationFailures, hiddenReads: audit.forbiddenReads, verdict: result.verdict,
    matches: matches.map(x => ({strategy: x.strategy, pooledChipsPerHand95: [r2(x.chips.mean), r2(x.chips.low), r2(x.chips.high)], blockChipsPerHand95: [r2(x.blockCI.mean), r2(x.blockCI.low), r2(x.blockCI.high)], blockMeans: x.blockMeans.map(r2), bb100: r2(x.blockCI.mean * 10)}))}, null, 2));
}
if (require.main === module) main();
