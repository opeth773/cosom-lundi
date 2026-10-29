const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
function setup(admin=true) {
  const goalie={id:'g',type:'goalie',firstName:'Gardien'};
  const skater={id:'s',type:'regular',firstName:'Joueur'};
  const match={id:'m',status:'final',finalLineup:[{playerId:'s',team:'dark',position:'skater'}]};
  const state={currentMatch:match,matches:[match],players:[goalie,skater],assignments:new Map(),leagueId:'l',user:{uid:'admin'},stats:{cached:true}};
  const writes=[];
  const ctx=vm.createContext({state,Map,Set,console,isAdmin:()=>admin,findPlayer:id=>state.players.find(p=>p.id===id),matchRef:()=> 'match',doc:(...args)=>args.at(-1),serverTimestamp:()=>0,toast:()=>{},render:()=>{},playerName:p=>p?.firstName||'',tsMillis:()=>0,playerWasActiveAtMatch:()=>true,activePlayers:()=>state.players,esc:x=>x,escAttr:x=>x,getMatchResponseStatus:()=> 'unknown',substituteRoleLabel:()=> 'Gardien',defaultMatchPosition:p=>p?.type==='goalie'?'goalie':'skater',collection:(...args)=>args.at(-1),getDocs:async()=>({docs:[{data:()=>({team:'light',assists:[]})}]}),handleError:e=>{throw e;},runTransaction:async(db,fn)=>fn({get:async()=>({exists:()=>true,data:()=>state.currentMatch}),set:(ref,data)=>writes.push(['set',ref,data]),delete:ref=>writes.push(['delete',ref]),update:(ref,data)=>{Object.assign(state.currentMatch,data);writes.push(['update',ref,data]);}})});
  for(const name of ['matchPosition','matchAssignments','correctFinalAssignment','setAssignment','setMatchPosition','loadStats','renderAssignmentGroup','renderArchivedLineups']) {
    const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
    assert.ok(start>=0,name);
    const rest=source.slice(start);
    const firstLine=rest.split('\n')[0];
    const end=firstLine.endsWith('}')?firstLine.length:rest.indexOf('\n}')+2;
    vm.runInContext(rest.slice(0,end),ctx);
  }
  return {ctx,state,writes};
}
test('admin adds forgotten goalie and stats count game and goals against',async()=>{
  const {ctx,state,writes}=setup();
  await ctx.setAssignment('g','dark');
  assert.equal(writes.length,2);
  assert.equal(state.currentMatch.finalLineup.length,2);
  await ctx.loadStats();
  const g=state.stats.players.find(p=>p.id==='g');
  assert.equal(g.goalieGp,1); assert.equal(g.ga,1); assert.equal(g.avg,1); assert.equal(g.absences,0);
  assert.equal(state.stats.players.find(p=>p.id==='s').skaterGp,1);
});
test('admin changes team, changes position, then removes final assignment',async()=>{
  const {ctx,state}=setup();
  await ctx.setAssignment('g','light');
  await ctx.setMatchPosition('g','skater');
  assert.equal(state.currentMatch.finalLineup.find(a=>a.playerId==='g').position,'skater');
  await ctx.setAssignment('g','dark');
  assert.equal(state.currentMatch.finalLineup.find(a=>a.playerId==='g').position,'skater');
  await ctx.setAssignment('g','absent');
  await ctx.setAssignment('s','absent');
  assert.equal(state.currentMatch.finalLineup.length,0);
  await ctx.loadStats();
  assert.equal(state.stats.players.find(p=>p.id==='g').goalieGp,0);
});
test('regular member cannot change finalized teams or positions',async()=>{
  const {ctx,writes}=setup(false);
  await ctx.setAssignment('g','dark'); await ctx.setMatchPosition('s','goalie');
  await ctx.correctFinalAssignment('g',{team:'dark'});
  assert.equal(writes.length,0);
});
test('only admins see corrections, including unavailable substitute goalies',()=>{
  const {ctx,state}=setup();
  state.players.push({id:'sub',firstName:'Remplaçant',type:'sub',subRole:'goalie'});
  ctx.defaultMatchPosition=p=>p?.type==='goalie'||p?.subRole==='goalie'?'goalie':'skater';
  const adminHtml=ctx.renderArchivedLineups(state.currentMatch);
  assert.match(adminHtml,/Corriger les alignements/);
  assert.match(adminHtml,/data-player="sub"/);
  assert.doesNotMatch(ctx.renderAssignmentGroup('Gardiens','goalie'),/<button disabled/);
  ctx.isAdmin=()=>false;
  assert.doesNotMatch(ctx.renderArchivedLineups(state.currentMatch),/data-action="assign"/);
});
test('legacy finals without snapshot preserve existing assignments',async()=>{
  const {ctx,state}=setup();
  delete state.currentMatch.finalLineup;
  state.assignments.set('s',{team:'light',position:'skater'});
  await ctx.setAssignment('g','dark');
  assert.equal(state.currentMatch.finalLineup.find(a=>a.playerId==='s').team,'light');
  assert.equal(state.currentMatch.finalLineup.length,2);
});
