const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const jon={id:'jon',firstName:'Jonathan',lastName:'Varin'};
const alex={id:'alex',firstName:'Alex',lastName:'Roy'};
const marc1={id:'marc1',firstName:'Marc-André',lastName:'Tremblay'};
const marc2={id:'marc2',firstName:'Marc-André',lastName:'Dubé'};
function setup(players=[jon,alex,marc1,marc2]) {
  const messages=[],committed=[],beeps=[];
  const state={currentMatch:{id:'m'},players,assignments:new Map(players.map(p=>[p.id,{team:'dark'}]))};
  const voice={enabled:true,matchId:'m',phase:'details'};
  const voiceTest={enabled:true,phase:'details',pauseAfterResult:false,results:[],running:true,detailSegments:{},lineup:Object.fromEntries(players.map(p=>[p.id,'dark']))};
  const ctx=vm.createContext({state,voice,voiceTest,Date,
    activePlayers:()=>players,matchAssignments:()=>state.assignments,
    findPlayer:id=>players.find(p=>p.id===id),
    playerName:p=>p?`${p.firstName} ${p.lastName}`:'',
    clearTimeout:()=>{},setTimeout:()=>1,resetVoiceDetailCollector:()=>{},
    getRemainingSeconds:()=>600,formatClock:()=>'10:00',
    scheduleVoiceGoalDetailProcessing:()=>{},scheduleVoiceTestDetailProcessing:()=>{},isAdmin:()=>true,
    updateVoiceHeard:()=>{},updateVoiceTestHeard:()=>{},
    setVoiceStatus:message=>messages.push(message),setVoiceTestStatus:message=>messages.push(message),
    voiceBeep:type=>beeps.push(type),restartVoiceDetailTimeout:()=>{},resetVoiceToListening:()=>{},
    render:()=>{},commitVoiceGoal:async parsed=>committed.push(parsed)});
  for(const name of ['voiceRecognitionVocabulary','voiceTestLineupPlayers','voiceNameDistance','voiceApproximateAliases','voiceProposalSummary','requestVoiceProposal','normalizeSpeechText','findVoiceTrigger','voiceTeamContext','updateVoiceTeamContext','resetVoiceDetailCollector','setVoiceDetailSegment','getVoiceDetailText','captureVoiceGoalMoment','handleVoiceRecognitionResult','handleVoiceTestRecognitionResult','restartVoiceTestDetailTimeout','isVoiceTestStopCommand','voiceNameTokens','voiceRosterAliases','resolveVoiceRosterNames','parseVoiceRosterDetails','voiceLineupPlayers','parseVoiceGoalDetails','parseVoiceTestDetails','processVoiceGoalAlternatives','processVoiceTestAlternatives']) {
    const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
    assert.ok(start>=0,name);
    const rest=source.slice(start),end=rest.indexOf('\n}')+2;
    vm.runInContext(rest.slice(0,end),ctx);
  }
  return {ctx,state,voice,voiceTest,messages,committed,beeps};
}
function ids(parsed) {return JSON.parse(JSON.stringify(parsed.assists));}

test('the reported phrase rejects ambiguous Marc instead of silently keeping only Alex',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('but Jonathan passe marc et Alex');
  assert.equal(result.ok,false);
  assert.match(result.message,/Nom ambigu/);
  assert.match(result.message,/Marc-André Tremblay/);
  assert.match(result.message,/Marc-André Dubé/);
});
test('complete compound first and last names identify both assists',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('but Jonathan Varin passe Marc-André Tremblay et Alex Roy');
  assert.equal(result.ok,true);assert.equal(result.scorerId,'jon');assert.deepEqual(ids(result),['marc1','alex']);
});
test('a unique surname identifies the scorer and assists',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('Varin, assisté de Dubé et Roy');
  assert.equal(result.ok,true);assert.equal(result.scorerId,'jon');assert.deepEqual(ids(result),['marc2','alex']);
});
test('a repeated first name requires a surname, including the full compound first name',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('Jonathan passe Marc-André et Alex');
  assert.equal(result.ok,false);assert.match(result.message,/ambigu/);
});
test('a repeated surname also requires the complete name',()=>{
  const extra={id:'other',firstName:'Paul',lastName:'Tremblay'};
  const {ctx}=setup([jon,alex,marc1,extra]);
  assert.match(ctx.parseVoiceTestDetails('Jonathan passe Tremblay et Roy').message,/ambigu/);
  const full=ctx.parseVoiceTestDetails('Jonathan passe Paul Tremblay et Alex');
  assert.equal(full.ok,true);assert.deepEqual(ids(full),['other','alex']);
});
test('a repeated scorer first name cannot be guessed',()=>{
  const {ctx}=setup([jon,alex,{id:'jon2',firstName:'Jonathan',lastName:'Bouchard'}]);
  assert.match(ctx.parseVoiceTestDetails('Jonathan passe Roy').message,/ambigu/);
  assert.equal(ctx.parseVoiceTestDetails('Jonathan Varin passe Roy').scorerId,'jon');
});
test('identical full names remain ambiguous rather than selecting the first ID',()=>{
  const {ctx}=setup([jon,alex,marc1,{...marc1,id:'duplicate'}]);
  assert.match(ctx.parseVoiceTestDetails('Jonathan passe Marc André Tremblay').message,/ambigu/);
});
test('an unknown first assist is not dropped in favor of a recognized second assist',()=>{
  const {ctx}=setup([jon,alex]);
  const result=ctx.parseVoiceTestDetails('but Jonathan passe Marc et Alex');
  assert.equal(result.ok,false);assert.match(result.message,/Nom non reconnu : « marc »/);
});
test('an unknown scorer cannot be replaced with the first recognized assist',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('Zorblax passe Alex');
  assert.equal(result.ok,false);assert.match(result.message,/zorblax/);
});
test('an unknown second assist fails the entire command',()=>{
  const {ctx}=setup();
  assert.match(ctx.parseVoiceTestDetails('Jonathan passe Dubé et Zorblax').message,/zorblax/);
});
test('announced assists without a name do not become an unassisted goal',()=>{
  const {ctx}=setup();assert.equal(ctx.parseVoiceTestDetails('Jonathan passe').ok,false);
});
test('unassisted goals are accepted but contradictory names are rejected',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('Jonathan sans aide');
  assert.equal(result.ok,true);assert.deepEqual(ids(result),[]);
  assert.equal(ctx.parseVoiceTestDetails('Jonathan sans aide Alex').ok,false);
  assert.equal(ctx.parseVoiceTestDetails('Jonathan passe Roy sans aide').ok,false);
});
test('duplicate assists, scorer as assist and more than two assists are rejected',()=>{
  const {ctx}=setup();
  for(const text of ['Jonathan passe Dubé et Marc André Dubé','Jonathan passe Varin','Jonathan passe Dubé Tremblay et Roy'])assert.equal(ctx.parseVoiceTestDetails(text).ok,false,text);
});
test('an unambiguous compound first name abbreviation is accepted only when unique',()=>{
  const {ctx}=setup([jon,alex,marc1]);
  const result=ctx.parseVoiceTestDetails('Jonathan passe Marc et Alex');
  assert.equal(result.ok,true);assert.deepEqual(ids(result),['marc1','alex']);
});
test('exact first names and compound abbreviations which collide are ambiguous',()=>{
  const {ctx}=setup([jon,alex,marc1,{id:'marc',firstName:'Marc',lastName:'Fortin'}]);
  assert.match(ctx.parseVoiceTestDetails('Jonathan passe Marc et Alex').message,/ambigu/);
});
test('real games require every named assistant to be on the scorer team',()=>{
  const {ctx,state}=setup();state.assignments.set('alex',{team:'light'});
  const result=ctx.parseVoiceGoalDetails('Jonathan passe Dubé et Roy');
  assert.equal(result.ok,false);assert.match(result.message,/même équipe/);
});
test('an approximate name is reported instead of silently assigned to a similar player',()=>{
  const {ctx}=setup();
  const result=ctx.parseVoiceTestDetails('Jonnathan Varin passe Marc André Tremblay et Alex Roy');
  assert.equal(result.ok,true);assert.equal(result.requiresConfirmation,true);assert.equal(result.scorerId,'jon');
});
test('live processing never writes a partial goal, even when an alternative drops the unknown assist',async()=>{
  const {ctx,committed,messages}=setup([jon,alex]);
  await ctx.processVoiceGoalAlternatives(['Jonathan passe Marc et Alex','Jonathan passe Alex']);
  assert.equal(committed.length,0);assert.match(messages.at(-1),/marc/);
});
test('different valid alternative player identities require clarification',async()=>{
  const {ctx,committed,messages}=setup();
  await ctx.processVoiceGoalAlternatives(['Jonathan passe Dubé','Jonathan passe Tremblay']);
  assert.equal(committed.length,0);assert.match(messages.at(-1),/interprétations/);
});
test('the lab reports an error for ambiguity and continues listening',async()=>{
  const {ctx,voiceTest}=setup();
  await ctx.processVoiceTestAlternatives(['but Jonathan passe Marc et Alex']);
  assert.equal(voiceTest.results[0].ok,false);assert.match(voiceTest.results[0].summary,/ambigu/);
  assert.equal(voiceTest.enabled,true);assert.equal(voiceTest.running,true);
});
test('lab success names both complete assistants and live processing writes both IDs',async()=>{
  const {ctx,voiceTest,committed}=setup();
  const text='Jonathan Varin passe Marc-André Tremblay et Alex Roy';
  await ctx.processVoiceTestAlternatives([text]);
  assert.equal(voiceTest.results[0].ok,true);
  assert.match(voiceTest.results[0].summary,/Marc-André Tremblay et Alex Roy/);
  await ctx.processVoiceGoalAlternatives([text]);
  assert.equal(committed.length,1);assert.deepEqual(ids(committed[0]),['marc1','alex']);
});

const jonDark={id:'jonDark',firstName:'Jonathan',lastName:'Bouchard'};
const alexDark={id:'alexDark',firstName:'Alex',lastName:'Gagnon'};
function teams() {
  const fixture=setup([jon,alex,marc1,marc2,jonDark,alexDark]);
  for(const p of [jon,alex,marc1])fixture.state.assignments.set(p.id,{team:'light'});
  for(const p of [jonDark,alexDark,marc2])fixture.state.assignments.set(p.id,{team:'dark'});
  fixture.voiceTest.lineup=Object.fromEntries([...fixture.state.assignments].map(([id,a])=>[id,a.team]));
  return fixture;
}
function recognitionEvent(text,isFinal=true,index=0) {
  const result=[{transcript:text}];result.isFinal=isFinal;
  return {resultIndex:index,results:[...Array(index).fill(null),result]};
}

test('team goal phrases are triggers with an explicit side, including accents and articles',()=>{
  const {ctx}=setup();
  for(const text of ['but pâles','but des pâles','but pour les pâles','ajouter un but pâle'])assert.equal(ctx.findVoiceTrigger(text).team,'light',text);
  for(const text of ['but foncés','but des foncés','but pour les foncés','ajoute un but foncé'])assert.equal(ctx.findVoiceTrigger(text).team,'dark',text);
  assert.equal(ctx.findVoiceTrigger('ajouter un but').team,null);
  assert.equal(ctx.findVoiceTrigger('Marc pâles'),null);
});
test('but pâles resolves identical first names only among the pale lineup',()=>{
  const {ctx}=teams();
  const parsed=ctx.parseVoiceGoalDetails('but pâles Jonathan passe Marc-André et Alex');
  assert.equal(parsed.ok,true);assert.equal(parsed.team,'light');assert.equal(parsed.scorerId,'jon');assert.deepEqual(ids(parsed),['marc1','alex']);
});
test('but foncés resolves the same spoken names to the dark lineup IDs',()=>{
  const {ctx}=teams();
  const parsed=ctx.parseVoiceGoalDetails('but foncés Jonathan passe Marc et Alex');
  assert.equal(parsed.ok,true);assert.equal(parsed.team,'dark');assert.equal(parsed.scorerId,'jonDark');assert.deepEqual(ids(parsed),['marc2','alexDark']);
});
test('identical names within the announced team still require clarification',()=>{
  const {ctx,state}=teams();state.assignments.set('marc2',{team:'light'});
  const parsed=ctx.parseVoiceGoalDetails('but pâles Jonathan passe Marc-André et Alex');
  assert.equal(parsed.ok,false);assert.match(parsed.message,/ambigu/);assert.match(parsed.message,/Pâles/);
});
test('players on the opposing side cannot be credited to the announced team',()=>{
  const {ctx}=teams();
  const parsed=ctx.parseVoiceGoalDetails('but pâles Jonathan passe Dubé et Roy');
  assert.equal(parsed.ok,false);assert.match(parsed.message,/dube/);assert.match(parsed.message,/Pâles/);
});
test('the lab uses independent fictitious lineups and shows the simulated team',async()=>{
  const {ctx,voiceTest}=teams();
  await ctx.processVoiceTestAlternatives(['but pâles Jonathan passe Marc et Alex']);
  assert.equal(voiceTest.results[0].ok,true);assert.match(voiceTest.results[0].summary,/Pâles/);
  assert.match(voiceTest.results[0].summary,/Marc-André Tremblay et Alex Roy/);
  assert.equal(voiceTest.team,null);assert.equal(voiceTest.enabled,true);
});
test('lab lineups work without a match and never follow real assignments',()=>{
  const {ctx,state,voiceTest}=teams();state.currentMatch=null;state.assignments.clear();
  assert.equal(ctx.parseVoiceTestDetails('but pâles Jonathan').scorerId,'jon');
  assert.equal(ctx.parseVoiceTestDetails('but foncés Jonathan').scorerId,'jonDark');
  voiceTest.lineup.jon='dark';
  assert.equal(ctx.parseVoiceTestDetails('but pâles Jonathan').ok,false);
  assert.equal(state.assignments.size,0);
});
test('the team trigger and the later names share one pending goal and do not write early',async()=>{
  const {ctx,voice,committed}=teams();voice.phase='idle';
  await ctx.handleVoiceRecognitionResult(recognitionEvent('but pâles'));
  assert.equal(voice.captured.team,'light');assert.equal(committed.length,0);
  await ctx.handleVoiceRecognitionResult(recognitionEvent('Jonathan passe Marc et Alex',true,1));
  assert.equal(committed.length,0);
  await ctx.processVoiceGoalAlternatives([ctx.getVoiceDetailText(voice)]);
  assert.equal(committed.length,1);assert.equal(committed[0].team,'light');assert.deepEqual(ids(committed[0]),['marc1','alex']);
});
test('an interim generic trigger can become a pale final command without a second beep or capture',async()=>{
  const {ctx,voice,beeps}=teams();voice.phase='idle';
  await ctx.handleVoiceRecognitionResult(recognitionEvent('ajouter un but',false));
  assert.equal(voice.captured.team,null);
  ctx.getRemainingSeconds=()=>450;
  await ctx.handleVoiceRecognitionResult(recognitionEvent('ajouter un but pâles Jonathan passe Marc et Alex',true));
  assert.equal(voice.captured.team,'light');assert.equal(voice.captured.clockRemainingSeconds,600);
  assert.deepEqual(beeps,['trigger']);
  const parsed=ctx.parseVoiceGoalDetails(ctx.getVoiceDetailText(voice));
  assert.equal(parsed.ok,true);assert.equal(parsed.team,'light');
});
test('a final team correction clears stale details without changing the goal time',async()=>{
  const {ctx,voice}=teams();voice.phase='idle';
  await ctx.handleVoiceRecognitionResult(recognitionEvent('but pâles',false));
  voice.detailSegments={9:'stale pale details'};
  await ctx.handleVoiceRecognitionResult(recognitionEvent('but foncés Jonathan passe Marc et Alex',true));
  assert.equal(voice.captured.team,'dark');assert.equal(voice.captured.clockRemainingSeconds,600);
  assert.doesNotMatch(ctx.getVoiceDetailText(voice),/stale/);
  assert.equal(ctx.parseVoiceGoalDetails(ctx.getVoiceDetailText(voice)).scorerId,'jonDark');
});
test('the lab keeps team context between trigger and names and clears it for the next goal',async()=>{
  const {ctx,voiceTest}=teams();voiceTest.phase='idle';
  await ctx.handleVoiceTestRecognitionResult(recognitionEvent('but pâles'));
  await ctx.handleVoiceTestRecognitionResult(recognitionEvent('Jonathan passe Marc et Alex',true,1));
  assert.equal(voiceTest.team,'light');
  await ctx.processVoiceTestAlternatives([ctx.getVoiceDetailText(voiceTest)]);
  assert.match(voiceTest.results[0].summary,/Marc-André Tremblay/);assert.equal(voiceTest.team,null);
  await ctx.handleVoiceTestRecognitionResult(recognitionEvent('but foncés Jonathan passe Marc et Alex'));
  await ctx.processVoiceTestAlternatives([ctx.getVoiceDetailText(voiceTest)]);
  assert.match(voiceTest.results[0].summary,/Marc-André Dubé/);assert.match(voiceTest.results[0].summary,/Foncés/);
});
test('actual goal persistence updates only the announced scoreboard side after all names validate',async()=>{
  const {ctx,state,voice}=teams();state.goals=[];state.user={uid:'test'};state.leagueId='league';
  const saved=[];
  ctx.serverTimestamp=()=>0;ctx.collection=()=> 'goals';ctx.addDoc=async(ref,data)=>{saved.push(data);state.goals.push(data);};
  const start=source.indexOf('async function commitVoiceGoal(');
  vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),ctx);
  vm.runInContext(source.match(/^function getScore\(.*$/m)[0],ctx);
  ctx.captureVoiceGoalMoment('light');
  assert.equal(ctx.getScore().light,0);assert.equal(ctx.getScore().dark,0);
  await ctx.commitVoiceGoal({team:'dark',scorerId:'jonDark',assists:['marc2']});
  assert.equal(saved.length,0);assert.equal(ctx.getScore().light,0);assert.equal(ctx.getScore().dark,0);
  await ctx.processVoiceGoalAlternatives(['Jonathan passe Marc et Alex']);
  assert.equal(saved.length,1);assert.equal(ctx.getScore().light,1);assert.equal(ctx.getScore().dark,0);
  assert.equal(saved[0].scorerId,'jon');assert.deepEqual(ids(saved[0]),['marc1','alex']);
  ctx.captureVoiceGoalMoment('dark');
  await ctx.processVoiceGoalAlternatives(['Jonathan passe Marc et Alex']);
  assert.equal(saved.length,2);assert.equal(ctx.getScore().light,1);assert.equal(ctx.getScore().dark,1);
  assert.equal(saved[1].scorerId,'jonDark');assert.deepEqual(ids(saved[1]),['marc2','alexDark']);
});

const will={id:'will',firstName:'Will',lastName:'Dupuis'};
const dupont={id:'dupont',firstName:'Marc-André',lastName:'Dupont'};
test('reported transcription proposes full anchored name and tolerates assisté dans',()=>{
  const {ctx}=setup([will,dupont]);
  const parsed=ctx.parseVoiceTestDetails('wild dupuis assiste dans marc andre dupont');
  assert.equal(parsed.ok,true);assert.equal(parsed.scorerId,'will');assert.deepEqual(ids(parsed),['dupont']);
  assert.equal(parsed.requiresConfirmation,true);
});
test('a fuzzy standalone first name is never guessed',()=>{
  const {ctx}=setup([will,dupont]);
  assert.equal(ctx.parseVoiceTestDetails('wild passe dupont').ok,false);
});
test('nearby full names remain ambiguous',()=>{
  const {ctx}=setup([will,{id:'willy',firstName:'Willy',lastName:'Dupuis'},dupont]);
  assert.match(ctx.parseVoiceTestDetails('wild dupuis passe dupont').message,/ambigu/);
});
test('a correction in lab waits for yes before marking simulation successful',async()=>{
  const {ctx,voiceTest}=setup([will,dupont]);
  await ctx.processVoiceTestAlternatives(['wild dupuis assiste dans marc andre dupont']);
  assert.equal(voiceTest.results.length,0);assert.ok(voiceTest.pendingProposal);
  await ctx.processVoiceTestAlternatives(['oui']);
  assert.equal(voiceTest.results.length,1);assert.equal(voiceTest.results[0].ok,true);
  assert.match(voiceTest.results[0].summary,/Will Dupuis/);
});
test('a correction in a real match never writes before confirmation',async()=>{
  const {ctx,voice,committed}=setup([will,dupont]);voice.captured={team:'dark'};
  await ctx.processVoiceGoalAlternatives(['wild dupuis assiste dans marc andre dupont']);
  assert.equal(committed.length,0);assert.ok(voice.pendingProposal);
  await ctx.processVoiceGoalAlternatives(['oui']);
  assert.equal(committed.length,1);assert.equal(committed[0].scorerId,'will');
});
test('no cancels the correction without recording anything',async()=>{
  const {ctx,voiceTest,committed}=setup([will,dupont]);
  await ctx.processVoiceTestAlternatives(['wild dupuis passe dupont']);
  await ctx.processVoiceTestAlternatives(['non']);
  assert.equal(voiceTest.pendingProposal,null);assert.equal(voiceTest.results.length,0);assert.equal(committed.length,0);
});
test('automatic lab teams include every player exactly once and reset between leagues',()=>{
  const {ctx,state,voiceTest}=setup();state.currentMatch=null;
  const light=ctx.voiceTestLineupPlayers('light'),dark=ctx.voiceTestLineupPlayers('dark');
  assert.equal(light.length+dark.length,4);assert.equal(new Set([...light,...dark].map(p=>p.id)).size,4);
  voiceTest.lineup.jon='dark';state.leagueId='another-league';ctx.voiceTestLineupPlayers();
  assert.equal(voiceTest.lineupLeagueId,'another-league');assert.equal(state.assignments.size,4);
});

test('the same general correction also handles misspelled surnames',()=>{
 const {ctx}=setup([jon,alex]);
 const parsed=ctx.parseVoiceTestDetails('Jonathan Varinn passe Alex Roy');
 assert.equal(parsed.ok,true);assert.equal(parsed.requiresConfirmation,true);assert.equal(parsed.scorerId,'jon');
});
test('lab aliases are scoped to the lab and respect the announced team',()=>{
 const {ctx,voiceTest}=teams();ctx.voiceTestLineupPlayers();voiceTest.aliases={jon:['Jojo']};
 assert.equal(ctx.parseVoiceTestDetails('but pâles Jojo').scorerId,'jon');
 assert.equal(ctx.parseVoiceTestDetails('but foncés Jojo').ok,false);
 assert.equal(ctx.parseVoiceGoalDetails('but pâles Jojo').ok,false);
});

test('lab infers the fictitious side without a color and rejects mixed teams',()=>{
 const {ctx}=teams();
 assert.equal(ctx.parseVoiceTestDetails('Jonathan Varin passe Alex Roy').team,'light');
 assert.equal(ctx.parseVoiceTestDetails('Jonathan Varin passe Marc-André Dubé').ok,false);
});
test('a delayed yes cannot confirm a changed lab roster',async()=>{
 const {ctx,voiceTest}=setup([will,dupont]);
 await ctx.processVoiceTestAlternatives(['wild dupuis passe dupont']);
 voiceTest.lineup.dupont='light';
 await ctx.processVoiceTestAlternatives(['oui']);
 assert.equal(voiceTest.results.length,0);assert.equal(voiceTest.pendingProposal,null);
});

test('vocabulary carries complete roster names, aliases and scoring phrases',()=>{
 const {ctx}=setup();
 const hints=ctx.voiceRecognitionVocabulary([{...jon,voiceAliases:['Jojo']}]);
 for (const phrase of ['Jonathan Varin','Jojo','oui','non','but Jonathan Varin','assisté de Jonathan Varin']) assert.ok(hints.includes(phrase));
 assert.ok(!hints.includes('Alex Roy'));assert.ok(hints.length<=200);
});
test('recognition events preserve a pending correction until the spoken yes arrives',async()=>{
 const {ctx,voiceTest}=setup([will,dupont]);voiceTest.team='dark';
 await ctx.handleVoiceTestRecognitionResult(recognitionEvent('wild dupuis assiste dans marc andre dupont'));
 await ctx.processVoiceTestAlternatives([ctx.getVoiceDetailText(voiceTest)]);
 assert.ok(voiceTest.pendingProposal);assert.equal(ctx.getVoiceDetailText(voiceTest),'');
 await ctx.handleVoiceTestRecognitionResult(recognitionEvent('oui',true,1));
 await ctx.processVoiceTestAlternatives([ctx.getVoiceDetailText(voiceTest)]);
 assert.equal(voiceTest.results.length,1);assert.equal(voiceTest.results[0].ok,true);assert.equal(voiceTest.enabled,true);
});
