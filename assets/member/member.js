import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bnxtvfetznuoqqvgppob.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_j2pEuGYXzTckGj8kBnuPtA_T_mFg1dN';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: 'physiqai-web-member-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

const state = {
  authMode: 'signin',
  user: null,
  profile: null,
  plans: [],
  sessions: [],
  checkIns: [],
  entitlement: null,
  selectedReadiness: { energy: 4, recovery: 4, adherence: 4 },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const byId = (id) => document.getElementById(id);

function id() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function initials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'PA';
}

function formatDate(value) {
  if (!value) return 'Today';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function humanGoal(value) {
  return value?.trim() || 'Your goal';
}

function toast(message, isError = false) {
  const node = byId('toast');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.hidden = false;
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => { node.hidden = true; }, 4800);
}

function setBusy(button, busy, normalText) {
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalText ||= normalText || button.textContent;
  button.textContent = busy ? 'Working…' : button.dataset.originalText;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function element(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function showAuth() {
  byId('auth-view').hidden = false;
  byId('app-view').hidden = true;
}

function showApp() {
  byId('auth-view').hidden = true;
  byId('app-view').hidden = false;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === 'signup';
  byId('name-field').hidden = !isSignup;
  byId('auth-password').autocomplete = isSignup ? 'new-password' : 'current-password';
  byId('auth-submit').textContent = isSignup ? 'Create my training account →' : 'Enter training dashboard →';
  $$('.tab').forEach((tab) => {
    const active = tab.dataset.authMode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  byId('auth-error').textContent = '';
}

function activateView(target) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === target));
  $$('[data-view-target]').forEach((button) => button.classList.toggle('active', button.dataset.viewTarget === target));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function sessionUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user || null;
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  if (error) throw error;
  state.profile = data || { id: state.user.id, display_name: state.user.user_metadata?.full_name || '', equipment: [] };
}

async function loadMemberData() {
  const [plansResult, sessionsResult, checkInsResult, entitlementResult] = await Promise.all([
    supabase.from('workout_plans').select('*').eq('status', 'active').order('created_at', { ascending: false }),
    supabase.from('workout_sessions').select('*').order('session_date', { ascending: false }).limit(30),
    supabase.from('training_check_ins').select('*').order('check_in_date', { ascending: false }).limit(8),
    supabase.from('subscription_entitlements').select('status, product_id, expires_at, verified_at').maybeSingle(),
  ]);
  for (const result of [plansResult, sessionsResult, checkInsResult, entitlementResult]) {
    if (result.error) throw result.error;
  }
  state.plans = plansResult.data || [];
  state.sessions = sessionsResult.data || [];
  state.checkIns = checkInsResult.data || [];
  state.entitlement = entitlementResult.data || null;
}

function activePlan() {
  return state.plans[0] || null;
}

function weeklySessions() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const key = dateKey(monday);
  return state.sessions.filter((item) => item.session_date >= key);
}

function currentReadiness() {
  const checkIn = state.checkIns[0];
  if (!checkIn) return null;
  const fields = [checkIn.energy, checkIn.recovery, checkIn.adherence].filter(Number.isFinite);
  if (!fields.length) return null;
  return Math.round((fields.reduce((total, value) => total + value, 0) / fields.length) * 20);
}

function planSchedule(plan) {
  return Array.isArray(plan?.schedule) ? plan.schedule : [];
}

function scheduleTitle(item, index) {
  if (typeof item === 'string') return item;
  return item?.title || item?.name || item?.focus || `Training day ${index + 1}`;
}

function scheduleDetail(item) {
  if (typeof item === 'object' && item) {
    const exercises = Array.isArray(item.exercises) ? item.exercises.length : null;
    return item.description || item.duration || (exercises ? `${exercises} movements` : 'Focused session');
  }
  return 'Focused session';
}

function renderPlanRows(container, plan, limit = 4) {
  clearNode(container);
  const schedule = planSchedule(plan).slice(0, limit);
  if (!schedule.length) {
    const empty = element('div', { className: 'empty-state' });
    empty.append(element('strong', { text: 'Your next block starts here.' }), document.createTextNode('Build a focused weekly plan, then turn the sessions into logged momentum.'));
    container.append(empty);
    return;
  }
  schedule.forEach((item, index) => {
    const row = element('div', { className: 'plan-row' });
    const day = element('span', { className: 'plan-day', text: `D${index + 1}` });
    const copy = element('div');
    copy.append(element('strong', { text: scheduleTitle(item, index) }), element('span', { text: scheduleDetail(item) }));
    row.append(day, copy, element('span', { className: 'mini', text: 'Ready' }));
    container.append(row);
  });
}

function renderSessions(container, sessions, limit = 5) {
  clearNode(container);
  if (!sessions.length) {
    const empty = element('div', { className: 'empty-state' });
    empty.append(element('strong', { text: 'The work starts when you do.' }), document.createTextNode('Log a completed session to put your first marker on the board.'));
    container.append(empty);
    return;
  }
  sessions.slice(0, limit).forEach((item) => {
    const row = element('div', { className: 'session-row' });
    const icon = element('span', { className: 'plan-day', text: '✓' });
    const copy = element('div');
    copy.append(element('strong', { text: item.notes || 'Training session completed' }), element('span', { text: `${formatDate(item.session_date)} · ${Math.round((item.duration_seconds || 0) / 60)} min · RPE ${item.perceived_effort || '—'}` }));
    row.append(icon, copy, element('span', { className: 'mini', text: 'Logged' }));
    container.append(row);
  });
}

function renderActivePlan() {
  const target = byId('active-plan-container');
  clearNode(target);
  const plan = activePlan();
  if (!plan) {
    const empty = element('article', { className: 'plan-card' });
    empty.append(element('span', { className: 'tag hot', text: 'Ready when you are' }), element('h3', { text: 'No active training block yet.' }), element('p', { text: 'Pick a focus and weekly cadence. Your secure account will keep this plan with you across the next-generation PhysiqAI experience.' }));
    target.append(empty);
    return;
  }
  const card = element('article', { className: 'plan-card' });
  card.append(element('span', { className: 'tag lime', text: 'Active training block' }), element('h3', { text: plan.title }), element('p', { text: `Version ${plan.version || 1} · Built ${formatDate(plan.created_at?.slice(0, 10))}` }));
  const chipRow = element('div', { className: 'day-chip-row' });
  planSchedule(plan).forEach((item, index) => chipRow.append(element('span', { className: 'day-chip', text: `Day ${index + 1}: ${scheduleTitle(item, index)}` })));
  card.append(chipRow);
  target.append(card);
}

function renderDashboard() {
  const profile = state.profile || {};
  const plan = activePlan();
  const weekly = weeklySessions();
  const minutes = weekly.reduce((total, session) => total + Math.round((session.duration_seconds || 0) / 60), 0);
  const readiness = currentReadiness();
  const name = profile.display_name || state.user?.user_metadata?.full_name || 'Athlete';

  byId('member-initials').textContent = initials(name);
  byId('member-name').textContent = name;
  byId('today-subtitle').textContent = profile.training_goal ? `Goal: ${profile.training_goal}` : 'Personalize your goal in your training profile.';
  byId('sessions-week').textContent = String(weekly.length);
  byId('sessions-delta').textContent = weekly.length ? `${weekly.length} session${weekly.length === 1 ? '' : 's'} recorded` : 'Start your streak';
  byId('minutes-week').textContent = String(minutes);
  byId('readiness-value').textContent = readiness ? `${readiness}%` : '—';
  byId('focus-value').textContent = humanGoal(profile.training_goal);
  byId('next-workout-title').textContent = plan ? plan.title : 'Build your first training week.';
  byId('next-workout-copy').textContent = plan ? `${planSchedule(plan).length} focused sessions are ready. Log your work and keep the chain moving.` : 'Choose a focused starter plan, then log your work here or in the PhysiqAI app.';
  byId('next-workout-button').textContent = plan ? 'Open training plan →' : 'Build my plan →';

  const active = state.entitlement && ['active', 'grace_period'].includes(state.entitlement.status) && (!state.entitlement.expires_at || new Date(state.entitlement.expires_at) > new Date());
  byId('membership-status').textContent = active ? 'Verified membership' : 'Secure account workspace';
  byId('member-tier').textContent = active ? 'Verified member' : 'Member dashboard';
  byId('entitlement-copy').textContent = active ? `Verified ${state.entitlement.product_id}` : 'Membership is verified in the mobile app';

  renderPlanRows(byId('today-plan-list'), plan);
  renderSessions(byId('latest-sessions'), state.sessions, 3);
  renderActivePlan();
  renderSessions(byId('session-history'), state.sessions, 10);
  byId('profile-name').value = profile.display_name || '';
  byId('profile-goal').value = profile.training_goal || '';
  byId('profile-equipment').value = Array.isArray(profile.equipment) ? profile.equipment.join(', ') : '';
}

async function handleAuth(event) {
  event.preventDefault();
  const button = byId('auth-submit');
  const email = byId('auth-email').value.trim().toLowerCase();
  const password = byId('auth-password').value;
  const name = byId('auth-name').value.trim();
  const errorNode = byId('auth-error');
  errorNode.textContent = '';
  if (!email || !password) {
    errorNode.textContent = 'Enter your email and password to continue.';
    return;
  }
  setBusy(button, true);
  try {
    if (state.authMode === 'signup') {
      if (!name) throw new Error('Add your name so your dashboard can welcome you properly.');
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/member` },
      });
      if (error) throw error;
      if (!data.session) {
        toast('Check your email to confirm your account, then return here to sign in.');
        setAuthMode('signin');
        return;
      }
      state.user = data.user;
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.user = data.user;
    }
    await hydrate();
  } catch (error) {
    errorNode.textContent = error.message || 'We could not sign you in. Try again.';
  } finally {
    setBusy(button, false);
  }
}

async function hydrate() {
  state.user = await sessionUser();
  if (!state.user) {
    showAuth();
    return;
  }
  try {
    await loadProfile();
    await loadMemberData();
    renderDashboard();
    showApp();
  } catch (error) {
    console.error(error);
    toast('Your account is signed in, but dashboard data could not load. Please refresh.', true);
    showApp();
  }
}

function starterSchedule(focus, days) {
  const structures = {
    'Strength foundation': ['Lower strength', 'Upper strength', 'Full body power', 'Optional mobility', 'Performance circuit'],
    'Muscle building': ['Upper push', 'Lower body', 'Upper pull', 'Full body volume', 'Arms & conditioning'],
    'Conditioning': ['Engine intervals', 'Full body strength', 'Zone 2 conditioning', 'Athletic circuit', 'Recovery mobility'],
    'Full-body consistency': ['Full body A', 'Full body B', 'Full body C', 'Optional conditioning', 'Recovery session'],
  };
  return structures[focus].slice(0, Number(days)).map((title, index) => ({
    title,
    description: index === 0 ? 'Start strong with a focused 45–60 minute session' : 'Build quality reps and sustainable momentum',
    exercises: Array.from({ length: 5 }, (_, exerciseIndex) => ({ order: exerciseIndex + 1 })),
  }));
}

async function createPlan(event) {
  event.preventDefault();
  const button = $('#plan-form button');
  setBusy(button, true);
  try {
    const focus = byId('plan-focus').value;
    const days = byId('plan-days').value;
    const current = activePlan();
    if (current) {
      const { error: archiveError } = await supabase.from('workout_plans').update({ status: 'archived', archived_at: new Date().toISOString() }).eq('id', current.id);
      if (archiveError) throw archiveError;
    }
    const schedule = starterSchedule(focus, days);
    const plan = {
      user_id: state.user.id,
      title: `${focus} · ${days}-day block`,
      schedule,
      source: 'manual',
      status: 'active',
      version: (current?.version || 0) + 1,
      client_reference: `web-plan-${id()}`,
      plan_payload: { source: 'web-member-dashboard', created_from: 'starter-plan-builder', days: Number(days) },
    };
    const { data, error } = await supabase.from('workout_plans').insert(plan).select('*').single();
    if (error) throw error;
    state.plans = [data];
    renderDashboard();
    activateView('today-view');
    toast('Your focused training week is ready. Go make it count.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'We could not create that plan.', true);
  } finally {
    setBusy(button, false);
  }
}

async function logSession(event) {
  event.preventDefault();
  const button = $('#session-form button');
  setBusy(button, true);
  try {
    const minutes = Number(byId('session-duration').value);
    const effort = Number(byId('session-effort').value);
    const notes = byId('session-notes').value.trim();
    if (!Number.isFinite(minutes) || minutes < 1 || !Number.isFinite(effort) || effort < 1 || effort > 10) throw new Error('Enter a session duration and effort between 1 and 10.');
    const plan = activePlan();
    const payload = {
      user_id: state.user.id,
      plan_id: plan?.id || null,
      session_date: dateKey(),
      completed_at: new Date().toISOString(),
      duration_seconds: minutes * 60,
      perceived_effort: effort,
      exercise_count: planSchedule(plan).length ? 5 : 0,
      notes: notes || null,
      client_reference: `web-session-${id()}`,
      session_payload: { source: 'web-member-dashboard', logged_at: new Date().toISOString() },
    };
    const { data, error } = await supabase.from('workout_sessions').insert(payload).select('*').single();
    if (error) throw error;
    state.sessions = [data, ...state.sessions];
    byId('session-notes').value = '';
    renderDashboard();
    toast('Session logged. That is how the baseline moves.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'We could not log that session.', true);
  } finally {
    setBusy(button, false);
  }
}

async function saveCheckIn(event) {
  event.preventDefault();
  const button = $('#checkin-form button');
  setBusy(button, true);
  try {
    const payload = {
      user_id: state.user.id,
      check_in_date: dateKey(),
      ...state.selectedReadiness,
      notes: byId('checkin-note').value.trim() || null,
    };
    const { data, error } = await supabase.from('training_check_ins').upsert(payload, { onConflict: 'user_id,check_in_date' }).select('*').single();
    if (error) throw error;
    state.checkIns = [data, ...state.checkIns.filter((item) => item.check_in_date !== data.check_in_date)];
    renderDashboard();
    toast('Readiness saved. Train with the signal, not against it.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'We could not save that check-in.', true);
  } finally {
    setBusy(button, false);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const button = $('#profile-form button');
  setBusy(button, true);
  try {
    const equipment = byId('profile-equipment').value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 30);
    const payload = {
      display_name: byId('profile-name').value.trim() || null,
      training_goal: byId('profile-goal').value.trim() || null,
      equipment,
      onboarding_completed_at: state.profile?.onboarding_completed_at || new Date().toISOString(),
    };
    const { data, error } = await supabase.from('profiles').update(payload).eq('id', state.user.id).select('*').single();
    if (error) throw error;
    state.profile = data;
    renderDashboard();
    toast('Training profile updated. Keep it sharp and current.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'We could not save your profile.', true);
  } finally {
    setBusy(button, false);
  }
}

async function sendSupport(event) {
  event.preventDefault();
  const button = $('#support-form button');
  const message = byId('support-message').value.trim();
  if (!message) {
    toast('Write a short message before sending it.', true);
    return;
  }
  setBusy(button, true);
  try {
    const { error } = await supabase.from('support_messages').insert({ user_id: state.user.id, message });
    if (error) throw error;
    byId('support-message').value = '';
    toast('Your message is safely in the support queue.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'We could not send your message.', true);
  } finally {
    setBusy(button, false);
  }
}

async function signOut() {
  await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  state.plans = [];
  state.sessions = [];
  state.checkIns = [];
  showAuth();
  byId('auth-form').reset();
  toast('Signed out. Your account data remains secure.');
}

function bindEvents() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  byId('auth-form').addEventListener('submit', handleAuth);
  $$('[data-view-target]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.viewTarget)));
  byId('plan-form').addEventListener('submit', createPlan);
  byId('session-form').addEventListener('submit', logSession);
  byId('checkin-form').addEventListener('submit', saveCheckIn);
  byId('profile-form').addEventListener('submit', saveProfile);
  byId('support-form').addEventListener('submit', sendSupport);
  byId('sign-out').addEventListener('click', signOut);
  byId('mobile-sign-out').addEventListener('click', signOut);
  $$('.checkin-range').forEach((range) => {
    range.addEventListener('click', (event) => {
      const button = event.target.closest('.range-choice');
      if (!button) return;
      const group = range.dataset.range;
      state.selectedReadiness[group] = Number(button.dataset.value);
      $$('.range-choice', range).forEach((choice) => choice.classList.toggle('active', choice === button));
    });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user && state.user) showAuth();
  });
}

bindEvents();
hydrate();
