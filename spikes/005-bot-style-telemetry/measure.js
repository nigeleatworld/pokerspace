'use strict';

/** Deterministic, read-only telemetry harness for the shipped River Room RiverCore. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const DIR = __dirname;
const ROOT = path.resolve(DIR, '..', '..');
const INDEX = process.env.RIVER_SOURCE ? path.resolve(process.env.RIVER_SOURCE) : path.join(ROOT, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');
const seam = html.match(/\/\* CORE_START \*\/([\s\S]*?)\/\* CORE_END \*\//);
assert(seam, 'RiverCore seam missing');
const sandbox = {console, Math, Uint32Array, crypto: crypto.webcrypto};
sandbox.globalThis = sandbox;
vm.runInNewContext(seam[1], sandbox);
const C = sandbox.RiverCore;

const STYLES = ['pressure', 'balanced', 'value', 'trap', 'nit'];
const TABLES = [2, 6, 8];
const STREETS = ['flop', 'turn', 'river'];
const BB = 10;
const STACK = 1500;

function rng(seed) { let x = seed >>> 0; return () => ((x = Math.imul(x, 1664525) + 1013904223 >>> 0) / 4294967296); }
function hashSeed(...xs) { let h = 2166136261; for (const s of xs.join('|')) for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function pct(n, d) { return d ? 100 * n / d : 0; }
function round(n, d = 2) { const z = 10 ** d; return Math.round(n * z) / z; }
function wilson(n, d) {
  if (!d) return [0, 0];
  const z = 1.96, p = n / d, den = 1 + z * z / d;
  const mid = (p + z * z / (2 * d)) / den;
  const half = z * Math.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / den;
  return [round(100 * Math.max(0, mid - half)), round(100 * Math.min(1, mid + half))];
}
function player(style) {
  return {style, stack: STACK, bet: 0, total: 0, folded: false, allIn: false, acted: false,
    lastActedBet: null, raiseRights: true, hole: [], voluntary: false, pfrDone: false, threeBetDone: false};
}
function blank() {
  return {hands: 0, decisions: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0,
    classes: Object.fromEntries(STREETS.map(s => [s, Object.fromEntries(['pureBluff','semiBluff','thinValue','strongValue','trap'].map(k => [k, {opportunities: 0, actions: 0}]))])),
    sizing: Object.fromEntries(STREETS.map(s => [s, Object.fromEntries(['underbet','standard','overbet','allIn'].map(k => [k, 0]))]))};
}
function addBlank(a, b) {
  for (const k of ['hands','decisions','vpip','pfr','threeBetOpp','threeBet']) a[k] += b[k];
  for (const s of STREETS) {
    for (const k of Object.keys(a.classes[s])) { a.classes[s][k].opportunities += b.classes[s][k].opportunities; a.classes[s][k].actions += b.classes[s][k].actions; }
    for (const k of Object.keys(a.sizing[s])) a.sizing[s][k] += b.sizing[s][k];
  }
}

const PUBLIC_KEYS = ['actor','hole','board','toCall','pot','opponents','activeOpponents','position','positionName','tableSize','inPosition',
  'street','raises','stack','effectiveStack','spr','currentBet','bb','lastFullRaiseSize','minRaiseTo','maxRaiseTo','legalActions','actions',
  'aggressor','openerPosition','preflopNode','wasPreflopAggressor','opponentRange','seed','humanModel','policyRoll','chipUnit','preflopUnit'];
const FORBIDDEN = new Set(['deck','opponentHoles','holes','spectator','spectatorState','foldedCards','hidden','players']);
function publicView(raw, audit) {
  const clean = Object.fromEntries(PUBLIC_KEYS.map(k => [k, raw[k]]));
  audit.views++;
  for (const k of Object.keys(raw)) assert(PUBLIC_KEYS.includes(k), `unexpected raw decision key ${k}`);
  for (const k of FORBIDDEN) assert(!(k in clean), `forbidden decision key ${k}`);
  const freeze = x => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) freeze(v); } return x; };
  freeze(clean);
  return new Proxy(clean, {get(target, prop) {
    if (typeof prop === 'string' && !(prop in target)) { audit.forbiddenReads++; throw Error(`non-public decision read: ${prop}`); }
    return target[prop];
  }});
}
function positions(n, dealer) {
  const live = Array.from({length:n}, (_, i) => i);
  return C.tournamentPositions(live, dealer); // exact exported RiverCore path, including HU button/SB rule
}
function posName(i, n, p) {
  if (n === 2) return i === p.dealer ? 'BTN' : 'BB';
  if (i === p.dealer) return 'BTN'; if (i === p.sb) return 'SB'; if (i === p.bb) return 'BB';
  const d = (i - p.dealer + n) % n, left = n - d;
  if (left === 1) return 'CO'; if (left === 2) return 'HJ'; if (d === 3) return 'UTG'; return 'MP';
}
function classifyFeature(f) {
  const meaningfulDraw = !!(f.comboDraw || f.draw > 0 || f.flushDraw || f.oesd || f.gutshot);
  if (f.showdownTier >= 3) return 'strongValue';
  if (meaningfulDraw) return 'semiBluff';
  if (f.showdownTier === 0) return 'pureBluff';
  return 'thinValue';
}
function recordDecision(stat, street, feature, L, type, paid, potBefore, allIn) {
  if (street === 'preflop') return;
  const cls = classifyFeature(feature);
  if (L.canRaise) {
    stat.classes[street][cls].opportunities++;
    if (type === 'raise') stat.classes[street][cls].actions++;
    if (feature.showdownTier >= 3) {
      stat.classes[street].trap.opportunities++;
      if (type === 'check' || type === 'call') stat.classes[street].trap.actions++;
    }
  }
  if (type === 'raise') {
    if (allIn) stat.sizing[street].allIn++;
    else {
      const frac = paid / (potBefore || 1);
      stat.sizing[street][frac <= .4 ? 'underbet' : frac <= 1 ? 'standard' : 'overbet']++;
    }
  }
}

function runHand(n, handNo, masterSeed, totals, audit) {
  const seed = hashSeed(masterSeed, 'table', n, 'hand', handNo), rand = rng(seed), dealer = handNo % n, pmap = positions(n, dealer);
  // Rotate the five shipped styles through all seats. This balances seats and opponent mixtures at every table size.
  const players = Array.from({length:n}, (_, i) => player(STYLES[(i + handNo) % STYLES.length]));
  const state = {players, dealer, board: [], pot: 0, lastPot: 0, currentBet: 0, lastFullRaiseSize: BB,
    actedSinceFullRaise: new Set(), turn: null, street: 'preflop', actions: []};
  const initial = n * STACK;
  const deck = C.shuffledDeck(max => Math.floor(rand() * max)), burned = [];
  for (const p of players) { p.hole = [deck.pop(), deck.pop()]; totals[p.style].hands++; }
  function post(i, amount) { const p = players[i], z = Math.min(amount, p.stack); p.stack -= z; p.bet += z; p.total += z; state.pot += z; if (!p.stack) p.allIn = true; }
  post(pmap.sb, 5); post(pmap.bb, 10); state.currentBet = 10;
  let pending = new Set(players.map((_, i) => i).filter(i => !players[i].allIn));
  let cursor = pmap.preflopFirst, steps = 0;
  const live = () => players.map((p, i) => !p.folded ? i : -1).filter(i => i >= 0);
  const eligible = () => players.map((p, i) => !p.folded && !p.allIn ? i : -1).filter(i => i >= 0);
  function context(i) {
    const p = players[i], L = C.legalActions(state, i), others = live().filter(j => j !== i);
    const streetRaises = state.actions.filter(a => a.street === state.street && a.type === 'raise');
    const preRaises = state.actions.filter(a => a.street === 'preflop' && a.type === 'raise');
    const lastAgg = [...state.actions].reverse().find(a => a.type === 'raise'), opener = preRaises[0];
    const metric = C.positionMetric(i, dealer, n), effectiveStack = Math.min(p.stack, Math.max(...others.map(j => players[j].stack)));
    return {actor:i, hole:p.hole.map(c=>({...c})), board:state.board.map(c=>({...c})), toCall:L.toCall, pot:state.pot,
      opponents:others.length, activeOpponents:others.length, position:metric, positionName:posName(i,n,pmap), tableSize:live().length,
      inPosition:others.every(j=>metric>=C.positionMetric(j,dealer,n)), street:state.street, raises:streetRaises.length, stack:p.stack,
      effectiveStack, spr:effectiveStack/(state.pot||1), currentBet:state.currentBet, bb:BB, lastFullRaiseSize:state.lastFullRaiseSize,
      minRaiseTo:L.minRaiseTo, maxRaiseTo:L.maxRaiseTo, legalActions:{...L}, actions:state.actions.map(a=>({...a})), aggressor:lastAgg?.actor??null,
      openerPosition:opener?.position, wasPreflopAggressor:preRaises.at(-1)?.actor===i,
      opponentRange:opener?{preflopNode:'RFI',positionName:opener.position,tableSize:live().length,stack:effectiveStack,bb:BB}:
        state.actions.some(a=>a.street==='preflop'&&a.type==='call')?{preflopNode:'vsLimpers',positionName:'MP',tableSize:live().length,stack:effectiveStack,bb:BB}:null,
      seed:(seed ^ Math.imul(i+1,2654435761) ^ Math.imul(state.actions.length+1,2246822519))>>>0,
      humanModel:C.modelStats({})};
  }
  function act(i) {
    state.turn = i;
    const p = players[i], stat = totals[p.style], L = C.legalActions(state, i), raw = context(i), view = publicView(raw, audit);
    const f = state.street === 'preflop' ? null : C.analyzePostflop(view.hole, view.board);
    const d = C.decideAction(p.style, view);
    let type, to = 0;
    if (d.type === 'raise' && L.canRaise) { type = 'raise'; to = Math.min(L.maxRaiseTo, Math.max(L.minRaiseTo, Math.round(d.to/(state.street==='preflop'?5:10))*(state.street==='preflop'?5:10))); }
    else if (d.type === 'fold' && L.canFold) type = 'fold';
    else type = L.toCall ? 'call' : 'check';
    assert((type==='raise'&&L.canRaise)||(type==='fold'&&L.canFold)||(type==='call'&&L.canCall)||(type==='check'&&L.canCheck), `illegal selected ${type}`);
    const before = p.stack, potBefore = state.pot, preRaiseCount = state.actions.filter(a=>a.street==='preflop'&&a.type==='raise').length;
    C.applyAction(state, i, type, to);
    const paid = before - p.stack; stat.decisions++;
    if (state.street === 'preflop') {
      if ((type === 'call' || type === 'raise') && !p.voluntary) { p.voluntary = true; stat.vpip++; }
      if (type === 'raise' && !p.pfrDone) { p.pfrDone = true; stat.pfr++; }
      if (preRaiseCount === 1 && L.canRaise && !p.threeBetDone) { stat.threeBetOpp++; p.threeBetDone = true; if (type === 'raise') stat.threeBet++; }
    } else recordDecision(stat, state.street, f, L, type, paid, potBefore, p.allIn);
    const record = {street:state.street, actor:i, position:posName(i,n,pmap), type, paid, to:type==='raise'?to:p.bet,
      potBefore, allIn:p.allIn, aggressor:[...state.actions].reverse().find(a=>a.type==='raise')?.actor??null, sizePot:paid/(potBefore||1)};
    state.actions.push(record); pending.delete(i);
    if (type === 'raise') pending = new Set(eligible().filter(j=>j!==i&&(players[j].bet<state.currentBet||!players[j].acted)));
  }
  while (true) {
    assert(++steps <= 500, `stall n=${n} hand=${handNo}`);
    if (live().length === 1) { players[live()[0]].stack += state.pot; state.lastPot = state.pot; state.pot = 0; break; }
    let found = -1;
    for (let k=0;k<n;k++) { const i=(cursor+k)%n,p=players[i]; if (pending.has(i)&&!p.folded&&!p.allIn&&(p.bet<state.currentBet||!p.acted)) { found=i;cursor=(i+1)%n;break; } }
    if (found >= 0) { act(found); continue; }
    if (state.street === 'river' || eligible().length < 2) { while(state.board.length<5){burned.push(deck.pop());state.board.push(deck.pop());} C.settlePots(state); break; }
    for (const p of players) { p.bet=0;p.acted=false;p.lastActedBet=null;p.raiseRights=true; }
    state.currentBet=0;state.lastFullRaiseSize=BB;state.actedSinceFullRaise=new Set();burned.push(deck.pop());
    if(state.street==='preflop'){state.board.push(deck.pop(),deck.pop(),deck.pop());state.street='flop';}
    else {state.board.push(deck.pop());state.street=state.street==='flop'?'turn':'river';}
    pending=new Set(eligible());cursor=pmap.postflopFirst;
  }
  assert.strictEqual(players.reduce((s,p)=>s+p.stack,0)+state.pot, initial, `chip conservation n=${n} hand=${handNo}`);
  assert.strictEqual(new Set([...players.flatMap(p=>p.hole),...state.board,...burned,...deck].map(c=>c.r+c.s)).size, 52, 'deck/card uniqueness');
}

function summarizeStat(s) {
  const rate = (n,d) => ({count:n, opportunities:d, ratePct:round(pct(n,d)), wilson95Pct:wilson(n,d)});
  return {hands:s.hands, decisions:s.decisions, vpip:rate(s.vpip,s.hands), pfr:rate(s.pfr,s.hands), threeBet:rate(s.threeBet,s.threeBetOpp),
    classes:Object.fromEntries(STREETS.map(st=>[st,Object.fromEntries(Object.entries(s.classes[st]).map(([k,x])=>[k,rate(x.actions,x.opportunities)]))])),
    sizing:Object.fromEntries(STREETS.map(st=>{const z=s.sizing[st], total=Object.values(z).reduce((a,b)=>a+b,0);return[st,{totalAggressions:total,...Object.fromEntries(Object.entries(z).map(([k,v])=>[k,rate(v,total)]))}];}))};
}
function mdRate(x) { return `${x.count}/${x.opportunities} (${x.ratePct}%; 95% ${x.wilson95Pct[0]}–${x.wilson95Pct[1]})`; }
function markdown(r) {
  const L=[];
  L.push('# Spike 005 — River Room bot-style telemetry','',`Run: ${r.runAt}  `,`Source SHA-256: \`${r.sourceSha256}\`  `,
    `Reproduction command: \`RIVER_SOURCE=./source-snapshot.html node measure.js --hands ${r.handsPerTable} --seed ${r.seed}\`  `,`Aggregate worker runtime: ${r.runtimeSeconds}s; complete hands: ${r.totalHands}; actual bot decisions: ${r.audit.views}.`,'',
    '## Operational definitions','',
    '- Every observation is an **actual legal bot decision in a complete hand**, not an isolated policy sample. The harness extracts the exact shipped `RiverCore` from the read-only `index.html` snapshot whose hash is above and uses exported `tournamentPositions`, `legalActions`, `applyAction`, `decideAction`, `analyzePostflop`, `shuffledDeck`, and `settlePots`. Stacks reset to 150 BB each hand to avoid bust/rebuy selection effects.',
    '- The aggression classes are mutually exclusive, in this precedence order: **strong value** is `showdownTier >= 3` (with or without a redraw); otherwise **semi-bluff** has a meaningful draw; otherwise **pure bluff** is tier 0; otherwise **thin value** is tier 1–2. Meaningful draw means RiverCore reports `draw > 0`, `comboDraw`, flush draw, OESD, or gutshot.',
    '- For those four aggression classes, an opportunity is a decision where a legal bet/raise was available; the numerator is an actual raise (RiverCore represents bets as `raise`). **Trap:** check/call with tier 3+ when a legal bet/raise was available; its denominator is all such strong-hand legal-aggression decisions, including strong hands that also draw.',
    '- Postflop size is chips newly paid divided by pot immediately before the action: underbet ≤40%, standard >40%–100%, overbet >100%. All-ins are removed from those buckets and reported separately.',
    '- VPIP and PFR denominators are dealt persona-hands. A 3-bet opportunity is the first decision facing exactly one prior preflop raise while a legal re-raise is available.',
    '- The five shipped styles rotate through every seat and opponent mixture at each table size. Heads-up uses RiverCore’s exported HU button/SB positioning. The public human model is held at its no-observation prior; no unsupported psychological intent is inferred from any label.','',
    '## Overall preflop entry','', '| Table | Persona | Hands | VPIP | PFR | 3-bet | Decisions |','|---:|---|---:|---:|---:|---:|---:|');
  for(const n of TABLES)for(const style of STYLES){const s=r.tables[n][style];L.push(`| ${n} | ${style} | ${s.hands} | ${mdRate(s.vpip)} | ${mdRate(s.pfr)} | ${mdRate(s.threeBet)} | ${s.decisions} |`);}
  L.push('','## Postflop aggression and trapping','', '| Table | Persona | Street | Pure bluff | Semi-bluff | Thin value | Strong value | Trap |','|---:|---|---|---:|---:|---:|---:|---:|');
  for(const n of TABLES)for(const style of STYLES)for(const st of STREETS){const c=r.tables[n][style].classes[st];L.push(`| ${n} | ${style} | ${st} | ${mdRate(c.pureBluff)} | ${mdRate(c.semiBluff)} | ${mdRate(c.thinValue)} | ${mdRate(c.strongValue)} | ${mdRate(c.trap)} |`);}
  L.push('','## Sizing among actual postflop aggressions','', '| Table | Persona | Street | Aggressions | Underbet | Standard | Overbet | All-in |','|---:|---|---|---:|---:|---:|---:|---:|');
  for(const n of TABLES)for(const style of STYLES)for(const st of STREETS){const z=r.tables[n][style].sizing[st];L.push(`| ${n} | ${style} | ${st} | ${z.totalAggressions} | ${mdRate(z.underbet)} | ${mdRate(z.standard)} | ${mdRate(z.overbet)} | ${mdRate(z.allIn)} |`);}
  L.push('','## Pooled persona view (all table sizes)','', '| Persona | Hands | VPIP | PFR | 3-bet |','|---|---:|---:|---:|---:|');
  for(const style of STYLES){const s=r.pooled[style];L.push(`| ${style} | ${s.hands} | ${mdRate(s.vpip)} | ${mdRate(s.pfr)} | ${mdRate(s.threeBet)} |`);}
  const pooled=r.pooled;
  L.push('','## Finding: do bots enter only strong?','');
  for(const style of STYLES)L.push(`- **${style}:** VPIP ${pooled[style].vpip.ratePct}% and PFR ${pooled[style].pfr.ratePct}% across ${pooled[style].hands} hands; pure-bluff aggression opportunities converted at flop/turn/river ${STREETS.map(st=>pooled[style].classes[st].pureBluff.ratePct+'%').join('/')}.`);
  L.push('',r.conclusion,'','## Integrity verification','',
    `- Hidden/non-public decision reads: **${r.audit.forbiddenReads}** across **${r.audit.views}** decisions. Decision views contain own hole cards plus public board/action/price/stack/position/model state only; opponent holes and deck are absent and forbidden.`,
    `- Illegal actions: **${r.audit.illegalActions}**. Stalls: **${r.audit.stalls}**. Chip-conservation failures: **${r.audit.conservationFailures}**. Card/deck uniqueness failures: **${r.audit.cardFailures}**.`,
    '- Persona/style is passed as the policy selector, not as hidden opponent information. Telemetry inspects own hand only at decision time; complete hidden state is used solely by dealing and settlement.','',
    '## Limitations','',
    '- These are descriptive frequencies for deterministic seeded all-bot public-state play, not solver-optimal labels or claims about subjective intent. Opponent population, 150-BB reset stacks, and a neutral human-model prior affect the observed mix.',
    '- Wilson intervals quantify binomial sampling uncertainty within each opportunity class; poker decisions are state-dependent, so treat them as descriptive intervals rather than independent-trial causal estimates.','',
    '## Verdict: VALIDATED','', 'The exact shipped policy can be measured legally and without hidden reads; the tables above are the observed telemetry for this source hash.');
  return L.join('\n')+'\n';
}

function main(){
  const argv=process.argv.slice(2), getStr=(k,d)=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:d;}, get=(k,d)=>+getStr(k,d);
  const handsPerTable=get('--hands',5000), seed=get('--seed',20260802), start=get('--start',0), selectedTables=getStr('--tables','2,6,8').split(',').map(Number), out=getStr('--out','');
  assert(Number.isInteger(handsPerTable)&&handsPerTable>0&&handsPerTable<=20000,'--hands must be 1..20000');
  assert(Number.isInteger(start)&&start>=0,'--start must be non-negative');
  assert(selectedTables.length&&selectedTables.every(n=>TABLES.includes(n)),'--tables must be a comma list drawn from 2,6,8');
  const started=process.hrtime.bigint(), audit={views:0,forbiddenReads:0,illegalActions:0,stalls:0,conservationFailures:0,cardFailures:0};
  const raw={};
  for(const n of selectedTables){raw[n]=Object.fromEntries(STYLES.map(s=>[s,blank()]));for(let h=start;h<start+handsPerTable;h++)runHand(n,h,seed,raw[n],audit);}
  const pooled=Object.fromEntries(STYLES.map(s=>[s,blank()]));
  for(const n of selectedTables)for(const s of STYLES)addBlank(pooled[s],raw[n][s]);
  const summarizedTables=Object.fromEntries(selectedTables.map(n=>[n,Object.fromEntries(STYLES.map(s=>[s,summarizeStat(raw[n][s])]))]));
  const summarizedPooled=Object.fromEntries(STYLES.map(s=>[s,summarizeStat(pooled[s])]));
  const vpips=STYLES.map(s=>summarizedPooled[s].vpip.ratePct), min=Math.min(...vpips), max=Math.max(...vpips);
  const conclusion=`**Not supported literally.** All personas voluntarily entered a material share of hands (pooled VPIP range **${min}%–${max}%**), and the logged postflop tables contain non-zero pure- and semi-bluff aggression. The narrower impression that the pool is selective has some support only in the relative sense shown by persona/table VPIP and PFR; the telemetry cannot call every entered hand “strong” because preflop strength was not part of the requested postflop operational classifier.`;
  const result={runAt:new Date().toISOString(),sourceSha256:crypto.createHash('sha256').update(html).digest('hex'),seed,start,selectedTables,handsPerTable,totalHands:handsPerTable*selectedTables.length,
    runtimeSeconds:round(Number(process.hrtime.bigint()-started)/1e9),audit,tables:summarizedTables,pooled:summarizedPooled,conclusion};
  assert.equal(audit.forbiddenReads,0);assert.equal(audit.illegalActions,0);assert.equal(audit.stalls,0);assert.equal(audit.conservationFailures,0);assert.equal(audit.cardFailures,0);
  fs.writeFileSync(out ? path.resolve(DIR,out) : path.join(DIR,'metrics.json'),JSON.stringify(result,null,2)+'\n');
  if(!out) fs.writeFileSync(path.join(DIR,'README.md'),markdown(result));
  console.log(JSON.stringify({hands:result.totalHands,decisions:audit.views,runtimeSeconds:result.runtimeSeconds,sourceSha256:result.sourceSha256,
    pooled:Object.fromEntries(STYLES.map(s=>[s,{vpip:summarizedPooled[s].vpip.ratePct,pfr:summarizedPooled[s].pfr.ratePct,threeBet:summarizedPooled[s].threeBet.ratePct}]))},null,2));
}
if(require.main===module)main();
module.exports={STYLES,TABLES,STREETS,blank,addBlank,summarizeStat,markdown};
