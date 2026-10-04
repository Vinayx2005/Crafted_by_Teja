// Translation for the book preview — Google's translate and input-tools
// endpoints, applied to the text nodes of a chapter's HTML so
// formatting survives.
//
//   from = 'en'   English prose → translated into `to`.
//   from = other  Phonetic typing (e.g. Tanglish): each English-letter word is
//                 converted to native script (the user's saved word choices,
//                 kept from the old translator, win), then translated if `to` differs.

// [code, name, Google Input Tools code or null]
export const LANGS = [
  ['en', 'English', null], ['te', 'Telugu', 'te'], ['hi', 'Hindi', 'hi'], ['ta', 'Tamil', 'ta'],
  ['kn', 'Kannada', 'kn'], ['ml', 'Malayalam', 'ml'], ['mr', 'Marathi', 'mr'], ['bn', 'Bengali', 'bn'],
  ['gu', 'Gujarati', 'gu'], ['pa', 'Punjabi', 'pa'], ['or', 'Odia', 'or'], ['ur', 'Urdu', 'ur'],
  ['as', 'Assamese', 'as'], ['sa', 'Sanskrit', 'sa'], ['ne', 'Nepali', 'ne'], ['gom', 'Konkani', 'mr'],
  ['mai', 'Maithili', 'hi'], ['doi', 'Dogri', 'hi'],
];
const itc = code => (LANGS.find(l => l[0] === code) || [])[2];
// "I type in" options: English, or any language that can be typed phonetically.
export const SOURCES = LANGS.filter(l => l[0] === 'en' || l[2]);
export const ROMAN = { te: 'Tanglish', hi: 'Hinglish', ta: 'Thanglish', kn: 'Kanglish', ml: 'Manglish', mr: 'Minglish', bn: 'Banglish', gu: 'Gujlish', pa: 'Punglish' };

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make().catch(() => { cache.delete(key); return null; }));
  return cache.get(key);
}

// ponytail: unbounded parallel fetches; add a small queue if Google starts rate-limiting long books.
const gtranslate = (text, sl, tl) => once(`t|${sl}|${tl}|${text}`, async () => {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=` + encodeURIComponent(text);
  const j = await (await fetch(url)).json();
  return (j[0] || []).filter(s => s[0]).map(s => s[0]).join('');
});

const transliterate = (word, lang) => once(`w|${lang}|${word}`, async () => {
  const url = `https://inputtools.google.com/request?itc=${itc(lang)}-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage&text=` + encodeURIComponent(word);
  const j = await (await fetch(url)).json();
  if (j[0] !== 'SUCCESS') throw 0;
  return j[1][0][1][0];
});

// Long paragraphs are sent in sentence-sized pieces to stay under URL limits.
function chunks(text, max = 1200) {
  if (text.length <= max) return [text];
  const out = []; let cur = '';
  for (const part of text.split(/(?<=[.!?।])\s+/)) {
    if (cur && (cur + ' ' + part).length > max) { out.push(cur); cur = part; } else cur = cur ? cur + ' ' + part : part;
  }
  if (cur) out.push(cur);
  return out;
}

async function translateText(text, from, to, words) {
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
  let body = text.trim();
  if (!body) return text;
  if (from !== 'en') {
    const parts = body.split(/([A-Za-z]+)/);
    const native = await Promise.all(parts.map((p, i) => i % 2
      ? (words[`${from}:${p.toLowerCase()}`] || transliterate(p.toLowerCase(), from).then(r => r || p))
      : p));
    body = native.join('');
  }
  if (to !== from) {
    const done = await Promise.all(chunks(body).map(c => gtranslate(c, from, to)));
    if (done.every(Boolean)) body = done.join(' ');
  }
  return lead + body + trail;
}

// Returns translated HTML, or the original if nothing needs doing.
// `words` = the user's saved word choices ({ "te:nenu": "నేను" }).
export async function translateHtml(html, from, to, words = {}) {
  if (!html || (from === to && from === 'en')) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const hasText = s => /[A-Za-z\p{L}]/u.test(s);
  const jobs = [];
  // Whole paragraphs go to Google so sentences translate as sentences. Formatting
  // that covers the whole paragraph survives; formatting on a few words inside
  // it can't map onto the translated word order, so it is dropped.
  const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';
  for (const b of tpl.content.querySelectorAll(BLOCKS)) {
    if (b.querySelector(BLOCKS) || !hasText(b.textContent)) continue;
    if (b.querySelector('img')) { // keep images in place: fall back to per-text-node
      const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode; if (hasText(n.data)) jobs.push(translateText(n.data, from, to, words).then(t => { n.data = t; })); }
      continue;
    }
    let inner = b;
    while (inner.children.length === 1 && ![...inner.childNodes].some(n => n.nodeType === 3 && n.data.trim()) && inner.firstElementChild.tagName !== 'BR') inner = inner.firstElementChild;
    jobs.push(translateText(b.textContent, from, to, words).then(t => { inner.textContent = t; }));
  }
  // stray text not inside any block
  for (const n of [...tpl.content.childNodes]) if (n.nodeType === 3 && hasText(n.data)) jobs.push(translateText(n.data, from, to, words).then(t => { n.data = t; }));
  await Promise.all(jobs);
  return tpl.innerHTML;
}
