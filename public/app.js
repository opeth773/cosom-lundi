import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp, Timestamp, onSnapshot, query, orderBy, where, runTransaction, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const APP_VERSION = '7.8.0';
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
  appConfig: null,
  leagueId: null,
  league: null,
  member: null,
  members: [],
  allUsers: [],
  accessRequests: new Map(),
  adminDirectoryLeagueId: null,
  adminUnsubs: [],
  accessWaitUnsub: null,
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
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    // Force a check at each app start. The worker no longer caches the app code,
    // so a new deploy cannot leave users on an old app.js/styles.css combination.
    registration.update().catch(() => {});
  } catch (e) {
    console.warn('SW', e);
  }
}

// Some mobile/in-app browsers restore a frozen page from the back/forward cache.
// Reloading only in that case guarantees that reopening COSOM gets the current release.
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});


async function handleAuthChange(user) {
  clearSubscriptions();
  state.user = user;
  state.userProfile = null;
  state.leagueId = null;
  state.league = null;
  state.member = null;
  state.members = [];
  state.allUsers = [];
  state.accessRequests = new Map();
  state.adminDirectoryLeagueId = null;
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
    const cfgSnap = await getDoc(doc(state.db, 'app', 'config'));
    if (cfgSnap.exists()) {
      state.appConfig = cfgSnap.data();
      const leagueId = state.appConfig.leagueId;
      try {
        const memberSnap = await getDoc(doc(state.db, 'leagues', leagueId, 'members', user.uid));
        if (memberSnap.exists()) return selectLeague(leagueId);
      } catch (e) {
        console.warn('Membership check', e);
      }
      return renderLeagueChooser([]);
    }

    // Migration/recovery for leagues created before /app/config existed.
    // The old versions stored a membership pointer under users/{uid}/leagues/{leagueId}.
    // Never interpret a missing global pointer as "the league was deleted".
    state.appConfig = null;
    const legacyMemberships = await getDocs(collection(state.db, 'users', user.uid, 'leagues'));
    const legacyLeagueIds = legacyMemberships.docs.map(d => d.id);
    for (const leagueId of legacyLeagueIds) {
      try {
        const leagueSnap = await getDoc(doc(state.db, 'leagues', leagueId));
        if (!leagueSnap.exists()) continue;
        const leagueData = leagueSnap.data();

        // The owner can safely recreate the single global pointer. This does not
        // modify or recreate the league itself; it only points the app back to it.
        if (leagueData.ownerUid === user.uid) {
          try {
            await setDoc(doc(state.db, 'app', 'config'), {
              leagueId,
              ownerUid: user.uid,
              recoveredAt: serverTimestamp()
            });
            state.appConfig = {leagueId, ownerUid:user.uid};
          } catch (recoveryError) {
            console.warn('Global league pointer recovery', recoveryError);
          }
        }

        // Existing members must still be able to open their original league even
        // while the owner is repairing an older installation.
        return selectLeague(leagueId);
      } catch (legacyError) {
        console.warn('Legacy league recovery', legacyError);
      }
    }

    // No existing membership was found for this account. Do not claim that an
    // existing league has vanished; this is only the first-time setup path.
    return renderLeagueChooser([]);
  } catch (e) {
    handleError(e);
  }
}

function clearSubscriptions() {
  [...state.leagueUnsubs, ...state.matchUnsubs, ...state.adminUnsubs].forEach(fn => { try { fn(); } catch {} });
  if (state.accessWaitUnsub) { try { state.accessWaitUnsub(); } catch {} }
  state.leagueUnsubs = [];
  state.matchUnsubs = [];
  state.adminUnsubs = [];
  state.accessWaitUnsub = null;
  state.adminDirectoryLeagueId = null;
  state.allUsers = [];
  state.accessRequests = new Map();
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
    if (isAdmin()) {
      queueMicrotask(() => ensureMondaySchedule().catch(handleError));
      queueMicrotask(() => subscribeAdminDirectory(leagueId));
    }
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(query(collection(state.db, 'leagues', leagueId, 'players'), orderBy('lastName')), snap => {
    state.players = snap.docs.map(d => ({id:d.id, ...d.data()}));
    state.stats = null;
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(collection(state.db, 'leagues', leagueId, 'members'), snap => {
    state.members = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, handleError));
  state.leagueUnsubs.push(onSnapshot(query(collection(state.db, 'leagues', leagueId, 'matches'), orderBy('startAt', 'desc')), snap => {
    state.matches = snap.docs.map(d => ({id:d.id, ...d.data()}));
    state.matchesLoaded = true;
    state.stats = null;
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

function subscribeAdminDirectory(leagueId) {
  if (!isAdmin() || state.adminDirectoryLeagueId === leagueId) return;
  state.adminUnsubs.forEach(fn => { try { fn(); } catch {} });
  state.adminUnsubs = [];
  state.adminDirectoryLeagueId = leagueId;
  state.adminUnsubs.push(onSnapshot(collection(state.db, 'users'), snap => {
    state.allUsers = snap.docs.map(d => ({id:d.id, ...d.data()}));
    render();
  }, handleError));
  state.adminUnsubs.push(onSnapshot(query(collection(state.db, 'accessRequests'), where('leagueId','==',leagueId)), snap => {
    state.accessRequests = new Map(snap.docs.map(d => [d.id, {id:d.id, ...d.data()}]));
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
    state.stats = null;
    render();
  }, handleError));
  state.matchUnsubs.push(onSnapshot(collection(state.db, ...base, 'responses'), snap => {
    state.responses = new Map(snap.docs.map(d => [d.id, {id:d.id, ...d.data()}]));
    render();
  }, handleError));
  state.matchUnsubs.push(onSnapshot(query(collection(state.db, ...base, 'goals'), orderBy('createdAt', 'asc')), snap => {
    state.goals = snap.docs.map(d => ({id:d.id, ...d.data()}));
    state.stats = null;
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
            <div class="logo">COSOM</div>
            <div class="header-meta">${esc(state.league.name || 'La ligue')} · ${esc(state.league.season || '')}</div>
          </div>
          <div class="header-actions">
            <span class="role-badge ${isAdmin()?'admin':'member'}">${isAdmin()?'ADMIN':'MEMBRE'}</span>
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
        ${navButton('settings','⚙',isAdmin()?'Admin':'Compte')}
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
    const assignment = state.assignments.get(p.id);
    const team = assignment?.team || 'absent';
    const position = matchPosition(p, assignment);
    const basePosition = defaultMatchPosition(p);
    const matchFinal = state.currentMatch?.status === 'final';
    const positionLocked = matchFinal && !isAdmin();
    const baseLabel = type==='sub'?'Remplaçant':type==='goalie'?'Gardien':'Régulier';
    const roleLabel = team==='absent' ? '' : ` · ${position==='goalie'?'Gardien ce match':'Joueur ce match'}${position!==basePosition?' (changé)':''}`;
    return `<div class="assignment-row">
      <div class="assignment-person">
        <div class="person-name">${playerName(p)}</div>
        <div class="person-meta">${baseLabel}${roleLabel}</div>
      </div>
      <div class="assignment-actions">
        <div class="assign-buttons" aria-label="Équipe de ${escAttr(playerName(p))}">
          <button ${matchFinal?'disabled':''} data-action="assign" data-player="${p.id}" data-team="dark" class="${team==='dark'?'on-dark':''}" title="Foncés">F</button>
          <button ${matchFinal?'disabled':''} data-action="assign" data-player="${p.id}" data-team="light" class="${team==='light'?'on-light':''}" title="Pâles">P</button>
          <button ${matchFinal?'disabled':''} data-action="assign" data-player="${p.id}" data-team="absent" class="${team==='absent'?'on-absent':''}" title="Absent / non appelé">—</button>
        </div>
        ${team!=='absent' ? `
          <div class="match-position-control">
            <span class="match-position-label">Position ce match</span>
            <div class="position-buttons" role="group" aria-label="Position de ${escAttr(playerName(p))}">
              <button type="button" class="${position==='skater'?'active':''}" data-action="match-position" data-player="${p.id}" data-position="skater" ${positionLocked?'disabled':''}>Joueur</button>
              <button type="button" class="${position==='goalie'?'active':''}" data-action="match-position" data-player="${p.id}" data-position="goalie" ${positionLocked?'disabled':''}>Gardien</button>
            </div>
            ${matchFinal && isAdmin()?'<div class="tiny muted">Correction admin : ce changement recalcule les stats de la saison.</div>':''}
          </div>` : `
          <div class="match-position-hint">Choisis F ou P pour régler sa position pour cette game.</div>`}
      </div>
    </div>`;
  }).join('')}`;
}

function renderGoals() {
  if (!state.goals.length) return '<div class="empty">Aucun but inscrit.</div>';
  const sorted = [...state.goals].sort((a,b) => (a.period-b.period) || ((a.elapsedSeconds||0)-(b.elapsedSeconds||0)));
  return sorted.map(g => {
    const scorer = findPlayer(g.scorerId);
    const assists = (g.assists||[]).map(id=>playerName(findPlayer(id))).filter(Boolean).join(' · ') || 'Sans aide';
    const remaining = goalClockRemainingSeconds(g, state.currentMatch);
    const clockLabel = remaining == null ? '--:--' : formatClock(remaining);
    const canEdit = state.currentMatch?.status !== 'final' || isAdmin();
    return `<div class="goal-row">
      <div class="goal-time">P${g.period}<br>${clockLabel}</div>
      <div class="goal-main"><strong>${esc(playerName(scorer)||'Joueur archivé')}</strong><div class="goal-meta">${esc(assists)} · ${g.team==='dark'?'Foncés':'Pâles'}</div></div>
      ${canEdit?`<div><button class="btn small ghost" data-action="edit-goal" data-goal="${g.id}">Modifier</button></div>`:''}
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
      <div class="row between calendar-heading">
        <div><h2 style="margin:0">Calendrier</h2><div class="muted">La ligue joue habituellement le lundi. Les présences peuvent être données d’avance.</div></div>
        ${isAdmin()?'<button class="btn primary" data-action="new-match">+ Ajouter un match</button>':''}
      </div>
    </div>
    ${!mine?`<div class="notice alert">Ton compte n’est pas encore associé à un joueur. Un administrateur doit associer ton compte à ton nom avant que tu puisses confirmer tes présences ou tes absences.</div>`:''}
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
    <div class="calendar-main">
      <button type="button" class="calendar-date calendar-date-button" data-action="calendar-match" data-match="${m.id}">
        <strong>${formatShortDate(m.startAt)}</strong><span>${formatTime(m.startAt)}${m.location?' · '+esc(m.location):''}</span>
      </button>
      <div class="calendar-counts" aria-label="Réponses de présence">
        <button type="button" class="pill live attendance-pill" data-action="calendar-attendance" data-match="${m.id}" data-status="yes" title="Voir les présents">${summary.yes} présent${summary.yes>1?'s':''}</button>
        <button type="button" class="pill absent attendance-pill" data-action="calendar-attendance" data-match="${m.id}" data-status="no" title="Voir les absents">${summary.no} absent${summary.no>1?'s':''}</button>
        <button type="button" class="pill attendance-pill" data-action="calendar-attendance" data-match="${m.id}" data-status="maybe" title="Voir les incertains">${summary.maybe} incertain${summary.maybe>1?'s':''}</button>
        <button type="button" class="pill attendance-pill" data-action="calendar-attendance" data-match="${m.id}" data-status="unknown" title="Voir ceux qui n'ont pas répondu">${summary.unknown} sans réponse</button>
      </div>
      ${summary.yesNames.length?`<div class="calendar-names"><strong>Confirmés :</strong> ${esc(summary.yesNames.join(', '))}</div>`:''}
      ${summary.noNames.length?`<div class="calendar-names"><strong>Absents :</strong> ${esc(summary.noNames.join(', '))}</div>`:''}
      ${summary.maybeNames.length?`<div class="calendar-names"><strong>Incertains :</strong> ${esc(summary.maybeNames.join(', '))}</div>`:''}
      ${summary.subYesNames.length?`<div class="calendar-names"><strong>Remplaçants dispo :</strong> ${esc(summary.subYesNames.join(', '))}</div>`:''}
      ${summary.subNoNames.length?`<div class="calendar-names"><strong>Remplaçants indispo :</strong> ${esc(summary.subNoNames.join(', '))}</div>`:''}
      ${summary.subMaybeNames.length?`<div class="calendar-names"><strong>Remplaçants incertains :</strong> ${esc(summary.subMaybeNames.join(', '))}</div>`:''}
    </div>
    ${mine?`<div class="calendar-my"><div class="tiny">Moi : <strong>${esc(mineLabel)}</strong></div>${renderCalendarResponseButtons(m,mine,mineStatus)}</div>`:''}
    ${isAdmin() && m.status==='scheduled'?`<div class="calendar-admin-actions"><button class="btn small danger" data-action="delete-calendar-match" data-match="${m.id}">Supprimer ce match</button></div>`:''}
  </div>`;
}

function openCalendarAttendance(matchId, status) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;
  const summary = attendanceSummary(match);
  const groups = {
    yes: {title:'Présents', names:summary.yesNames},
    no: {title:'Absents', names:summary.noNames},
    maybe: {title:'Incertains', names:summary.maybeNames},
    unknown: {title:'Sans réponse', names:summary.unknownNames}
  };
  const group = groups[status] || groups.unknown;
  const list = group.names.length
    ? `<div class="attendance-name-list">${group.names.map(name=>`<div class="attendance-name-row">${esc(name)}</div>`).join('')}</div>`
    : '<div class="empty">Personne dans cette catégorie.</div>';
  openModal(`<h2>${esc(group.title)}</h2><div class="muted">${formatDate(match.startAt)} · ${formatTime(match.startAt)}</div>${list}<div class="modal-actions"><button type="button" class="btn primary wide" data-modal-close>Fermer</button></div>`);
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
  const noPlayers = core.filter(p=>status(p)==='no');
  const maybePlayers = core.filter(p=>status(p)==='maybe');
  const unknownPlayers = core.filter(p=>status(p)==='unknown');
  const subYesPlayers = subs.filter(p=>status(p)==='yes');
  const subNoPlayers = subs.filter(p=>status(p)==='no');
  const subMaybePlayers = subs.filter(p=>status(p)==='maybe');
  return {
    yes: yesPlayers.length,
    no: noPlayers.length,
    maybe: maybePlayers.length,
    unknown: unknownPlayers.length,
    yesNames: yesPlayers.map(playerName),
    noNames: noPlayers.map(playerName),
    maybeNames: maybePlayers.map(playerName),
    unknownNames: unknownPlayers.map(playerName),
    subYesNames: subYesPlayers.map(playerName),
    subNoNames: subNoPlayers.map(playerName),
    subMaybeNames: subMaybePlayers.map(playerName)
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
  const linked = state.member?.playerId ? findPlayer(state.member.playerId) : null;
  const players = activePlayers().filter(p=>p.type===state.playerTab);
  return `<div class="card"><h2>Mon joueur</h2>${linked
      ? `<div class="notice good"><strong>${esc(playerName(linked))}</strong><br>${linked.type==='goalie'?'Gardien':linked.type==='sub'?'Remplaçant':'Joueur régulier'} · compte associé</div>`
      : `<div class="notice alert">Ton compte n’est pas encore associé à un joueur. ${isAdmin()?'Fais l’association dans l’onglet Admin.':'Un administrateur doit associer ton compte à ton nom avant que tu puisses répondre à tes présences.'}</div>`}
    </div>
    <div class="card">
      <div class="row between"><h2 style="margin:0">Joueurs</h2>${isAdmin()?'<button class="btn primary" data-action="new-player">+ Ajouter</button>':''}</div>
      <div class="segment" style="margin-top:12px">${Object.entries(types).map(([k,v])=>`<button data-player-tab="${k}" class="${state.playerTab===k?'active':''}">${v}</button>`).join('')}</div>
      ${players.length?players.map(p=>`<div class="list-row"><div><div class="person-name">${playerName(p)}</div><div class="person-meta">${p.type==='goalie'?'Gardien':p.type==='sub'?'Remplaçant':'Régulier'}</div></div>${isAdmin()?`<button class="btn small ghost" data-action="edit-player" data-player="${p.id}">Modifier</button>`:''}</div>`).join(''):'<div class="empty">Aucun joueur dans cette catégorie.</div>'}
    </div>`;
}

function renderStats() {
  if (!state.stats && !state.statsLoading) queueMicrotask(loadStats);
  if (state.statsLoading || !state.stats) return '<div class="card empty">Calcul des statistiques…</div>';
  const skaters = state.stats.players
    .filter(x=>x.skaterGp>0 || x.goals>0 || x.assists>0 || (x.absences>0 && x.goalieGp===0 && x.type!=='goalie'))
    .sort((a,b)=>(b.points-a.points)||(b.goals-a.goals)||a.name.localeCompare(b.name));
  const goalies = state.stats.players
    .filter(x=>x.goalieGp>0 || (x.absences>0 && x.skaterGp===0 && x.type==='goalie'))
    .sort((a,b)=>(a.avg-b.avg)||a.name.localeCompare(b.name));
  return `<div class="card"><h2>Statistiques de la saison</h2><div class="kpi-grid"><div class="kpi"><strong>${state.stats.finalMatches}</strong><span>matchs</span></div><div class="kpi"><strong>${state.stats.totalGoals}</strong><span>buts</span></div><div class="kpi"><strong>${activePlayers().length}</strong><span>joueurs actifs</span></div></div><p class="muted" style="margin-top:10px">Les matchs joués sont comptés selon la position de chaque match. Un joueur qui garde les buts une soirée apparaît donc aussi dans les statistiques des gardiens.</p></div>
    <div class="card"><h3 style="margin-top:0">Joueurs</h3>${skaters.length?`<table><thead><tr><th>Joueur</th><th>MJ</th><th>B</th><th>A</th><th>PTS</th><th>ABS</th></tr></thead><tbody>${skaters.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.skaterGp}</td><td>${s.goals}</td><td>${s.assists}</td><td><strong>${s.points}</strong></td><td>${s.absences}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucune statistique.</div>'}</div>
    <div class="card"><h3 style="margin-top:0">Gardiens</h3>${goalies.length?`<table><thead><tr><th>Gardien</th><th>MJ</th><th>BA</th><th>MOY</th><th>ABS</th></tr></thead><tbody>${goalies.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.goalieGp}</td><td>${s.ga}</td><td><strong>${s.avg.toFixed(2).replace('.',',')}</strong></td><td>${s.absences}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">Aucun gardien.</div>'}</div>
    <div class="card"><h3 style="margin-top:0">Historique</h3>${state.stats.history.length?state.stats.history.map(h=>`<button type="button" class="history-match-row" data-action="open-history-match" data-match="${h.id}" aria-label="Voir les détails du match du ${escAttr(formatDate(h.startAt))}"><div><div class="person-name">${formatDate(h.startAt)}</div><div class="person-meta">Foncés ${h.dark} − ${h.light} Pâles</div></div><div class="history-match-link"><span class="pill">Final</span><span aria-hidden="true">›</span></div></button>`).join(''):'<div class="empty">Aucun match terminé.</div>'}</div>`;
}

function renderSettings() {
  const admin = isAdmin();
  const linked = state.member?.playerId ? findPlayer(state.member.playerId) : null;
  const members = [...state.members].sort((a,b)=>{
    if(a.id===state.league.ownerUid) return -1;
    if(b.id===state.league.ownerUid) return 1;
    if(a.role!==b.role) return a.role==='admin'?-1:1;
    return String(a.displayName||'').localeCompare(String(b.displayName||''),'fr');
  });
  const memberIds = new Set(state.members.map(m=>m.id));
  const usedPlayerIds = new Set(state.members.map(m=>m.playerId).filter(Boolean));
  const availablePlayers = activePlayers().filter(p=>!usedPlayerIds.has(p.id));
  const pendingUsers = admin ? state.allUsers
    .filter(u=>!memberIds.has(u.id))
    .sort((a,b)=>String(a.displayName||a.email||'').localeCompare(String(b.displayName||b.email||''),'fr')) : [];
  return `${admin?`<div class="card admin-card"><div class="row between"><div><h2 style="margin:0">Mode administrateur</h2><div class="muted">Gestion de la ligue et des comptes</div></div><span class="role-badge admin">ADMIN</span></div></div>
    <div class="card"><h3 style="margin-top:0">Demandes d’accès</h3><p class="muted">Tout nouveau compte apparaît ici automatiquement. Choisis le joueur correspondant puis approuve-le. Il n’a pas besoin de se réinscrire.</p>
      ${pendingUsers.length?pendingUsers.map(u=>{
        const req=state.accessRequests.get(u.id);
        const rejected=req?.status==='rejected';
        return `<div class="member-admin-row"><div class="member-admin-head"><div class="grow"><div class="person-name">${esc(u.displayName||u.email||'Nouveau compte')}</div><div class="person-meta">${esc(u.email||'')}${rejected?' · Refusé':' · En attente'}</div></div><span class="pill ${rejected?'':'warn'}">${rejected?'Refusé':'En attente'}</span></div>
          <form data-form="approve-access" data-user-id="${u.id}" class="member-admin-controls"><select name="playerId" required><option value="">Associer à un joueur…</option>${availablePlayers.map(p=>`<option value="${p.id}">${esc(playerName(p))} · ${p.type==='goalie'?'Gardien':p.type==='sub'?'Remplaçant':'Régulier'}</option>`).join('')}</select><button class="btn small primary" ${availablePlayers.length?'':'disabled'}>Approuver</button><button type="button" class="btn small warn" data-action="reject-access" data-user="${u.id}">Rejeter</button></form>
          ${!availablePlayers.length?'<div class="tiny muted" style="margin-top:6px">Crée d’abord le joueur correspondant dans l’onglet Joueurs.</div>':''}
        </div>`;
      }).join(''):'<div class="empty">Aucun compte en attente.</div>'}
    </div>
    <div class="card"><h3 style="margin-top:0">Comptes et rôles</h3><p class="muted">Tu associes ici chaque compte approuvé à son joueur. Les comptes normaux ne peuvent pas modifier eux-mêmes cette association.</p>
      ${members.length?members.map(m=>{
        const owner=m.id===state.league.ownerUid;
        const me=m.id===state.user.uid;
        return `<div class="member-admin-row"><div class="member-admin-head"><div class="grow"><div class="person-name">${esc(m.displayName||'Membre')}</div><div class="person-meta">${esc(m.email||'')}${owner?' · Propriétaire':m.role==='admin'?' · Administrateur':' · Compte normal'}</div></div>${owner?'<span class="pill live">Propriétaire</span>':m.role==='admin'?'<span class="pill live">Admin</span>':'<span class="pill">Normal</span>'}</div>
          <div class="member-admin-controls"><select data-change="member-player" data-member="${m.id}"><option value="">Aucun joueur associé</option>${activePlayers().map(p=>`<option value="${p.id}" ${m.playerId===p.id?'selected':''}>${esc(playerName(p))} · ${p.type==='goalie'?'Gardien':p.type==='sub'?'Remplaçant':'Régulier'}</option>`).join('')}</select>
          ${!owner && !me ? `<button class="btn small ${m.role==='admin'?'warn':'primary'}" data-action="set-member-role" data-member="${m.id}" data-role="${m.role==='admin'?'member':'admin'}">${m.role==='admin'?'Remettre normal':'Nommer admin'}</button>`:''}</div></div>`;
      }).join(''):'<div class="empty">Aucun compte.</div>'}
    </div>
    <div class="card"><h3 style="margin-top:0">Configuration des matchs</h3><form data-form="league-settings"><label>Nombre de périodes</label><input name="periodCount" type="number" min="1" max="9" value="${state.league.settings?.periodCount||3}" required><label>Durée d’une période (minutes)</label><input name="periodMinutes" type="number" min="1" max="120" value="${state.league.settings?.periodMinutes||20}" required><label>Heure habituelle du lundi</label><input name="gameTime" type="time" value="${escAttr(state.league.settings?.gameTime||'20:00')}" required><label>Nombre de semaines créées d’avance</label><input name="scheduleWeeks" type="number" min="8" max="52" value="${state.league.settings?.scheduleWeeks||44}" required><p class="muted">Le calendrier crée automatiquement les lundis futurs. Dans Calendrier, un admin peut aussi ajouter un match manuel ou supprimer un lundi; un lundi supprimé ne sera pas recréé automatiquement.</p><button class="btn primary wide" style="margin-top:12px">Enregistrer</button></form></div>
    <div class="card"><h3 style="margin-top:0">Données</h3><button class="btn wide" data-action="export-json">Exporter la ligue en JSON</button><p class="muted">Copie locale des joueurs, matchs, alignements, réponses et buts.</p></div>`:''}
    <div class="card"><h3 style="margin-top:0">Mon compte</h3><div class="row between"><div><strong>${esc(userDisplayName())}</strong><br><span class="muted">${esc(state.user.email||'')}</span></div><span class="role-badge ${admin?'admin':'member'}">${admin?'Administrateur':'Compte normal'}</span></div><p class="muted" style="margin-top:12px">${linked?`Associé à ${esc(playerName(linked))}.`:'Aucun joueur associé à ce compte.'}</p><p class="muted">Cosom v${APP_VERSION}</p><button class="btn" data-action="logout">Déconnexion</button></div>`;
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

async function renderLeagueChooser() {
  if (!state.user) return;
  let appConfig = state.appConfig;
  if (!appConfig) {
    try {
      const cfg = await getDoc(doc(state.db,'app','config'));
      if (cfg.exists()) appConfig = cfg.data();
    } catch (e) { console.warn('App config',e); }
  }
  state.appConfig = appConfig;
  state.leagueId = null;

  if (!appConfig) {
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card" style="width:min(520px,100%)"><div class="row between"><div><div class="logo">COSOM</div><div class="muted">${esc(userDisplayName())}</div></div><button class="btn small ghost" data-action="logout">Sortir</button></div><h2>Créer la ligue</h2><p class="muted">Aucune ligue n’existe encore. Le premier compte qui la crée devient administrateur propriétaire.</p><button class="btn primary wide" data-action="create-league">Créer la ligue du lundi</button></div></div>`;
    return;
  }

  await ensureAccessRequest(appConfig.leagueId);
  watchAccessRequest(appConfig.leagueId);
}

async function ensureAccessRequest(leagueId) {
  const ref = doc(state.db,'accessRequests',state.user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref,{
      uid:state.user.uid,
      leagueId,
      displayName:userDisplayName(),
      email:state.user.email||null,
      status:'pending',
      createdAt:serverTimestamp()
    });
  }
}

function watchAccessRequest(leagueId) {
  if (state.accessWaitUnsub) { try { state.accessWaitUnsub(); } catch {} }
  const ref=doc(state.db,'accessRequests',state.user.uid);
  state.accessWaitUnsub=onSnapshot(ref, async snap=>{
    const req=snap.exists()?{id:snap.id,...snap.data()}:null;
    if (req?.status==='approved') {
      try {
        const memberSnap=await getDoc(doc(state.db,'leagues',leagueId,'members',state.user.uid));
        if(memberSnap.exists()) {
          if(state.accessWaitUnsub){try{state.accessWaitUnsub();}catch{} state.accessWaitUnsub=null;}
          return selectLeague(leagueId);
        }
      } catch(e){ console.warn('Approved membership check',e); }
    }
    renderPendingAccess(req);
  },handleError);
}

function renderPendingAccess(req) {
  const rejected=req?.status==='rejected';
  root.innerHTML=`<div class="auth-wrap"><div class="auth-card" style="width:min(520px,100%)"><div class="row between"><div><div class="logo">COSOM</div><div class="muted">${esc(userDisplayName())}</div></div><button class="btn small ghost" data-action="logout">Sortir</button></div><h2>${rejected?'Accès refusé':'Compte en attente'}</h2>${rejected?`<div class="notice alert">Un administrateur a refusé l’accès de ce compte. Communique avec l’administrateur de la ligue si c’est une erreur.</div>`:`<div class="notice good">Ton compte est bien créé.</div><p>Un administrateur doit maintenant <strong>associer ton compte à ton joueur</strong> avant que tu puisses accéder à la ligue.</p><p class="muted">Tu n’as rien d’autre à faire et tu n’as pas à te réinscrire. Cette page s’ouvrira automatiquement dès que ton compte sera approuvé.</p>`}</div></div>`;
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
    const playerMap = new Map(state.players.map(p=>[p.id,{id:p.id,name:playerName(p),type:p.type,skaterGp:0,goalieGp:0,goals:0,assists:0,points:0,absences:0,ga:0,avg:0}]));
    const history = [];
    let totalGoals = 0;
    for (const m of finals) {
      const gSnap = await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'goals'));
      let assignments;
      if (Array.isArray(m.finalLineup) && m.finalLineup.length) {
        assignments = new Map(m.finalLineup.map(a=>[a.playerId,a]));
      } else {
        const aSnap = await getDocs(collection(state.db,'leagues',state.leagueId,'matches',m.id,'assignments'));
        assignments = new Map(aSnap.docs.map(d=>[d.id,d.data()]));
      }
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
        const assignment = assignments.get(p.id);
        const team = assignment?.team;
        if (team==='dark' || team==='light') {
          const position = matchPosition(p, assignment);
          if (position==='goalie') {
            s.goalieGp++;
            s.ga += team==='dark'?light:dark;
          } else {
            s.skaterGp++;
          }
        } else if (p.type!=='sub') {
          s.absences++;
        }
      }
      history.push({id:m.id,startAt:m.startAt,dark,light});
    }
    for (const s of playerMap.values()) { s.points=s.goals+s.assists; s.avg=s.goalieGp?s.ga/s.goalieGp:0; }
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
    else if (action==='delete-calendar-match') await deleteCalendarMatch(el.dataset.match);
    else if (action==='new-player') openPlayerEditor();
    else if (action==='edit-player') openPlayerEditor(findPlayer(el.dataset.player));
    else if (action==='assign') await setAssignment(el.dataset.player,el.dataset.team);
    else if (action==='match-position') await setMatchPosition(el.dataset.player,el.dataset.position);
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
    else if (action==='calendar-attendance') openCalendarAttendance(el.dataset.match,el.dataset.status);
    else if (action==='calendar-match') { selectMatch(el.dataset.match); state.tab='calendar'; render(); }
    else if (action==='open-history-match') { selectMatch(el.dataset.match); state.tab='match'; render(); }
    else if (action==='open-match-tab') { state.tab='match'; render(); }
    else if (action==='copy-invite') await copyInvite();
    else if (action==='export-json') await exportLeagueJson();
    else if (action==='set-member-role') await setMemberRole(el.dataset.member,el.dataset.role);
    else if (action==='reject-access') await rejectAccess(el.dataset.user);
  } catch (err) { handleError(err); }
});

root.addEventListener('change', async e => {
  const action = e.target.dataset.change;
  try {
    if (action==='select-match' && e.target.value) selectMatch(e.target.value);
    if (action==='member-player') {
      if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
      await updateDoc(doc(state.db,'leagues',state.leagueId,'members',e.target.dataset.member),{playerId:e.target.value||null,updatedAt:serverTimestamp(),updatedBy:state.user.uid});
      toast('Association mise à jour.');
    }
    if (action==='match-position') await setMatchPosition(e.target.dataset.player,e.target.value);
  } catch (err) { handleError(err); }
});

root.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]'); if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  try {
    if (form.dataset.form==='auth') await submitAuth(fd);
    if (form.dataset.form==='league-settings') await saveLeagueSettings(fd);
    if (form.dataset.form==='approve-access') await approveAccess(form.dataset.userId,fd);
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
    if(kind==='goal') await saveGoal(fd,form.dataset.goalId||null,form.dataset.team,Number(form.dataset.period||1));
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
  const existing=await getDoc(doc(state.db,'app','config'));
  if(existing.exists()) throw new Error('La ligue existe déjà. Utilise le code d’invitation pour la rejoindre.');
  const name=String(fd.get('name')||'').trim(); const season=String(fd.get('season')||'').trim();
  const leagueRef=doc(collection(state.db,'leagues')); const code=randomCode();
  const batch=writeBatch(state.db);
  batch.set(leagueRef,{name,season,ownerUid:state.user.uid,inviteCode:code,settings:{periodCount:3,periodMinutes:20,gameTime:'20:00',scheduleWeeks:44},createdAt:serverTimestamp()});
  batch.set(doc(state.db,'leagues',leagueRef.id,'members',state.user.uid),{uid:state.user.uid,role:'admin',displayName:userDisplayName(),email:state.user.email||null,playerId:null,joinedAt:serverTimestamp()});
  batch.set(doc(state.db,'users',state.user.uid,'leagues',leagueRef.id),{leagueId:leagueRef.id,joinedAt:serverTimestamp()});
  batch.set(doc(state.db,'invites',code),{leagueId:leagueRef.id,leagueName:name,active:true,createdBy:state.user.uid,createdAt:serverTimestamp()});
  batch.set(doc(state.db,'app','config'),{leagueId:leagueRef.id,ownerUid:state.user.uid,createdAt:serverTimestamp()});
  await batch.commit(); modal.close(); await selectLeague(leagueRef.id); toast('Ligue créée. Tu es administrateur.');
}

function openJoinLeague() {
  openModal(`<h2>Joindre une ligue</h2><form data-modal-form="join-league"><label>Code d’invitation</label><input name="code" maxlength="8" style="text-transform:uppercase;letter-spacing:3px" required><div class="modal-actions"><button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">Joindre</button></div></form>`);
}

async function joinLeague(fd) {
  const code=String(fd.get('code')||'').trim().toUpperCase();
  const inviteSnap=await getDoc(doc(state.db,'invites',code));
  if(!inviteSnap.exists()||inviteSnap.data().active!==true) throw new Error('Code d’invitation invalide.');
  const leagueId=inviteSnap.data().leagueId;
  const cfg=await getDoc(doc(state.db,'app','config'));
  if(cfg.exists() && cfg.data().leagueId!==leagueId) throw new Error('Ce code ne correspond pas à la ligue de cette application.');
  const batch=writeBatch(state.db);
  batch.set(doc(state.db,'leagues',leagueId,'members',state.user.uid),{uid:state.user.uid,role:'member',displayName:userDisplayName(),email:state.user.email||null,playerId:null,inviteCode:code,joinedAt:serverTimestamp()});
  batch.set(doc(state.db,'users',state.user.uid,'leagues',leagueId),{leagueId,joinedAt:serverTimestamp()});
  await batch.commit(); modal.close(); await selectLeague(leagueId); toast('Ligue rejointe avec un compte normal.');
}

async function approveAccess(uid, fd) {
  if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
  const playerId=String(fd.get('playerId')||'');
  const player=findPlayer(playerId);
  if(!player || player.archived) throw new Error('Choisis un joueur valide.');
  const already=state.members.find(m=>m.playerId===playerId);
  if(already) throw new Error('Ce joueur est déjà associé à un autre compte.');
  const user=state.allUsers.find(u=>u.id===uid);
  if(!user) throw new Error('Compte introuvable.');
  const batch=writeBatch(state.db);
  batch.set(doc(state.db,'leagues',state.leagueId,'members',uid),{
    uid,role:'member',displayName:user.displayName||user.email||'Membre',email:user.email||null,playerId,
    approvedAt:serverTimestamp(),approvedBy:state.user.uid,joinedAt:serverTimestamp()
  });
  batch.set(doc(state.db,'accessRequests',uid),{
    uid,leagueId:state.leagueId,displayName:user.displayName||null,email:user.email||null,status:'approved',playerId,
    reviewedAt:serverTimestamp(),reviewedBy:state.user.uid
  },{merge:true});
  await batch.commit();
  toast(`${user.displayName||user.email||'Compte'} approuvé.`);
}

async function rejectAccess(uid) {
  if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
  if(!confirm('Refuser l’accès de ce compte?')) return;
  const user=state.allUsers.find(u=>u.id===uid);
  await setDoc(doc(state.db,'accessRequests',uid),{
    uid,leagueId:state.leagueId,displayName:user?.displayName||null,email:user?.email||null,status:'rejected',
    reviewedAt:serverTimestamp(),reviewedBy:state.user.uid
  },{merge:true});
  toast('Accès refusé.');
}

function openNewMatch() {
  const nextMonday=getCurrentOrNextMonday();
  const date=localDateKey(nextMonday);
  const gameTime=String(state.league?.settings?.gameTime||'20:00');
  openModal(`<h2>Ajouter un match</h2><form data-modal-form="new-match"><div class="grid2"><div><label>Date</label><input name="date" type="date" value="${date}" required></div><div><label>Heure</label><input name="time" type="time" value="${escAttr(gameTime)}" required></div></div><label>Lieu</label><input name="location" placeholder="Gymnase / aréna"><div class="notice">Tu peux ajouter un match n’importe quel jour. Si tu recrées manuellement un lundi que tu avais supprimé, cette date redevient active.</div><div class="modal-actions"><button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">Créer</button></div></form>`);
}

async function createMatch(fd) {
  if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
  const dateKey=String(fd.get('date')||'');
  const time=String(fd.get('time')||'');
  const start=new Date(`${dateKey}T${time}:00`);
  if(Number.isNaN(start.getTime())) throw new Error('Date ou heure invalide.');
  if(state.matches.some(m=>localDateKey(new Date(tsMillis(m.startAt)))===dateKey && m.status!=='final')) throw new Error('Un match existe déjà à cette date.');
  const mins=Number(state.league.settings?.periodMinutes||20);
  const count=Number(state.league.settings?.periodCount||3);
  const ref=doc(collection(state.db,'leagues',state.leagueId,'matches'));
  const batch=writeBatch(state.db);
  batch.set(ref,{
    startAt:Timestamp.fromDate(start),location:String(fd.get('location')||'').trim(),status:'scheduled',period:1,periodCount:count,periodSeconds:mins*60,
    clock:{running:false,remainingSeconds:mins*60,endsAt:null},startedAt:null,finalizedAt:null,alarmDeviceId:null,alarmDeviceName:null,attendance:{},autoScheduled:false,createdAt:serverTimestamp(),createdBy:state.user.uid
  });
  if(start.getDay()===1){
    batch.update(doc(state.db,'leagues',state.leagueId),{'settings.skippedDates':arrayRemove(dateKey),updatedAt:serverTimestamp()});
  }
  await batch.commit();
  modal.close(); selectMatch(ref.id); state.tab='calendar'; toast('Match ajouté au calendrier.');
}

async function deleteCalendarMatch(matchId) {
  if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
  const match=state.matches.find(m=>m.id===matchId);
  if(!match) throw new Error('Match introuvable.');
  if(match.status!=='scheduled') throw new Error('Seul un match à venir peut être supprimé du calendrier.');
  const dateKey=localDateKey(new Date(tsMillis(match.startAt)));
  if(!confirm(`Supprimer le match du ${formatDate(match.startAt)}?\n\nLes réponses déjà enregistrées pour ce match seront aussi supprimées.`)) return;

  const base=['leagues',state.leagueId,'matches',matchId];
  const [assignments,responses,goals]=await Promise.all([
    getDocs(collection(state.db,...base,'assignments')),
    getDocs(collection(state.db,...base,'responses')),
    getDocs(collection(state.db,...base,'goals'))
  ]);
  const batch=writeBatch(state.db);
  for(const snap of [assignments,responses,goals]) for(const d of snap.docs) batch.delete(d.ref);
  batch.delete(doc(state.db,...base));
  const d=new Date(tsMillis(match.startAt));
  if(d.getDay()===1){
    batch.update(doc(state.db,'leagues',state.leagueId),{'settings.skippedDates':arrayUnion(dateKey),updatedAt:serverTimestamp()});
  }
  await batch.commit();
  if(state.selectedMatchId===matchId){
    clearMatchSubscriptions();
    state.selectedMatchId=null; state.currentMatch=null; state.assignments=new Map(); state.responses=new Map(); state.goals=[];
  }
  toast(d.getDay()===1?'Match supprimé. Ce lundi restera exclu du calendrier automatique.':'Match supprimé.');
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
  if(team==='absent') {
    await deleteDoc(ref).catch(()=>{});
    return;
  }
  const player=findPlayer(playerId);
  if(!player) throw new Error('Joueur introuvable.');
  const current=state.assignments.get(playerId);
  const position=matchPosition(player,current);
  await setDoc(ref,{playerId,team,position,updatedAt:serverTimestamp(),updatedBy:state.user.uid},{merge:true});
}

async function setMatchPosition(playerId,position) {
  if(!state.currentMatch) return;
  if(state.currentMatch.status==='final' && !isAdmin()) return;
  if(!['skater','goalie'].includes(position)) throw new Error('Position invalide.');
  const assignment=state.assignments.get(playerId);
  if(!assignment || !['dark','light'].includes(assignment.team)) throw new Error('Assigne d’abord ce joueur à une équipe.');

  await setDoc(doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id,'assignments',playerId),{
    playerId,team:assignment.team,position,updatedAt:serverTimestamp(),updatedBy:state.user.uid
  },{merge:true});

  if(state.currentMatch.status==='final' && isAdmin()) {
    const finalLineup = buildFinalLineup(playerId, position);
    await updateDoc(matchRef(),{finalLineup,updatedAt:serverTimestamp()});
    state.currentMatch = {...state.currentMatch,finalLineup};
    state.matches = state.matches.map(m=>m.id===state.currentMatch.id?{...m,finalLineup}:m);
  }

  state.stats=null;
  toast(position==='goalie'?'Position : gardien pour ce match.':'Position : joueur pour ce match.');
}

function openGoalEditor(team,goal=null) {
  if(!state.currentMatch) return;
  if(state.currentMatch.status==='final' && !isAdmin()) return;
  const eligible=activePlayers().filter(p=>state.assignments.get(p.id)?.team===team);
  if(!eligible.length) return toast(`Ajoute d’abord des joueurs chez les ${team==='dark'?'Foncés':'Pâles'}.`);

  const scorerId=goal?.scorerId||'';
  const assists=new Set(goal?.assists||[]);
  const period=Number(goal?.period||state.currentMatch.period||1);
  const capturedRemaining=goal ? goalClockRemainingSeconds(goal,state.currentMatch) : getRemainingSeconds(state.currentMatch);
  const clockValue=capturedRemaining==null?'':formatClock(capturedRemaining);

  openModal(`<h2>${goal?'Modifier':'Ajouter'} un but · ${team==='dark'?'Foncés':'Pâles'}</h2><form data-modal-form="goal" data-team="${team}" data-period="${period}" ${goal?`data-goal-id="${goal.id}"`:''}><label>Temps au chrono</label><input name="clockTime" inputmode="numeric" placeholder="MM:SS" value="${escAttr(clockValue)}" required><div class="tiny muted">${goal?'Tu peux corriger le temps manuellement.':'Le temps est capturé dès que tu appuies sur + But; le temps passé à entrer le buteur et les passes ne le décale pas.'}</div><label>Buteur</label><select name="scorer" required><option value="">Choisir…</option>${eligible.map(p=>`<option value="${p.id}" ${p.id===scorerId?'selected':''}>${esc(playerName(p))}</option>`).join('')}</select><label>Passes (maximum 2)</label><div>${eligible.map(p=>`<div class="check-row"><input type="checkbox" name="assist" value="${p.id}" ${assists.has(p.id)?'checked':''} id="a-${p.id}"><label for="a-${p.id}">${esc(playerName(p))}</label></div>`).join('')}</div><div class="modal-actions">${goal?'<button type="button" class="btn danger" data-action-modal="delete-goal">Supprimer</button>':''}<button type="button" class="btn" data-modal-close>Annuler</button><button class="btn primary grow">${goal?'Enregistrer':'Confirmer le but'}</button></div></form>`);
  modal.querySelectorAll('input[name="assist"]').forEach(cb=>cb.addEventListener('change',()=>{const checked=[...modal.querySelectorAll('input[name="assist"]:checked')];if(checked.length>2){cb.checked=false;toast('Maximum 2 passes.');}}));
  if(goal){modal.querySelector('[data-action-modal="delete-goal"]').addEventListener('click',async()=>{if(confirm('Supprimer ce but?')){await deleteDoc(doc(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id,'goals',goal.id));state.stats=null;modal.close();toast('But supprimé.');}});}
}

async function saveGoal(fd,id,team,period) {
  const scorer=String(fd.get('scorer')||'');
  const assists=fd.getAll('assist').map(String).filter(x=>x&&x!==scorer).slice(0,2);
  if(!scorer) throw new Error('Choisis le buteur.');

  const current=state.currentMatch;
  const periodSeconds=Number(current.periodSeconds||state.league.settings?.periodMinutes*60||1200);
  const clockRemainingSeconds=parseClockInput(fd.get('clockTime'),periodSeconds);
  const elapsedSeconds=Math.max(0,periodSeconds-clockRemainingSeconds);
  const data={
    team,
    scorerId:scorer,
    assists,
    period:Number(period||current.period||1),
    clockRemainingSeconds,
    elapsedSeconds,
    updatedAt:serverTimestamp(),
    updatedBy:state.user.uid
  };

  if(id) await setDoc(doc(state.db,'leagues',state.leagueId,'matches',current.id,'goals',id),data,{merge:true});
  else await addDoc(collection(state.db,'leagues',state.leagueId,'matches',current.id,'goals'),{...data,createdAt:serverTimestamp()});
  state.stats=null;
  modal.close();
  toast(id?'But modifié.':'But ajouté.');
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
  const remaining=getRemainingSeconds(state.currentMatch);
  const aSnap=await getDocs(collection(state.db,'leagues',state.leagueId,'matches',state.currentMatch.id,'assignments'));
  const latestAssignments=new Map(aSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const finalLineup=[...latestAssignments.entries()]
    .filter(([,a])=>a.team==='dark'||a.team==='light')
    .map(([playerId,a])=>({playerId,team:a.team,position:matchPosition(findPlayer(playerId),a)}));

  await updateDoc(matchRef(),{
    status:'final',
    finalizedAt:serverTimestamp(),
    finalLineup,
    'clock.running':false,
    'clock.remainingSeconds':remaining,
    'clock.endsAt':null
  });

  const localFinal={
    ...state.currentMatch,
    status:'final',
    finalLineup,
    clock:{...(state.currentMatch.clock||{}),running:false,remainingSeconds:remaining,endsAt:null}
  };
  state.currentMatch=localFinal;
  state.matches=state.matches.map(m=>m.id===localFinal.id?{...m,...localFinal}:m);
  state.stats=null;
  toast('Match terminé.');
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

async function setMemberRole(uid, role) {
  if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
  if(!['admin','member'].includes(role)) throw new Error('Rôle invalide.');
  if(uid===state.league.ownerUid) throw new Error('Le propriétaire doit rester administrateur.');
  if(uid===state.user.uid) throw new Error('Tu ne peux pas modifier ton propre rôle.');
  const member = state.members.find(m=>m.id===uid);
  if(!member) throw new Error('Compte introuvable.');
  const label = member.displayName || 'ce membre';
  const question = role==='admin' ? `Donner les droits administrateur à ${label}?` : `Remettre ${label} en compte normal?`;
  if(!confirm(question)) return;
  await updateDoc(doc(state.db,'leagues',state.leagueId,'members',uid),{role,updatedAt:serverTimestamp(),updatedBy:state.user.uid});
  toast(role==='admin'?'Administrateur ajouté.':'Compte remis en mode normal.');
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
  const skippedDates=new Set(Array.isArray(state.league.settings?.skippedDates)?state.league.settings.skippedDates:[]);
  const mins=Number(state.league.settings?.periodMinutes||20);
  const count=Number(state.league.settings?.periodCount||3);
  const batch=writeBatch(state.db);
  let writes=0;
  for(let i=0;i<weeks;i++){
    const d=new Date(first); d.setDate(first.getDate()+i*7);
    const dateKey=localDateKey(d);
    if(existingDates.has(dateKey) || skippedDates.has(dateKey)) continue;
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
  if(!isAdmin()) throw new Error('Réservé aux administrateurs.');
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
function defaultMatchPosition(p){return p?.type==='goalie'?'goalie':'skater';}
function matchPosition(p,assignment){return assignment?.position==='goalie'||assignment?.position==='skater'?assignment.position:defaultMatchPosition(p);}
function buildFinalLineup(overridePlayerId=null,overridePosition=null){
  return [...state.assignments.entries()]
    .filter(([,a])=>a.team==='dark'||a.team==='light')
    .map(([playerId,a])=>({
      playerId,
      team:a.team,
      position:playerId===overridePlayerId?overridePosition:matchPosition(findPlayer(playerId),a)
    }));
}
function goalClockRemainingSeconds(goal,match){
  const periodSeconds=Number(match?.periodSeconds||state.league?.settings?.periodMinutes*60||1200);
  const explicit=Number(goal?.clockRemainingSeconds);
  if(Number.isFinite(explicit)) return Math.max(0,Math.min(periodSeconds,explicit));
  const elapsed=Number(goal?.elapsedSeconds);
  if(Number.isFinite(elapsed) && elapsed>0) return Math.max(0,Math.min(periodSeconds,periodSeconds-elapsed));
  return null;
}
function parseClockInput(value,maxSeconds){
  const raw=String(value||'').trim();
  const match=raw.match(/^(\d{1,3}):([0-5]\d)$/);
  if(!match) throw new Error('Entre le temps au format MM:SS, par exemple 14:37.');
  const seconds=Number(match[1])*60+Number(match[2]);
  if(seconds<0 || seconds>maxSeconds) throw new Error(`Le temps doit être entre 00:00 et ${formatClock(maxSeconds)}.`);
  return seconds;
}
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
