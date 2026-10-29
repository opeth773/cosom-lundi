const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const messages = [];
  const window = new EventTarget();
  window.CosomNative = {postMessage: data => messages.push(JSON.parse(data))};
  const context = vm.createContext({window, navigator: {}, EventTarget, Event, DOMException, Map, Promise, Error});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/android-bridge.js'), 'utf8'), context);
  return {window, messages, context};
}

test('speech keeps interim and final segments at stable Web Speech result indexes', () => {
  const {window, messages} = setup();
  const recognition = new window.SpeechRecognition();
  recognition.interimResults = true;
  recognition.continuous = true;
  const results = [];
  recognition.onresult = e => results.push(e);
  recognition.start();
  const id = messages[0].id;
  assert.equal(messages[0].lang, 'fr-CA');
  for (const [text, final] of [['Ajouter', false], ['Ajouter un but', true], ['Jean', false], ['Jean passe Marc', true]]) {
    window.CosomAndroid._event({channel:'speech', id, type:'result', alternatives:[text], final});
  }
  assert.deepEqual(results.map(e=>e.resultIndex), [0, 0, 1, 1]);
  assert.equal(results[3].results[0][0].transcript, 'Ajouter un but');
  assert.equal(results[3].results[1][0].transcript, 'Jean passe Marc');
  assert.equal(results[3].results[1].isFinal, true);
});

test('aborting drops delayed results and ends exactly once', () => {
  const {window, messages} = setup();
  const recognition = new window.SpeechRecognition();
  let goals = 0, ends = 0;
  recognition.onresult = () => goals++;
  recognition.onend = () => ends++;
  recognition.start();
  const id = messages[0].id;
  assert.throws(()=>recognition.start(), {name:'InvalidStateError'});
  recognition.abort();
  window.CosomAndroid._event({channel:'speech', id, type:'result', alternatives:['Ajouter un but'], final:true});
  window.CosomAndroid._event({channel:'speech', id, type:'end'});
  assert.equal(goals, 0);
  assert.equal(ends, 1);
  recognition.start();
  assert.notEqual(messages.at(-1).id, id);
});

test('permission failures retain the Web Speech error contract', () => {
  const {window, messages} = setup();
  const recognition = new window.SpeechRecognition();
  let code;
  recognition.onerror = e => { code=e.error; };
  recognition.start();
  window.CosomAndroid._event({channel:'speech',id:messages[0].id,type:'error',error:'not-allowed'});
  assert.equal(code, 'not-allowed');
});

test('Google tokens resolve only the matching native login request', async () => {
  const {window, messages} = setup();
  const login = window.CosomAndroid.signInGoogle();
  assert.equal(messages[0].action, 'googleSignIn');
  window.CosomAndroid._event({id:'unrelated',value:'ignored'});
  window.CosomAndroid._event({id:messages[0].id,value:'test-id-token'});
  assert.equal(await login, 'test-id-token');
  const rejected = window.CosomAndroid.signInGoogle();
  window.CosomAndroid._event({id:messages[1].id,error:'Connexion annulée'});
  await assert.rejects(rejected, /Connexion annulée/);
});

test('native export passes the original JSON and receives save confirmation', async () => {
  const {window, messages} = setup();
  const saved = window.CosomAndroid.saveFile('cosom.json', '{"matches":[]}', 'application/json');
  assert.equal(messages[0].text, '{"matches":[]}');
  window.CosomAndroid._event({id:messages[0].id,value:true});
  assert.equal(await saved, true);
});

test('background transition dispatches lifecycle event and releases native screen lock', async () => {
  const {window, messages, context} = setup();
  const lock = await context.navigator.wakeLock.request('screen');
  let paused = false;
  window.addEventListener('cosom:native-pause', () => { paused=true; });
  window.CosomAndroid._event({channel:'lifecycle'});
  assert.equal(paused, true);
  assert.equal(lock.released, true);
  assert.equal(messages.at(-1).enabled, false);
});

test('Android-only adapter has no effect in a normal browser', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/android-bridge.js'), 'utf8'), {window});
  assert.equal(window.CosomAndroid, undefined);
  assert.equal(window.SpeechRecognition, undefined);
});

test('Android project never references the PWA directory as a build input', () => {
  const gradle = fs.readFileSync(path.join(__dirname, '../app/build.gradle.kts'), 'utf8');
  assert.match(gradle, /assets.srcDir\("\.\.\/web"\)/);
  assert.doesNotMatch(gradle, /public\//);
});

test('lab does not restart a recorder when an unexpected end is reported', async () => {
  const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
  const start=source.indexOf('async function startVoiceTest()');
  const code=source.slice(start,source.indexOf('\nfunction startVoiceTestRecognition',start));
  let starts=0;
  const voiceTest={enabled:false,recognition:null};
  const ctx=vm.createContext({window:{CosomAndroid:{}},voiceTest,voice:{enabled:false},
    voiceTestLineupPlayers:()=>[{}],voiceRecognitionVocabulary:()=>['Marc'],isAdmin:()=>true,activePlayers:()=>[{}],playerName:()=> 'Marc',unlockAudio:async()=>{},resetVoiceDetailCollector:()=>{},
    setVoiceTestStatus:()=>{},render:()=>{},SpeechRecognitionCtor:function(){},
    startVoiceTestRecognition:()=>starts++,
    stopVoiceTest:()=>{voiceTest.enabled=false;}});
  vm.runInContext(code,ctx);
  await ctx.startVoiceTest();
  for(let i=0;i<10;i++)voiceTest.recognition.onend();
  assert.equal(starts,1);
  assert.equal(voiceTest.enabled,true);
  assert.equal(voiceTest.pauseAfterResult,false);
});

function labContext(parsed) {
  const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
  const voiceTest={enabled:true,phase:'details',pauseAfterResult:false,results:[],running:true,
    recognition:{abort(){throw new Error('Microphone must stay open');}}};
  const ctx=vm.createContext({voiceTest,Date,normalizeSpeechText:s=>s.toLowerCase(),clearTimeout:()=>{},resetVoiceDetailCollector:()=>{},
    parseVoiceTestDetails:()=>parsed,updateVoiceTestHeard:()=>{},setVoiceTestStatus:()=>{},
    voiceBeep:()=>{},render:()=>{},playerName:p=>p?.name||'',findPlayer:()=>({name:'Marc'})});
  const a=source.indexOf('async function processVoiceTestAlternatives(');
  vm.runInContext(source.slice(a,source.indexOf('\nfunction parseVoiceTestDetails',a)),ctx);
  return {ctx,voiceTest,source};
}

test('successful simulations keep listening, including repeated goals', async () => {
  const {ctx,voiceTest}=labContext({ok:true,scorer:{name:'Marc'},assists:[],confidence:1});
  for(let i=0;i<20;i++) {
    voiceTest.phase='details';
    await ctx.processVoiceTestAlternatives(['Marc sans aide']);
    assert.equal(voiceTest.pauseAfterResult,false);
    assert.equal(voiceTest.enabled,true);
    assert.equal(voiceTest.running,true);
  }
});
test('unrecognized player does not close the microphone', async () => {
  const {ctx,voiceTest}=labContext({ok:false,message:'Joueur non reconnu'});
  await ctx.processVoiceTestAlternatives(['un nom inconnu']);
  assert.equal(voiceTest.pauseAfterResult,false);
  assert.equal(voiceTest.enabled,true);
  assert.equal(voiceTest.phase,'idle');
});
test('waiting for goal details installs no inactivity timeout', () => {
  const {ctx,voiceTest,source}=labContext({});
  const a=source.indexOf('function restartVoiceTestDetailTimeout()');
  vm.runInContext(source.slice(a,source.indexOf('\nfunction isVoiceTestStopCommand',a)),ctx);
  voiceTest.detailTimer=99;
  ctx.restartVoiceTestDetailTimeout();
  assert.equal(voiceTest.detailTimer,null);
});
test('spoken stop commands are explicit and do not match scoring phrases', () => {
  const {ctx,source}=labContext({});
  for(const name of ['normalizeSpeechText','isVoiceTestStopCommand']) {
    const a=source.indexOf('function '+name+'(');
    const b=source.indexOf('\n}',a)+2;
    vm.runInContext(source.slice(a,b),ctx);
  }
  for(const text of ['arrête le test','arrêter le micro',"arrête l’écoute",'stop le test'])assert.equal(ctx.isVoiceTestStopCommand(text),true,text);
  for(const text of ['ajouter un but','Marc sans aide','arrêt du gardien'])assert.equal(ctx.isVoiceTestStopCommand(text),false,text);
});

test('Google Canadian French mode is explicit, persisted and carries actual player hints', () => {
  const {window,messages}=setup();
  const stored=new Map();
  window.localStorage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
  assert.equal(window.CosomAndroid.getSpeechEngine(),'offline-fr');
  window.CosomAndroid.capabilities.googleStreaming=true;
  window.CosomAndroid.setSpeechEngine('google-fr-ca');
  const recognizer=new window.SpeechRecognition();
  recognizer.vocabulary=['Jean-François Tremblay','Éric Gagnon'];
  recognizer.start();
  assert.equal(messages[0].engine,'google-fr-ca');
  assert.deepEqual(messages[0].vocabulary,['Jean-François Tremblay','Éric Gagnon']);
  assert.equal(messages[0].lang,'fr-CA');
  window.CosomAndroid.capabilities.googleStreaming=false;
  assert.equal(window.CosomAndroid.getSpeechEngine(),'offline-fr');
});
