const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function setup() {
 const players=[{id:'dark',type:'goalie',firstName:'Gardien foncé'},{id:'light',type:'goalie',firstName:'Gardien pâle'},{id:'mixed',type:'regular',firstName:'Polyvalent'},{id:'sub',type:'sub',firstName:'Remplaçant'},{id:'absent',type:'goalie',firstName:'Absent'}];
 const lineup=()=>[{playerId:'dark',team:'dark',position:'goalie'},{playerId:'light',team:'light',position:'goalie'},{playerId:'mixed',team:'dark',position:'skater'}];
 const matches=[{id:'win',status:'final',finalLineup:lineup()},{id:'loss',status:'final',finalLineup:lineup()},{id:'tie',status:'final'},{id:'zero',status:'final',finalLineup:lineup()},{id:'live',status:'live',finalLineup:lineup()},{id:'scheduled',status:'scheduled',finalLineup:lineup()}];
 matches[0].finalLineup.push({playerId:'sub',team:'dark',position:'goalie'});
 matches[1].finalLineup.find(p=>p.playerId==='mixed').team='light';
 matches[1].finalLineup.find(p=>p.playerId==='mixed').position='goalie';
 const scores={win:[2,1],loss:[0,2],tie:[1,1],zero:[0,0],live:[9,0],scheduled:[0,5]};
 const state={players,matches,leagueId:'league',statsLoading:false};
 const reads=[];
 const ctx=vm.createContext({state,Map,Set,render:()=>{},playerName:p=>p.firstName,
  playerWasActiveAtMatch:()=>true,defaultMatchPosition:p=>p.type==='goalie'?'goalie':'skater',tsMillis:()=>0,
  handleError:e=>{throw e;},collection:(...parts)=>parts.slice(-2),
  getDocs:async([id,kind])=>{
   reads.push([id,kind]);
   const values=kind==='assignments'?lineup().filter(a=>a.playerId!=='mixed'):[...Array(scores[id][0])].map(()=>({team:'dark',assists:[]})).concat([...Array(scores[id][1])].map(()=>({team:'light',assists:[]})));
   return {docs:values.map(value=>({id:value.playerId,data:()=>value}))};
  },activePlayers:()=>players,esc:x=>x,escAttr:x=>x,formatDate:()=>''});
 for(const name of ['matchPosition','loadStats','renderStats']) {
  const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
  assert.ok(start>=0,name);const rest=source.slice(start),first=rest.split('\n')[0];
  vm.runInContext(first.endsWith('}')?first:rest.slice(0,rest.indexOf('\n}')+2),ctx);
 }
 return {ctx,state,reads,record:id=>state.stats.players.find(p=>p.id===id)};
}
test('goalie wins, losses and ties derive only from finalized match scores on both sides',async()=>{
 const {ctx,state,reads,record}=setup();await ctx.loadStats();
 assert.equal(state.stats.finalMatches,4);
 const dark=record('dark'),light=record('light');
 for(const g of [dark,light]) {
  assert.equal(g.goalieGp,4);assert.equal(g.goalieWins,1);assert.equal(g.goalieLosses,1);assert.equal(g.goalieTies,2);
  assert.equal(g.goalieWins+g.goalieLosses+g.goalieTies,g.goalieGp);
 }
 assert.equal(dark.ga,4);assert.equal(dark.avg,1);assert.equal(light.ga,3);assert.equal(light.avg,0.75);
 assert.ok(!reads.some(([id])=>id==='live'||id==='scheduled'));
});
test('temporary and substitute goalies receive results only when aligned in goal',async()=>{
 const {ctx,record}=setup();await ctx.loadStats();
 const mixed=record('mixed'),sub=record('sub'),absent=record('absent');
 assert.equal(mixed.goalieGp,1);assert.equal(mixed.goalieWins,1);assert.equal(mixed.goalieLosses,0);assert.equal(mixed.skaterGp,2);
 assert.equal(sub.goalieWins,1);assert.equal(sub.goalieGp,1);assert.equal(sub.absences,0);
 assert.equal(absent.goalieWins,0);assert.equal(absent.goalieLosses,0);assert.equal(absent.goalieTies,0);assert.equal(absent.goalieGp,0);
});
test('legacy finals fetch assignments and zero-zero matches count as ties',async()=>{
 const {ctx,state,reads,record}=setup();state.matches=state.matches.filter(m=>m.id==='tie'||m.id==='zero');await ctx.loadStats();
 assert.ok(reads.some(([id,kind])=>id==='tie'&&kind==='assignments'));
 assert.equal(record('dark').goalieTies,2);assert.equal(record('dark').goalieWins,0);assert.equal(record('dark').goalieLosses,0);
});
test('correcting an archived goalie team or position recalculates results without duplicate credit',async()=>{
 const {ctx,state,record}=setup();state.matches=state.matches.filter(m=>m.id==='win');await ctx.loadStats();
 assert.equal(record('dark').goalieWins,1);
 state.matches[0].finalLineup.find(a=>a.playerId==='dark').team='light';await ctx.loadStats();
 assert.equal(record('dark').goalieWins,0);assert.equal(record('dark').goalieLosses,1);assert.equal(record('dark').goalieGp,1);
 state.matches[0].finalLineup.find(a=>a.playerId==='dark').position='skater';await ctx.loadStats();
 assert.equal(record('dark').goalieLosses,0);assert.equal(record('dark').goalieGp,0);assert.equal(record('dark').skaterGp,1);
});
test('goalie table exposes V/D/N and preserves access to all columns on mobile',async()=>{
 const {ctx}=setup();await ctx.loadStats();const html=ctx.renderStats();
 assert.match(html,/<th title="Victoires">V<\/th>/);assert.match(html,/<th title="Défaites">D<\/th>/);assert.match(html,/<th title="Matchs nuls">N<\/th>/);
 assert.match(html,/goalie-stats-scroll/);assert.match(html,/Gardien foncé<\/td><td>4<\/td><td>1<\/td><td>1<\/td><td>2<\/td><td>4<\/td>/);
});
