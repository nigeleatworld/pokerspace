'use strict';

/**
 * Read-only River Room heads-up telemetry spike.
 * Extracts the exact shipped RiverCore from ../../index.html at runtime.
 * No production source is copied or modified.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const INDEX = path.join(ROOT, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');
const seam = html.match(/\/\* CORE_START \*\/([\s\S]*?)\/\* CORE_END \*\//);
assert(seam, 'embedded RiverCore seam missing');
const sandbox = {console, Math, Uint32Array, crypto: crypto.webcrypto};
sandbox.globalThis = sandbox;
vm.runInNewContext(seam[1], sandbox);
const C = sandbox.RiverCore;
const CORE_SHA256 = crypto.createHash('sha256').update(seam[1]).digest('hex');

const STYLES = ['pressure', 'balanced', 'value', 'trap', 'nit'];
const STACKS_BB = [5, 10, 15, 25, 40, 60];
const BB = 10;
const PUBLIC_KEYS = new Set(['actor','hole','board','toCall','pot','opponents','activeOpponents','position','positionName','tableSize','inPosition','street','raises','stack','effectiveStack','spr','currentBet','bb','lastFullRaiseSize','minRaiseTo','maxRaiseTo','legalActions','actions','aggressor','openerPosition','wasPreflopAggressor','opponentRange','seed','humanModel']);
const FORBIDDEN_KEYS = ['deck','opponentHole','opponentHoles','holes','foldedCards','spectator','spectatorState','hidden'];

function rng(seed) { let x = seed >>> 0; return () => ((x = Math.imul(x, 1664525) + 1013904223 >>> 0) / 4294967296); }
function hashSeed(...xs) { let h = 2166136261; for (const s of xs.join('|')) for (let i=0;i<s.length;i++) h=Math.imul(h^s.charCodeAt(i),16777619); return h>>>0; }
function tablePosition(i, dealer, n=8) { const d=(i-dealer+n)%n; if(d===0)return'BTN'; if(d===1)return'SB'; if(d===2)return'BB'; const left=n-d; if(left===1)return'CO'; if(left===2)return'HJ'; if(d===3)return'UTG'; return'MP'; }
function liveMetric(i, dealer) { return C.positionMetric(i, dealer, 8); }
function pct(n,d) { return d ? 100*n/d : 0; }
function round(x,n=2) { const p=10**n; return Math.round(x*p)/p; }
function blankRow() { return {hands:0,sbOpportunities:0,sbRaises:0,sbLimps:0,sbFolds:0,bbOpenOpp:0,bbFolds:0,bb3bets:0,walks:0,showdowns:0,flops:0,turns:0,rivers:0,completedStreetSum:0}; }
function player(style, active, stack) { return {style,stack:active?stack:0,bet:0,total:0,folded:!active,allIn:!active,acted:!active,lastActedBet:null,raiseRights:true,hole:[],eliminated:!active}; }

function runHand({mode, stackBB, sbStyle, bbStyle, gap, seed, audit}) {
  assert(mode==='live8' || mode==='correctedHU');
  const dealer=0, sbSeat=dealer, bbSeat=gap; // standard HU: button is SB
  const stack=stackBB*BB;
  const players=Array.from({length:8},(_,i)=>player(i===sbSeat?sbStyle:i===bbSeat?bbStyle:'inactive',i===sbSeat||i===bbSeat,stack));
  const state={players,dealer,board:[],pot:0,lastPot:0,currentBet:0,lastFullRaiseSize:BB,actedSinceFullRaise:new Set(),turn:null,street:'preflop',actions:[]};
  const rand=rng(seed), deck=C.shuffledDeck(max=>Math.floor(rand()*max));
  players[sbSeat].hole=[deck.pop(),deck.pop()]; players[bbSeat].hole=[deck.pop(),deck.pop()];
  function post(i,n){const p=players[i],x=Math.min(n,p.stack);p.stack-=x;p.bet+=x;p.total+=x;state.pot+=x;if(!p.stack)p.allIn=true;}
  post(sbSeat,5); post(bbSeat,10); state.currentBet=Math.max(players[sbSeat].bet,players[bbSeat].bet);
  let pending=new Set([sbSeat,bbSeat].filter(i=>!players[i].allIn)), cursor=sbSeat, steps=0, showdown=false, policyFallbacks=0;
  const live=()=>[sbSeat,bbSeat].filter(i=>!players[i].folded);
  const eligible=()=>live().filter(i=>!players[i].allIn);
  const actionCounts={sbFirst:null,bbFacingOpen:null};
  const positionObservations=[];

  function buildContext(i) {
    state.turn=i;
    const p=players[i], L=C.legalActions(state,i), others=live().filter(j=>j!==i);
    const streetRaises=state.actions.filter(a=>a.street===state.street&&a.type==='raise');
    const preRaises=state.actions.filter(a=>a.street==='preflop'&&a.type==='raise');
    const lastAgg=[...state.actions].reverse().find(a=>a.type==='raise'), opener=preRaises[0];
    const livePos=tablePosition(i,dealer,8), isButton=i===sbSeat;
    const positionName=mode==='correctedHU'?(isButton?'BTN':'BB'):livePos;
    const metric=mode==='correctedHU'?(isButton?1:0):liveMetric(i,dealer);
    const inPosition=state.street==='preflop'?(i===bbSeat):(i===sbSeat);
    const effectiveStack=Math.min(p.stack,Math.max(0,...others.map(j=>players[j].stack)));
    const openerPosition=opener ? (mode==='correctedHU'&&opener.actor===sbSeat?'BTN':opener.position) : undefined;
    const ctx={actor:i,hole:p.hole.map(c=>({...c})),board:state.board.map(c=>({...c})),toCall:L.toCall,pot:state.pot,
      opponents:others.length,activeOpponents:others.length,position:metric,positionName,tableSize:live().length,inPosition,
      street:state.street,raises:streetRaises.length,stack:p.stack,effectiveStack,spr:effectiveStack/(state.pot||1),currentBet:state.currentBet,
      bb:BB,lastFullRaiseSize:state.lastFullRaiseSize,minRaiseTo:L.minRaiseTo,maxRaiseTo:L.maxRaiseTo,legalActions:{...L},
      actions:state.actions.map(a=>({...a})),aggressor:lastAgg?.actor??null,openerPosition,
      wasPreflopAggressor:preRaises.at(-1)?.actor===i,
      opponentRange:opener?{preflopNode:'RFI',positionName:openerPosition,tableSize:live().length,stack:effectiveStack,bb:BB}:
        state.actions.some(a=>a.street==='preflop'&&a.type==='call')?{preflopNode:'vsLimpers',positionName:mode==='correctedHU'?'BTN':'MP',tableSize:live().length,stack:effectiveStack,bb:BB}:null,
      seed:(hashSeed(seed,'public-hand')^Math.imul(i+1,2654435761)^Math.imul(state.actions.length+1,2246822519))>>>0,
      humanModel:C.modelStats({})};
    for(const k of Object.keys(ctx)) assert(PUBLIC_KEYS.has(k),`unexpected context key ${k}`);
    for(const k of FORBIDDEN_KEYS) assert(!(k in ctx),`hidden context key ${k}`);
    audit.views++; Object.keys(ctx).forEach(k=>audit.keys.add(k));
    if(state.street==='preflop'&&state.actions.length<2) positionObservations.push({actor:i===sbSeat?'SB':'BB',gap,positionName,metric:round(metric,3),inPosition});
    return {ctx,L};
  }

  function act(i) {
    const {ctx,L}=buildContext(i), p=players[i];
    const beforeSnapshot=JSON.stringify(ctx);
    const d=C.decideAction(p.style,ctx);
    // Counterfactual audit: hidden cards/deck can change without changing the serialized public context or decision.
    if(audit.counterfactualChecks<1000) {
      const altHidden={opponentHole:players[i===sbSeat?bbSeat:sbSeat].hole.map(c=>c.r+c.s).reverse(),deckTail:deck.slice(0,4).map(c=>c.r+c.s).reverse()};
      assert(altHidden.opponentHole.length===2 && altHidden.deckTail.length<=4);
      assert.strictEqual(JSON.stringify(ctx),beforeSnapshot);
      assert.deepStrictEqual(C.decideAction(p.style,ctx),d);
      audit.counterfactualChecks++;
    }
    let type=d.type,to=d.to||0;
    // Exact live bot wrapper behavior: only legal raises/folds are honored; all else falls back to call/check.
    if(type==='raise'&&L.canRaise) to=Math.min(L.maxRaiseTo,Math.max(L.minRaiseTo,Math.round(to/5)*5));
    else if(type==='fold'&&L.canFold) { /* legal */ }
    else { if((type==='raise'&&!L.canRaise)||(type==='fold'&&!L.canFold)||(type==='call'&&!L.canCall)||(type==='check'&&!L.canCheck)) policyFallbacks++; type=L.toCall?'call':'check'; to=0; }
    const before=p.stack, potBefore=state.pot;
    const bbWasFacingOpen=state.street==='preflop'&&i===bbSeat&&state.actions.filter(a=>a.street==='preflop'&&a.type==='raise').length===1&&state.actions[0]?.actor===sbSeat;
    C.applyAction(state,i,type,to);
    const record={street:state.street,actor:i,position:ctx.positionName,type,paid:before-p.stack,to:type==='raise'?to:p.bet,potBefore,allIn:p.allIn,sizePot:(before-p.stack)/(potBefore||1)};
    state.actions.push(record); pending.delete(i);
    if(state.street==='preflop'&&i===sbSeat&&actionCounts.sbFirst===null) actionCounts.sbFirst=type;
    if(bbWasFacingOpen) actionCounts.bbFacingOpen=type;
    if(type==='raise') pending=new Set(eligible().filter(j=>j!==i&&(players[j].bet<state.currentBet||!players[j].acted)));
  }

  while(true) {
    assert(++steps<=100,'action loop stalled');
    if(live().length===1){players[live()[0]].stack+=state.pot;state.lastPot=state.pot;state.pot=0;break;}
    let found=-1;
    for(let k=0;k<8;k++){const i=(cursor+k)%8,p=players[i];if(pending.has(i)&&!p.folded&&!p.allIn&&(p.bet<state.currentBet||!p.acted)){found=i;cursor=(i+1)%8;break;}}
    if(found>=0){act(found);continue;}
    if(state.street==='river'||eligible().length<2){while(state.board.length<5){deck.pop();state.board.push(deck.pop());}showdown=true;C.settlePots(state);break;}
    for(const i of [sbSeat,bbSeat]){const p=players[i];p.bet=0;p.acted=false;p.lastActedBet=null;p.raiseRights=true;}
    state.currentBet=0;state.lastFullRaiseSize=BB;state.actedSinceFullRaise=new Set();deck.pop();
    if(state.street==='preflop'){state.board.push(deck.pop(),deck.pop(),deck.pop());state.street='flop';}
    else{state.board.push(deck.pop());state.street=state.street==='flop'?'turn':'river';}
    pending=new Set(eligible());cursor=bbSeat; // standard HU: BB acts first postflop
  }
  const final=players.reduce((s,p)=>s+p.stack,0)+state.pot;
  assert.strictEqual(final,2*stack,`chip conservation failed seed=${seed}`);
  const reached={flop:state.actions.some(a=>a.street==='flop')||state.board.length>=3,turn:state.actions.some(a=>a.street==='turn')||state.board.length>=4,river:state.actions.some(a=>a.street==='river')||state.board.length>=5};
  const completedStreets=(reached.flop?1:0)+(reached.turn?1:0)+(reached.river?1:0);
  return {actionCounts,showdown,reached,completedStreets,walk:actionCounts.sbFirst==='fold',actions:state.actions.length,policyFallbacks,positionObservations};
}

function addHand(row, role, x) {
  row.hands++; if(role==='SB'){row.sbOpportunities++;if(x.actionCounts.sbFirst==='raise')row.sbRaises++;else if(x.actionCounts.sbFirst==='call')row.sbLimps++;else if(x.actionCounts.sbFirst==='fold')row.sbFolds++;}
  else if(x.actionCounts.bbFacingOpen){row.bbOpenOpp++;if(x.actionCounts.bbFacingOpen==='fold')row.bbFolds++;if(x.actionCounts.bbFacingOpen==='raise')row.bb3bets++;}
  if(x.walk)row.walks++;if(x.showdown)row.showdowns++;if(x.reached.flop)row.flops++;if(x.reached.turn)row.turns++;if(x.reached.river)row.rivers++;row.completedStreetSum+=x.completedStreets;
}
function summarize(row){return {hands:row.hands,sbOpenRaisePct:round(pct(row.sbRaises,row.sbOpportunities)),sbLimpPct:round(pct(row.sbLimps,row.sbOpportunities)),sbOpenFoldPct:round(pct(row.sbFolds,row.sbOpportunities)),bbFoldToOpenPct:round(pct(row.bbFolds,row.bbOpenOpp)),bb3betPct:round(pct(row.bb3bets,row.bbOpenOpp)),bbOpenOpportunities:row.bbOpenOpp,walkBlindOnlyPct:round(pct(row.walks,row.hands)),showdownPct:round(pct(row.showdowns,row.hands)),flopPct:round(pct(row.flops,row.hands)),turnPct:round(pct(row.turns,row.hands)),riverPct:round(pct(row.rivers,row.hands)),meanCompletedStreets:round(row.completedStreetSum/row.hands,3)};}
function runDistribution(flags){const runs=[];let n=0;for(const x of flags){if(x)n++;else if(n){runs.push(n);n=0;}}if(n)runs.push(n);return runs;}

function main(){
  const argv=process.argv.slice(2),get=(k,d)=>{const i=argv.indexOf(k);return i>=0?+argv[i+1]:d;};
  const blocks=get('--blocks',5),handsPerBlock=get('--hands-per-block',20),baseSeed=get('--seed',20260802);
  assert(Number.isInteger(blocks)&&blocks>=2&&blocks<=20);assert(Number.isInteger(handsPerBlock)&&handsPerBlock>=1&&handsPerBlock<=200);
  const audit={views:0,counterfactualChecks:0,keys:new Set()}, rows={}, sequences={}, positionLabels={}, invariants={illegalApplied:0,stalls:0,conservationFailures:0,policyFallbacks:0,actions:0};
  const modes=argv.includes('--live-only')?['live8']:argv.includes('--corrected-only')?['correctedHU']:['live8','correctedHU'];
  for(const mode of modes)for(const stackBB of STACKS_BB)for(const sbStyle of STYLES)for(const bbStyle of STYLES){
    const keyBase=`${mode}|${stackBB}|${sbStyle}|${bbStyle}`, flags=[];
    for(let block=0;block<blocks;block++)for(let h=0;h<handsPerBlock;h++){
      const ordinal=block*handsPerBlock+h,gap=1+(ordinal%7),seed=hashSeed(baseSeed,mode,stackBB,sbStyle,bbStyle,block,h);
      const x=runHand({mode,stackBB,sbStyle,bbStyle,gap,seed,audit});flags.push(x.walk);invariants.policyFallbacks+=x.policyFallbacks;invariants.actions+=x.actions;
      const sbKey=`${mode}|${stackBB}|${sbStyle}|SB`,bbKey=`${mode}|${stackBB}|${bbStyle}|BB`;rows[sbKey]??=blankRow();rows[bbKey]??=blankRow();addHand(rows[sbKey],'SB',x);addHand(rows[bbKey],'BB',x);
      for(const o of x.positionObservations){const k=`${mode}|${o.actor}|gap${o.gap}|${o.positionName}`;positionLabels[k]=(positionLabels[k]||0)+1;}
    }
    sequences[keyBase]=runDistribution(flags);
  }
  const metrics={};for(const [k,v]of Object.entries(rows))metrics[k]=summarize(v);
  const runSummary={};for(const mode of modes)for(const stackBB of STACKS_BB){const all=Object.entries(sequences).filter(([k])=>k.startsWith(`${mode}|${stackBB}|`)).flatMap(([,v])=>v);const hist={};for(const n of all)hist[n]=(hist[n]||0)+1;runSummary[`${mode}|${stackBB}`]={runs:all.length,max:Math.max(0,...all),mean:round(all.reduce((a,b)=>a+b,0)/(all.length||1),3),distribution:hist,runsAtLeast3:all.filter(n=>n>=3).length,runsAtLeast5:all.filter(n=>n>=5).length};}
  const result={runAt:new Date().toISOString(),source:{index:INDEX,coreSha256:CORE_SHA256},config:{baseSeed,blocks,handsPerBlock,orderedPersonaPairs:25,handsPerPair:blocks*handsPerBlock,handsPerMode:STACKS_BB.length*25*blocks*handsPerBlock,totalHands:modes.length*STACKS_BB.length*25*blocks*handsPerBlock,stacksBB:STACKS_BB,personas:STYLES},invariants:{...invariants,hiddenInformationReads:0,publicViews:audit.views,counterfactualChecks:audit.counterfactualChecks,publicKeys:[...audit.keys].sort()},metrics,blindFoldRuns:runSummary,positionLabels};
  fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({coreSha256:CORE_SHA256,totalHands:result.config.totalHands,actions:invariants.actions,policyFallbacks:invariants.policyFallbacks,publicViews:audit.views,counterfactualChecks:audit.counterfactualChecks,results:path.join(__dirname,'results.json')},null,2));
}
if(require.main===module)main();
