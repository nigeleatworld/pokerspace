'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {STYLES,TABLES,STREETS,blank,addBlank,summarizeStat,markdown}=require('./measure');
const files=process.argv.slice(2);assert(files.length,'usage: node aggregate.js shards/*.json');
const shards=files.map(f=>JSON.parse(fs.readFileSync(f,'utf8'))), hashes=new Set(shards.map(x=>x.sourceSha256)), seeds=new Set(shards.map(x=>x.seed));
assert.equal(hashes.size,1,'source hashes differ');assert.equal(seeds.size,1,'seeds differ');
function rawFrom(x){const z=blank();z.hands=x.hands;z.decisions=x.decisions;z.vpip=x.vpip.count;z.pfr=x.pfr.count;z.threeBet=x.threeBet.count;z.threeBetOpp=x.threeBet.opportunities;for(const st of STREETS){for(const k of Object.keys(z.classes[st])){z.classes[st][k].actions=x.classes[st][k].count;z.classes[st][k].opportunities=x.classes[st][k].opportunities;}for(const k of Object.keys(z.sizing[st]))z.sizing[st][k]=x.sizing[st][k].count;}return z;}
const raw=Object.fromEntries(TABLES.map(n=>[n,Object.fromEntries(STYLES.map(s=>[s,blank()]))]));
for(const n of TABLES){const ss=shards.filter(x=>x.selectedTables.length===1&&x.selectedTables[0]===n).sort((a,b)=>a.start-b.start);assert(ss.length,`no shards for ${n}`);let next=0;for(const x of ss){assert.equal(x.start,next,`gap/overlap table ${n}`);next+=x.handsPerTable;for(const s of STYLES)addBlank(raw[n][s],rawFrom(x.tables[n][s]));}assert(next>=1000,`too few hands table ${n}`);}
const pooled=Object.fromEntries(STYLES.map(s=>[s,blank()]));for(const n of TABLES)for(const s of STYLES)addBlank(pooled[s],raw[n][s]);
const tables=Object.fromEntries(TABLES.map(n=>[n,Object.fromEntries(STYLES.map(s=>[s,summarizeStat(raw[n][s])]))])),pooledOut=Object.fromEntries(STYLES.map(s=>[s,summarizeStat(pooled[s])]));
const handsPerTable=shards.filter(x=>x.selectedTables[0]===2).reduce((a,x)=>a+x.handsPerTable,0), vpips=STYLES.map(s=>pooledOut[s].vpip.ratePct);
const result={runAt:new Date().toISOString(),sourceSha256:[...hashes][0],seed:[...seeds][0],start:0,selectedTables:TABLES,handsPerTable,totalHands:handsPerTable*TABLES.length,runtimeSeconds:Math.round(shards.reduce((a,x)=>a+x.runtimeSeconds,0)*100)/100,
 audit:Object.fromEntries(Object.keys(shards[0].audit).map(k=>[k,shards.reduce((a,x)=>a+x.audit[k],0)])),tables,pooled:pooledOut,
 conclusion:`**Not supported literally.** All personas voluntarily entered a material share of hands (pooled VPIP range **${Math.min(...vpips)}%–${Math.max(...vpips)}%**), and the logged postflop tables contain non-zero pure- and semi-bluff aggression. The narrower impression that the pool is selective has some support only in the relative sense shown by persona/table VPIP and PFR; the telemetry cannot call every entered hand “strong” because preflop strength was not part of the requested postflop operational classifier.`};
for(const [k,v] of Object.entries(result.audit))if(k!=='views')assert.equal(v,0,`${k} failures`);
fs.writeFileSync('metrics.json',JSON.stringify(result,null,2)+'\n');fs.writeFileSync('README.md',markdown(result));console.log(JSON.stringify({hands:result.totalHands,decisions:result.audit.views,handsPerTable,sourceSha256:result.sourceSha256},null,2));
