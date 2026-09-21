import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, Timestamp, onSnapshot, query, orderBy, runTransaction
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const root = document.getElementById('app');
const modal = document.getElementById('modal');
const toastEl = document.getElementById('toast');
const DEVICE_ID = getDeviceId();

const state = {
  firebaseReady: false,
  auth: null,
  db: null,
  firebaseApp: null,
  user: null,
  userProfile: null,
  leagueId: null,
  league: null,
  member: null,
  members: [],
  players: [],
  matches: [],
  matchesLoaded: false,
  selectedMatchId: null,
  currentMatch: null,
  assignments: new Map(),
  responses: new Map(),
  goals: [],
  tab: 'match',
  playerTab: 'regular',
  stats: null,
  statsLoading: false,
  leagueUnsubs: [],
  matchUnsubs: [],
  clockZeroHandled: false,
  authMode: 'login',
  scheduleEnsuredKey: null
};

let toastTimer = null;
let clockTimer = null;
let audioCtx = null;
let wakeLock = null;

boot();

async function boot() {
  registerShellServiceWorker();
  renderBoot('Connexion à Firebase…');
  try {
    const configResponse = await fetch('/__/firebase/init.json', {cache: 'no-store'});
    if (!configResponse.ok) throw new Error('Configuration Firebase introuvable.');
    const firebaseConfig = await configResponse.json();
    state.firebaseApp = initializeApp(firebaseConfig);
    state.auth = getAuth(state.firebaseApp);
    state.db = getFirestore(state.firebaseApp);
    await setPersistence(state.auth, browserLocalPersistence);
    state.firebaseReady = true;
    onAuthStateChanged(state.auth, handleAuthChange);
    clockTimer = setInterval(updateClockDisplay, 250);
  } catch (error) {
    console.error(error);
    renderSetupNeeded();
  }
}

async function registerShellServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.warn('SW', e); }
}

async function handleAuthChange(user) {
  clearSubscriptions();
  state.user = user;
  state.userProfile = null;
  state.leagueId = null;
  state.league = null;
  state.member = null;
  state.players = [];
  state.matches = [];
  state.matchesLoaded = false;
  state.currentMatch = null;
  state.assignments = new Map();
  state.responses = new Map();
  state.goals = [];
  state.stats = null;
  if (!user) return renderAuth();
  try {
    const userRef = doc(state.db, 'users', user.uid);
    const profileSnap = await getDoc(userRef);
    if (profileSnap.exists()) state.userProfile = profileSnap.data();
    else {
      const profile = {
        displayName: user.displayName || user.email?.split('@')[0] || 'Joueur',
        email: user.email || null,
        photoURL: user.photoURL || null,
        createdAt: serverTimestamp()
      };
      await setDoc(userRef, profile, {merge:true});
      state.userProfile = profile;
    }
    const memberships = await getDocs(collection(state.db, 'users', user.uid, 'leagues'));
    const leagueIds = memberships.docs.map(d => d.id);
    if (leagueIds.length === 1) return selectLeague(leagueIds[0]);
    return renderLeagueChooser(leagueIds);
  } catch (e) {
    handleError(e);
  }
}

function clearSubscriptions() {
  [...state.leagueUnsubs, ...state.matchUnsubs].forEach(fn => { try { fn(); } catch {} });
  state.leagueUnsubs = [];
  state.matchUnsubs = [];
}

function clearMatchSubscriptions() {
  state.matchUnsubs.forEach(fn => { try { fn(); } catch {} });
  state.matchUnsubs = [];
}

async function selectLeague(leagueId) {
  clearSubscriptions();
  state.leagueId = leagueId;
  state.selectedMatchId = null;
  state.currentMatch = null;
  state.matchesLoaded = false;
  state.assignments = new Map();
  state.responses = new Map();
  state.goals = [];
  state.stats = null;
  state.tab = 'match';
  state.scheduleEnsuredKey = null;
  renderBoot('Chargement de la ligue…');

  const leagueRef = doc(state.db, 'leagues', leagueId);
  const memberRef = doc(state.db, 'leagues', leagueId, 'members', state.user.uid);
  state.leagueUnsubs.push(onSnapshot(leagueRef, snap => {
    if (!snap.exists()) return leaveLeagueLocally();
    state.league = {id: snap.id, ...snap.data()};
    if (isAdmin()) queueMicrotask(() => ensureMondaySchedule().catch(handleError));
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(memberRef, snap => {
    state.member = snap.exists() ? {id: snap.id, ...snap.data()} : null;
    if (isAdmin()) queueMicrotask(() => ensureMondaySchedule().catch(handleError));
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(query(collection(state.db, 'leagues', leagueId, 'players'), orderBy('lastName')), snap => {
    state.players = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(collection(state.db, 'leagues', leagueId, 'members'), snap => {
    state.members = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(query(collection(state.db, 'leagues', leagueId, 'matches'), orderBy('startAt', 'desc')), snap => {
    state.matches = snap.docs.map(d => ({id:d.id, ...d.data()}));
    state.matchesLoaded = true;
    if (isAdmin()) queueMicrotask(() => ensureMondaySchedule().catch(handleError));
    const wanted = chooseDefaultMatch();
    if (wanted && wanted !== state.selectedMatchId) selectMatch(wanted);
    if (!wanted) {
      state.selectedMatchId = null;
      state.currentMatch = null;
      clearMatchSubscriptions();
    }
    render();
  }, handleError));
}

function chooseDefaultMatch() {
  if (state.selectedMatchId && state.matches.some(m => m.id === state.selectedMatchId)) return state.selectedMatchId;
  const live = state.matches.find(m => m.status === 'live');
  if (live) return live.id;
  const now = Date.now();
  const upcoming = [...state.matches]
    .filter(m => m.status !== 'final' && tsMillis(m.startAt) >= now - 12*3600e3)
    .sort((a,b) => tsMillis(a.startAt) - tsMillis(b.startAt))[0];
  return upcoming?.id || state.matches[0]?.id || null;
}

function selectMatch(matchId) {
  clearMatchSubscriptions();
  state.selectedMatchId = matchId;
  state.currentMatch = null;
  state.assignments = new Map();
  state.responses = new Map();
  state.goals = [];
  state.clockZeroHandled = false;
  const base = ['leagues', state.leagueId, 'matches', matchId];
  state.matchUnsubs.push(onSnapshot(doc(state.db, ...base), snap => {
    state.currentMatch = snap.exists() ? {id:snap.id, ...snap.data()} : null;
    if (state.currentMatch?.clock?.running && getRemainingSeconds(state.currentMatch) > 0) state.clockZeroHandled = false;
    render();
  }, handleError));
  state.matchUnsubs.push(onSnapshot(collection(state.db, ...base, 'assignments'), snap => {
    state.assignments = new Map(snap.docs.map(d => [d.id, {id:d.id, ...d.data()}]));
    render();
  }, handleError));
  state.matchUnsubs.push(onSnapshot(collection(state.db, ...base, 'responses'), snap => {
    state.responses = new Map(snap.docs.map(d => [d.id, {id:d.id, ...d.data()}]));
    render();
  }, handleError));
  state.matchUnsubs.push(onSnapshot(query(collection(state.db, ...base, 'goals'), orderBy('createdAt', 'asc')), snap => {
    state.goals = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, handleError));
}

function render() {
  if (!state.user) return renderAuth();
  if (!state.leagueId) return;
  if (!state.league || !state.member) return renderBoot('Chargement…');
  root.innerHTML = `
    <div class="shell">
      <header class="header">
        <div class="header-row">
          <div class="grow">
            <div class="logo">Ligue cosom du lundi</div>
            <div class="header-meta">${esc(state.league.name || 'La ligue')} · ${esc(state.league.season || '')}</div>
          </div>
          <div class="header-actions">
            <button class="btn small" data-action="switch-league" title="Changer de ligue">⇄</button>
            <button class="btn small ghost" data-action="logout" title="Déconnexion">Sortir</button>
          </div>
        </div>
      </header>
      <main class="page">${renderCurrentTab()}</main>
      <nav class="bottom-nav" aria-label="Navigation principale">
        ${navButton('match','🏒','Match')}
        ${navButton('calendar','▦','Calendrier')}
        ${navButton('players','👥','Joueurs')}
        ${navButton('stats','▥','Stats')}
        ${navButton('settings','⚙','Réglages')}
      </nav>
    </div>`;
  requestAnimationFrame(updateClockDisplay);
}

function navButton(tab, icon, label) {
  return `<button data-tab="${tab}" class="${state.tab===tab?'active':''}"><span class="ico">${icon}</span>${label}</button>`;
}

function renderCurrentTab() {
  switch (state.tab) {
    case 'calendar': return renderCalendar();
    case 'players': return renderPlayers();
    case 'stats': return renderStats();
    case 'settings': return renderSettings();
    default: return renderMatch();
  }
}

function renderMatch() {
  const admin = isAdmin();
  const current = state.currentMatch;
  const selector = renderMatchSelector();
  if (!current) {
    return `${selector}<div class="card empty"><h2>Aucun match</h2><p>Crée ton premier match quand la date est connue.</p>${admin?'<button class="btn primary" data-action="new-match">Créer un match</button>':''}</div>`;
  }
  const score = getScore();
  const periodCount = current.periodCount || state.league.settings?.periodCount || 3;
  const remaining = getRemainingSeconds(current);
  const canClear = !current.startedAt && state.goals.length === 0 && state.assignments.size > 0;
  const alarmMine = current.alarmDeviceId === DEVICE_ID;
  const alarmText = alarmMine ? 'Alarme sur cet appareil' : current.alarmDeviceName ? `Alarme: ${esc(current.alarmDeviceName)}` : 'Aucune alarme assignée';
  const periodRows = Array.from({length:periodCount}, (_,i) => {
    const p = i+1;
    const d = state.goals.filter(g=>g.period===p && g.team==='dark').length;
    const l = state.goals.filter(g=>g.period===p && g.team==='light').length;
    return {p,d,l};
  });
  return `
    ${selector}
    <div class="card">
      <div class="row between">
        <div><h2 style="margin:0">${formatDate(current.startAt)}</h2><div class="muted">${formatTime(current.startAt)}${current.location?' · '+esc(current.location):''}</div></div>
        <span class="pill ${current.status==='live'?'live':''}">${current.status==='final'?'Final':current.status==='live'?'En cours':'À venir'}</span>
      </div>
    </div>
    <section class="scoreboard">
      <div class="score-grid">
        <div><div class="team-name">FONCÉS</div><div class="score-num">${score.dark}</div></div>
        <div><div class="team-name">PÂLES</div><div class="score-num">${score.light}</div></div>
      </div>
      <div id="clockText" class="clock">${formatClock(remaining)}</div>
      <div class="period-label">Période ${Math.min(current.period||1,periodCount)} / ${periodCount}</div>
      ${current.status!=='final' ? `
        <div class="grid2" style="margin-top:10px">
          <button class="btn primary" data-action="toggle-clock">${current.clock?.running?'Pause':'Démarrer'}</button>
          <button class="btn" data-action="reset-clock">Réinitialiser chrono</button>
        </div>
        <div class="grid2" style="margin-top:7px">
          <button class="btn" data-action="claim-alarm">${alarmMine?'✓ Alarme active':'Prendre l’alarme'}</button>
          ${current.period < periodCount ? '<button class="btn" data-action="next-period">Période suivante</button>' : '<button class="btn" data-action="finalize-match">Terminer le match</button>'}
        </div>
        <div class="center tiny" style="margin-top:8px">${alarmText}</div>
      ` : ''}
    </section>
    ${current.status!=='final' ? `
      <div class="grid2">
        <button class="btn goalbtn" data-action="new-goal" data-team="dark"><strong>+ But Foncés</strong></button>
        <button class="btn goalbtn" data-action="new-goal" data-team="light"><strong>+ But Pâles</strong></button>
      </div>` : ''}
    <div class="card">
      <div class="row between"><h3 style="margin:0">Alignements</h3>${canClear?'<button class="btn small ghost" data-action="clear-teams">Vider les équipes</button>':''}</div>
      ${renderAssignmentGroup('Joueurs réguliers','regular')}
      ${renderAssignmentGroup('Gardiens','goalie')}
      ${renderAssignmentGroup('Remplaçants','sub')}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Résultat par période</h3>
      <table><thead><tr><th>Équipe</th>${periodRows.map(x=>`<th>P${x.p}</th>`).join('')}<th>TOT</th></tr></thead>
      <tbody><tr><td>Foncés</td>${periodRows.map(x=>`<td>${x.d}</td>`).join('')}<td><strong>${score.dark}</strong></td></tr>
      <tr><td>Pâles</td>${periodRows.map(x=>`<td>${x.l}</td>`).join('')}<td><strong>${score.light}</strong></td></tr></tbody></table>
    </div>
    <div class="card"><h3 style="margin-top:0">Buts</h3>${renderGoals()}</div>
  `;
}

function renderMatchSelector() {
  const opts = state.matches.map(m => `<option value="${m.id}" ${m.id===state.selectedMatchId?'selected':''}>${formatDate(m.startAt)} · ${m.status==='final'?'Final':m.status==='live'?'En cours':'À venir'}</option>`).join('');
  return `<div class="card"><div class="row"><div class="grow"><select aria-label="Choisir le match" data-change="select-match"><option value="">${state.matches.length?'Choisir…':'Aucun match'}</option>${opts}</select></div>${isAdmin()?'<button class="btn primary" data-action="new-match">+ Match</button>':''}</div></div>`;
}

function renderAssignmentGroup(title, type) {
  const players = activePlayers().filter(p => p.type === type);
  if (!players.length) return '';
  return `<h3>${title}</h3>${players.map(p => {
    const team = state.assignments.get(p.id)?.team || 'absent';
    const locked = state.currentMatch?.status === 'final' ? 'disabled' : '';
    return `<div class="assignment-row">
      <div><div class="person-name">${playerName(p)}</div><div class="person-meta">${type==='sub'?'Remplaçant':type==='goalie'?'Gardien':'Régulier'}</div></div>
      <div class="assign-buttons">
        <button ${locked} data-action="assign" data-player="${p.id}" data-team="dark" class="${team==='dark'?'on-dark':''}" title="Foncés">F</button>
        <button ${locked} data-action="assign" data-player="${p.id}" data-team="light" class="${team==='light'?'on-light':''}" title="Pâles">P</button>
        <button ${locked} data-action="assign" data-player="${p.id}" data-team="absent" class="${team==='absent'?'on-absent':''}" title="Absent / non appelé">—</button>
      </div>
    </div>`;
  }).join('')}`;
}

function renderGoals() {
  if (!state.goals.length) return '<div class="empty">Aucun but inscrit.</div>';
  const sorted = [...state.goals].sort((a,b) => (a.period-b.period) || (a.elapsedSeconds-b.elapsedSeconds));
  return sorted.map(g => {
    const scorer = findPlayer(g.scorerId);
    const assists = (g.assists||[]).map(id=>playerName(findPlayer(id))).filter(Boolean).join(' · ') || 'Sans aide';
    return `<div class="goal-row">
      <div class="goal-time">P${g.period}<br>${formatClock(g.elapsedSeconds||0)}</div>
      <div class="goal-main"><strong>${esc(playerName(scorer)||'Joueur archivé')}</strong><div class="goal-meta">${esc(assists)} · ${g.team==='dark'?'Foncés':'Pâles'}</div></div>
      ${state.currentMatch?.status!=='final'?`<div><button class="btn small ghost" data-action="edit-goal" data-goal="${g.id}">Modifier</button></div>`:''}
    </div>`;
  }).join('');
}

function renderCalendar() {
  const mine = state.member?.playerId ? findPlayer(state.member.playerId) : null;
  const today = startOfLocalDay(Date.now());
  const upcoming = [...state.matches]
    .filter(m => m.status !== 'final' && tsMillis(m.startAt) >= today)
    .sort((a,b) => tsMillis(a.startAt) - tsMillis(b.startAt));
  const groups = groupMatchesByMonth(upcoming);
  return `
    <div class="card">
      <div class="row between"><div><h2 style="margin:0">Calendrier</h2><div class="muted">La ligue joue tous les lundis. Tu peux répondre pour n’importe quel match futur.</div></div></div>
    </div>
    ${!mine?`<div class="notice alert">Ton compte n’est pas encore associé à un joueur. Va dans <strong>Joueurs</strong> et choisis « Mon compte correspond à » pour confirmer tes présences ou tes absences.</div>`:''}
    ${groups.length ? groups.map(([label,matches])=>`<div class="card calendar-month"><h3>${esc(label)}</h3>${matches.map(m=>renderCalendarRow(m,mine)).join('')}</div>`).join('') : '<div class="card empty">Aucun match futur au calendrier.</div>'}
    ${state.currentMatch && state.currentMatch.status!=='final' ? renderSelectedAttendanceDetails() : ''}`;
}

function renderCalendarRow(m, mine) {
  const summary = attendanceSummary(m);
  const mineStatus = mine ? getMatchResponseStatus(m, mine.id) : 'unknown';
  const mineLabel = mine?.type==='sub'
    ? ({yes:'Disponible',no:'Indispo',maybe:'Incertain',unknown:'Non répondu'}[mineStatus])
    : ({yes:'Présent',no:'Absent',maybe:'Incertain',unknown:'Non répondu'}[mineStatus]);
  return `<div class="calendar-row ${m.id===state.selectedMatchId?'selected-match':''}">
    <button class="calendar-main" data-action="calendar-match" data-match="${m.id}">
      <div class="calendar-date"><strong>${formatShortDate(m.startAt)}</strong><span>${formatTime(m.startAt)}${m.location?' · '+esc(m.location):''}</span></div>
      <div class="calendar-counts"><span class="pill live">${summary.yes} présent${summary.yes>1?'s':''}</span><span class="pill absent">${summary.no} absent${summary.no>1?'s':''}</span><span class="pill">${summary.maybe} incertain${summary.maybe>1?'s':''}</span><span class="pill">${summary.unknown} sans réponse</span></div>
      ${summary.yesNames.length?`<div class="calendar-names"><strong>Confirmés :</strong> ${esc(summary.yesNames.join(', '))}</div>`:''}
      ${summary.subYesNames.length?`<div class="calendar-names"><strong>Remplaçants dispo :</strong> ${esc(summary.subYesNames.join(', '))}</div>`:''}
    </button>
    ${mine?`<div class="calendar-my"><div class="tiny">Moi : <strong>${esc(mineLabel)}</strong></div>${renderCalendarResponseButtons(m,mine,mineStatus)}</div>`:''}
  </div>`;
}

function renderCalendarResponseButtons(match, player, status) {
  const sub = player.type === 'sub';
  return `<div class="calendar-response-buttons">
    <button class="btn small ${status==='yes'?'primary':''}" data-action="respond-match" data-match="${match.id}" data-player="${player.id}" data-status="yes">${sub?'Dispo':'Présent'}</button>
    <button class="btn small ${status==='maybe'?'warn':''}" data-action="respond-match" data-match="${match.id}" data-player="${player.id}" data-status="maybe">Incertain</button>
    <button class="btn small ${status==='no'?'danger':''}" data-action="respond-match" data-match="${match.id}" data-player="${player.id}" data-status="no">${sub?'Indispo':'Absent'}</button>
  </div>`;
}

function renderSelectedAttendanceDetails() {
  const m = state.currentMatch;
  if (!m) return '';
  const groups = [['Joueurs réguliers','regular'],['Gardiens','goalie'],['Remplaçants','sub']];
  return `<div class="card"><div class="row between"><div><h2 style="margin:0">${formatDate(m.startAt)}</h2><div class="muted">Détail des réponses</div></div><button class="btn small" data-action="open-match-tab">Ouvrir le match</button></div>
    <p class="muted">Les réponses servent à planifier. À la fin du match, les absences officielles restent calculées selon les joueurs réellement placés dans Foncés ou Pâles.</p>
    ${groups.map(([title,type])=>renderResponseGroup(title,type)).join('')}
  </div>`;
}

function renderResponseGroup(title,type) {
  const players = activePlayers().filter(p=>p.type===type);
  if (!players.length) return '';
  return `<h3>${title}</h3>${players.map(p=>{
    const r = state.responses.get(p.id)?.status || getMatchResponseStatus(state.currentMatch,p.id);
    const labels = type==='sub' ? {yes:'Disponible',no:'Indispo',maybe:'Incertain',unknown:'Non répondu'} : {yes:'Présent',no:'Absent',maybe:'Incertain',unknown:'Non répondu'};
    return `<div class="list-row"><div><div class="person-name">${playerName(p)}</div><div class="person-meta">${labels[r]}</div></div>${isAdmin()?renderResponseButtons(p,false):statusPill(r,labels[r])}</div>`;
  }).join('')}`;
}

function renderResponseButtons(player, large) {
  const r = state.responses.get(player.id)?.status || getMatchResponseStatus(state.currentMatch,player.id);
  const sub = player.type === 'sub';
  return `<div class="${large?'grid3':'row'}">
    <button class="btn ${r==='yes'?'primary':''} ${large?'wide':'small'}" data-action="respond" data-player="${player.id}" data-status="yes">${sub?'Disponible':'Présent'}</button>
    <button class="btn ${r==='maybe'?'warn':''} ${large?'wide':'small'}" data-action="respond" data-player="${player.id}" data-status="maybe">Incertain</button>
    <button class="btn ${r==='no'?'danger':''} ${large?'wide':'small'}" data-action="respond" data-player="${player.id}" data-status="no">${sub?'Indispo':'Absent'}</button>
  </div>`;
}

function statusPill(status,label) {
  const cls = status==='yes'?'live':status==='no'?'absent':'';
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function attendanceSummary(match) {
  const core = activePlayers().filter(p=>p.type!=='sub');
  const subs = activePlayers().filter(p=>p.type==='sub');
  const status = p => getMatchResponseStatus(match,p.id);
  const yesPlayers = core.filter(p=>status(p)==='yes');
  return {
    yes: yesPlayers.length,
    no: core.filter(p=>status(p)==='no').length,
    maybe: core.filter(p=>status(p)==='maybe').length,
    unknown: core.filter(p=>status(p)==='unknown').length,
    yesNames: yesPlayers.map(playerName),
    subYesNames: subs.filter(p=>status(p)==='yes').map(playerName)
  };
}

function getMatchResponseStatus(match, playerId) {
  if (!match || !playerId) return 'unknown';
  if (match.id===state.currentMatch?.id && state.responses.has(playerId)) return state.responses.get(playerId)?.status || 'unknown';
  return match.attendance?.[playerId] || 'unknown';
}

function groupMatchesByMonth(matches) {
  const map = new Map();
  for (const m of matches) {
    const d = new Date(tsMillis(m.startAt));
    const label = new Intl.DateTimeFormat('fr-CA',{month:'long',year:'numeric'}).format(d);
    if (!map.has(label)) map.set(label,[]);
    map.get(label).push(m);
  }
  return [...map.entries()];
}

function renderPlayers() {
  const types = {regular:'Joueurs réguliers',goalie:'Gardiens',sub:'Remplaçants'};
  const mine = state.member?.playerId || '';
  const active = activePlayers();
  const options = active.map(p=>`<option value="${p.id}" ${p.id===mine?'selected':''}>${esc(playerName(p))} · ${p.type==='goalie'?'Gardien':p.type==='sub'?'Remplaçant':'Régulier'}</option>`).join('');
  const players = active.filter(p=>p.type===state.playerTab);
  return `<div class="card"><h2>Mon joueur</h2><label>Mon compte correspond à</label><select data-change="link-player"><option value="">Aucun / organisateur seulement</option>${options}</select></div>
    <div class="card">
      <div class="row between"><h2 style="margin:0">Joueurs</h2>${isAdmin()?'<button class="btn primary" data-action="new-player">+ Ajouter</button>':''}</div>
      <div class="segment" style="margin-top:12px">${Object.entries(types).map(([k,v])=>`<button data-player-tab="${k}" class="${state.playerTab===k?'active':''}">${v}</button>`).join('')}</div>
      ${players.length?players.map(p=>`<div class="list-row"><div><div class="person-name">${playerName(p)}</div><div class="person-meta">${p.firstName} · ${p.lastName}</div></div>${isAdmin()?`<button class="btn small ghost" data-action="edit-player" data-player="${p.id}">Modifier</button>`:''}</div>`).join(''):'<div class="empty">Aucun joueur dans cette catégorie.</div>'}
    </div>`;
}

function renderStats() {
  if (!state.stats && !state.statsLoading) queueMicrotask(loadStats);
  if (state.statsLoading || !state.stats) return '<div class="card empty">Calcul des statistiques…</div>';
  const skaters = state.stats.players.filter(x=>x.type!=='goalie').sort((a,b)=>(b.points-a.points)||(b.goals-a.goals)||a.name.localeCompare(b.name));
  const goalies = state.stats.players.filter(x=>x.type==='goalie').sort((a,b)=>(a.avg-b.avg)||a.name.localeCompare(b.name));
  return `<div class="card"><h2>Statistiques de la saison</h2><div class="kpi-grid"><div class="kpi"><strong>${state.stats.finalMatches}</strong><span>matchs</span></div><div class="kpi"><strong>${state.stats.totalGoals}</strong><span>buts</span></div><div class="kpi"><strong>${activePlayers().length}</strong><span>joueurs actifs</span></div></div></div>
    <div class="card"><h3 style="margin-top:0">Joueurs</h3>${skaters.length?`<table><thead><tr><th>Joueur</th><th>MJ</th><th>B</th><th>A</th><th>PTS</th><th>ABS</th></tr></thead><tbody>${skaters.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.gp}</td><td>${s.goals}</td><td>${s.assists}</td><td><strong>${s.points}</strong></td><td>${s.absences}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucune statistique.</div>'}</div>
    <div class="card"><h3 style="margin-top:0">Gardiens</h3>${goalies.length?`<table><thead><tr><th>Gardien</th><th>MJ</th><th>BA</th><th>MOY</th><th>ABS</th></tr></thead><tbody>${goalies.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.gp}</td><td>${s.ga}</td><td><strong>${s.avg.toFixed(2).replace('.',',')}</strong></td><td>${s.absences}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucun gardien.</div>'}</div>
    <div class="card"><h3 style="margin-top:0">Historique</h3>${state.stats.history.length?state.stats.history.map(h=>`<div class="list-row"><div><div class="person-name">${formatDate(h.startAt)}</div><div class="person-meta">Foncés ${h.dark} − ${h.light} Pâles</div></div><span class="pill">Final</span></div>`).join(''):'<div class="empty">Aucun match terminé.</div>'}</div>`;
}

function renderSettings() {
  const admin = isAdmin();
  const invite = state.league.inviteCode || '—';
  return `<div class="card"><h2>${esc(state.league.name)}</h2><p class="muted">${esc(state.league.season||'')}</p><div class="invite-code">${esc(invite)}</div><button class="btn wide" data-action="copy-invite">Copier le code d’invitation</button></div>
    ${admin?`<div class="card"><h3 style="margin-top:0">Configuration des matchs</h3><form data-form="league-settings"><label>Nombre de périodes</label><input name="periodCount" type="number" min="1" max="9" value="${state.league.settings?.periodCount||3}" required><label>Durée d’une période (minutes)</label><input name="periodMinutes" type="number" min="1" max="120" value="${state.league.settings?.periodMinutes||20}" required><label>Heure habituelle du lundi</label><input name="gameTime" type="time" value="${escAttr(state.league.settings?.gameTime||'20:00')}" required><label>Nombre de semaines créées d’avance</label><input name="scheduleWeeks" type="number" min="8" max="52" value="${state.league.settings?.scheduleWeeks||44}" required><p class="muted">Le calendrier crée automatiquement les lundis futurs. Tu peux toujours ajouter un match manuel au besoin.</p><button class="btn primary wide" style="margin-top:12px">Enregistrer</button></form></div>`:''}
    <div class="card"><h3 style="margin-top:0">Données</h3><button class="btn wide" data-action="export-json">Exporter la ligue en JSON</button><p class="muted">Export des joueurs, matchs, alignements, réponses et buts pour avoir une copie locale de la base.</p></div>
    <div class="card"><h3 style="margin-top:0">Compte</h3><p>${esc(userDisplayName())}<br><span class="muted">${esc(state.user.email||'')}</span></p><button class="btn" data-action="logout">Déconnexion</button></div>`;
}

function renderAuth() {
  const reg = state.authMode === 'register';
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="auth-logo">C</div><h1>Cosom</h1><p class="muted">La ligue du lundi, synchronisée sur tous les appareils.</p>
    <button class="btn google wide" data-action="google-login"><span class="google-g">G</span> Continuer avec Google</button>
    <div class="auth-divider"><span>ou avec un courriel</span></div>
    <div class="segment"><button data-auth-mode="login" class="${!reg?'active':''}">Connexion</button><button data-auth-mode="register" class="${reg?'active':''}">Créer un compte</button></div>
    <form data-form="auth">${reg?'<label>Ton nom</label><input name="name" autocomplete="name" required>':''}<label>Courriel</label><input name="email" type="email" autocomplete="email" required><label>Mot de passe</label><input name="password" type="password" minlength="6" autocomplete="current-password" required><button class="btn primary wide" style="margin-top:14px">${reg?'Créer mon compte':'Connexion'}</button></form>
  </div></div>`;
}

async function renderLeagueChooser(knownIds = null) {
  if (!state.user) return;
  let leagueIds = knownIds;
  if (!leagueIds) {
    const snaps = await getDocs(collection(state.db, 'users', state.user.uid, 'leagues'));
    leagueIds = snaps.docs.map(d=>d.id);
  }
  const leagues = [];
  for (const id of leagueIds) {
    try { const s = await getDoc(doc(state.db,'leagues',id)); if (s.exists()) leagues.push({id:s.id,...s.data()}); } catch {}
  }
  state.leagueId = null;
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="width:min(520px,100%)"><div class="row between"><div><div class="logo">Ligue cosom du lundi</div><div class="muted">${esc(userDisplayName())}</div></div><button class="btn small ghost" data-action="logout">Sortir</button></div>
    <h2>Mes ligues</h2>${leagues.length?leagues.map(l=>`<div class="league-card"><div><strong>${esc(l.name)}</strong><div class="muted">${esc(l.season||'')}</div></div><button class="btn primary" data-action="open-league" data-league="${l.id}">Ouvrir</button></div>`).join(''):'<div class="empty">Aucune ligue pour l’instant.</div>'}
    <div class="grid2 stack-mobile" style="margin-top:14px"><button class="btn primary" data-action="create-league">Créer une ligue</button><button class="btn" data-action="join-league">Joindre avec un code</button></div>
  </div></div>`;
}

function renderBoot(text) {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card center"><div class="auth-logo" style="margin:0 auto 15px">C</div><strong>${esc(text)}</strong></div></div>`;
}

function renderSetupNeeded() {
  root.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="auth-logo">C</div><h1>Projet prêt</h1><div class="notice alert">La PWA doit être servie par Firebase Hosting pour recevoir automatiquement sa configuration.</div><p>Suis le fichier <strong>SETUP-FIREBASE.md</strong> dans le ZIP, puis ouvre l’adresse <span class="code">ton-projet.web.app</span>.</p></div></div>`;
}

async function loadStats() {
  if (!state.leagueId || state.statsLoading) return;
  state.statsLoading = true; render();
  try {
    const finals = state.matches.filter(m=>m.status==='final');
    const playerMap = new Map(state.players.map(p=>[p.id,{id:p.id,name:playerName(p),type:p.type,gp:0,goals:0,assists:0,points:0,absences:0,ga:0,avg:0}]));
    const history = [];
    let totalGoals = 0;
    for (const m of finals) {
      const aSnap = await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'assignments'));
      const gSnap = await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'goals'));
      const assignments = new Map(aSnap.docs.map(d=>[d.id,d.data().team]));
      const goals = gSnap.docs.map(d=>d.data());
      let dark=0, light=0;
      for (const g of goals) {
        totalGoals++;
        if (g.team==='dark') dark++; else if (g.team==='light') light++;
        const s = playerMap.get(g.scorerId); if (s) s.goals++;
        for (const aid of (g.assists||[])) { const a=playerMap.get(aid); if(a) a.assists++; }
      }
      for (const p of state.players) {
        const s = playerMap.get(p.id); if (!s || !playerWasActiveAtMatch(p, m)) continue;
        const team = assignments.get(p.id);
        if (team==='dark' || team==='light') s.gp++;
        else if (p.type!=='sub') s.absences++;
        if (p.type==='goalie' && (team==='dark'||team==='light')) s.ga += team==='dark'?light:dark;
      }
      history.push({startAt:m.startAt,dark,light});
    }
    for (const s of playerMap.values()) { s.points=s.goals+s.assists; if(s.type==='goalie') s.avg=s.gp?s.ga/s.gp:0; }
    state.stats = {finalMatches:finals.length,totalGoals,players:[...playerMap.values()],history:history.sort((a,b)=>tsMillis(b.startAt)-tsMillis(a.startAt))};
  } catch (e) { handleError(e); state.stats={finalMatches:0,totalGoals:0,players:[],history:[]}; }
  finally { state.statsLoading=false; render(); }
}

// ---------- Events ----------
root.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (tab) { state.tab=tab; render(); return; }
  const playerTab = e.target.closest('[data-player-tab]')?.dataset.playerTab;
  if (playerTab) { state.playerTab=playerTab; render(); return; }
  const authMode = e.target.closest('[data-auth-mode]')?.dataset.authMode;
  if (authMode) { state.authMode=authMode; renderAuth(); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  try {
    if (action==='google-login') await signInGoogle();
    else if (action==='logout') await signOut(state.auth);
    else if (action==='switch-league') { clearSubscriptions(); await renderLeagueChooser(); }
    else if (action==='open-league') await selectLeague(el.dataset.league);
    else if (action==='create-league') openCreateLeague();
    else if (action==='join-league') openJoinLeague();
    else if (action==='new-match') openNewMatch();
    else if (action==='new-player') openPlayerEditor();
    else if (action==='edit-player') openPlayerEditor(findPlayer(el.dataset.player));
    else if (action==='assign') await setAssignment(el.dataset.player,el.dataset.team);
    else if (action==='new-goal') openGoalEditor(el.dataset.team);
    else if (action==='edit-goal') { const g=state.goals.find(x=>x.id===el.dataset.goal); if(g) openGoalEditor(g.team,g); }
    else if (action==='toggle-clock') await toggleClock();
    else if (action==='reset-clock') await resetClock();
    else if (action==='next-period') await nextPeriod();
    else if (action==='finalize-match') await finalizeMatch();
    else if (action==='claim-alarm') await claimAlarm();
    else if (action==='clear-teams') await clearTeams();
    else if (action==='respond') await setResponse(el.dataset.player,el.dataset.status);
    else if (action==='respond-match') await setResponseForMatch(el.dataset.match,el.dataset.player,el.dataset.status);
    else if (action==='calendar-match') { selectMatch(el.dataset.match); state.tab='calendar'; render(); }
    else if (action==='open-match-tab') { state.tab='match'; render(); }
    else if (action==='copy-invite') await copyInvite();
    else if (action==='export-json') await exportLeagueJson();
  } catch (err) { handleError(err); }
});

root.addEventListener('change', async e => {
  const action = e.target.dataset.change;
  try {
    if (action==='select-match' && e.target.value) selectMatch(e.target.value);
    if (action==='link-player') await updateDoc(doc(state.db,'leagues',state.leagueId,'members',state.user.uid),{playerId:e.target.value||null,updatedAt:serverTimestamp()});
  } catch (err) { handleError(err); }
});

root.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]'); if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  try {
    if (form.dataset.form==='auth') await submitAuth(fd);
    if (form.dataset.form==='league-settings') await saveLeagueSettings(fd);
  } catch (err) { handleError(err); }
});

modal.addEventListener('click', e => {
  if (e.target === modal || e.target.closest('[data-modal-close]')) modal.close();
});
modal.addEventListener('submit', async e => {
  const form=e.target.closest('form[data-modal-form]'); if(!form)return;
  e.preventDefault(); const fd=new FormData(form);
  try {
    const kind=form.dataset.modalForm;
    if(kind==='create-league') await createLeague(fd);
    if(kind==='join-league') await joinLeague(fd);
    if(kind==='new-match') await createMatch(fd);
    if(kind==='player') await savePlayer(fd,form.dataset.playerId||null);
    if(kind==='goal') await saveGoal(fd,form.dataset.goalId||null,form.dataset.team);
  } catch(err){handleError(err);}
});


async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  try {
    await signInWithPopup(state.auth, provider);
  } catch (err) {
    const code = err?.code || '';
    if (code.includes('popup-blocked') || code.includes('operation-not-supported-in-this-environment')) {
      await signInWithRedirect(state.auth, provider);
      return;
    }
    throw err;
  }
}

async function submitAuth(fd) {
  const email=String(fd.get('email')||'').trim(); const password=String(fd.get('password')||'');
  if (state.authMode==='register') {
    const name=String(fd.get('name')||'').trim();
    const cred=await createUserWithEmailAndPassword(state.auth,email,password);
    await updateProfile(cred.user,{displayName:name});
    await setDoc(doc(state.db,'users',cred.user.uid),{displayName:name,email,createdAt:serverTimestamp()},{merge:true});
  } else await signInWithEmailAndPassword(state.auth,email,password);
}

function openCreateLeague() {
  openModal(`<h2>Créer une ligue</h2><form data-modal-form="create-league"><label>Nom</label><input name="name" value="La ligue du lundi" required><label>Saison</label><input name="season" value="2026–2027" required><div class="modal-actions"><button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">Créer</button></div></form>`);
}

async function createLeague(fd) {
  const name=String(fd.get('name')||'').trim(); const season=String(fd.get('season')||'').trim();
  const leagueRef=doc(collection(state.db,'leagues')); const code=randomCode();
  const batch=writeBatch(state.db);
  batch.set(leagueRef,{name,season,ownerUid:state.user.uid,inviteCode:code,settings:{periodCount:3,periodMinutes:20,gameTime:'20:00',scheduleWeeks:44},createdAt:serverTimestamp()});
  batch.set(doc(state.db,'leagues',leagueRef.id,'members',state.user.uid),{uid:state.user.uid,role:'admin',displayName:userDisplayName(),playerId:null,joinedAt:serverTimestamp()});
  batch.set(doc(state.db,'users',state.user.uid,'leagues',leagueRef.id),{leagueId:leagueRef.id,joinedAt:serverTimestamp()});
  batch.set(doc(state.db,'invites',code),{leagueId:leagueRef.id,leagueName:name,active:true,createdBy:state.user.uid,createdAt:serverTimestamp()});
  await batch.commit(); modal.close(); await selectLeague(leagueRef.id); toast('Ligue créée.');
}

function openJoinLeague() {
  openModal(`<h2>Joindre une ligue</h2><form data-modal-form="join-league"><label>Code d’invitation</label><input name="code" maxlength="8" style="text-transform:uppercase;letter-spacing:3px" required><div class="modal-actions"><button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">Joindre</button></div></form>`);
}

async function joinLeague(fd) {
  const code=String(fd.get('code')||'').trim().toUpperCase();
  const inviteSnap=await getDoc(doc(state.db,'invites',code));
  if(!inviteSnap.exists()||inviteSnap.data().active!==true) throw new Error('Code d’invitation invalide.');
  const leagueId=inviteSnap.data().leagueId;
  const batch=writeBatch(state.db);
  batch.set(doc(state.db,'leagues',leagueId,'members',state.user.uid),{uid:state.user.uid,role:'member',displayName:userDisplayName(),playerId:null,inviteCode:code,joinedAt:serverTimestamp()});
  batch.set(doc(state.db,'users',state.user.uid,'leagues',leagueId),{leagueId,joinedAt:serverTimestamp()});
  await batch.commit(); modal.close(); await selectLeague(leagueId); toast('Ligue ajoutée.');
}

function openNewMatch() {
  const d=new Date(Date.now()+7*864e5); const date=d.toISOString().slice(0,10);
  openModal(`<h2>Nouveau match</h2><form data-modal-form="new-match"><div class="grid2"><div><label>Date</label><input name="date" type="date" value="${date}" required></div><div><label>Heure</label><input name="time" type="time" value="20:00" required></div></div><label>Lieu</label><input name="location" placeholder="Gymnase / aréna"><div class="modal-actions"><button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">Créer</button></div></form>`);
}

async function createMatch(fd) {
  if(!isAdmin()) throw new Error('Réservé aux organisateurs.');
  const start=new Date(`${fd.get('date')}T${fd.get('time')}:00`);
  const mins=Number(state.league.settings?.periodMinutes||20); const count=Number(state.league.settings?.periodCount||3);
  const ref=await addDoc(collection(state.db,'leagues',state.leagueId,'matches'),{
    startAt:Timestamp.fromDate(start),location:String(fd.get('location')||'').trim(),status:'scheduled',period:1,periodCount:count,periodSeconds:mins*60,
    clock:{running:false,remainingSeconds:mins*60,endsAt:null},startedAt:null,finalizedAt:null,alarmDeviceId:null,alarmDeviceName:null,createdAt:serverTimestamp(),createdBy:state.user.uid
  });
  modal.close(); selectMatch(ref.id); toast('Match créé.');
}

function openPlayerEditor(player=null) {
  const type=player?.type||state.playerTab||'regular';
  openModal(`<h2>${player?'Modifier':'Ajouter'} un joueur</h2><form data-modal-form="player" ${player?`data-player-id="${player.id}"`:''}><label>Prénom</label><input name="firstName" value="${escAttr(player?.firstName||'')}" required><label>Nom</label><input name="lastName" value="${escAttr(player?.lastName||'')}" required><label>Catégorie</label><select name="type"><option value="regular" ${type==='regular'?'selected':''}>Joueur régulier</option><option value="goalie" ${type==='goalie'?'selected':''}>Gardien</option><option value="sub" ${type==='sub'?'selected':''}>Remplaçant</option></select>${player?'<div class="notice">Archiver conserve son historique et ses statistiques passées.</div>':''}<div class="modal-actions">${player?'<button type="button" class="btn danger" data-action-modal="archive-player">Archiver</button>':''}<button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">Enregistrer</button></div></form>`);
  const archiveBtn=modal.querySelector('[data-action-modal="archive-player"]');
  if(archiveBtn) archiveBtn.addEventListener('click',async()=>{if(confirm('Archiver ce joueur?')){await updateDoc(doc(state.db,'leagues',state.leagueId,'players',player.id),{active:false,archivedAt:serverTimestamp()});modal.close();toast('Joueur archivé.');}});
}

async function savePlayer(fd,id) {
  if(!isAdmin()) throw new Error('Réservé aux organisateurs.');
  const data={firstName:String(fd.get('firstName')||'').trim(),lastName:String(fd.get('lastName')||'').trim(),type:String(fd.get('type')),active:true,updatedAt:serverTimestamp()};
  if(id) await setDoc(doc(state.db,'leagues',state.leagueId,'players',id),data,{merge:true});
  else await addDoc(collection(state.db,'leagues',state.leagueId,'players'),{...data,createdAt:serverTimestamp()});
  state.playerTab=data.type; modal.close(); state.tab='players'; toast('Joueur enregistré.');
}

async function setAssignment(playerId,team) {
  if(!state.currentMatch || state.currentMatch.status==='final') return;
  const ref=doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id,'assignments',playerId);
  if(team==='absent') await deleteDoc(ref).catch(()=>{});
  else await setDoc(ref,{playerId,team,updatedAt:serverTimestamp(),updatedBy:state.user.uid},{merge:true});
}

function openGoalEditor(team,goal=null) {
  if(!state.currentMatch || state.currentMatch.status==='final') return;
  const eligible=activePlayers().filter(p=>state.assignments.get(p.id)?.team===team);
  if(!eligible.length) return toast(`Ajoute d’abord des joueurs chez les ${team==='dark'?'Foncés':'Pâles'}.`);
  const scorerId=goal?.scorerId||''; const assists=new Set(goal?.assists||[]);
  openModal(`<h2>${goal?'Modifier':'Ajouter'} un but · ${team==='dark'?'Foncés':'Pâles'}</h2><form data-modal-form="goal" data-team="${team}" ${goal?`data-goal-id="${goal.id}"`:''}><label>Buteur</label><select name="scorer" required><option value="">Choisir…</option>${eligible.map(p=>`<option value="${p.id}" ${p.id===scorerId?'selected':''}>${esc(playerName(p))}</option>`).join('')}</select><label>Passes (maximum 2)</label><div>${eligible.map(p=>`<div class="check-row"><input type="checkbox" name="assist" value="${p.id}" ${assists.has(p.id)?'checked':''} id="a-${p.id}"><label for="a-${p.id}">${esc(playerName(p))}</label></div>`).join('')}</div><div class="modal-actions">${goal?'<button type="button" class="btn danger" data-action-modal="delete-goal">Supprimer</button>':''}<button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">${goal?'Enregistrer':'Confirmer le but'}</button></div></form>`);
  modal.querySelectorAll('input[name="assist"]').forEach(cb=>cb.addEventListener('change',()=>{const checked=[...modal.querySelectorAll('input[name="assist"]:checked')];if(checked.length>2){cb.checked=false;toast('Maximum 2 passes.');}}));
  if(goal){modal.querySelector('[data-action-modal="delete-goal"]').addEventListener('click',async()=>{if(confirm('Supprimer ce but?')){await deleteDoc(doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id,'goals',goal.id));modal.close();toast('But supprimé.');}});}
}

async function saveGoal(fd,id,team) {
  const scorer=String(fd.get('scorer')||''); let assists=fd.getAll('assist').map(String).filter(x=>x&&x!==scorer).slice(0,2);
  if(!scorer) throw new Error('Choisis le buteur.');
  const current=state.currentMatch; const elapsed=Math.max(0,(current.periodSeconds||1200)-getRemainingSeconds(current));
  const data={team,scorerId:scorer,assists,period:current.period||1,elapsedSeconds:elapsed,updatedAt:serverTimestamp(),updatedBy:state.user.uid};
  if(id) await setDoc(doc(state.db,'leagues',state.leagueId,'matches',current.id,'goals',id),data,{merge:true});
  else await addDoc(collection(state.db,'leagues',state.leagueId,'matches',current.id,'goals'),{...data,createdAt:serverTimestamp()});
  modal.close(); toast(id?'But modifié.':'But ajouté.');
}

async function toggleClock() {
  const ref=doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id);
  await unlockAudio();
  await requestWakeLock();
  await runTransaction(state.db,async tx=>{
    const snap=await tx.get(ref); if(!snap.exists())return; const m=snap.data(); const rem=getRemainingSeconds(m);
    if(m.status==='final')return;
    if(m.clock?.running) tx.update(ref,{status:'live','clock.running':false,'clock.remainingSeconds':rem,'clock.endsAt':null});
    else if(rem>0){const patch={status:'live','clock.running':true,'clock.remainingSeconds':rem,'clock.endsAt':Timestamp.fromMillis(Date.now()+rem*1000)};if(!m.startedAt)patch.startedAt=serverTimestamp();tx.update(ref,patch);}
  });
}

async function resetClock() {
  if(!confirm('Remettre le chrono au début de la période? Les buts et les équipes restent intacts.'))return;
  const secs=state.currentMatch.periodSeconds||Number(state.league.settings?.periodMinutes||20)*60;
  await updateDoc(matchRef(),{'clock.running':false,'clock.remainingSeconds':secs,'clock.endsAt':null}); toast('Chrono réinitialisé.');
}

async function nextPeriod() {
  const m=state.currentMatch; if(!m)return; if(m.period>=m.periodCount)return;
  if(!confirm(`Passer à la période ${m.period+1}?`))return;
  const secs=m.periodSeconds||1200;
  await updateDoc(matchRef(),{period:m.period+1,'clock.running':false,'clock.remainingSeconds':secs,'clock.endsAt':null});
}

async function finalizeMatch() {
  if(!confirm('Terminer ce match? Les statistiques et les absences seront alors comptées.'))return;
  await updateDoc(matchRef(),{status:'final',finalizedAt:serverTimestamp(),'clock.running':false,'clock.remainingSeconds':getRemainingSeconds(state.currentMatch),'clock.endsAt':null}); state.stats=null; toast('Match terminé.');
}

async function claimAlarm() {
  await unlockAudio();
  await requestWakeLock();
  const mine=state.currentMatch.alarmDeviceId===DEVICE_ID;
  await updateDoc(matchRef(),{alarmDeviceId:mine?null:DEVICE_ID,alarmDeviceName:mine?null:userDisplayName(),alarmClaimedAt:serverTimestamp()});
  toast(mine?'Alarme libérée.':'Cet appareil sonnera à 0:00.');
}

async function clearTeams() {
  if(state.currentMatch.startedAt || state.goals.length) return toast('Les équipes ne peuvent être vidées qu’avant le début du match.');
  if(!confirm('Vider complètement les équipes?'))return;
  const batch=writeBatch(state.db); for(const id of state.assignments.keys())batch.delete(doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id,'assignments',id)); await batch.commit();
}

async function setResponse(playerId,status) {
  if (!state.currentMatch) return;
  return setResponseForMatch(state.currentMatch.id, playerId, status);
}

async function setResponseForMatch(matchId,playerId,status) {
  const can = isAdmin() || state.member?.playerId===playerId;
  if(!can) throw new Error('Tu peux modifier seulement ta propre réponse.');
  if(!['yes','no','maybe'].includes(status)) throw new Error('Réponse invalide.');
  const responseRef=doc(state.db,'leagues',state.leagueId,'matches',matchId,'responses',playerId);
  const matchDocRef=doc(state.db,'leagues',state.leagueId,'matches',matchId);
  const batch=writeBatch(state.db);
  batch.set(responseRef,{playerId,status,updatedBy:state.user.uid,updatedAt:serverTimestamp()},{merge:true});
  batch.update(matchDocRef,{[`attendance.${playerId}`]:status});
  await batch.commit();
  toast(status==='yes'?'Présence confirmée.':status==='no'?'Absence enregistrée.':'Réponse mise à incertain.');
}

async function saveLeagueSettings(fd) {
  if(!isAdmin())return;
  const periodCount=Math.max(1,Math.min(9,Number(fd.get('periodCount'))));
  const periodMinutes=Math.max(1,Math.min(120,Number(fd.get('periodMinutes'))));
  const gameTime=String(fd.get('gameTime')||'20:00');
  const scheduleWeeks=Math.max(8,Math.min(52,Number(fd.get('scheduleWeeks'))||44));
  await updateDoc(doc(state.db,'leagues',state.leagueId),{
    'settings.periodCount':periodCount,
    'settings.periodMinutes':periodMinutes,
    'settings.gameTime':gameTime,
    'settings.scheduleWeeks':scheduleWeeks,
    updatedAt:serverTimestamp()
  });
  state.scheduleEnsuredKey=null;
  await updateFutureAutoMatchTimes(gameTime);
  await ensureMondaySchedule();
  toast('Réglages enregistrés.');
}

async function ensureMondaySchedule() {
  if(!isAdmin() || !state.leagueId || !state.league || !state.matchesLoaded) return;
  const weeks=Math.max(8,Math.min(52,Number(state.league.settings?.scheduleWeeks||44)));
  const gameTime=String(state.league.settings?.gameTime||'20:00');
  const first=getCurrentOrNextMonday();
  const key=`${state.leagueId}:${localDateKey(first)}:${gameTime}:${weeks}`;
  if(state.scheduleEnsuredKey===key) return;
  state.scheduleEnsuredKey=key;

  const existingDates=new Set(state.matches.map(m=>localDateKey(new Date(tsMillis(m.startAt)))));
  const mins=Number(state.league.settings?.periodMinutes||20);
  const count=Number(state.league.settings?.periodCount||3);
  const batch=writeBatch(state.db);
  let writes=0;
  for(let i=0;i<weeks;i++){
    const d=new Date(first); d.setDate(first.getDate()+i*7);
    const dateKey=localDateKey(d);
    if(existingDates.has(dateKey)) continue;
    const start=new Date(`${dateKey}T${gameTime}:00`);
    const ref=doc(state.db,'leagues',state.leagueId,'matches',`monday-${dateKey}`);
    batch.set(ref,{
      startAt:Timestamp.fromDate(start),location:'',status:'scheduled',period:1,periodCount:count,periodSeconds:mins*60,
      clock:{running:false,remainingSeconds:mins*60,endsAt:null},startedAt:null,finalizedAt:null,alarmDeviceId:null,alarmDeviceName:null,
      attendance:{},autoScheduled:true,createdAt:serverTimestamp(),createdBy:state.user.uid
    });
    writes++;
  }
  if(writes) await batch.commit();
}

async function updateFutureAutoMatchTimes(gameTime) {
  const future=state.matches.filter(m=>m.autoScheduled===true && m.status==='scheduled' && tsMillis(m.startAt)>=startOfLocalDay(Date.now()));
  if(!future.length) return;
  const batch=writeBatch(state.db);
  for(const m of future){
    const key=localDateKey(new Date(tsMillis(m.startAt)));
    batch.update(doc(state.db,'leagues',state.leagueId,'matches',m.id),{startAt:Timestamp.fromDate(new Date(`${key}T${gameTime}:00`))});
  }
  await batch.commit();
}

async function copyInvite() {
  const code=state.league.inviteCode||''; await navigator.clipboard.writeText(code); toast(`Code ${code} copié.`);
}

async function exportLeagueJson() {
  const data={exportedAt:new Date().toISOString(),league:stripFirestore(state.league),players:state.players.map(stripFirestore),matches:[]};
  for(const m of state.matches){
    const a=await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'assignments'));
    const r=await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'responses'));
    const g=await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'goals'));
    data.matches.push({...stripFirestore(m),assignments:a.docs.map(x=>({id:x.id,...stripFirestore(x.data())})),responses:r.docs.map(x=>({id:x.id,...stripFirestore(x.data())})),goals:g.docs.map(x=>({id:x.id,...stripFirestore(x.data())}))});
  }
  downloadBlob(`cosom-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2),'application/json');
}

function openModal(body) { modal.innerHTML=`<div class="modal-inner"><div class="modal-head"><strong>COSOM</strong><button type="button" class="btn small ghost" data-modal-close>✕</button></div><div class="modal-body">${body}</div></div>`; modal.showModal(); }

// ---------- Clock + alarm ----------
function updateClockDisplay() {
  const el=document.getElementById('clockText'); const m=state.currentMatch; if(!el||!m)return;
  const rem=getRemainingSeconds(m); el.textContent=formatClock(rem);
  if(m.clock?.running && rem<=0 && !state.clockZeroHandled){
    state.clockZeroHandled=true;
    if(m.alarmDeviceId===DEVICE_ID) playAlarm();
    stopExpiredClock().catch(()=>{});
  }
}

async function stopExpiredClock(){
  const ref=matchRef(); await runTransaction(state.db,async tx=>{const s=await tx.get(ref);if(!s.exists())return;const m=s.data();if(m.clock?.running&&getRemainingSeconds(m)<=0)tx.update(ref,{'clock.running':false,'clock.remainingSeconds':0,'clock.endsAt':null});});
}

function getRemainingSeconds(m) {
  const clock=m?.clock||{}; if(clock.running&&clock.endsAt){return Math.max(0,Math.ceil((tsMillis(clock.endsAt)-Date.now())/1000));} return Math.max(0,Number(clock.remainingSeconds ?? m?.periodSeconds ?? 1200));
}
async function unlockAudio(){try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')await audioCtx.resume();}catch{}}
async function playAlarm(){await unlockAudio();await requestWakeLock();if(!audioCtx)return;const now=audioCtx.currentTime;[0,.45,.9].forEach(off=>{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=880;g.gain.setValueAtTime(.0001,now+off);g.gain.exponentialRampToValueAtTime(.25,now+off+.02);g.gain.exponentialRampToValueAtTime(.0001,now+off+.28);o.connect(g).connect(audioCtx.destination);o.start(now+off);o.stop(now+off+.3);});}

// ---------- Helpers ----------
function activePlayers(){return state.players.filter(p=>p.active!==false);}
function playerWasActiveAtMatch(p,m){const when=tsMillis(m.startAt),created=tsMillis(p.createdAt),archived=tsMillis(p.archivedAt);return (!created||created<=when)&&(!archived||archived>when);}
function findPlayer(id){return state.players.find(p=>p.id===id)||null;}
function playerName(p){return p?[p.firstName,p.lastName].filter(Boolean).join(' '):'';}
function isAdmin(){return state.member?.role==='admin';}
function userDisplayName(){return state.userProfile?.displayName||state.user?.displayName||state.user?.email?.split('@')[0]||'Joueur';}
function matchRef(){return doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id);}
function getScore(){return state.goals.reduce((s,g)=>{if(g.team==='dark')s.dark++;if(g.team==='light')s.light++;return s;},{dark:0,light:0});}
function formatClock(sec){sec=Math.max(0,Math.floor(Number(sec)||0));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function tsMillis(v){if(!v)return 0;if(typeof v.toMillis==='function')return v.toMillis();if(v.seconds)return v.seconds*1000;return new Date(v).getTime()||0;}
function formatDate(v){const ms=tsMillis(v);return ms?new Intl.DateTimeFormat('fr-CA',{weekday:'short',day:'numeric',month:'long',year:'numeric'}).format(new Date(ms)):'Date inconnue';}
function formatTime(v){const ms=tsMillis(v);return ms?new Intl.DateTimeFormat('fr-CA',{hour:'2-digit',minute:'2-digit'}).format(new Date(ms)):'';}
function startOfLocalDay(v){const d=new Date(v);return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();}
function localDateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function getCurrentOrNextMonday(){const now=new Date();const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());const delta=(8-d.getDay())%7;d.setDate(d.getDate()+delta);return d;}
function formatShortDate(v){const ms=tsMillis(v);return ms?new Intl.DateTimeFormat('fr-CA',{weekday:'long',day:'numeric',month:'long'}).format(new Date(ms)):'Date inconnue';}
async function requestWakeLock(){try{if('wakeLock' in navigator && (!wakeLock || wakeLock.released))wakeLock=await navigator.wakeLock.request('screen');}catch{}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible' && state.currentMatch?.alarmDeviceId===DEVICE_ID)requestWakeLock();});
function getDeviceId(){let id=localStorage.getItem('cosomDeviceId');if(!id){id=(crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`);localStorage.setItem('cosomDeviceId',id);}return id;}
function randomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<6;i++)s+=chars[Math.floor(Math.random()*chars.length)];return s;}
function toast(msg){clearTimeout(toastTimer);toastEl.textContent=msg;toastEl.classList.add('show');toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2800);}
function handleError(err){console.error(err);toast(firebaseErrorMessage(err));}
function firebaseErrorMessage(err){const c=err?.code||'';if(c.includes('wrong-password')||c.includes('invalid-credential'))return'Courriel ou mot de passe invalide.';if(c.includes('popup-closed-by-user'))return'Connexion Google annulée.';if(c.includes('account-exists-with-different-credential'))return'Un compte existe déjà avec ce courriel. Connecte-toi avec la méthode utilisée à l’origine.';if(c.includes('email-already-in-use'))return'Ce courriel est déjà utilisé.';if(c.includes('permission-denied'))return'Permission refusée par Firebase. Vérifie les règles Firestore.';return err?.message||'Une erreur est survenue.';}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function escAttr(v){return esc(v);}
function stripFirestore(obj){if(obj==null)return obj;if(Array.isArray(obj))return obj.map(stripFirestore);if(typeof obj==='object'){if(typeof obj.toDate==='function')return obj.toDate().toISOString();const out={};for(const[k,v]of Object.entries(obj))out[k]=stripFirestore(v);return out;}return obj;}
function downloadBlob(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}
function leaveLeagueLocally(){clearSubscriptions();state.leagueId=null;renderLeagueChooser();}
