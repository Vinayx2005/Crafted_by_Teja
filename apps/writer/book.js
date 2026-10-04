// Book engine: settings, A5 pagination, the page-flip preview and exports.

export const FONTS = [
  'Times New Roman', 'Georgia', 'EB Garamond', 'Libre Baskerville', 'Lora', 'Merriweather',
  'Crimson Text', 'Palatino Linotype', 'Noto Serif', 'Arial', 'Verdana', 'Courier New',
];
// Fallbacks so translated text in Indian scripts still renders in a book face.
// Google serves these by unicode-range, so only scripts actually used download.
const INDIC = '"Noto Serif Telugu", "Noto Serif Devanagari", "Noto Serif Tamil", "Noto Serif Kannada", "Noto Serif Malayalam", "Noto Serif Bengali", "Noto Serif Gujarati", "Noto Sans Gurmukhi", "Noto Serif Oriya", "Noto Nastaliq Urdu", "Nirmala UI", serif';
export const fontStack = f => `"${f}", ${INDIC}`;
export const FONT_CSS = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;0,600;1,400&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=Noto+Serif:ital,wght@0,400;0,700;1,400&family=Noto+Serif+Telugu:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&family=Noto+Serif+Tamil:wght@400;600&family=Noto+Serif+Kannada:wght@400;600&family=Noto+Serif+Malayalam:wght@400;600&family=Noto+Serif+Bengali:wght@400;600&family=Noto+Serif+Gujarati:wght@400;600&family=Noto+Sans+Gurmukhi:wght@400;600&family=Noto+Serif+Oriya:wght@400;600&display=swap';

export const DEFAULTS = {
  font: 'Times New Roman', size: 11, lineHeight: 1.5, paraSpacing: 6,
  header: { show: true, opacity: 0.55, size: 8.5 },
  pageNumbers: { show: true, position: 'footer', align: 'center', format: 'n', size: 9, start: 1 },
  translate: { on: false, from: 'en', to: 'te' },
};
export function withDefaults(s = {}) {
  const out = { ...DEFAULTS, ...s };
  for (const k of ['header', 'pageNumbers', 'translate']) out[k] = { ...DEFAULTS[k], ...(s[k] || {}) };
  return out;
}

export function applyVars(el, s) {
  el.classList.add('book-vars');
  el.style.setProperty('--bf', fontStack(s.font));
  el.style.setProperty('--bs', s.size + 'pt');
  el.style.setProperty('--lh', s.lineHeight);
  el.style.setProperty('--ps', s.paraSpacing + 'pt');
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const PAGE_W = 559, PAGE_H = 794;

// ---------- pagination ----------
const textNodes = el => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), a = [];
  while (w.nextNode()) a.push(w.currentNode);
  return a;
};
const countWords = el => textNodes(el).reduce((n, t) => n + (t.data.match(/\S+/g) || []).length, 0);

// Copy of `el` keeping only words [from, to), formatting intact.
function sliceWords(el, from, to) {
  const c = el.cloneNode(true);
  let i = 0;
  for (const t of textNodes(c)) {
    let out = '';
    for (const p of t.data.split(/(\S+)/)) {
      if (!p) continue;
      if (/\S/.test(p)) { if (i >= from && i < to) out += p; i++; }
      else if ((i > from && i < to) || (i === 0 && from === 0)) out += p;
    }
    t.data = out;
  }
  return c;
}

function blocksOf(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = (html || '').replace(/&nbsp;| /g, ' ');
  return [...tpl.content.childNodes].flatMap(n => {
    if (n.nodeType === 1) return [n];
    if (n.nodeType === 3 && n.data.trim()) { const p = document.createElement('p'); p.textContent = n.data; return [p]; }
    return [];
  });
}

const over = body => body.scrollHeight > body.clientHeight + 1;

// Fit as much of `b` as possible into what's left of `body`. → [head|null, tail|null]
function split(b, body) {
  if (b.tagName === 'UL' || b.tagName === 'OL') {
    const items = [...b.children], shell = b.cloneNode(false);
    body.append(shell);
    let n = 0;
    for (const li of items) { shell.append(li.cloneNode(true)); if (over(body)) break; n++; }
    shell.remove();
    if (!n) return [null, b];
    const head = b.cloneNode(false), tail = b.cloneNode(false);
    items.forEach((li, i) => (i < n ? head : tail).append(li));
    if (b.tagName === 'OL') tail.start = (b.start || 1) + n;
    return [head, tail.children.length ? tail : null];
  }
  if (/^H\d$/.test(b.tagName)) return [null, b];
  const total = countWords(b);
  if (total < 2) return [null, b];
  let lo = 0, hi = total - 1; // most words that still fit (always leave at least one for the next page)
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1, t = sliceWords(b, 0, mid);
    body.append(t); const ok = !over(body); t.remove();
    if (ok) lo = mid; else hi = mid - 1;
  }
  if (!lo) return [null, b];
  const head = sliceWords(b, 0, lo);
  head.classList.add('split-head');
  return [head, sliceWords(b, lo, total)];
}

async function imagesReady(chapters) {
  const srcs = new Set();
  for (const c of chapters) for (const m of (c.html || '').matchAll(/<img[^>]+src="([^"]+)"/g)) srcs.add(m[1].replace(/&amp;/g, '&'));
  await Promise.all([...srcs].map(src => { const i = new Image(); i.src = src; return i.decode().catch(() => {}); }));
}

let host;
// chapters: [{ id, kind, title, html }] in reading order (html already translated if needed).
// → { pages: [{ kind, first, chapter, html }], starts: { chapterId: pageIndex } }
// ponytail: re-lays out the whole book on every change; cache per chapter if long books feel slow.
export async function paginate(title, author, chapters, s) {
  await imagesReady(chapters);
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-20000px;top:0;visibility:hidden;pointer-events:none';
    document.body.append(host);
  }
  applyVars(host, s);
  const pages = [{ kind: 'title', html: `<div class="bp-cover"><h1>${esc(title)}</h1>${author ? `<p>${esc(author)}</p>` : ''}</div>` }];
  const starts = {};
  const newBody = () => {
    host.innerHTML = '<div class="bp-inner"><div class="bp-body"></div></div>';
    return host.querySelector('.bp-body');
  };
  for (const ch of chapters) {
    starts[ch.id] = pages.length;
    if (ch.kind === 'blank') { pages.push({ kind: 'blank', html: '' }); continue; }
    let body = newBody(), first = true;
    if (ch.title) body.insertAdjacentHTML('beforeend', `<h1 class="bp-chtitle">${esc(ch.title)}</h1>`);
    const flush = () => { pages.push({ kind: 'text', first, chapter: ch.title, html: body.innerHTML }); first = false; body = newBody(); };
    const queue = blocksOf(ch.html);
    while (queue.length) {
      const b = queue.shift();
      body.append(b);
      if (!over(body)) continue;
      b.remove();
      const [head, tail] = split(b, body);
      if (head) { body.append(head); flush(); if (tail) queue.unshift(tail); }
      else if (body.childNodes.length) { flush(); queue.unshift(b); }
      else { body.append(b); flush(); } // taller than a whole page: it gets clipped
    }
    if (first || body.childNodes.length) flush();
  }
  host.innerHTML = '';
  return { pages, starts };
}

const NUM_FORMATS = { n: n => `${n}`, dash: n => `– ${n} –`, page: n => `Page ${n}` };
export const NUM_FORMAT_LABELS = { n: '12', dash: '– 12 –', page: 'Page 12' };

// Full inner HTML for page i, including running header and page number.
export function pageHtml(p, i, s) {
  const pn = s.pageNumbers, hd = s.header;
  const showNum = pn.show && p.kind === 'text';
  const showHead = hd.show && p.kind === 'text' && !p.first && p.chapter;
  const recto = i % 2 === 0; // page 0 (title) is a right-hand page
  const align = pn.align === 'outer' ? (recto ? 'right' : 'left') : pn.align;
  const zone = top => {
    const cols = { left: '', center: '', right: '' };
    if (top && showHead) cols.center += `<span style="opacity:${hd.opacity};font-size:${hd.size}pt">${esc(p.chapter)}</span>`;
    if (showNum && (pn.position === 'header') === top)
      cols[align] += `<span style="font-size:${pn.size}pt">${(NUM_FORMATS[pn.format] || NUM_FORMATS.n)(i - 1 + (+pn.start || 1))}</span>`;
    if (!cols.left && !cols.center && !cols.right) return '';
    return `<div class="bp-zone ${top ? 'top' : 'bottom'}"><span>${cols.left}</span><span>${cols.center}</span><span>${cols.right}</span></div>`;
  };
  return `${zone(true)}${p.kind === 'title' ? p.html : `<div class="bp-body">${p.html}</div>`}${zone(false)}`;
}

// ---------- page-flip preview ----------
export class BookView {
  constructor(stage, onFlip) {
    this.stage = stage; this.onFlip = onFlip; this.pages = []; this.s = DEFAULTS; this.flip = null; this.at = 0;
    let t;
    new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => this.draw(), 150); }).observe(stage);
  }
  show(pages, s, at = this.flip ? this.flip.getCurrentPageIndex() : this.at) {
    this.pages = pages; this.s = s;
    this.draw(Math.max(0, Math.min(at, pages.length - 1)));
  }
  draw(at = this.flip ? this.flip.getCurrentPageIndex() : this.at) {
    const { stage, pages, s } = this;
    if (!pages.length) return;
    const W = stage.clientWidth - 24, H = stage.clientHeight - 24;
    if (W < 50 || H < 50) return;
    const two = Math.min(W / (2 * PAGE_W), H / PAGE_H), one = Math.min(W / PAGE_W, H / PAGE_H);
    const scale = two >= 0.42 ? two : one;
    this.at = at;
    if (this.flip) { this.flip.destroy(); this.flip = null; }
    const book = document.createElement('div');
    book.className = 'flipbook';
    stage.querySelector('.flipbook')?.remove();
    stage.append(book);
    const nodes = pages.map((p, i) => {
      const page = document.createElement('div');
      page.className = 'page';
      page.dataset.density = p.kind === 'title' ? 'hard' : 'soft';
      const inner = document.createElement('div');
      inner.className = 'bp-inner';
      inner.style.transform = `scale(${scale})`;
      inner.style.transformOrigin = '0 0';
      inner.innerHTML = pageHtml(p, i, s);
      applyVars(inner, s);
      page.append(inner);
      return page;
    });
    this.flip = new St.PageFlip(book, {
      width: Math.floor(PAGE_W * scale), height: Math.floor(PAGE_H * scale), size: 'fixed',
      showCover: true, usePortrait: true, maxShadowOpacity: 0.35, flippingTime: 700,
      mobileScrollSupport: false, startPage: this.at,
    });
    this.flip.loadFromHTML(nodes);
    this.flip.on('flip', e => { this.at = e.data; this.onFlip?.(e.data, pages.length); });
    this.onFlip?.(this.at, pages.length);
  }
  next() { this.flip?.flipNext(); }
  prev() { this.flip?.flipPrev(); }
  go(i) { if (this.flip) { this.flip.turnToPage(Math.max(0, Math.min(i, this.pages.length - 1))); this.at = this.flip.getCurrentPageIndex(); this.onFlip?.(this.at, this.pages.length); } }
}

// ---------- exports ----------
const fileName = (title, ext) => (title || 'book').replace(/[\\/:*?"<>|]+/g, '').trim() + '.' + ext;
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// PDF: print the exact preview pages; the browser's "Save as PDF" keeps text
// selectable and Indian scripts shaped correctly (a canvas-based PDF would not).
export function exportPdf(title, pages, s) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="${new URL('book.css', location.href)}"><link rel="stylesheet" href="${FONT_CSS}">
    <style>@page { size: 148mm 210mm; margin: 0 } html, body { margin: 0 } .bp-inner { break-after: page; -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style>
    </head><body></body></html>`);
  d.close();
  applyVars(d.body, s);
  d.body.innerHTML = pages.map((p, i) => `<div class="bp-inner">${pageHtml(p, i, s)}</div>`).join('');
  const go = async () => {
    await d.fonts?.ready;
    await Promise.all([...d.images].map(i => i.decode().catch(() => {})));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  };
  // stylesheets need a moment to arrive before fonts can be resolved
  setTimeout(go, 600);
}

// DOC: Word-flavoured HTML. Word opens it with A5 pages and the book font;
// running headers / page numbers are only in DOCX and PDF.
export function exportDoc(title, author, chapters, s) {
  const body = chapters.map((c, i) => c.kind === 'blank'
    ? `<p style="page-break-before:always">&nbsp;</p>`
    : `<h1 style="page-break-before:always;text-align:center">${esc(c.title)}</h1>${(c.html || '').replace(/&nbsp;| /g, ' ')}`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page WordSection1 { size: 148mm 210mm; margin: 18mm 16mm; } div.WordSection1 { page: WordSection1; }
body { font-family: ${fontStack(s.font)}; font-size: ${s.size}pt; line-height: ${s.lineHeight}; }
p { margin: 0 0 ${s.paraSpacing}pt; text-align: justify; } img { max-width: 100%; }</style></head>
<body><div class="WordSection1"><h1 style="text-align:center;margin-top:200pt">${esc(title)}</h1>${author ? `<p style="text-align:center">${esc(author)}</p>` : ''}${body}</div></body></html>`;
  download(new Blob(['﻿', html], { type: 'application/msword' }), fileName(title, 'doc'));
}

// DOCX: built natively with the `docx` library — A5, one section per chapter,
// chapter name as running header, page numbers per the book's settings.
export async function exportDocx(title, author, chapters, s) {
  const D = await import('https://cdn.jsdelivr.net/npm/docx@9.5.1/+esm');
  const mm = D.convertMillimetersToTwip;
  const font = s.font, half = pt => Math.round(pt * 2);
  const ALIGN = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };
  const grey = o => { const v = Math.round(255 - o * (255 - 22)).toString(16).padStart(2, '0'); return v + v + v; };
  const hex = c => {
    if (!c) return undefined;
    if (c.startsWith('#')) return c.length === 4 ? [...c.slice(1)].map(x => x + x).join('') : c.slice(1, 7);
    const m = c.match(/\d+/g); return m ? m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('') : undefined;
  };
  const bytes = async src => new Uint8Array(await (await fetch(src)).arrayBuffer());
  let listInstance = 0;

  async function runs(node, f = {}) {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.data) out.push(new D.TextRun({ text: n.data.replace(/ /g, ' '), ...f })); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName, st = n.style, g = { ...f };
      if (t === 'BR') { out.push(new D.TextRun({ break: 1 })); continue; }
      if (t === 'IMG') {
        try {
          const w = Math.min(n.naturalWidth || 400, 400), h = Math.round(w * ((n.naturalHeight || 300) / (n.naturalWidth || 400)));
          out.push(new D.ImageRun({ type: /png/.test(n.src.slice(0, 30)) ? 'png' : 'jpg', data: await bytes(n.src), transformation: { width: w, height: h } }));
        } catch {}
        continue;
      }
      if (t === 'STRONG' || t === 'B') g.bold = true;
      if (t === 'EM' || t === 'I') g.italics = true;
      if (t === 'U') g.underline = {};
      if (t === 'S' || t === 'STRIKE') g.strike = true;
      if (t === 'SUB') g.subScript = true;
      if (t === 'SUP') g.superScript = true;
      if (st.fontFamily) g.font = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (st.fontSize) g.size = half(parseFloat(st.fontSize) * (st.fontSize.endsWith('px') ? 0.75 : 1));
      if (st.color) g.color = hex(st.color);
      if (st.backgroundColor) g.shading = { type: D.ShadingType.CLEAR, fill: hex(st.backgroundColor), color: 'auto' };
      out.push(...await runs(n, g));
    }
    return out;
  }
  const paraOpts = el => ({
    alignment: ALIGN[el.style?.textAlign] || D.AlignmentType.JUSTIFIED,
    spacing: { line: Math.round((parseFloat(el.style?.lineHeight) || s.lineHeight) * 240), after: Math.round(s.paraSpacing * 20) },
  });
  async function blocks(html) {
    const out = [];
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    // images need natural sizes
    await Promise.all([...tpl.content.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    for (const el of tpl.content.childNodes) {
      if (el.nodeType === 3) { if (el.data.trim()) out.push(new D.Paragraph({ children: [new D.TextRun(el.data)], ...paraOpts({}) })); continue; }
      if (el.nodeType !== 1) continue;
      const t = el.tagName;
      if (/^H[1-6]$/.test(t)) {
        out.push(new D.Paragraph({ heading: D.HeadingLevel['HEADING_' + t[1]], ...paraOpts(el), alignment: ALIGN[el.style.textAlign] || D.AlignmentType.LEFT, children: await runs(el) }));
      } else if (t === 'UL' || t === 'OL') {
        const inst = ++listInstance;
        for (const li of el.children) out.push(new D.Paragraph({
          ...paraOpts(li), alignment: ALIGN[li.style.textAlign] || D.AlignmentType.LEFT,
          ...(t === 'UL' ? { bullet: { level: 0 } } : { numbering: { reference: 'num', level: 0, instance: inst } }),
          children: await runs(li),
        }));
      } else {
        out.push(new D.Paragraph({ ...paraOpts(el), children: await runs(el) }));
      }
    }
    return out;
  }

  const pn = s.pageNumbers, hd = s.header;
  const numFmt = { n: [], dash: ['– ', ' –'], page: ['Page ', ''] }[pn.format] || [];
  const numRun = () => [
    ...(numFmt[0] ? [new D.TextRun({ text: numFmt[0], size: half(pn.size), font })] : []),
    new D.TextRun({ children: [D.PageNumber.CURRENT], size: half(pn.size), font }),
    ...(numFmt[1] ? [new D.TextRun({ text: numFmt[1], size: half(pn.size), font })] : []),
  ];
  // Odd pages are right-hand pages in Word; `outer` flips between them.
  const numAlign = odd => ALIGN[pn.align === 'outer' ? (odd ? 'right' : 'left') : pn.align];
  const zone = (Kind, withTitle, withNum, odd, chapter) => {
    const kids = [];
    if (withTitle) kids.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: chapter, size: half(hd.size), color: grey(hd.opacity), font })] }));
    if (withNum) kids.push(new D.Paragraph({ alignment: numAlign(odd), children: numRun() }));
    return new Kind({ children: kids.length ? kids : [new D.Paragraph('')] });
  };
  const inHead = pn.show && pn.position === 'header', inFoot = pn.show && pn.position === 'footer';
  const page = { size: { width: mm(148), height: mm(210) }, margin: { top: mm(18.5), bottom: mm(18.5), left: mm(16), right: mm(16), header: mm(8), footer: mm(8) } };

  const sections = [{
    properties: { page: { ...page, pageNumbers: { start: Math.max(0, (+pn.start || 1) - 1) } } },
    headers: { default: zone(D.Header, false, false) }, footers: { default: zone(D.Footer, false, false) },
    children: [
      new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 3600, after: 360 }, children: [new D.TextRun({ text: title, size: half(s.size * 2.4), font })] }),
      ...(author ? [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: author, size: half(s.size * 1.05), font })] })] : []),
    ],
  }];
  for (const c of chapters) {
    if (c.kind === 'blank') {
      sections.push({ properties: { page }, headers: { default: zone(D.Header, false, false) }, footers: { default: zone(D.Footer, false, false) }, children: [new D.Paragraph('')] });
      continue;
    }
    const head = odd => zone(D.Header, hd.show && !!c.title, inHead, odd, c.title);
    const foot = odd => zone(D.Footer, false, inFoot, odd);
    sections.push({
      properties: { page, titlePage: true },
      headers: { default: head(true), even: head(false), first: zone(D.Header, false, inHead, true) },
      footers: { default: foot(true), even: foot(false), first: zone(D.Footer, false, inFoot, true) },
      children: [
        ...(c.title ? [new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 840, after: 540 }, children: [new D.TextRun({ text: c.title, size: half(s.size * 1.9), font })] })] : []),
        ...await blocks(c.html),
      ],
    });
  }

  const doc = new D.Document({
    title, creator: author || undefined,
    evenAndOddHeaderAndFooters: true,
    styles: { default: { document: { run: { font, size: half(s.size) } } } },
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.START }] }] },
    sections,
  });
  download(await D.Packer.toBlob(doc), fileName(title, 'docx'));
}
