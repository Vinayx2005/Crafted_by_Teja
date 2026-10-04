// Shared by every page of the writer app: Supabase client, sign-in gate,
// the per-user prefs blob (writer.prefs) and the light/dark theme.
//
// Importing this module waits until someone is signed in, so a page can
// simply `await import('./common.js')` and then use `user`.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Same Supabase project as the other apps; the anon key is public by design,
// RLS on every writer.* table limits rows to their owner.
export const sb = createClient(
  'https://nqgflcoqfrqzelzduuhs.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xZ2ZsY29xZnJxemVsemR1dWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNjU0MzcsImV4cCI6MjA5OTg0MTQzN30.Ud7l_jg_uNMrf_IROo6SAByPY6E1m3O0obcXlL4O9hk',
  { db: { schema: 'writer' } }
);

let noteTimer;
export function notify(msg) {
  let el = document.querySelector('.cnote');
  if (!el) { el = document.createElement('div'); el.className = 'cnote'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(noteTimer); noteTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- sign-in ----------
const GOOGLE_SVG = '<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

async function signIn() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user;

  const wrap = document.createElement('div');
  wrap.id = 'auth'; wrap.className = 'open';
  wrap.innerHTML = `
    <form class="auth-card" id="authForm">
      <h2>Crafted by <span>Teja</span></h2>
      <p>Sign in to write your books and keep your saved words on every device.</p>
      <button type="button" class="abtn google" id="googleBtn">${GOOGLE_SVG} Continue with Google</button>
      <div class="or">or</div>
      <input type="email" id="authEmail" placeholder="Email" autocomplete="email" required>
      <input type="password" id="authPass" placeholder="Password" autocomplete="current-password" minlength="6" required>
      <div id="authMsg" role="status"></div>
      <button type="submit" class="abtn primary" id="authSubmit">Sign in</button>
      <div class="auth-switch"><span id="switchText">New here?</span> <a id="switchLink" href="#" role="button">Create an account</a></div>
    </form>`;
  document.body.append(wrap);
  const $ = id => wrap.querySelector('#' + id);
  let signUp = false;
  const msg = (t, ok) => { $('authMsg').textContent = t; $('authMsg').className = ok ? 'ok' : ''; };
  $('switchLink').onclick = e => {
    e.preventDefault();
    signUp = !signUp; msg('');
    $('authSubmit').textContent = signUp ? 'Create account' : 'Sign in';
    $('switchText').textContent = signUp ? 'Have an account?' : 'New here?';
    $('switchLink').textContent = signUp ? 'Sign in' : 'Create an account';
    $('authPass').autocomplete = signUp ? 'new-password' : 'current-password';
  };
  $('googleBtn').onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) msg(error.message);
  };
  $('authForm').onsubmit = async e => {
    e.preventDefault();
    $('authSubmit').disabled = true; msg('');
    const creds = { email: $('authEmail').value.trim(), password: $('authPass').value };
    const { data, error } = signUp ? await sb.auth.signUp({ ...creds, options: { emailRedirectTo: location.origin } })
                                   : await sb.auth.signInWithPassword(creds);
    $('authSubmit').disabled = false;
    if (error) return msg(error.message);
    if (signUp && !data.session) msg('Check your email to confirm your account, then sign in.', true);
  };
  return new Promise(res => sb.auth.onAuthStateChange((_, s) => { if (s) { wrap.remove(); res(s.user); } }));
}

export const user = await signIn();

// ---------- prefs: one jsonb blob per user in writer.prefs ----------
const LEGACY_KEYS = ['tr_src', 'te_tgt', 'te_ac', 'te_fs', 'te_hist', 'te_words'];
const { data: row, error: loadErr } = await sb.from('prefs').select('data').eq('user_id', user.id).maybeSingle();
if (loadErr) { console.error('Could not load saved data', loadErr); setTimeout(() => notify('Could not load your saved settings, so changes will not be saved'), 0); }
let prefs = row?.data;
if (!prefs) {
  // First sign-in: carry over anything this browser saved before accounts existed.
  prefs = {};
  for (const k of LEGACY_KEYS) { try { const v = localStorage.getItem(k); if (v) prefs[k] = JSON.parse(v); } catch {} }
}
let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer); saveTimer = null;
  if (loadErr) return Promise.resolve(); // never overwrite data we failed to read
  return sb.from('prefs').upsert({ user_id: user.id, data: prefs, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) { console.error('Save failed', error); notify('Could not save — check your connection'); } });
}
if (!row && !loadErr) savePrefs(); // creates the row so the account shows as a Writer user in the CMS
export const store = {
  get(k, d) { return k in prefs ? prefs[k] : d; },
  set(k, v) { prefs[k] = v; clearTimeout(saveTimer); saveTimer = setTimeout(savePrefs, 600); }
};
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) savePrefs(); });

export async function signOut() {
  if (saveTimer) await savePrefs();
  await sb.auth.signOut();
  location.reload();
}

// ---------- theme ----------
// The <head> of each page applies the cached theme before paint; the account
// copy wins once loaded so the choice follows the user across devices.
const applyTheme = t => {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('writer_theme', t); } catch {}
};
applyTheme(store.get('theme', document.documentElement.dataset.theme || 'dark'));
document.addEventListener('click', e => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(t); store.set('theme', t);
});
