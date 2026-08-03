'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const m=html.match(/\/\* CORE_START \*\/([\s\S]*?)\/\* CORE_END \*\//);
assert(m,'embedded RiverCore test seam is present');
const sandbox={console,Math,Uint32Array,crypto:require('crypto').webcrypto}; sandbox.globalThis=sandbox;
vm.runInNewContext(m[1],sandbox); const C=sandbox.RiverCore;
function p(stack=1000,bet=0,total=0){return {stack,bet,total,folded:false,allIn:false,acted:false,raiseRights:true,hole:[]}}
function test(name,fn){try{fn();console.log('✓',name)}catch(e){console.error('✗',name);throw e}}

test('bet 20 then raise 50 makes minimum reraise 80',()=>{const s={players:[p(980,20),p(950,50),p()],currentBet:50,lastFullRaiseSize:30,actedSinceFullRaise:new Set([1]),turn:2,pot:70};assert.equal(C.legalActions(s,2).minRaiseTo,80)});
test('short all-in does not reopen prior actor but preserves unacted rights',()=>{const s={players:[p(900,100),p(0,150),p(1000,0)],currentBet:150,lastFullRaiseSize:100,actedSinceFullRaise:new Set([0,1]),turn:0,pot:250};s.players[0].raiseRights=false;s.players[1].allIn=true;assert.equal(C.legalActions(s,0).canRaise,false);s.turn=2;assert.equal(C.legalActions(s,2).canRaise,true);assert.equal(C.legalActions(s,2).minRaiseTo,250)});
test('cumulative short all-ins reopen action after a full raise increment',()=>{const ps=[p(900,100,100),p(50,100,100),p(100,100,100)];ps[0].acted=true;ps[0].lastActedBet=100;const s={players:ps,currentBet:100,lastFullRaiseSize:100,actedSinceFullRaise:new Set([0]),turn:1,pot:300};C.applyAction(s,1,'raise',150);s.turn=0;assert.equal(ps[0].raiseRights,false,'one 50 short raise must not reopen');s.turn=2;C.applyAction(s,2,'raise',200);s.turn=0;assert.equal(ps[0].raiseRights,true,'two short raises totaling 100 must reopen')});
test('direct illegal raise is rejected',()=>{const s={players:[p(950,50),p(1000)],currentBet:50,lastFullRaiseSize:30,actedSinceFullRaise:new Set([0]),turn:1,pot:50};assert.throws(()=>C.applyAction(s,1,'raise',70),/Illegal raise/)});
test('folded and all-in players have no legal actions and applyAction rejects them',()=>{for(const flag of ['folded','allIn']){const ps=[p(900,100),p(1000)];ps[0][flag]=true;const s={players:ps,currentBet:100,lastFullRaiseSize:100,actedSinceFullRaise:new Set(),turn:0,pot:100};const L=C.legalActions(s,0);assert.equal(L.canFold,false);assert.equal(L.canCheck,false);assert.equal(L.canCall,false);assert.equal(L.canRaise,false);for(const a of ['fold','check','call','raise'])assert.throws(()=>C.applyAction(s,0,a,200),/Illegal/)}});
test('sole active player cannot raise into an all-in opponent',()=>{const ps=[p(900,50,50),p(0,100,100)];ps[1].allIn=true;const s={players:ps,currentBet:100,lastFullRaiseSize:50,actedSinceFullRaise:new Set(),turn:0,pot:150};const L=C.legalActions(s,0);assert.equal(L.canCall,true);assert.equal(L.canRaise,false);assert.throws(()=>C.applyAction(s,0,'raise',150),/Illegal raise/)});
test('active player may fold only when facing a bet',()=>{const s={players:[p(1000),p(900,100)],currentBet:100,lastFullRaiseSize:100,actedSinceFullRaise:new Set(),turn:0,pot:100};assert.equal(C.legalActions(s,0).canFold,true);C.applyAction(s,0,'fold');assert.equal(s.players[0].folded,true);const t={players:[p(),p()],currentBet:0,lastFullRaiseSize:10,actedSinceFullRaise:new Set(),turn:0,pot:0};assert.throws(()=>C.applyAction(t,0,'fold'),/Illegal fold/)});
test('main and side pots settle by contribution layer and clear live pot',()=>{const ps=[p(0,0,100),p(0,0,300),p(0,0,300)];ps[0].hole=C.cards('As Ad');ps[1].hole=C.cards('Ks Kd');ps[2].hole=C.cards('Qs Qd');const s={players:ps,board:C.cards('2c 3d 7h 8s Jc'),dealer:2,pot:700};const out=C.settlePots(s);assert.deepEqual(out.awards.map(x=>[x.label,x.amount,x.winners[0]]),[['Main pot',300,0],['Side pot 1',400,1]]);assert.equal(s.pot,0);assert.equal(s.lastPot,700);assert.equal(ps[0].stack,300);assert.equal(ps[1].stack,400)});
test('split odd chip starts clockwise left of dealer',()=>{const ps=[p(0,0,5),p(0,0,5),p(0,0,5)];ps[0].folded=true;ps[1].hole=C.cards('As Kd');ps[2].hole=C.cards('Ah Kc');const s={players:ps,board:C.cards('2c 3d 7h 8s Jc'),dealer:0,pot:15};const out=C.settlePots(s);assert.equal(out.awards[0].amount,15);assert.equal(ps[1].stack,8);assert.equal(ps[2].stack,7)});
test('dead unmatched contribution is explicitly returned and all chips are preserved',()=>{const ps=[p(0,0,300),p(0,0,100),p(0,0,100)];ps[0].folded=true;ps[0].hole=C.cards('2s 3d');ps[1].hole=C.cards('As Ad');ps[2].hole=C.cards('Ks Kd');const s={players:ps,board:C.cards('4c 7d 8h 9s Jc'),dealer:2,pot:500};const out=C.settlePots(s);assert.equal(out.awards.reduce((n,a)=>n+a.amount,0),500);const returned=out.awards.find(a=>a.label==='Uncalled returned');assert(returned);assert.equal(returned.amount,200);assert.deepEqual(returned.winners,[0]);assert.equal(ps.reduce((n,x)=>n+x.stack,0),500);assert.equal(s.pot,0)});
test('dead layer supplied by multiple folded contributors returns each exact slice',()=>{const ps=[p(0,0,300),p(0,0,300),p(0,0,100)];ps[0].folded=ps[1].folded=true;ps[2].hole=C.cards('As Ad');const s={players:ps,board:C.cards('4c 7d 8h 9s Jc'),dealer:2,pot:700};const out=C.settlePots(s),returned=out.awards.find(a=>a.label==='Uncalled returned');assert.equal(returned.amount,400);assert.deepEqual(returned.winners,[0,1]);assert.equal(ps[0].stack,200);assert.equal(ps[1].stack,200);assert.equal(ps[2].stack,300);assert.equal(ps.reduce((n,x)=>n+x.stack,0),700)});
test('live unmatched excess is returned rather than presented as a side pot',()=>{const ps=[p(0,0,300),p(0,0,100),p(0,0,100)];ps[0].hole=C.cards('As Ad');ps[1].hole=C.cards('Ks Kd');ps[2].hole=C.cards('Qs Qd');const s={players:ps,board:C.cards('2c 3d 7h 8s Jc'),dealer:2,pot:500};const out=C.settlePots(s),returned=out.awards.find(a=>a.label==='Uncalled returned');assert(returned);assert.equal(returned.amount,200);assert.deepEqual(returned.winners,[0]);assert.equal(ps.reduce((n,x)=>n+x.stack,0),500)});
test('fractional and non-finite raise amounts are rejected before state mutation',()=>{for(const to of [200.5,NaN,Infinity]){const ps=[p(900,100,100),p(900,100,100)];const s={players:ps,currentBet:100,lastFullRaiseSize:100,actedSinceFullRaise:new Set(),turn:0,pot:200};const before=JSON.stringify({stack:ps[0].stack,bet:ps[0].bet,total:ps[0].total,pot:s.pot,currentBet:s.currentBet});assert.throws(()=>C.applyAction(s,0,'raise',to),/Illegal raise/);assert.equal(JSON.stringify({stack:ps[0].stack,bet:ps[0].bet,total:ps[0].total,pot:s.pot,currentBet:s.currentBet}),before)}});
test('persisted display strings are escaped and session exits clear pending bot timers',()=>{assert.equal(C.escapeHTML('<img src=x onerror="boom">'),'&lt;img src=x onerror=&quot;boom&quot;&gt;');assert(/function newSession\(\)\{clearTimeout\(timer\)/.test(html));assert(/function endSession\(\)\{clearTimeout\(timer\)/.test(html));assert(/safeName\(p\)/.test(html))});
test('sound can recover from autoplay suspension on a user gesture',()=>{assert(/audio\.state===['"]suspended['"]/.test(html));assert(/audio\.resume\(\)/.test(html))});
test('pot fractions raise to current bet plus fraction of pot after calling',()=>{const s={players:[p(980,20),p(900,100)],currentBet:100,lastFullRaiseSize:80,actedSinceFullRaise:new Set(),turn:0,pot:150};assert.equal(C.potFractionRaiseTo(s,0,.5),220);assert.equal(C.potFractionRaiseTo(s,0,.75),270);assert.equal(C.potFractionRaiseTo(s,0,1),330);s.players[0].stack=200;assert.equal(C.potFractionRaiseTo(s,0,1),220,'clamps to all-in maximum')});
test('normalized position makes the button strongest and first postflop seat earliest for 3 to 8 handed',()=>{for(let n=3;n<=8;n++){for(let dealer=0;dealer<n;dealer++){assert.equal(C.positionMetric(dealer,dealer,n),1);assert.equal(C.positionMetric((dealer+1)%n,dealer,n),0);for(let d=2;d<n;d++)assert(C.positionMetric((dealer+d)%n,dealer,n)>C.positionMetric((dealer+d-1)%n,dealer,n))}}});
test('human session profit subtracts every buy-in',()=>{assert.equal(C.sessionProfit(1500,1500),0);assert.equal(C.sessionProfit(1500,3000),-1500);assert(/totalBuyIns:1500/.test(html));assert(/totalBuyIns\s*\+=\s*1500/.test(html));assert(/sessionProfit\(g\.players\[0\]\.stack,g\.totalBuyIns\)/.test(html))});
test('evaluator recognizes representative fixtures for every category',()=>{const fixtures=[['As Ks Qs Js Ts','Royal flush'],['As Ad Ac Ah 2s','Four of a kind'],['Ks Kd Kh 2s 2d','Full house'],['As Js 8s 4s 2s','Flush'],['9s 8d 7c 6h 5s','Straight'],['Qs Qd Qc 7h 2s','Three of a kind'],['Js Jd 4c 4h 2s','Two pair'],['Ts Td 8c 5h 2s','One pair'],['As Jd 8c 5h 2s','High card']];fixtures.forEach(([cards,name])=>assert.equal(C.rank5(C.cards(cards)).name,name))});
test('dry TPTK usually continues versus half pot heads up',()=>{const ctx={hole:C.cards('As Kd'),board:C.cards('Kh 7c 2d'),toCall:50,pot:100,opponents:1,position:.8,street:'flop',raises:0,stack:950,currentBet:50};assert(C.samplePolicy('balanced',ctx,1000,1).continueRate>.75)});
test('nut flush draw is materially more aggressive than dry high card',()=>{const base={board:C.cards('Kh 7h 2c'),toCall:0,pot:100,opponents:1,position:.7,street:'flop',raises:0,stack:1000,currentBet:0};const draw=C.samplePolicy('pressure',{...base,hole:C.cards('Ah Qh')},1500,2),air=C.samplePolicy('pressure',{...base,hole:C.cards('9s 4d')},1500,2);assert(draw.raiseRate>air.raiseRate+.20)});
test('72o continues against open plus 3bet under two percent',()=>{const c={hole:C.cards('7s 2d'),board:[],toCall:90,pot:140,opponents:2,position:.4,street:'preflop',raises:2,stack:910,currentBet:100,bb:10};assert(C.samplePolicy('pressure',c,5000,3).continueRate<.02)});
test('AA and KK continue essentially always at 100BB',()=>{for(const h of ['As Ad','Ks Kd']){const c={hole:C.cards(h),board:[],toCall:90,pot:140,opponents:2,position:.4,street:'preflop',raises:2,stack:910,currentBet:100,bb:10};assert(C.samplePolicy('nit',c,2000,4).continueRate>.995)}});
test('four personas have distinct bounded fingerprints',()=>{const c={hole:C.cards('Jh Th'),board:C.cards('9h 4c 2d'),toCall:0,pot:100,opponents:2,position:.75,street:'flop',raises:0,stack:1000,currentBet:0};const rates=['pressure','balanced','value','trap','nit'].map((x,i)=>C.samplePolicy(x,c,2500,10+i).raiseRate);assert(new Set(rates.map(x=>Math.round(x*20))).size>=4);rates.forEach(x=>assert(x>=.02&&x<=.85))});
test('opponents adapt from confident, opportunity-based human evidence',()=>{
  const base={hole:C.cards('9s 7d'),board:C.cards('As 6h 2c'),toCall:0,pot:80,opponents:1,position:.7,street:'flop',raises:0,stack:1400,currentBet:0,bb:10};
  const quiet=C.samplePolicy('balanced',{...base,humanModel:{foldToBet:.5,vpip:.3,confidence:0}},4000,31);
  const exploitable=C.samplePolicy('balanced',{...base,humanModel:{foldToBet:.85,vpip:.3,confidence:.9}},4000,31);
  assert(exploitable.raiseRate>quiet.raiseRate+.03,`expected measured adaptation, got ${quiet.raiseRate} vs ${exploitable.raiseRate}`);
  assert(/humanModel:C\.modelStats\(g\.players\[0\]\.stats\)/.test(html),'bots must receive the bounded player model');
  assert(/if\(i===0&&L\.toCall\)/.test(html),'human fold opportunities must be recorded only when facing a bet');
});

test('opportunity stats use bounded confidence',()=>{const a=C.modelStats({vpipOpp:2,vpip:2,pfrOpp:2,pfr:2,threeBetOpp:0,threeBet:0,foldOpp:1,folds:1});assert(a.confidence<.2);const b=C.modelStats({vpipOpp:100,vpip:35,pfrOpp:100,pfr:20,threeBetOpp:30,threeBet:5,foldOpp:50,folds:25});assert(b.confidence>.7)});
test('range-aware preflop fixtures respect position and raise depth',()=>{
  const base={board:[],pot:15,toCall:10,currentBet:10,stack:990,effectiveStack:990,bb:10,opponents:5,tableSize:6,street:'preflop',raises:0,actions:[]};
  assert.equal(C.decideAction('balanced',{...base,hole:C.cards('7s 2d'),tableSize:8,opponents:7,positionName:'UTG',policyRoll:.1}).type,'fold');
  const btn=C.decideAction('balanced',{...base,hole:C.cards('As 5s'),positionName:'BTN',policyRoll:.1});
  assert.equal(btn.type,'raise'); assert(btn.to>=22&&btn.to<=27,`BTN RFI was ${btn.to}`);
  const aq=C.samplePolicy('balanced',{...base,hole:C.cards('As Qd'),positionName:'UTG',raises:2,toCall:80,currentBet:90,pot:135,preflopNode:'vs3Bet'},2000,41);
  assert(aq.continueRate<.65,'AQo must not auto-continue versus open plus 3-bet');
  const aa=C.samplePolicy('balanced',{...base,hole:C.cards('As Ad'),positionName:'BTN',raises:3,toCall:190,currentBet:200,pot:315,preflopNode:'vs4Bet'},1000,42);
  assert(aa.continueRate>.99&&aa.raiseRate>.25,'AA must always continue and retain raises versus a 4-bet');
});

test('aggregate compact ranges land in credible strong-recreational envelopes',()=>{
  const u6=C.rangeBenchmark({tableSize:6,positionName:'UTG',node:'RFI'}),b6=C.rangeBenchmark({tableSize:6,positionName:'BTN',node:'RFI'}),u8=C.rangeBenchmark({tableSize:8,positionName:'UTG',node:'RFI'}),def=C.rangeBenchmark({tableSize:6,positionName:'BB',openerPosition:'BTN',node:'vsOpen'});
  assert(u6.vpip>=.14&&u6.vpip<=.23&&u6.pfr>=.12&&u6.pfr<=.21,JSON.stringify(u6));
  assert(b6.vpip>=.35&&b6.vpip<=.55&&b6.pfr>=.32&&b6.pfr<=.50,JSON.stringify(b6));
  assert(u8.vpip<u6.vpip,`${u8.vpip} must be tighter than ${u6.vpip}`);
  assert(def.vpip>=.35&&def.vpip<=.58,JSON.stringify(def));
});

test('postflop features distinguish relative strength, draws, texture and blockers',()=>{
  const dry=C.analyzePostflop(C.cards('As Kd'),C.cards('Kh 7c 2d'));
  assert(dry.topPair&&dry.kickerRank===14&&!dry.boardPlays&&dry.texture==='rainbow');
  const nut=C.analyzePostflop(C.cards('Ah Qh'),C.cards('Kh 7h 2c'));
  assert(nut.flushDraw&&nut.nutFlushDraw&&nut.drawOuts>=9);
  const weak=C.analyzePostflop(C.cards('8h 6h'),C.cards('Kh 7h 2c'));
  assert(weak.flushDraw&&!weak.nutFlushDraw);
  const oesd=C.analyzePostflop(C.cards('9s 8d'),C.cards('7h 6c Kd'));
  assert(oesd.oesd&&!oesd.gutshot);
  const blocker=C.analyzePostflop(C.cards('As Qd'),C.cards('Ks 9s 4c 2h 3s'));
  assert(blocker.nutFlushBlocker&&blocker.showdownTier<=1);
});

test('coherent postflop sizing reacts to board and SPR',()=>{
  const dry={hole:C.cards('As Kd'),board:C.cards('Kh 7c 2d'),toCall:0,pot:60,stack:940,effectiveStack:940,currentBet:0,bb:10,opponents:1,street:'flop',inPosition:true,wasPreflopAggressor:true};
  const ds=C.samplePolicy('balanced',dry,1500,101);assert(ds.raiseRate>.45,JSON.stringify(ds));
  const wet={...dry,hole:C.cards('Kh 7d'),board:C.cards('Ks 7s 6h'),pot:100,stack:900,effectiveStack:900};
  const ws=C.samplePolicy('balanced',wet,1500,102);assert(ws.raiseRate>ds.raiseRate,`${ws.raiseRate} vs ${ds.raiseRate}`);
  const drySizes=Array.from({length:40},(_,seed)=>C.decideAction('balanced',{...dry,seed}).to).filter(Boolean),wetSizes=Array.from({length:40},(_,seed)=>C.decideAction('balanced',{...wet,seed}).to).filter(Boolean);
  assert(Math.max(...wetSizes)>Math.min(...drySizes),`${drySizes} / ${wetSizes}`);
  const low={...dry,hole:C.cards('Ah Kd'),board:C.cards('Ks 9s 8h'),pot:500,stack:350,effectiveStack:350,toCall:180,currentBet:180};
  assert(C.samplePolicy('balanced',low,1000,103).continueRate>.8);
});

test('range equity is deterministic, exact on river, and board-play aware',()=>{
  const ctx={hole:C.cards('2c 3d'),board:C.cards('As Ks Qs Js Ts'),opponents:1,seed:77};
  const a=C.estimateEquity(ctx),b=C.estimateEquity(ctx); assert.equal(a.equity,b.equity); assert.equal(a.exact,true); assert(Math.abs(a.equity-.5)<1e-12);
});

test('heads-up turn equity uses affordable exact weighted enumeration',()=>{
  const x=C.estimateEquity({hole:C.cards('As Ad'),board:C.cards('2c 3d 7h 8s'),opponents:1,seed:9});
  assert.equal(x.exact,true); assert(x.samples>40000); assert(x.equity>0&&x.equity<1);
});

test('multiway weak draw is disciplined relative to nut draw',()=>{
  const base={board:C.cards('Kh 7h 2c'),toCall:100,pot:130,currentBet:100,stack:900,effectiveStack:900,bb:10,positionName:'BTN',street:'flop',raises:1};
  const nut=C.samplePolicy('balanced',{...base,hole:C.cards('Ah Qh'),opponents:1},1200,7),weak=C.samplePolicy('balanced',{...base,hole:C.cards('8h 6h'),opponents:3},1200,7);
  assert(nut.continueRate>weak.continueRate+.20,`${nut.continueRate} vs ${weak.continueRate}`);
});

test('river overbet bluff catch and nut-blocker bluff candidates are context aware',()=>{
  const catcher={hole:C.cards('Ah Jd'),board:C.cards('Js 9c 7d 4h 2s'),toCall:300,pot:200,currentBet:300,stack:700,effectiveStack:700,opponents:1,street:'river'};
  const catchRate=C.samplePolicy('balanced',catcher,2000,64).continueRate;assert(catchRate<.55&&catchRate>.05,catchRate);
  const bluff={hole:C.cards('As Qd'),board:C.cards('Ks 9s 4c 2h 3s'),toCall:0,pot:200,currentBet:0,stack:800,effectiveStack:800,opponents:1,street:'river',inPosition:true};
  const rate=C.samplePolicy('balanced',bluff,2000,65).raiseRate;assert(rate>.08&&rate<.4,rate);
  const raised=Array.from({length:80},(_,seed)=>C.decideAction('balanced',{...bluff,seed}).to).filter(Boolean);assert(raised.some(x=>x>=200));
  assert(C.analyzePostflop(bluff.hole,bluff.board).nutFlushBlocker);
});

test('AI decision latency stays practical in Node release probe',()=>{
  const ctx={hole:C.cards('Ah Qh'),board:C.cards('Kh 7h 2c'),toCall:0,pot:100,currentBet:0,stack:1000,effectiveStack:1000,opponents:1,street:'flop',positionName:'BTN',inPosition:true,policyRoll:.2};
  const t=process.hrtime.bigint(); for(let i=0;i<100;i++)C.decideAction('balanced',{...ctx,seed:i}); const ms=Number(process.hrtime.bigint()-t)/1e6/100;
  assert(ms<120,`mean decision latency ${ms.toFixed(1)}ms exceeds release ceiling`);
});
test('shared board strength is not mistaken for private value',()=>{
  const f=C.analyzePostflop(C.cards('2c 3d'),C.cards('Ks Kd 7h 7s'));
  assert(f.boardOwnsMade&&f.showdownTier===0,JSON.stringify(f));
  const d=C.decideAction('balanced',{hole:C.cards('2c 3d'),board:C.cards('Ks Kd 7h 7s'),toCall:0,pot:200,currentBet:0,stack:800,effectiveStack:800,opponents:1,street:'turn',inPosition:true,policyRoll:.2,seed:808});
  assert.equal(d.type,'check',JSON.stringify(d));
  const trips=C.analyzePostflop(C.cards('7c 6d'),C.cards('Ks Kd Kh 2s'));
  assert(trips.boardOwnsMade&&trips.showdownTier===0,JSON.stringify(trips));
});
test('equity cache separates materially different public ranges',()=>{
  const base={hole:C.cards('Qh Jh'),board:C.cards('Qs 8d 4c 2s 9h'),toCall:50,pot:200,currentBet:50,stack:950,effectiveStack:950,opponents:1,street:'river',policyRoll:.9,seed:123};
  const u={preflopNode:'RFI',positionName:'UTG',tableSize:6,stack:1000,bb:10},b={preflopNode:'RFI',positionName:'BTN',tableSize:6,stack:1000,bb:10};
  const eu=C.estimateEquity({...base,opponentRange:u}).equity,eb=C.estimateEquity({...base,opponentRange:b}).equity;
  const cu=C.decideAction('balanced',{...base,opponentRange:u}).trace.equity,cb=C.decideAction('balanced',{...base,opponentRange:b}).trace.equity;
  assert(Math.abs(cu-eu)<1e-12&&Math.abs(cb-eb)<1e-12,JSON.stringify({eu,eb,cu,cb}));assert(Math.abs(cu-cb)>.03);
});
test('multiway price discipline keeps profitable draws and shared ties',()=>{
  const tiny=C.decideAction('balanced',{hole:C.cards('9s 8d'),board:C.cards('7h 6c Kd'),toCall:10,pot:1000,currentBet:10,stack:990,effectiveStack:990,opponents:3,street:'flop',policyRoll:.1,seed:809});
  assert.equal(tiny.type,'call',JSON.stringify(tiny));
  const tie={hole:C.cards('2c 3d'),board:C.cards('As Ks Qs Js Ts'),toCall:20,pot:100,currentBet:20,stack:980,effectiveStack:980,opponents:3,street:'river',policyRoll:.9,seed:77};
  const d=C.decideAction('balanced',tie);assert.equal(d.type,'call',JSON.stringify(d));assert(Math.abs(d.trace.equity-.25)<1e-12,d.trace.equity);
});
test('preflop composition has node-specific bluff classes and limper awareness',()=>{
  const ctx={tableSize:6,positionName:'BB',openerPosition:'BTN',preflopNode:'vsOpen',stack:1000,effectiveStack:1000,bb:10};
  const a5=C.preflopRangeWeight(C.cards('As 5s'),ctx,'raise'),twos=C.preflopRangeWeight(C.cards('2s 2d'),ctx,'raise');assert(a5>twos,`${a5} vs ${twos}`);
  assert.equal(C.preflopNode({raises:0,actions:[{street:'preflop',type:'call'}]}),'vsLimpers');
  const m=C.modelStats({foldOpp:19,folds:19,vpipOpp:100,vpip:30,pfrOpp:100,pfr:20});assert.equal(m.foldConfidence,0);
});

test('blind-post toy conservation helper runs 30 deterministic 8-handed rounds',()=>{const r=C.simulateHands(30,8,99);assert.equal(r.hands,30);assert.equal(r.stalls,0);assert.equal(r.initial,r.final)});
test('actual Fisher-Yates helper makes 10,000 valid decks and covers every first card',()=>{const first=new Set();for(let n=0;n<10000;n++){const d=C.shuffledDeck();assert.equal(d.length,52);assert.equal(new Set(d.map(c=>c.r+c.s)).size,52);assert(d.every(c=>/^[2-9TJQKA][shdc]$/.test(c.r+c.s)));first.add(d[0].r+d[0].s)}assert.equal(first.size,52)});
test('source keeps independent Fisher-Yates and ten display',()=>{assert(/crypto\.getRandomValues/.test(html));assert(/rankLabel\(r\).*10/.test(html));assert(!/Pressure architect|Balanced theorist|Trap specialist/.test(html))});
test('session persistence saves action and resumes without dealing a new hand',()=>{
  const start=html.match(/function start\(n,state=null\)\{([\s\S]*?)\nfunction deal/)[1];
  const act=html.match(/function doAct\(i,type,to=0[^)]*\)\{([\s\S]*?)\nfunction bot/)[1];
  assert(/if\(state\)/.test(start),'resume branch must preserve the current hand');
  assert(/save\(\)/.test(act),'every completed action must persist');
});

test('setup preserves the full 6 to 8 handed range',()=>{
  assert(html.includes('data-n="6"'),'6-handed option');
  assert(html.includes('data-n="7"'),'7-handed option');
  assert(html.includes('data-n="8"'),'8-handed option');
});

test('previous hand control cycles through stored history and identifies the shown item',()=>{const handler=html.match(/\$\('#previous'\)\.onclick=\(\)=>\{([\s\S]*?)\};\$\('#resumeBtn'/)[1];assert(/historyCursor/.test(handler));assert(/History.*\/.*Hand/.test(handler));assert(/%\s*g\.histories\.length/.test(handler))});

test('table shows player action callouts and persistent blind markers',()=>{
  assert(/class="action-callout/.test(html),'seat-level action callout');
  assert(html.includes('class="blind-marker"'),'seat-level blind marker');
  assert(/\.blind=['"]SB['"]/.test(html),'small blind state marker');
  assert(/\.blind=['"]BB['"]/.test(html),'big blind state marker');
  assert(/actionText/.test(html),'actions need a table-facing label helper');
  assert(html.includes('id="tableAnnouncer"'),'table actions should also announce accessibly');
});
test('normal pace uses visible human-scale thinking and street pauses',()=>{
  assert(/thinkDelay=\(\)=>/.test(html));
  assert(/Normal[^\n]*900/.test(html),'normal bot decisions need a meaningful floor');
  assert(/Thinking/.test(html),'active opponent should show an in-table thinking state');
  assert(/streetDelay=\(\)=>/.test(html));
});
test('mobile seats, controls and settlement tray remain separated and usable',()=>{
  assert(/seat\.pos3\{left:19%!important/.test(html));assert(/seat\.pos4\{left:81%!important/.test(html));
  assert(/seat\.pos1\{left:14%!important;top:68%!important/.test(html));assert(/seat\.pos6\{left:86%!important;top:68%!important/.test(html));
  assert(/<section class="action-bar" id="actionBar">[\s\S]*?<div id="result"><\/div>/.test(html),'settlement must live in the bounded action tray');
  assert(/hand-settled \.action-bar/.test(html)&&/hand-settled \.seat\.human/.test(html));
  assert(/@media\(max-width:580px\)[\s\S]*?\.action-row button\{[^}]*min-height:44px/.test(html),'primary mobile actions need 44px targets');
  assert(/@media\(max-width:580px\)[\s\S]*?\.sizings button\{[^}]*min-height:36px/.test(html),'sizing controls need safer targets');
  assert(/\.seat-name,\.stack\{font-size:10\.5px\}/.test(html),'mobile names and stacks must remain legible');
  assert(/\.seat\.folded \.seat-box\{opacity:\.62\}/.test(html),'folded seats retain context');
  assert(/@media\(max-width:340px\)[\s\S]*?\.brand \.mark\{width:28px;height:28px/.test(html),'PS monogram remains visible at 320px');
  assert(/class="amount-shell"/.test(html)&&/>TO<\/span>/.test(html),'raise total has a visible label');
});
test('spectator equity is exact on the turn and identifies clean river outs',()=>{
  const active=[{i:1,hole:C.cards('As Ad')},{i:2,hole:C.cards('Ks Kd')}];
  const x=C.spectatorEquity(active,C.cards('2c 3d 7h 8s'));
  assert.strictEqual(x.runouts,44);
  assert(Math.abs(x.players[0].equity-42/44)<1e-12);
  assert(Math.abs(x.players[1].equity-2/44)<1e-12);
  assert.strictEqual(Array.from(x.players[1].outs).sort().join(','),'Kc,Kh');
  assert.strictEqual(x.players[0].outs.length,0,'current leader should not receive misleading hold-card outs');
});
test('spectator data and opponent cards stay gated behind a successful folded hero and the flop',()=>{
  assert(html.includes('id="spectatorPanel"'));
  assert(/if\(i===0&&type==='fold'\)g\.spectatorSeats=live\(\)\.filter/.test(html),'successful hero fold must snapshot then-live opponents');
  assert(/spectating=g\.players\[0\]\.folded&&g\.spectatorSeats\.length>0&&g\.board\.length>=3&&!g\.finished/.test(html));
  assert(/spectating&&g\.spectatorSeats\.includes\(i\)&&!p\.folded/.test(html),'only snapshotted live opponents may be revealed');
  assert(/g\.spectatorSeats=\[\]/.test(html),'new hands must clear spectator state');
  assert(/if\(!spectating\)/.test(html),'panel must explicitly clear outside spectator mode');
  assert(/action-bar\.spectator \.spectator-grid\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/.test(html),'mobile spectator rows must form a bounded horizontal tray');
  assert(/action-bar\.spectator\{[^}]*height:142px[^}]*overflow:hidden/.test(html),'mobile spectator tray must not grow over the table');
});
test('spectator flop equity, known-dead removal and turn chop outs are exact',()=>{
  const active=[{i:1,hole:C.cards('As Ad')},{i:2,hole:C.cards('Ks Kd')}];
  const flop=C.spectatorEquity(active,C.cards('2c 3d 4h'));
  assert.strictEqual(flop.runouts,990);
  assert.strictEqual(flop.players[0].wins,891);assert.strictEqual(flop.players[0].ties,24);
  assert.strictEqual(flop.players[1].wins,75);assert.strictEqual(flop.players[1].ties,24);
  assert.strictEqual(Array.from(flop.players[1].nextLead).sort().join(','),'Kc,Kh');
  const dead=C.spectatorEquity(active,C.cards('2c 3d 4h'),C.cards('Qh Jh'));
  assert.strictEqual(dead.runouts,903);assert.strictEqual(dead.players[0].wins,808);assert.strictEqual(dead.players[1].wins,71);
  const turn=C.spectatorEquity(active,C.cards('2c 3d 4h 5s'));
  assert.strictEqual(turn.runouts,44);assert.strictEqual(turn.players[0].wins,38);assert.strictEqual(turn.players[0].ties,6);assert.strictEqual(turn.players[1].ties,6);
  assert.strictEqual(Array.from(turn.players[1].chopOuts).sort().join(','),'6c,6d,6h,6s,Ac,Ah');
});

test('tournament schedule advances only by seven completed hands and caps',()=>{
  const expected=[[25,50,0],[50,100,0],[75,150,25],[100,200,25],[150,300,50],[200,400,50],[300,600,75],[400,800,100],[600,1200,200],[800,1600,200],[1000,2000,300],[1500,3000,500]];
  assert.deepEqual(Array.from(C.TOURNAMENT_LEVELS,l=>Array.from(l)),expected);
  for(let h=0;h<84;h++){const x=C.tournamentLevel(h);assert.equal(x.index,Math.min(11,Math.floor(h/7)));assert.equal(x.completedInLevel,x.index===11?h-77:h%7);assert.equal(x.handsToNext,x.index===11?null:7-h%7)}
  const cap=C.tournamentLevel(999);assert.equal(cap.index,11);assert.equal(cap.handsToNext,null);assert.deepEqual(Array.from(cap.blinds),[1500,3000,500]);
});

test('tournament antes are integer, all-in capable and conserved',()=>{
  const ps=[p(10),p(25),p(100),p(0)];ps[3].eliminated=true;
  const s={players:ps,pot:0};const paid=C.postTournamentAntes(s,[0,1,2],25);
  assert.deepEqual(Array.from(paid),[10,25,25]);assert.deepEqual(ps.map(x=>x.stack),[0,0,75,0]);
  assert.deepEqual(ps.map(x=>x.total),[10,25,25,0]);assert.equal(s.pot,60);assert(ps[0].allIn&&ps[1].allIn);
  assert.equal(ps.reduce((n,x)=>n+x.stack+(x.total||0),0),135);
  assert.throws(()=>C.postTournamentAntes({players:[p(10)],pot:0},[0],2.5),/integer/i);
});

test('heads-up button posts SB and acts first preflop while BB acts first postflop',()=>{
  const hu=C.tournamentPositions([2,6],2);assert.deepEqual({...hu},{dealer:2,sb:2,bb:6,preflopFirst:2,postflopFirst:6});
  const full=C.tournamentPositions([0,2,4,6],2);assert.deepEqual({...full},{dealer:2,sb:4,bb:6,preflopFirst:0,postflopFirst:4});
  assert.equal(C.nextLiveSeat([0,2,6],2),6);assert.equal(C.nextLiveSeat([0,2,6],6),0);
});

test('simultaneous tournament busts use starting stack then deterministic clockwise order',()=>{
  const ps=Array.from({length:8},(_,seat)=>({seat,stack:seat===1||seat===3||seat===5?0:1000,eliminated:false,finishPlace:null,bustHand:null}));
  const starts=[1000,200,1000,100,1000,200,1000,1000];
  const out=C.resolveTournamentEliminations(ps,starts,0,12);
  assert.deepEqual(Array.from(out),[3,1,5]);
  assert.deepEqual([ps[3].finishPlace,ps[1].finishPlace,ps[5].finishPlace],[8,7,6]);
  assert(ps[1].eliminated&&ps[5].eliminated&&ps[3].eliminated);assert.equal(ps[3].bustHand,12);
});

test('tournament state validation enforces mode, counters and exactly 24000 live chips',()=>{
  const players=Array.from({length:8},(_,seat)=>({seat,stack:3000,total:0,eliminated:false}));
  const s={schemaVersion:3,mode:'tournament',players,pot:0,completedHands:0,levelIndex:0,handsCompletedInLevel:0,status:'HAND_ACTIVE'};
  assert.equal(C.validateTournamentState(s),true);
  players[0].stack--;assert.throws(()=>C.validateTournamentState(s),/24,000/);players[0].stack++;
  s.mode='cash';assert.throws(()=>C.validateTournamentState(s),/mode/);s.mode='tournament';s.levelIndex=2;assert.throws(()=>C.validateTournamentState(s),/level/);
});

test('setup defaults to fixed tournament while cash choices and accounting remain available',()=>{
  assert(/data-mode="tournament"[^>]*class="selected"/.test(html),'Tournament must be selected by default');
  assert(/data-mode="cash"/.test(html),'Cash remains selectable');
  assert(/8 players[^<]*3,000 chips[^<]*7 hands\/level[^<]*no rebuys/i.test(html),'fixed structure summary');
  assert(html.includes('data-n="6"')&&html.includes('data-n="7"')&&html.includes('data-n="8"'),'cash seat range remains');
  assert(/Buy in for \$1,500/.test(html)&&/totalBuyIns\s*\+=\s*1500/.test(html),'cash buy-in and explicit rebuy remain');
});

test('tournament UI has hand-count progress, bust/watch and completion actions without time promises',()=>{
  for(const id of ['tournamentStatus','watchTournament','newTournament','returnMenu','playAgain'])assert(html.includes(`id="${id}"`)||html.includes(`id=\"${id}\"`),id);
  assert(/players remaining/i.test(html)&&/hands completed/i.test(html)&&/Next:/i.test(html));
  assert(!/countdown|minutes remaining|45[–-]60 minutes/i.test(html));
  assert(/heroWatching/.test(html),'watch state exists');
});

test('persistence uses versioned mode-separated keys and resume never settles or deals',()=>{
  assert(/riverRoomCashV3/.test(html)&&/riverRoomTournamentV3/.test(html));
  assert(/mode===['"]tournament['"]/.test(html));
  assert(/validateTournamentState/.test(html));
  assert(/status:['"]HAND_ACTIVE['"]/.test(html)||/status\s*=\s*['"]HAND_ACTIVE['"]/.test(html));
  assert(/settlementId/.test(html),'settlement idempotency token');
});

test('offline procedural audio exposes distinctive cues and only unlocks from gestures',()=>{
  for(const cue of ['shuffle','deal','chips','check','fold','allIn','street','win'])assert(new RegExp(`soundCue\\(['\"]${cue}['\"]`).test(html),cue);
  assert(/function unlockAudio\(/.test(html));assert(/isTrusted/.test(html));assert(/createOscillator|createBufferSource/.test(html));
  assert(!/<audio|\.mp3|\.wav|https?:\/\//i.test(html),'sound must stay procedural and offline');
});

test('seeded postflop sizing is reproducible, diverse, legal and overlaps across hand classes',()=>{
  const base={board:C.cards('Ks 7c 2d'),toCall:0,pot:100,currentBet:0,stack:1000,effectiveStack:1000,minRaiseTo:10,maxRaiseTo:1000,opponents:1,street:'flop',positionName:'BTN',inPosition:true,wasPreflopAggressor:true};
  const sizes=(hole)=>Array.from({length:40},(_,seed)=>C.decideAction('balanced',{...base,hole:C.cards(hole),seed}).to).filter(Boolean);
  const air=sizes('9s 8h'),value=sizes('Kh 7d');
  assert(new Set(air).size>=3,`air sizes ${air}`);assert(new Set(value).size>=3,`value sizes ${value}`);
  assert(air.some(x=>value.includes(x)),`sizes must overlap: ${air} / ${value}`);
  for(const x of [...air,...value])assert(Number.isInteger(x)&&x>=10&&x<=1000);
  const x=C.decideAction('balanced',{...base,hole:C.cards('Kh 7d'),seed:17,policyRoll:.01});
  const y=C.decideAction('balanced',{...base,hole:C.cards('Kh 7d'),seed:17,policyRoll:.01});assert.deepEqual(x,y);
});

test('style and public context mix duplicate action boundaries without caricature frequencies',()=>{
  const base={hole:C.cards('9s 7d'),board:C.cards('As 6h 2c'),toCall:0,pot:100,currentBet:0,stack:1000,effectiveStack:1000,opponents:1,street:'flop',positionName:'BTN',inPosition:true,wasPreflopAggressor:true};
  const signatures=['pressure','balanced','value','trap','nit'].map(style=>Array.from({length:20},(_,seed)=>C.decideAction(style,{...base,seed}).type[0]).join(''));
  assert(new Set(signatures).size>=4,signatures.join('\n'));
  const mixed=signatures.filter(s=>{const raises=[...s].filter(x=>x==='r').length;return raises>0&&raises<20});assert(mixed.length>=3,signatures.join('\n'));
});

test('river defense scales sensibly across sizing, strength, blockers and observed overbet outcomes',()=>{
  const base={board:C.cards('Js 9s 7d 4h 2s'),pot:200,currentBet:200,stack:1000,effectiveStack:1000,opponents:1,street:'river',positionName:'BB',inPosition:false};
  const rate=(hole,mult,model={})=>C.samplePolicy('balanced',{...base,hole:C.cards(hole),toCall:200*mult,currentBet:200*mult,humanModel:model},2000,73).continueRate;
  const weak75=rate('Jh Td',.75),weak2=rate('Jh Td',2),top2=rate('9h 9d',2),block2=rate('As Jd',2);
  assert(weak75>weak2+.12,`${weak75} vs ${weak2}`);assert(top2>weak2+.35,`${top2} vs ${weak2}`);assert(block2>weak2+.08,`${block2} vs ${weak2}`);
  const bluffHeavy=rate('Jh Td',1.5,{riverOverbetBluffRate:.7,riverOverbetConfidence:.8}),valueHeavy=rate('Jh Td',1.5,{riverOverbetBluffRate:.15,riverOverbetConfidence:.8});
  assert(bluffHeavy>valueHeavy+.08,`${bluffHeavy} vs ${valueHeavy}`);
});

test('multiway realization is price-aware rather than a universal aggression subtraction',()=>{
  const base={hole:C.cards('9s 8d'),board:C.cards('7h 6c Kd'),currentBet:20,stack:980,effectiveStack:980,street:'flop',positionName:'BTN',inPosition:true};
  const hu=C.samplePolicy('balanced',{...base,pot:120,toCall:20,opponents:1},1200,91),mw=C.samplePolicy('balanced',{...base,pot:300,toCall:20,opponents:3},1200,91);
  assert(mw.continueRate>.85,JSON.stringify(mw));assert(mw.continueRate>=hu.continueRate-.08,`${hu.continueRate} vs ${mw.continueRate}`);
});

test('expanded public model uses shrinkage, relevant minima and preserves legacy fields',()=>{
  const m=C.modelStats({vpipOpp:100,vpip:30,pfrOpp:100,pfr:20,foldOpp:50,folds:25,stealOpp:20,steals:12,bbVsBtnOpp:20,bbVsBtnFolds:14,fold3BetOpp:18,fold3Bet:10,flopCbetHUSmallOpp:24,flopCbetHUSmallFolds:16,riverOverbetOpp:16,riverOverbetBluffSignals:9});
  for(const k of ['vpip','pfr','foldToBet','confidence','steal','foldBBvsBTN','foldTo3Bet','flopCbetHUSmallFold','riverOverbetBluffRate','riverOverbetConfidence'])assert(Number.isFinite(m[k]),k);
  const thin=C.modelStats({riverOverbetOpp:3,riverOverbetBluffSignals:3});assert.equal(thin.riverOverbetConfidence,0);
});

test('live hands persist a public nonce and feed stable bot decision seeds without card or deck derivation',()=>{
  assert(/handNonce/.test(html),'saved game needs a public hand nonce');
  assert(/seed:.*handNonce/.test(html),'bot context needs the persisted nonce');
  assert(/handNonce=randInt\(4294967296\)/.test(html),'nonce must come from an independent public random draw');
});

test('adversarial benchmark pools deterministic seed blocks and reports block uncertainty',()=>{
  const bench=fs.readFileSync(__dirname+'/ai-match-bench.js','utf8');
  assert(/--blocks/.test(bench),'benchmark needs an explicit seed-block count');
  assert(/blockInterval|blockCI/.test(bench),'benchmark needs uncertainty across block means');
  assert(/blockMeans/.test(bench),'each strategy must retain block-level means');
  assert(/handsPerBlock/.test(bench),'reporting must distinguish hands per block from pooled hands');
});

test('wet-board top pair retains a reduced mixed cbet instead of checking range face-up',()=>{
  const base={toCall:0,pot:100,currentBet:0,stack:1000,effectiveStack:1000,opponents:1,street:'flop',positionName:'BTN',inPosition:true,wasPreflopAggressor:true};
  const dry=C.samplePolicy('balanced',{...base,hole:C.cards('As Kd'),board:C.cards('Kh 7c 2d')},2400,111);
  const wet=C.samplePolicy('balanced',{...base,hole:C.cards('Ah Kd'),board:C.cards('Ks 9s 8h')},2400,112);
  assert(wet.raiseRate>.12&&wet.raiseRate<.65,`wet TPTK cbet ${wet.raiseRate}`);
  assert(dry.raiseRate>wet.raiseRate+.12,`${dry.raiseRate} vs ${wet.raiseRate}`);
});

test('preflop boundary classes mix and small blind defends button opens credibly',()=>{
  const ctx={tableSize:6,positionName:'HJ',preflopNode:'vs3Bet',stack:1000,effectiveStack:1000,bb:10};
  const eights=C.preflopRangeWeight(C.cards('8s 8d'),ctx,'continue'),sevens=C.preflopRangeWeight(C.cards('7s 7d'),ctx,'continue');
  assert(eights<.98&&sevens>.02&&eights>sevens,`${eights} / ${sevens}`);
  const sb=C.rangeBenchmark({tableSize:6,positionName:'SB',openerPosition:'BTN',node:'vsOpen'});
  assert(sb.vpip>=.25&&sb.vpip<=.34,JSON.stringify(sb));
});

test('live opponent ranges include limped pots and decision equity uses a stronger flop sample floor',()=>{
  assert(/preflopNode:['"]vsLimpers['"]/.test(html),'limped pots need a weighted public opponent range');
  assert(/samples:[^?]*\?800:600/.test(html),'decision equity should use 800/600 overbet/default samples');
});

test('Pokerspace identity is complete, architectural and explicitly non-cosmic',()=>{
  assert(/<title>Pokerspace · Offline Hold’em<\/title>/.test(html));
  assert(/<h1>POKERSPACE<\/h1>/.test(html)&&/>PS<\/div>/.test(html));
  assert(/content:'POKERSPACE'/.test(html),'table wordmark');
  assert(/--walnut:/.test(html)&&/--oxblood:/.test(html)&&/--brass:/.test(html),'room palette tokens');
  assert(/\.setup\{position:fixed\}/.test(html),'entry screen remains a fixed full-screen modal');
  assert(!/River Room|RIVER ROOM/.test(html),'obsolete visible brand');
  assert(!/\b(stars?|planets?|galaxy|cosmic|orbit|nebula|spacecraft|spaceship|sci-fi)\b/i.test(html),'no outer-space interpretation');
  assert(/pokerspaceTournamentV3/.test(html)&&/pokerspaceCashV3/.test(html),'new storage namespace');
  assert(/riverRoomTournamentV3/.test(html)&&/riverRoomCashV3/.test(html),'legacy saves remain migratable');
});

test('heads-up policy uses a wide mixed SB range and correctly labels the defender as BB',()=>{
  assert.equal(C.preflopNode({tableSize:2,positionName:'BTN',raises:0,actions:[]}), 'HU_SB');
  const sb=C.rangeBenchmark({tableSize:2,positionName:'BTN',node:'HU_SB',effectiveStack:600,bb:10,pot:15});
  const shallow=C.rangeBenchmark({tableSize:2,positionName:'BTN',node:'HU_SB',effectiveStack:40,bb:10,pot:15});
  const ante=C.rangeBenchmark({tableSize:2,positionName:'BTN',node:'HU_SB',effectiveStack:600,bb:10,pot:20});
  assert(sb.vpip>.84&&sb.vpip<.92,`HU SB VPIP ${sb.vpip}`);
  assert(sb.pfr>.55&&sb.pfr<.66,`HU SB PFR ${sb.pfr}`);
  assert(shallow.vpip<sb.vpip&&shallow.vpip>.78,'shallow HU SB should tighten its non-all-in tail');
  assert(shallow.pfr<sb.pfr&&shallow.pfr>.5,'shallow HU SB keeps a broad shove band');
  assert(ante.vpip>sb.vpip,'dead ante money should widen the button slightly');
  assert.equal(C.preflopSizing({node:'HU_SB',positionName:'BTN',effectiveStack:40,bb:10,maxRaiseTo:45,minRaiseTo:20,currentBet:10,seed:7},'HU_SB'),45,'5BB button aggression should apply maximum pressure');
  for(let seed=1;seed<=300;seed++){
    const d=C.decideAction('balanced',{hole:C.cards('7s 2h'),board:[],street:'preflop',tableSize:2,positionName:'BB',raises:0,actions:[{street:'preflop',actor:0,position:'BTN',type:'call'}],toCall:0,pot:20,stack:590,effectiveStack:590,bb:10,currentBet:10,lastFullRaiseSize:10,minRaiseTo:20,maxRaiseTo:600,legalActions:{canFold:false,canCheck:true,canCall:false,canRaise:true,toCall:0,minRaiseTo:20,maxRaiseTo:600},seed,humanModel:C.modelStats({})});
    assert.notEqual(d.type,'call','BB must emit check, not rely on call-to-check fallback');
  }
  const bb=C.rangeBenchmark({tableSize:2,positionName:'BB',openerPosition:'BTN',node:'vsOpen',effectiveStack:600,bb:10});
  assert(bb.vpip>.56&&bb.vpip<.7,`HU BB defend ${bb.vpip}`);
  assert(/tournamentLive\(\)\.length===2[\s\S]{0,100}i===g\.dealer\?'BTN':'BB'/.test(html),'live HU defender must be labeled BB');
  assert(/tableSeats=dealtIn\(\),hu=tableSeats\.length===2/.test(html),'HU policy must use players dealt in, not survivors after folds');
  assert(!/hu=live\(\)\.length===2/.test(html),'folds in a multiway hand must not activate HU ranges');
});

test('all-in runout burns correctly and reveals each community card in sequence',()=>{
  const deck=C.cards('2s 3s 4s 5s 6s 7s 8s 9s Ts Js').slice().reverse(),st={deck,board:[],street:'preflop'};
  const seen=[];for(let i=0;i<5;i++){const x=C.dealRunoutCard(st);seen.push(x.card.r+x.card.s);assert.equal(st.board.length,i+1);}
  assert.deepEqual(seen,['3s','4s','5s','7s','9s']);
  assert.equal(st.street,'river');assert.equal(st.deck.length,2);
  assert.equal(C.dealRunoutCard(st).done,true);
});

test('uncalled return does not mark the player as a winner at showdown',()=>{const ps=[p(900,100,2100),p(500,100,1500)];ps[0].hole=C.cards('2c 3h');ps[0].allIn=true;ps[0].folded=false;ps[1].hole=C.cards('Ad Ks');ps[1].allIn=true;ps[1].folded=false;for(let i=2;i<8;i++){ps.push(p(3000,0,0));ps[i].folded=true}const s={players:ps,board:C.cards('Ac 7d 4s 2d 9h'),pot:3600,currentBet:2100,lastFullRaiseSize:100,street:'river',awards:[],lastPot:0};C.settlePots(s);let potWinners=s.awards.filter(a=>a.label!=='Uncalled returned').flatMap(a=>a.winners),allWinners=[...new Set(s.awards.flatMap(a=>a.winners))];assert.ok(!potWinners.includes(0),'hero should not win any pot');assert.ok(potWinners.includes(1),'bot should win the main pot');assert.ok(allWinners.includes(0),'hero gets uncalled return');assert.ok(!allWinners.every(w=>potWinners.includes(w)),'uncalled return winner differs from pot winner')});
test('all-in showdown is paced, resumable and no longer dumps the full board synchronously',()=>{
  assert(/runoutDelay=/.test(html),'runout needs pace-aware delay');
  assert(/function beginAllInRunout\(/.test(html));assert(/function dealNextRunoutCard\(/.test(html));
  assert(/runoutInProgress/.test(html)&&/if\(g\.runoutInProgress\)/.test(html),'active runout must resume');
  assert(!/function showdown\(\)\{while\(g\.board\.length<5\)/.test(html),'showdown must not reveal all cards in one loop');
  const a=html.indexOf('function dealNextRunoutCard('),b=html.indexOf('function nextStreet(',a),fn=html.slice(a,b);
  assert(a>=0&&b>a,'runout function source');
  const dealAt=fn.indexOf('C.dealRunoutCard(g)'),renderAt=fn.indexOf('render()',dealAt),saveAt=fn.indexOf('save()',renderAt),timerAt=fn.indexOf('setTimeout(',saveAt);
  assert(dealAt>=0&&dealAt<renderAt&&renderAt<saveAt&&saveAt<timerAt,'each card should deal, render and persist before the next');
});

console.log('\nAll Pokerspace QA tests passed.');
