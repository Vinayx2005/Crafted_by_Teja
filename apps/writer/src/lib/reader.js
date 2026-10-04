// Public ebook reader (/read/<id>) — no sign-in. Shows the published snapshot
// as a flip-book: closed on the cover, swipe / tap / arrow keys to turn.
import { sb } from './common';
import { withDefaults, paginate, BookView, FONT_CSS } from './book';
import { play } from './sound';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const soundOn = () => { try { return localStorage.getItem('reader_sound') !== 'off'; } catch { return true; } };

let started = false;
export async function start(id) {
  if (started) return;
  started = true;
  const { data, error } = await sb.from('ebooks').select('title, book').eq('id', id).maybeSingle();
  if (error || !data) {
    $('#stage').innerHTML = '<p class="r-msg">This book isn’t available. The link may be wrong, or the author unpublished it.</p>';
    return;
  }
  const s = withDefaults(data.book.settings);
  const chapters = data.book.chapters || [];
  $('#bookFonts').href = FONT_CSS;
  $('#rTitle').textContent = data.title;
  $('#rAuthor').textContent = s.author ? `by ${s.author}` : '';

  let starts = {}, picked = null;
  const view = new BookView($('#stage'), (at, total) => {
    const last = view.flip?.getOrientation?.() === 'landscape' && at > 0 && at < total - 1 ? at + 1 : at;
    $('#pvAt').textContent = `${last > at ? `${at + 1}–${last + 1}` : at + 1} / ${total}`;
    const jump = $('#pvJump');
    if (picked != null && picked >= at && picked <= last) { jump.value = String(picked); return; }
    picked = null;
    const here = [...jump.options].filter(o => +o.value <= last).pop();
    if (here) jump.value = here.value;
  });
  view.sound = kind => soundOn() && play(kind);

  const layout = async () => {
    const out = await paginate(data.title, data.book.tagline, chapters, s);
    starts = out.starts;
    let n = 0;
    $('#pvJump').innerHTML = [
      '<option value="0">Cover</option>',
      ...chapters.filter(c => c.kind === 'chapter' && starts[c.id] != null)
        .map(c => `<option value="${starts[c.id]}">${esc(c.title || `Chapter ${++n}`)}</option>`),
      `<option value="${out.pages.length - 1}">Back cover</option>`,
    ].join('');
    view.show(out.pages, s);
  };
  await layout();
  // web fonts change line breaks once they arrive; re-lay out, keeping the place
  let t;
  document.fonts.addEventListener?.('loadingdone', () => { clearTimeout(t); t = setTimeout(layout, 400); });

  $('#pvPrev').onclick = () => view.prev();
  $('#pvNext').onclick = () => view.next();
  $('#pvJump').onchange = e => { picked = +e.target.value; view.go(picked); };
  addEventListener('keydown', e => {
    if (e.target.closest('select')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); view.next(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') view.prev();
  });

  const sb_ = $('#pvSound');
  const showSound = () => { const on = soundOn(); sb_.textContent = on ? '🔊' : '🔇'; sb_.title = on ? 'Mute page sounds' : 'Turn page sounds on'; sb_.setAttribute('aria-label', sb_.title); };
  sb_.onclick = () => { try { localStorage.setItem('reader_sound', soundOn() ? 'off' : 'on'); } catch {} showSound(); };
  showSound();

  $('#rShare').onclick = async () => {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: data.title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); $('#rShare').textContent = 'Link copied'; setTimeout(() => { $('#rShare').textContent = 'Share'; }, 1800); }
    catch { prompt('Copy this link:', url); }
  };

  // one-time hint for first-time readers
  const hint = $('#rHint');
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 3500);
}
