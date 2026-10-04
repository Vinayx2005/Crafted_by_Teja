'use client';

// Book Studio shell. The views inside #view are rendered by src/lib/studio.js
// (hash-routed: #/, #/p/<id>, #/p/<id>/c/<id>), so React only draws the frame.
import { useEffect } from 'react';
import 'quill/dist/quill.snow.css';
import './studio.css';

export default function Studio() {
  useEffect(() => {
    // Loaded in the browser only: Quill and PageFlip need `document`.
    import('@/lib/studio').then(m => m.start());
  }, []);

  return (
    <>
      <link rel="stylesheet" href="/book.css" />
      <link id="bookFonts" rel="stylesheet" />
      <header className="top">
        <a className="brand" href="#/">Writers <span>Book Studio</span></a>
        <nav className="crumbs" id="crumbs" aria-label="Breadcrumb" />
        <span className="spacer" />
        <button className="btn" data-theme-toggle="" aria-label="Toggle theme" />
        <span id="who" />
        <button className="btn" id="logoutBtn">Log out</button>
      </header>
      <main id="view"><div className="loading">Loading…</div></main>
    </>
  );
}
