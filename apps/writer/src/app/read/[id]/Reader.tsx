'use client';

// Public reader shell; src/lib/reader.js loads the book and drives it.
import { useEffect } from 'react';
import '../../studio.css';
import './reader.css';

export default function Reader({ id }: { id: string }) {
  useEffect(() => {
    import('@/lib/reader').then(m => m.start(id));
  }, [id]);

  return (
    <>
      <link rel="stylesheet" href="/book.css" />
      <link id="bookFonts" rel="stylesheet" />
      <header className="r-top">
        <div className="r-head">
          <h1 id="rTitle">Loading…</h1>
          <span id="rAuthor" />
        </div>
        <button className="btn sm" id="rShare">Share</button>
        <button className="btn sm" data-theme-toggle="" aria-label="Toggle theme" />
      </header>
      <section className="preview r-book" aria-label="Book">
        <div className="stage" id="stage" />
        <p className="r-hint" id="rHint" aria-hidden="true">Swipe or tap the page edge to turn</p>
        <nav className="pv-nav" aria-label="Pages">
          <button className="btn sm" id="pvPrev" aria-label="Previous page">‹ Prev</button>
          <select className="sel" id="pvJump" aria-label="Go to" />
          <span id="pvAt">—</span>
          <button className="btn sm" id="pvNext" aria-label="Next page">Next ›</button>
          <button className="btn sm icon" id="pvSound" />
        </nav>
      </section>
      <footer className="r-foot">Made with <a href="/">Writers Book Studio</a></footer>
    </>
  );
}
