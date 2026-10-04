// Book Studio — projects → chapters → editor, with a live A5 page-flip preview.
//   #/                  your books
//   #/p/<id>            a book: chapters, page setup, preview, downloads
//   #/p/<id>/c/<id>     a chapter in the editor, preview alongside
import Quill from 'quill';
import { sb, init, store, signOut, notify } from './common';
import { FONTS, FONT_CSS, withDefaults, applyVars, paginate, BookView, NUM_FORMAT_LABELS, exportPdf, exportDoc, exportDocx } from './book';
import { LANGS, SOURCES, ROMAN, translateHtml } from './lang';
import { play } from './sound';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nowIso = () => new Date().toISOString();
let view, user;

// Dev only: this module wires listeners once at start(), so a hot-swapped copy
// would never run. Declining makes the dev server reload the page instead.
import.meta.webpackHot?.decline();

// Entry point, called once by src/app/Studio.tsx after the shell has rendered.
let started = false;
const me = Symbol('studio'); // this copy of the module (dev hot-reload can load a second one)
export async function start() {
  if (started) return;
  started = true;
  window.__studio = me;
  user = await init();
  view = $('#view');
  $('#bookFonts').href = FONT_CSS;
  $('#who').textContent = user.email || '';
  $('#logoutBtn').onclick = async () => { await flushAll(); signOut(); };
  addEventListener('hashchange', route);
  route();
}

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
const words = html => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim().split(/\s+/).filter(Boolean).length;
const failed = (what, error) => { console.error(what, error); notify(`${what} failed — ${error.message || 'check your connection'}`); };

// ---------- state + saving ----------
let project = null;   // { id, title, status, settings, ... }
let ebook = null;     // published snapshot { id, published_at, updated_at } or null
let chapters = [];    // ordered by position, without deleted ones
let trash = [];       // deleted chapters / empty pages (deleted_at set), newest first
const pending = new Map(); // key → { timer, run }

function later(key, ms, run) {
  clearTimeout(pending.get(key)?.timer);
  pending.set(key, { run, timer: setTimeout(() => { pending.delete(key); run(); }, ms) });
  markDirty();
}
async function flushAll() {
  const jobs = [...pending.values()];
  pending.clear();
  jobs.forEach(j => clearTimeout(j.timer));
  await Promise.all(jobs.map(j => j.run()));
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
addEventListener('beforeunload', e => { if (pending.size) { flushAll(); e.preventDefault(); } });

let saving = 0;
function markDirty() { const el = $('#saveState'); if (el) { el.textContent = 'Unsaved changes…'; el.classList.add('dirty'); } }
async function track(p) {
  saving++;
  try { return await p; } finally {
    saving--;
    const el = $('#saveState');
    if (el && !saving && !pending.size) { el.textContent = 'Draft saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); el.classList.remove('dirty'); }
  }
}

function saveProject() {
  const p = project;
  later('project', 700, () => track(sb.from('projects').update({ title: p.title, status: p.status, settings: p.settings, updated_at: nowIso() }).eq('id', p.id)
    .then(({ error }) => error && failed('Saving the book', error))));
}
function saveChapter(ch) {
  later('ch:' + ch.id, 900, () => track(Promise.all([
    sb.from('chapters').update({ title: ch.title, delta: ch.delta, html: ch.html, updated_at: nowIso() }).eq('id', ch.id),
    sb.from('projects').update({ updated_at: nowIso() }).eq('id', ch.project_id),
  ]).then(([{ error }]) => error && failed('Saving the chapter', error))));
}

async function loadProject(id) {
  if (project?.id === id) return true;
  await flushAll();
  const [{ data: p, error: e1 }, { data: cs, error: e2 }, { data: eb }] = await Promise.all([
    sb.from('projects').select('*').eq('id', id).maybeSingle(),
    sb.from('chapters').select('*').eq('project_id', id).order('position'),
    // no error check: before writer_ebooks.sql has run this just means "not published"
    sb.from('ebooks').select('id, published_at, updated_at').eq('project_id', id).maybeSingle(),
  ]);
  ebook = eb || null;
  if (e1 || e2) { failed('Loading the book', e1 || e2); return false; }
  if (!p) return false;
  project = { ...p, settings: withDefaults(p.settings) };
  // filtered here rather than in the query so books still load before writer_chapters_trash.sql has run
  chapters = cs.filter(c => !c.deleted_at);
  trash = cs.filter(c => c.deleted_at).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  return true;
}

// ---------- routing ----------
let bookView = null;
async function route() {
  // After a dev hot-reload an older copy of this module is still listening;
  // only the newest one may draw, and always into the live #view.
  if (window.__studio !== me) return;
  view = $('#view');
  await flushAll();
  bookView?.destroy();
  bookView = null;
  const m = location.hash.match(/^#\/p\/([\w-]+)(?:\/c\/([\w-]+))?/);
  if (!m) return home();
  view.innerHTML = '<div class="loading">Loading…</div>';
  if (!(await loadProject(m[1]))) { notify('That book could not be found'); location.hash = '#/'; return; }
  if (m[2]) {
    const ch = chapters.find(c => c.id === m[2] && c.kind === 'chapter');
    if (!ch) { location.hash = `#/p/${project.id}`; return; }
    chapterView(ch);
  } else projectView();
}

function crumbs(ch) {
  $('#crumbs').innerHTML = project
    ? `<span>/</span><a href="#/">Books</a><span>/</span>${ch ? `<a href="#/p/${project.id}">${esc(project.title)}</a><span>/</span><b>${esc(ch.title || 'Untitled chapter')}</b>` : `<b>${esc(project.title)}</b>`}`
    : '';
}

// ---------- home: your books ----------
async function home() {
  project = null; chapters = [];
  crumbs();
  view.innerHTML = '<div class="loading">Loading your books…</div>';
  const [{ data, error }, { data: pub }] = await Promise.all([
    sb.from('projects').select('id, title, status, updated_at, chapters(count)').order('updated_at', { ascending: false }),
    sb.from('ebooks').select('id, project_id'),
  ]);
  const published = new Map((pub || []).map(e => [e.project_id, e.id])); // project id → ebook id
  if (error) { view.innerHTML = `<div class="loading">Could not load your books. ${esc(error.message)}</div>`; return; }
  view.innerHTML = `
    <section class="home">
      <div class="home-head"><h2>Your books</h2><button class="btn primary" id="newBook">+ New book</button></div>
      <div class="grid">
        <a class="card new-card" href="#" id="newCard"><div class="cover">+ Start a new book</div></a>
        ${data.map(p => `
          <a class="card" href="#/p/${p.id}">
            <div class="cover">${esc(p.title)}</div>
            <div class="meta"><b>${esc(p.title)}</b><span>${p.chapters[0]?.count || 0} pages/chapters · ${published.has(p.id) ? 'Published' : p.status === 'complete' ? 'Complete' : 'Draft'} · ${ago(p.updated_at)}</span></div>
            <button class="btn sm icon more" data-more="${p.id}" title="More" aria-label="More options for ${esc(p.title)}" aria-haspopup="menu" aria-expanded="false">⋯</button>
            <div class="menu" role="menu" data-menu="${p.id}">
              ${published.has(p.id) ? `
                <button role="menuitem" data-act="copy">Copy ebook link</button>
                <button role="menuitem" data-act="unpublish">Unpublish book</button>` : ''}
              <button role="menuitem" class="danger" data-act="delete">Delete book</button>
            </div>
          </a>`).join('')}
      </div>
      ${data.length ? '' : '<p class="empty">No books yet. Start one — it is saved as a draft as you write.</p>'}
    </section>`;
  const create = async e => {
    e.preventDefault();
    const author = await askAuthor();
    if (author === null) return; // cancelled
    store.set('last_author', author);
    const { data: p, error } = await sb.from('projects').insert({ title: 'Untitled book', settings: { author } }).select().single();
    if (error) return failed('Creating the book', error);
    const { data: ch, error: e2 } = await sb.from('chapters').insert({ project_id: p.id, position: 1, title: 'Chapter 1' }).select().single();
    if (e2) return failed('Creating the first chapter', e2);
    location.hash = `#/p/${p.id}/c/${ch.id}`;
  };
  $('#newBook').onclick = create;
  $('#newCard').onclick = create;
  // ⋯ menu on each card (the card itself is a link, so clicks here must not navigate)
  const closeMenus = () => view.querySelectorAll('.menu.open').forEach(m => {
    m.classList.remove('open');
    view.querySelector(`[data-more="${m.dataset.menu}"]`)?.setAttribute('aria-expanded', 'false');
  });
  view.querySelectorAll('[data-more]').forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const menu = view.querySelector(`[data-menu="${b.dataset.more}"]`);
    const open = !menu.classList.contains('open');
    closeMenus();
    menu.classList.toggle('open', open);
    b.setAttribute('aria-expanded', String(open));
  });
  view.querySelectorAll('.menu').forEach(m => m.onclick = async e => {
    e.preventDefault(); e.stopPropagation();
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    closeMenus();
    const p = data.find(x => x.id === m.dataset.menu), ebookId = published.get(p.id);
    if (act === 'copy') {
      const url = `${location.origin}/read/${ebookId}`;
      try { await navigator.clipboard.writeText(url); notify('Ebook link copied'); } catch { prompt('Copy this link:', url); }
    }
    if (act === 'unpublish') {
      if (!await confirmBox(`Unpublish “${p.title}”?`, 'The reading link will stop working.', 'Unpublish')) return;
      const { error } = await sb.from('ebooks').delete().eq('id', ebookId);
      if (error) return failed('Unpublishing', error);
      notify('Unpublished'); home();
    }
    if (act === 'delete') {
      if (!await confirmBox(`Delete “${p.title}”?`, `All its chapters will be deleted${ebookId ? ' and its ebook link will stop working' : ''}. This cannot be undone.`, 'Delete book', 'DELETE')) return;
      const { error } = await sb.from('projects').delete().eq('id', p.id);
      if (error) return failed('Deleting the book', error);
      home();
    }
  });
  view.querySelector('.home').addEventListener('click', e => { if (!e.target.closest('.menu, [data-more]')) closeMenus(); });
  view.querySelector('.home').addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
}

// In-app "are you sure?" — the browser's confirm() is blocked in some embedded
// browsers (and looks out of place). Resolves true only on the confirm button.
// With `typeWord`, the confirm button stays disabled until that exact word is typed.
function confirmBox(title, text, okLabel, typeWord) {
  const dlg = document.createElement('dialog');
  dlg.className = 'ask';
  dlg.innerHTML = `
    <form method="dialog">
      <h3>${esc(title)}</h3>
      <p style="font-size:13px">${esc(text)}</p>
      ${typeWord ? `
        <label class="lbl" for="askWord">Type <b style="color:var(--bad)">${esc(typeWord)}</b> to confirm</label>
        <input class="in" id="askWord" autocomplete="off" autocapitalize="characters" spellcheck="false" style="margin:4px 0 14px">` : ''}
      <div class="row" style="justify-content:flex-end">
        <button class="btn" value="cancel" ${typeWord ? '' : 'autofocus'}>Cancel</button>
        <button class="btn primary danger-fill" value="ok" ${typeWord ? 'disabled' : ''}>${esc(okLabel)}</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const ok = dlg.querySelector('[value=ok]'), word = dlg.querySelector('#askWord');
  if (word) {
    word.oninput = () => { ok.disabled = word.value !== typeWord; };
    // Enter would hit the form's first button (Cancel); make it confirm instead, only when the word matches
    word.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (!ok.disabled) ok.click(); } };
  }
  dlg.showModal();
  word?.focus();
  return new Promise(res => dlg.addEventListener('close', () => {
    res(dlg.returnValue === 'ok' && (!word || word.value === typeWord));
    dlg.remove();
  }));
}

// New-book popup. Resolves to the author name ('' is fine), or null if cancelled.
function askAuthor() {
  const dlg = document.createElement('dialog');
  dlg.className = 'ask';
  const guess = store.get('last_author', '') || user.user_metadata?.full_name || user.user_metadata?.name || '';
  dlg.innerHTML = `
    <form method="dialog">
      <h3>New book</h3>
      <label class="lbl" for="askAuthor">Author name</label>
      <input class="in" id="askAuthor" maxlength="120" placeholder="How your name appears on the cover" value="${esc(guess)}" autocomplete="name">
      <p>Shown at the bottom of the cover. You can change it later.</p>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" value="cancel" formnovalidate>Cancel</button>
        <button class="btn primary" value="ok">Create book</button>
      </div>
    </form>`;
  document.body.append(dlg);
  dlg.showModal();
  const input = dlg.querySelector('input');
  input.select();
  return new Promise(res => dlg.addEventListener('close', () => {
    res(dlg.returnValue === 'ok' ? input.value.trim() : null);
    dlg.remove();
  }));
}

// Phones show one pane at a time; this switch (hidden on wide screens) flips between them.
const paneTabs = first => `
  <nav class="mtabs" aria-label="Switch view">
    <button class="on" data-pane="side">${first}</button>
    <button data-pane="preview">Preview</button>
  </nav>`;
document.addEventListener('click', e => {
  const b = e.target.closest('.mtabs button'); if (!b) return;
  const work = b.closest('.work');
  work.dataset.pane = b.dataset.pane;
  work.querySelectorAll('.mtabs button').forEach(x => x.classList.toggle('on', x === b));
});

// ---------- the book preview (shared by project + chapter views) ----------
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('');

function previewHtml() {
  const s = project.settings;
  return `
    <section class="preview" aria-label="Book preview">
      <div class="pv-bar">
        <label>Font <select class="sel" data-set="font">${opts(FONTS.map(f => [f, f]), s.font)}</select></label>
        <label>Size <select class="sel" data-set="size">${opts([9, 9.5, 10, 10.5, 11, 11.5, 12, 13, 14].map(n => [n, n + ' pt']), s.size)}</select></label>
        <label>Line <select class="sel" data-set="lineHeight">${opts([1, 1.15, 1.3, 1.5, 1.75, 2].map(n => [n, n]), s.lineHeight)}</select></label>
        <label>Paragraph <select class="sel" data-set="paraSpacing">${opts([0, 3, 6, 9, 12, 18].map(n => [n, n + ' pt']), s.paraSpacing)}</select></label>
      </div>
      <h2 class="pv-title" id="pvTitle">${esc(project.title)}</h2>
      <div class="pv-tagline" id="pvTagline">${taglineHtml()}</div>
      <div class="stage" id="stage"><span class="pv-busy" id="pvBusy">Updating…</span></div>
      <div class="pv-nav">
        <button class="btn sm" id="pvPrev" aria-label="Previous page">‹ Prev</button>
        <select class="sel" id="pvJump" aria-label="Go to"></select>
        <span id="pvAt">—</span>
        <button class="btn sm" id="pvNext" aria-label="Next page">Next ›</button>
        <button class="btn sm icon" id="pvSound"></button>
      </div>
    </section>`;
}

let starts = {};
let picked = null; // page chosen in the jump list, kept selected while it is on screen
let previewVersion = 0;
function mountPreview(goTo) {
  const stage = $('#stage');
  bookView = new BookView(stage, (at, total) => {
    // In a two-page spread both `at` and `at + 1` are showing.
    const last = bookView?.flip?.getOrientation?.() === 'landscape' && at > 0 && at < total - 1 ? at + 1 : at;
    $('#pvAt').textContent = `${last > at ? `${at + 1}–${last + 1}` : at + 1} / ${total}`;
    // Show what's open: the item just picked if it's visible, else the one the last visible page belongs to.
    const jump = $('#pvJump');
    if (picked != null && picked >= at && picked <= last) { jump.value = String(picked); return; }
    picked = null;
    const here = [...jump.options].filter(o => +o.value <= last).pop();
    if (here) jump.value = here.value;
  });
  bookView.sound = kind => store.get('book_sound', true) && play(kind);
  const soundBtn = $('#pvSound');
  const showSound = () => {
    const on = store.get('book_sound', true);
    soundBtn.textContent = on ? '🔊' : '🔇';
    soundBtn.title = on ? 'Page sounds on — click to mute' : 'Page sounds off — click to turn on';
    soundBtn.setAttribute('aria-label', soundBtn.title);
    soundBtn.setAttribute('aria-pressed', String(on));
  };
  soundBtn.onclick = () => { store.set('book_sound', !store.get('book_sound', true)); showSound(); };
  showSound();
  $('#pvJump').onchange = e => { picked = +e.target.value; bookView?.go(picked); };
  $('#pvPrev').onclick = () => bookView?.prev();
  $('#pvNext').onclick = () => bookView?.next();
  view.querySelectorAll('[data-set]').forEach(sel => sel.onchange = () => {
    const k = sel.dataset.set;
    project.settings[k] = k === 'font' ? sel.value : +sel.value;
    saveProject(); refresh();
  });
  refresh(goTo);
}

// Re-lay out the book from current state. `goTo` = chapter id to open at.
async function refresh(goTo) {
  if (!bookView) return;
  const my = ++previewVersion, s = project.settings, tr = s.translate;
  $('#pvBusy')?.classList.add('on');
  const myWords = store.get('te_words', {});
  const flow = await Promise.all(chapters.map(async c => ({
    ...c, html: tr.on && c.kind === 'chapter' ? await translateHtml(c.html, tr.from, tr.to, myWords) : c.html,
  })));
  if (my !== previewVersion || !bookView) return;
  const out = await paginate(project.title, taglineHtml(), flow, s);
  if (my !== previewVersion || !bookView) return;
  starts = out.starts;
  lastPages = out.pages; lastFlow = flow;
  fillJumpOptions();
  bookView.show(out.pages, s, goTo ? out.starts[goTo] ?? 0 : undefined);
  fillStartOptions();
  $('#pvBusy')?.classList.remove('on');
}
let lastPages = [], lastFlow = [];

// How a chapter or empty page is named in dropdowns.
function itemName(c) {
  if (c.kind !== 'blank') return esc(c.title || 'Untitled chapter');
  const blanks = chapters.filter(x => x.kind === 'blank');
  return blanks.length > 1 ? `Empty page ${blanks.indexOf(c) + 1}` : 'Empty page';
}

// Jump list under the book: cover, every chapter / empty page, back cover.
function fillJumpOptions() {
  const sel = $('#pvJump');
  if (!sel) return;
  sel.innerHTML = [
    `<option value="0">Cover</option>`,
    ...chapters.filter(c => starts[c.id] != null).map(c => `<option value="${starts[c.id]}">${itemName(c)}</option>`),
    `<option value="${lastPages.length - 1}">Back cover</option>`,
  ].join('');
}

// "Start on" lists the chapters and empty pages; numbering starts on the first page of the one picked.
function fillStartOptions() {
  const sel = $('#pnFrom');
  if (!sel || !lastPages.length) return;
  const pn = project.settings.pageNumbers;
  sel.innerHTML = chapters.map(c => `<option value="${c.id}:0">${itemName(c)}</option>`).join('');

  // An unset or vanished choice falls back to the first page after the cover.
  const want = pn.from && sel.querySelector(`option[value="${pn.from}"]`) ? pn.from : sel.options[0]?.value;
  if (want) sel.value = want;
}
let refreshTimer;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(), 600); };
document.fonts.addEventListener?.('loadingdone', () => refreshSoon());

addEventListener('keydown', e => {
  if (!bookView || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') bookView.next();
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') bookView.prev();
});

// Rich-text tagline (HTML). Books saved before it was rich text have a plain `tagline`.
const taglineHtml = () => {
  const s = project.settings;
  return s.taglineHtml ?? (s.tagline ? `<p>${esc(s.tagline)}</p>` : '');
};

// ---------- project view ----------
function projectView() {
  crumbs();
  const s = project.settings, pn = s.pageNumbers, hd = s.header;
  view.innerHTML = `
    <div class="work" data-pane="side">
      ${paneTabs('Book setup')}
      <aside class="side">
        <div class="row">
          <select class="sel" id="bookStatus" aria-label="Status">${opts([['draft', 'Draft'], ['complete', 'Complete']], project.status)}</select>
          <span id="saveState" style="font-size:12px;color:var(--muted)">All changes saved</span>
        </div>

        <!-- every panel starts closed except Chapters & pages (re-rendered on each visit) -->
        <details class="panel">
          <summary>Cover page</summary>
          <div class="pb">
            <div class="field"><span class="lbl">Title</span>
              <input class="in" id="bookTitle" value="${esc(project.title)}" aria-label="Book title" maxlength="200"></div>
            <div class="field"><span class="lbl">Tagline</span>
              <div class="tag-ed"><div id="bookTagline" aria-label="Tagline"></div></div></div>
            <div class="field"><span class="lbl">Author</span>
              <input class="in" id="bookAuthor" value="${esc(s.author || '')}" placeholder="Author name" aria-label="Author name" maxlength="120"></div>
          </div>
        </details>

        <details class="panel" open>
          <summary>Chapters &amp; pages</summary>
          <div class="row ch-add">
            <button class="btn sm" id="addBlank" title="Add an empty page to the end">+ Empty page</button>
            <button class="btn sm primary" id="addChapter">+ Chapter</button>
          </div>
          <ul class="chapters" id="chList"></ul>
        </details>

        <details class="panel">
          <summary>Back cover</summary>
          <div class="pb">
            <div class="field"><span class="lbl">Summary</span>
              <div class="tag-ed back-ed"><div id="bookBack" aria-label="Back cover summary"></div></div></div>
            <span style="font-size:12px;color:var(--muted)">The author name from the cover is shown at the bottom.</span>
          </div>
        </details>

        <details class="panel">
          <summary>Page numbers &amp; header</summary>
          <div class="pb setgrid">
            <span class="sub">Page numbers</span>
            <span>Show</span><label class="chk"><input type="checkbox" data-pn="show" ${pn.show ? 'checked' : ''}> On text pages</label>
            <span>Start on</span><select class="sel" data-pn="from" id="pnFrom" aria-label="Page where numbering starts"></select>
            <span>Position</span><select class="sel" data-pn="position">${opts([['footer', 'Footer'], ['header', 'Header']], pn.position)}</select>
            <span>Alignment</span><select class="sel" data-pn="align">${opts([['center', 'Center'], ['left', 'Left'], ['right', 'Right'], ['outer', 'Outside edge']], pn.align)}</select>
            <span>Style</span><select class="sel" data-pn="format">${opts(Object.entries(NUM_FORMAT_LABELS), pn.format)}</select>
            <span>Size</span><select class="sel" data-pn="size">${opts([7, 8, 9, 10, 11, 12].map(n => [n, n + ' pt']), pn.size)}</select>
            <span>First number</span><input class="in" type="number" min="1" max="9999" data-pn="start" value="${pn.start}">
            <span class="sub">Running header (chapter name)</span>
            <span>Show</span><label class="chk"><input type="checkbox" data-hd="show" ${hd.show ? 'checked' : ''}> Chapter name at the top</label>
            <span>Opacity</span><input type="range" min="0.15" max="1" step="0.05" data-hd="opacity" value="${hd.opacity}" aria-label="Header opacity">
            <span>Size</span><select class="sel" data-hd="size">${opts([7, 7.5, 8, 8.5, 9, 10, 11, 12].map(n => [n, n + ' pt']), hd.size)}</select>
          </div>
        </details>

        <details class="panel">
          <summary>Publish as a free ebook</summary>
          <div class="pb" id="pubBox"></div>
        </details>

        <details class="panel">
          <summary>Download the whole book</summary>
          <div class="pb">
            <div class="row">
              <button class="btn" data-export="pdf">PDF</button>
              <button class="btn" data-export="docx">DOCX</button>
              <button class="btn" data-export="doc">DOC</button>
            </div>
            <span style="font-size:12px;color:var(--muted)">PDF opens the print dialog — choose “Save as PDF”. It matches the preview exactly.</span>
          </div>
        </details>

        <details class="panel">
          <summary>Deleted chapters<span id="trashCount"></span></summary>
          <div id="trashBox"></div>
        </details>
      </aside>
      ${previewHtml()}
    </div>`;

  $('#bookTitle').oninput = e => { project.title = e.target.value.trim() || 'Untitled book'; crumbs(); $('#pvTitle').textContent = project.title; saveProject(); refreshSoon(); };
  setupQuill();
  const tagQuill = new Quill('#bookTagline', {
    theme: 'snow',
    placeholder: 'Add a tagline (optional)',
    modules: { toolbar: [['bold', 'italic', 'underline', 'strike'], [{ color: [] }, { background: [] }], ['clean']] },
  });
  keepPastedFormatting(tagQuill);
  tagQuill.clipboard.dangerouslyPasteHTML(taglineHtml(), 'silent');
  tagQuill.on('text-change', () => {
    s.taglineHtml = tagQuill.getText().trim() ? tagQuill.getSemanticHTML().replace(/&nbsp;/g, ' ') : '';
    delete s.tagline;
    $('#pvTagline').innerHTML = s.taglineHtml;
    saveProject(); refreshSoon();
  });
  const backQuill = new Quill('#bookBack', {
    theme: 'snow',
    placeholder: 'What is this book about? A few lines for the back cover…',
    modules: { toolbar: [['bold', 'italic', 'underline'], [{ header: [2, 3, false] }], [{ align: [false, 'left', 'center', 'right'] }], [{ color: [] }, { background: [] }], ['clean']] },
  });
  keepPastedFormatting(backQuill);
  backQuill.clipboard.dangerouslyPasteHTML(s.backHtml || '', 'silent');
  backQuill.on('text-change', () => {
    s.backHtml = backQuill.getText().trim() ? backQuill.getSemanticHTML().replace(/&nbsp;/g, ' ') : '';
    saveProject(); refreshSoon();
  });
  $('#bookAuthor').oninput = e => { s.author = e.target.value.trim(); saveProject(); refreshSoon(); };
  $('#bookStatus').onchange = e => { project.status = e.target.value; saveProject(); renderPublish(); };
  renderPublish();
  view.querySelectorAll('[data-pn]').forEach(el => el.oninput = el.onchange = () => {
    const k = el.dataset.pn;
    pn[k] = el.type === 'checkbox' ? el.checked : (k === 'size' || k === 'start') ? Math.max(1, +el.value || 1) : el.value;
    saveProject(); refreshSoon();
  });
  view.querySelectorAll('[data-hd]').forEach(el => el.oninput = el.onchange = () => {
    const k = el.dataset.hd;
    hd[k] = el.type === 'checkbox' ? el.checked : +el.value;
    saveProject(); refreshSoon();
  });
  $('#addChapter').onclick = () => addItem('chapter');
  $('#addBlank').onclick = () => addItem('blank');
  view.querySelectorAll('[data-export]').forEach(b => b.onclick = () => doExport(b.dataset.export, b));
  renderChapterList();
  renderTrash();
  mountPreview();
}

function renderChapterList() {
  let n = 0;
  $('#chList').innerHTML = chapters.length ? chapters.map((c, i) => {
    const blank = c.kind === 'blank';
    if (!blank) n++;
    return `
      <li class="${blank ? 'blank' : ''}" data-id="${c.id}">
        <span class="grip" title="Drag to reorder" aria-hidden="true">⠿</span>
        <span class="n">${blank ? '' : n}</span>
        ${blank
          ? `<span class="t"><b>Empty page</b></span>`
          : `<a class="t" draggable="false" href="#/p/${project.id}/c/${c.id}"><b>${esc(c.title || 'Untitled chapter')}</b><span>${words(c.html)} words · edited ${ago(c.updated_at)}</span></a>`}
        <span class="acts">
          <button class="btn sm icon" data-go="${c.id}" title="Show in preview" aria-label="Show in preview">◉</button>
          <button class="btn sm icon danger" data-rm="${i}" title="Delete" aria-label="Delete">✕</button>
        </span>
      </li>`;
  }).join('') : '<li><span class="t" style="color:var(--muted)">No chapters yet — add one to start writing.</span></li>';

  enableDrag($('#chList'));
  $('#chList').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) return bookView?.go(starts[b.dataset.go] ?? 0);
    if (b.dataset.rm) {
      const c = chapters[+b.dataset.rm];
      const what = c.kind === 'blank' ? 'this empty page' : `“${c.title || 'Untitled chapter'}”`;
      if (!await confirmBox(`Delete ${what}?`, 'It moves to “Deleted chapters” at the bottom of this page, where you can bring it back.', c.kind === 'blank' ? 'Delete page' : 'Delete chapter', 'DELETE')) return;
      const deleted_at = nowIso();
      const { error } = await sb.from('chapters').update({ deleted_at }).eq('id', c.id);
      if (error) return failed('Deleting', /deleted_at/.test(error.message) ? { message: 'run migrations/writer_chapters_trash.sql in Supabase first' } : error);
      c.deleted_at = deleted_at;
      chapters = chapters.filter(x => x !== c);
      trash.unshift(c);
      renderChapterList(); renderTrash(); refresh();
      notify('Moved to Deleted chapters');
    }
  };
}

// Reorder by drag: grab the ⠿ handle, or press and hold anywhere on a row.
// The row lifts out of the list and follows the pointer; a dashed gap shows
// where it will land and the other rows slide aside. Pointer events, so a
// mouse, a finger and a pen all work the same.
function enableDrag(list) {
  if (list.dataset.drag) return; // listeners survive re-renders of the rows
  list.dataset.drag = '1';
  let drag = null; // { li, id, x, y, timer, active, gap, dx, dy }
  let swallowClick = false;
  const scroller = list.closest('.side');

  // slide rows from where they were to where they are now (FLIP)
  const slide = (rows, before) => rows.forEach(r => {
    const d = before.get(r) - r.getBoundingClientRect().top;
    if (!d) return;
    r.style.transition = 'none';
    r.style.transform = `translateY(${d}px)`;
    requestAnimationFrame(() => { r.style.transition = 'transform .16s ease'; r.style.transform = ''; });
  });

  const begin = () => {
    const { li } = drag;
    const r = li.getBoundingClientRect();
    drag.active = true;
    drag.dx = drag.x - r.left; drag.dy = drag.y - r.top;
    drag.gap = document.createElement('li');
    drag.gap.className = 'drop-gap';
    drag.gap.style.height = r.height + 'px';
    li.before(drag.gap);
    Object.assign(li.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    li.classList.add('dragging');
    list.classList.add('sorting');
    try { list.setPointerCapture(drag.id); } catch {}
    if (drag.touch) navigator.vibrate?.(12);
  };

  const end = () => {
    clearTimeout(drag?.timer);
    const d = drag; drag = null;
    if (!d?.active) return;
    const { li, gap } = d;
    list.classList.remove('sorting');
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    // glide into the gap, then drop back into the list there
    const to = gap.getBoundingClientRect();
    li.style.transition = 'left .15s ease, top .15s ease, transform .15s ease';
    li.style.left = to.left + 'px'; li.style.top = to.top + 'px';
    li.classList.remove('dragging');
    setTimeout(async () => {
      gap.replaceWith(li);
      li.removeAttribute('style');
      const ids = [...list.children].map(x => x.dataset.id);
      if (ids.join() !== chapters.map(c => c.id).join()) await saveOrder(ids);
    }, 160);
  };

  list.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    const li = e.target.closest('li[data-id]');
    if (!li || e.target.closest('button')) return;
    drag = { li, id: e.pointerId, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType === 'touch' };
    if (e.target.closest('.grip')) { e.preventDefault(); begin(); }
    else drag.timer = setTimeout(() => drag && begin(), 280); // press and hold
  });

  list.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      // moved before the hold finished: it's a scroll or a click, not a drag
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { clearTimeout(drag.timer); drag = null; }
      else { drag.x = e.clientX; drag.y = e.clientY; }
      return;
    }
    e.preventDefault();
    const { li, gap } = drag;
    // the card sticks to the pointer exactly where it was grabbed
    li.style.left = e.clientX - drag.dx + 'px';
    li.style.top = e.clientY - drag.dy + 'px';
    // move the gap to wherever the card's centre now is
    const mid = e.clientY - drag.dy + li.offsetHeight / 2;
    const rows = [...list.children].filter(r => r !== li && r !== gap);
    const target = rows.find(r => { const b = r.getBoundingClientRect(); return mid < b.top + b.height / 2; });
    const want = target ? rows.indexOf(target) : rows.length;        // rows that should sit above the gap
    const kids = [...list.children];
    const now = kids.slice(0, kids.indexOf(gap)).filter(r => r !== li).length;
    if (want !== now) {
      const before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]));
      if (target) target.before(gap); else list.append(gap);
      slide(rows, before);
    }
    // keep scrolling when dragging near the top / bottom of the panel
    const box = scroller.getBoundingClientRect();
    if (e.clientY < box.top + 50) scroller.scrollBy(0, -14);
    else if (e.clientY > box.bottom - 50) scroller.scrollBy(0, 14);
  });

  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  // once a drag has started, a finger must move the row, not the page
  list.addEventListener('touchmove', e => { if (drag?.active) e.preventDefault(); }, { passive: false });
  // a hold-drag that ends over the chapter link must not open the chapter
  list.addEventListener('click', e => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); } }, true);
  list.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
}

async function saveOrder(ids) {
  const byId = new Map(chapters.map(c => [c.id, c]));
  const old = new Map(chapters.map(c => [c.id, c.position]));
  chapters = ids.map(id => byId.get(id));
  chapters.forEach((c, i) => { c.position = i + 1; });
  const changed = chapters.filter(c => old.get(c.id) !== c.position);
  renderChapterList(); refresh();
  const res = await track(Promise.all(changed.map(c => sb.from('chapters').update({ position: c.position }).eq('id', c.id))));
  const err = res.find(r => r.error)?.error;
  if (err) failed('Reordering', err);
}

// ---------- deleted chapters ----------
function renderTrash() {
  const box = $('#trashBox'); if (!box) return;
  $('#trashCount').textContent = trash.length ? ` (${trash.length})` : '';
  box.innerHTML = trash.length ? `<ul class="chapters">${trash.map(c => `
    <li data-tid="${c.id}">
      <span class="t"><b>${c.kind === 'blank' ? '<i>Empty page</i>' : esc(c.title || 'Untitled chapter')}</b><span>${c.kind === 'blank' ? '' : `${words(c.html)} words · `}deleted ${ago(c.deleted_at)}</span></span>
      <button class="btn sm" data-restore="${c.id}">Restore</button>
      <button class="btn sm danger" data-purge="${c.id}" title="Delete forever">Delete forever</button>
    </li>`).join('')}</ul>` : '<p class="trash-empty">Nothing here. Deleted chapters and empty pages land here so you can bring them back.</p>';
  box.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const c = trash.find(x => x.id === (b.dataset.restore || b.dataset.purge)); if (!c) return;
    if (b.dataset.restore) {
      // comes back at the end of the book; drag it into place
      const position = Math.max(0, ...chapters.map(x => x.position)) + 1;
      const { error } = await sb.from('chapters').update({ deleted_at: null, position }).eq('id', c.id);
      if (error) return failed('Restoring', error);
      Object.assign(c, { deleted_at: null, position });
      trash = trash.filter(x => x !== c);
      chapters.push(c);
      renderChapterList(); renderTrash(); refresh();
      notify('Restored to the end of the book');
    } else {
      const what = c.kind === 'blank' ? 'this empty page' : `“${c.title || 'Untitled chapter'}”`;
      if (!await confirmBox(`Delete ${what} forever?`, 'This cannot be undone.', 'Delete forever', 'DELETE')) return;
      const { error } = await sb.from('chapters').delete().eq('id', c.id);
      if (error) return failed('Deleting', error);
      trash = trash.filter(x => x !== c);
      renderTrash();
    }
  };
}

async function addItem(kind) {
  const position = Math.max(0, ...chapters.map(c => c.position)) + 1;
  const title = kind === 'chapter' ? `Chapter ${chapters.filter(c => c.kind === 'chapter').length + 1}` : '';
  const { data, error } = await sb.from('chapters').insert({ project_id: project.id, position, kind, title }).select().single();
  if (error) return failed('Adding', error);
  chapters.push(data);
  if (kind === 'chapter') location.hash = `#/p/${project.id}/c/${data.id}`;
  else { renderChapterList(); refresh(); notify('Empty page added at the end — drag it to where you want it'); }
}

// ---------- publishing ----------
const readUrl = () => `${location.origin}/read/${ebook.id}`;
function renderPublish() {
  const box = $('#pubBox'); if (!box) return;
  const when = iso => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  if (!ebook) {
    const ready = project.status === 'complete';
    box.innerHTML = `
      <span style="font-size:13px">Anyone with the link can read it free, like a real book — no sign-in needed.</span>
      <div class="row"><button class="btn primary" id="pubGo" ${ready ? '' : 'disabled'}>Publish</button></div>
      ${ready ? '' : '<span style="font-size:12px;color:var(--muted)">Set the status above to <b>Complete</b> to publish.</span>'}`;
    $('#pubGo').onclick = () => publish($('#pubGo'));
    return;
  }
  box.innerHTML = `
    <span style="font-size:13px">Published ${when(ebook.published_at)}${ebook.updated_at !== ebook.published_at ? ` · updated ${when(ebook.updated_at)}` : ''}. Readers see this version until you update it.</span>
    <input class="in" id="pubLink" value="${esc(readUrl())}" readonly aria-label="Reading link">
    <div class="row">
      <button class="btn primary" id="pubShare">Share link</button>
      <a class="btn" href="${esc(readUrl())}" target="_blank" rel="noopener">Open</a>
      <button class="btn" id="pubUpdate" title="Replace the published copy with the book as it is now">Update published version</button>
      <button class="btn danger" id="pubOff">Unpublish</button>
    </div>`;
  $('#pubLink').onclick = e => e.target.select();
  $('#pubShare').onclick = () => shareLink(project.title, readUrl());
  $('#pubUpdate').onclick = () => publish($('#pubUpdate'));
  $('#pubOff').onclick = async () => {
    if (!await confirmBox('Unpublish this book?', 'The reading link will stop working.', 'Unpublish')) return;
    const { error } = await sb.from('ebooks').delete().eq('id', ebook.id);
    if (error) return failed('Unpublishing', error);
    ebook = null; renderPublish(); notify('Unpublished');
  };
}

export async function shareLink(title, url) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); notify('Link copied'); } catch { prompt('Copy this link:', url); }
}

// Saves a snapshot of the book exactly as the preview shows it (translated
// text included), so later draft edits don't change what readers see.
async function publish(btn) {
  btn.disabled = true;
  const label = btn.textContent; btn.textContent = 'Publishing…';
  try {
    await flushAll();
    await refresh();
    const s = project.settings;
    const book = {
      settings: s,
      tagline: taglineHtml(),
      chapters: lastFlow.map(c => ({ id: c.id, kind: c.kind, title: c.title, html: c.html })),
    };
    const now = nowIso();
    const row = { project_id: project.id, title: project.title, book, updated_at: now, ...(ebook ? {} : { published_at: now }) };
    const { data, error } = await sb.from('ebooks').upsert(row, { onConflict: 'project_id' }).select('id, published_at, updated_at').single();
    if (error) throw error;
    const first = !ebook;
    ebook = data;
    renderPublish();
    notify(first ? 'Published — share the link with your readers' : 'Published version updated');
  } catch (e) {
    failed('Publishing', e);
    btn.disabled = false; btn.textContent = label;
  }
}

async function doExport(kind, btn) {
  await flushAll();
  btn.disabled = true;
  const label = btn.textContent; btn.textContent = 'Preparing…';
  try {
    if (!lastPages.length) await refresh();
    const { title, settings: s } = project, tagline = taglineHtml();
    if (kind === 'pdf') exportPdf(title, lastPages, s);
    if (kind === 'doc') exportDoc(title, tagline, lastFlow, s);
    if (kind === 'docx') await exportDocx(title, tagline, lastFlow, s);
  } catch (e) { failed('Download', e); }
  btn.disabled = false; btn.textContent = label;
}

// ---------- chapter editor ----------
const SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '36pt'];
const SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'];
let quillReady = false;
function setupQuill() {
  if (quillReady) return;
  quillReady = true;
  const P = Quill.import('parchment');
  // font-family comes back quoted from the DOM ("Times New Roman"); strip so it matches the whitelist
  class FontStyle extends P.StyleAttributor {
    value(node) { const v = (node.style.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(); return this.canAdd(node, v) ? v : ''; }
  }
  Quill.register(new FontStyle('font', 'font-family', { scope: P.Scope.INLINE, whitelist: FONTS }), true);
  const Size = Quill.import('attributors/style/size'); Size.whitelist = SIZES; Quill.register(Size, true);
  // No alignment = justify (the book default), so the "unset" option shows the justify icon.
  const Align = Quill.import('attributors/style/align'); Align.whitelist = ['left', 'center', 'right']; Quill.register(Align, true);
  const icons = Quill.import('ui/icons');
  icons.align.left = icons.align[''];
  icons.align[''] = icons.align.justify;
  Quill.register(new P.StyleAttributor('lineheight', 'line-height', { scope: P.Scope.BLOCK, whitelist: SPACINGS }), true);

  const css = [
    `.ql-snow .ql-picker.ql-font .ql-picker-label::before, .ql-snow .ql-picker.ql-font .ql-picker-item::before { content: "Book font"; }`,
    `.ql-snow .ql-picker.ql-size .ql-picker-label::before, .ql-snow .ql-picker.ql-size .ql-picker-item::before { content: "Size"; }`,
    `.ql-snow .ql-picker.ql-lineheight .ql-picker-label::before, .ql-snow .ql-picker.ql-lineheight .ql-picker-item::before { content: "Spacing"; }`,
    ...FONTS.map(f => `.ql-snow .ql-picker.ql-font [data-value="${f}"]::before { content: "${f}"; font-family: "${f}"; }`),
    ...SIZES.map(z => `.ql-snow .ql-picker.ql-size [data-value="${z}"]::before { content: "${z}"; }`),
    ...SPACINGS.map(z => `.ql-snow .ql-picker.ql-lineheight [data-value="${z}"]::before { content: "${z}×"; }`),
  ];
  const st = document.createElement('style'); st.textContent = css.join('\n'); document.head.append(st);
}

// Docs/Word paste every run as explicit black; drop it so text follows the
// theme in the editor (pages are dark-on-paper anyway). Other colours stay.
function keepPastedFormatting(quill) {
  quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
    for (const op of delta.ops) {
      const a = op.attributes;
      if (!a) continue;
      if (/^(black|#000(000)?|rgb\(0, ?0, ?0\))$/i.test(a.color || '')) delete a.color;
      if (/^(transparent|rgba\(0, ?0, ?0, ?0\))$/i.test(a.background || '')) delete a.background;
    }
    return delta;
  });
}

// Inserted images are downscaled so a chapter row stays small enough to save quickly.
// ponytail: images live inline in the chapter (base64); move to Supabase Storage if books get image-heavy.
function pickImage(quill) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return notify('That image could not be read');
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const url = file.type === 'image/png' && file.size < 400_000 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
    const at = (quill.getSelection(true) || { index: quill.getLength() }).index;
    quill.insertEmbed(at, 'image', url, 'user');
    quill.setSelection(at + 1, 0, 'silent');
  };
  input.click();
}

function chapterView(ch) {
  crumbs(ch);
  setupQuill();
  const s = project.settings, tr = s.translate;
  const langOpts = (list, cur, roman) => opts(list.map(([c, n]) => [c, roman && c !== 'en' ? `${ROMAN[c] || n} (${n} in English letters)` : n]), cur);
  view.innerHTML = `
    <div class="work" data-pane="side">
      ${paneTabs('Write')}
      <aside class="side editor">
        <div class="ed-head">
          <div class="row" style="justify-content:space-between">
            <a class="btn sm" href="#/p/${project.id}">‹ All chapters</a>
            <span id="saveState" style="font-size:12px;color:var(--muted)">All changes saved</span>
          </div>
          <input class="in title" id="chTitle" value="${esc(ch.title)}" placeholder="Chapter name" aria-label="Chapter name" maxlength="200">
          <div class="tr-bar ${tr.on ? 'on' : ''}" id="trBar">
            <label class="chk"><input type="checkbox" id="trOn" ${tr.on ? 'checked' : ''}> Translate the book</label>
            <select class="sel" id="trFrom" aria-label="I type in">${langOpts(SOURCES, tr.from, true)}</select>
            <span>→</span>
            <select class="sel" id="trTo" aria-label="Book language">${opts(LANGS.filter(l => l[0] !== 'en').map(l => [l[0], l[1]]), tr.to)}</select>
          </div>
        </div>
        <div class="ed-wrap"><div id="editor"></div></div>
        <div class="ed-foot">
          <span id="wc">0 words</span>
          <span class="spacer"></span>
          <button class="btn sm primary" id="saveDraft">Save draft</button>
        </div>
      </aside>
      ${previewHtml()}
    </div>`;

  const edWrap = $('.ed-wrap');
  applyVars(edWrap, s);
  const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: tr.on ? 'Type here — the preview shows the translation…' : 'Start writing your chapter…',
    modules: {
      toolbar: {
        container: [
          [{ font: [false, ...FONTS] }, { size: [false, ...SIZES] }],
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ align: [false, 'left', 'center', 'right'] }],
          [{ lineheight: [false, ...SPACINGS] }],
          ['blockquote', 'image', 'clean'],
        ],
        handlers: { image() { pickImage(this.quill); } },
      },
    },
  });
  keepPastedFormatting(quill);
  // Toolbar tooltips
  const tips = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', blockquote: 'Quote', image: 'Insert image', clean: 'Clear formatting', color: 'Text colour', background: 'Highlight', align: 'Alignment (default: justify)', lineheight: 'Line spacing', header: 'Heading', font: 'Font', size: 'Font size' };
  for (const [k, t] of Object.entries(tips)) view.querySelectorAll(`.ql-${k}`).forEach(el => el.title = t);
  view.querySelectorAll('.ql-list[value=ordered]').forEach(el => el.title = 'Numbered list');
  view.querySelectorAll('.ql-list[value=bullet]').forEach(el => el.title = 'Bullet list');

  if (ch.delta) quill.setContents(ch.delta, 'silent');
  else if (ch.html) quill.clipboard.dangerouslyPasteHTML(ch.html, 'silent');
  const updateWc = () => { $('#wc').textContent = `${words(ch.html)} words`; };
  updateWc();
  quill.on('text-change', () => {
    ch.delta = quill.getContents();
    ch.html = quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
    ch.updated_at = nowIso();
    updateWc(); saveChapter(ch); refreshSoon();
  });
  $('#chTitle').oninput = e => { ch.title = e.target.value; crumbs(ch); saveChapter(ch); refreshSoon(); };

  const trChange = () => {
    tr.on = $('#trOn').checked; tr.from = $('#trFrom').value; tr.to = $('#trTo').value;
    $('#trBar').classList.toggle('on', tr.on);
    saveProject(); refresh();
  };
  $('#trOn').onchange = $('#trFrom').onchange = $('#trTo').onchange = trChange;

  $('#saveDraft').onclick = async () => {
    await flushAll();
    notify('Draft saved — continue any time from Your books');
  };
  view.querySelectorAll('[data-set]').forEach(sel => sel.addEventListener('change', () => applyVars(edWrap, s)));
  mountPreview(ch.id);
  if (!ch.html) quill.focus();
}
