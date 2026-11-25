'use client';

// Everything under /studio: the sign-in gate and the app frame (sidebar, brand
// selector, profile menu). Row-level security and the API checks are the real
// locks; this only shows the right screen.

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookOpen, CalendarDays, Check, ChevronDown, ChevronsLeft, ChevronsRight, Clapperboard, FolderOpen, Home, LogOut, Menu, Palette, Search, X } from 'lucide-react';
import { api, configured, errorText, supabase } from '@/lib/studio/client';
import { btn, btnGhost, card, ErrorNote, field, label, menuItem, Popover, Spinner } from './ui';

type Org = { id: string; name: string; role: string };
type BrandLite = { id: string; name: string; organisation_id: string };
type State =
  | { s: 'loading' }
  | { s: 'out' }
  | { s: 'denied'; email: string; note?: string }
  | { s: 'setup'; msg: string }
  | { s: 'ok'; email: string; orgs: Org[] };

export default function Shell({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    if (!configured()) return setState({ s: 'setup', msg: 'The Supabase settings (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) are missing on this site.' });
    const sb = supabase();
    let live = true;
    const check = async () => {
      const {
        data: { session },
      } = await sb.auth.getSession();
      const email = session?.user.email?.toLowerCase();
      if (!live) return;
      if (!email) return setState({ s: 'out' });
      try {
        // An invitation link (?invite=token) is accepted once the person is signed in.
        const token = new URLSearchParams(window.location.search).get('invite');
        if (token) {
          window.history.replaceState(null, '', window.location.pathname);
          await api('invite.accept', { token }).catch((e) => sessionStorage.setItem('studio-invite-error', errorText(e)));
        }
        const { organisations } = await api<{ organisations: Org[] }>('org.list');
        if (!live) return;
        setState(organisations.length ? { s: 'ok', email, orgs: organisations } : { s: 'denied', email, note: sessionStorage.getItem('studio-invite-error') ?? '' });
      } catch (e) {
        if (live) setState({ s: 'setup', msg: errorText(e) });
      }
    };
    check();
    const { data: sub } = sb.auth.onAuthStateChange(() => check());
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state.s === 'loading')
    return (
      <Overlay center>
        <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Loading…</p>
      </Overlay>
    );
  if (state.s === 'setup') return <Overlay center><Box><ErrorNote text={state.msg} /></Box></Overlay>;
  if (state.s === 'out') return <Overlay center><Box><Login /></Box></Overlay>;
  if (state.s === 'denied')
    return (
      <Overlay center>
        <Box>
          <p className="text-st-ink text-sm leading-relaxed">
            <strong>{state.email}</strong> isn&apos;t part of any organisation yet. Ask an Owner or Admin for an invitation link, then open it while signed in.
          </p>
          {state.note && <p className="text-xs text-red-600 mt-2">{state.note}</p>}
          <button onClick={() => supabase().auth.signOut()} className={`${btnGhost} mt-4`}>
            Sign out
          </button>
        </Box>
      </Overlay>
    );

  return <Frame email={state.email} orgs={state.orgs}>{children}</Frame>;
}

// Covers the site header and footer: the studio is its own app.
const Overlay = ({ children, center }: { children: React.ReactNode; center?: boolean }) => (
  <div className={`fixed inset-0 z-50 bg-white text-st-ink [color-scheme:light] font-[Inter,system-ui,sans-serif] ${center ? 'overflow-y-auto flex items-center justify-center p-4' : 'flex'}`}>{children}</div>
);
const Box = ({ children }: { children: React.ReactNode }) => <div className={`${card} p-6 w-full max-w-sm`}>{children}</div>;

const NAV = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'calendar', label: 'Content Calendar', icon: CalendarDays },
  { key: 'library', label: 'Library', icon: FolderOpen },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { key: 'video', label: 'Video Editor', icon: Clapperboard },
  { key: 'research', label: 'Research', icon: Search },
  { key: 'settings', label: 'Brand Settings', icon: Palette },
] as const;

function Frame({ email, orgs, children }: { email: string; orgs: Org[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [remembered, setRemembered] = useState('');
  // The desktop sidebar can shrink to icons only, to give the page more room. Remembered in this browser.
  const [mini, setMini] = useState(false);
  useEffect(() => { try { setMini(localStorage.getItem('studio-sidebar-mini') === '1'); } catch {} }, []);
  const toggleMini = () => setMini((m) => { try { localStorage.setItem('studio-sidebar-mini', m ? '0' : '1'); } catch {} return !m; });

  const brandId = pathname.match(/^\/studio\/([0-9a-f-]{36})/i)?.[1] ?? '';
  // The old Silence remover section is now part of the Video Editor (Remove pauses & fillers).
  const asked = brandId ? params.get('section') || 'calendar' : 'home';
  const section = asked === 'silence' ? 'video' : asked;
  // The Video Editor and the Content Calendar get the whole width (timeline, chat beside the outputs).
  const wide = section === 'video' || section === 'calendar';

  // Fresh on every screen change, so a new or archived brand shows up straight away.
  useEffect(() => {
    supabase().from('studio_brands').select('id, name, organisation_id').is('archived_at', null).order('name').then(({ data }) => setBrands((data ?? []) as BrandLite[]));
  }, [pathname]);
  useEffect(() => {
    try {
      if (brandId) localStorage.setItem('studio-brand', brandId);
      else setRemembered(localStorage.getItem('studio-brand') ?? '');
    } catch {}
  }, [brandId]);
  useEffect(() => setDrawer(false), [pathname, section]);

  const current = brands.find((b) => b.id === brandId) ?? null;
  const target = current ?? brands.find((b) => b.id === remembered) ?? brands[0] ?? null; // what the sidebar opens
  const org = orgs.find((o) => o.id === (current ?? target)?.organisation_id) ?? orgs[0];
  const href = (key: string) => (key === 'home' ? '/studio' : target ? `/studio/${target.id}?section=${key}` : '/studio');

  const sidebar = (small: boolean) => (
    <nav aria-label="Studio" className="flex flex-col h-full">
      <div className={`flex items-center gap-2.5 h-14 shrink-0 ${small ? 'justify-center' : 'px-5'}`}>
        <span className="h-7 w-7 rounded-lg bg-18-orange text-white flex items-center justify-center text-sm font-bold" aria-hidden>C</span>
        {!small && <span className="font-semibold text-[15px] tracking-tight">Content Studio</span>}
      </div>
      <ul className={`${small ? 'px-2' : 'px-3'} py-2 space-y-0.5`}>
        {NAV.map(({ key, label: text, icon: Icon }) => {
          const active = section === key || (section === 'create' && key === 'library'); // Create is reached from the calendar or an opened script
          return (
            <li key={key}>
              <Link
                href={href(key)}
                // Video Editor: clicking it again (same page) closes the open project and shows the projects.
                onClick={key === 'video' ? () => window.dispatchEvent(new Event('studio-video-home')) : undefined}
                aria-current={active ? 'page' : undefined}
                title={small ? text : undefined}
                className={`flex items-center gap-3 rounded-lg ${small ? 'justify-center px-0' : 'px-3'} py-2.5 min-h-[40px] text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 ${active ? 'bg-18-orange/10 text-18-orange font-semibold' : 'text-st-ink/80 hover:bg-st-surface hover:text-st-ink'}`}
              >
                <Icon size={17} aria-hidden /> {small ? <span className="sr-only">{text}</span> : text}
              </Link>
            </li>
          );
        })}
      </ul>
      {!brands.length && !small && <p className="px-5 mt-3 text-xs text-st-mute">Create your first brand on Home to unlock the other sections.</p>}
    </nav>
  );

  return (
    <Overlay>
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-col ${mini ? 'w-16' : 'w-60'} shrink-0 border-r border-st-line bg-white transition-[width]`}>
        <div className="min-h-0 flex-1">{sidebar(mini)}</div>
        <button onClick={toggleMini} aria-label={mini ? 'Expand the menu' : 'Collapse the menu'} title={mini ? 'Expand the menu' : 'Collapse the menu'}
          className={`m-2 flex items-center gap-2 rounded-lg py-2.5 min-h-[40px] text-sm text-st-mute hover:bg-st-surface hover:text-st-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-18-orange/40 ${mini ? 'justify-center' : 'px-3'}`}>
          {mini ? <ChevronsRight size={17} aria-hidden /> : <><ChevronsLeft size={17} aria-hidden /> Collapse</>}
        </button>
      </aside>

      {/* Tablet and mobile drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[85vw] bg-white border-r border-st-line shadow-xl">
            <button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute top-3 right-3 p-2 text-st-mute hover:text-st-ink"><X size={18} /></button>
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 border-b border-st-line flex items-center gap-2 px-3 md:px-6">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="lg:hidden p-2 -ml-1 rounded-lg text-st-ink hover:bg-st-surface"><Menu size={20} /></button>
          <span className="lg:hidden font-semibold text-sm tracking-tight mr-1">Content Studio</span>
          <span className="hidden sm:block text-sm text-st-mute truncate max-w-[10rem]" title="Organisation">{org?.name}</span>
          <span className="hidden sm:block text-st-line" aria-hidden>/</span>

          <Popover
            trigger={({ open, toggle }) => (
              <button onClick={toggle} aria-haspopup="listbox" aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 min-h-[40px] text-sm font-medium hover:bg-st-surface max-w-[12rem] sm:max-w-[16rem]">
                <span className="truncate">{current?.name ?? 'Select brand'}</span>
                <ChevronDown size={14} className="text-st-mute shrink-0" aria-hidden />
              </button>
            )}
          >
            {(close) => (
              <div role="listbox" aria-label="Brands">
                {brands.map((b) => (
                  <Link key={b.id} href={`/studio/${b.id}?section=${brandId ? section : 'calendar'}`} onClick={close} role="option" aria-selected={b.id === brandId} className={`${menuItem} justify-between`}>
                    <span className="truncate">{b.name}</span>
                    {b.id === brandId && <Check size={14} className="text-18-orange shrink-0" aria-hidden />}
                  </Link>
                ))}
                {!brands.length && <p className="px-3 py-2 text-sm text-st-mute">No brands yet.</p>}
                <div className="my-1 border-t border-st-line" />
                <Link href="/studio" onClick={close} className={menuItem}>All brands and team</Link>
              </div>
            )}
          </Popover>

          <div className="flex-1" />
          <Popover
            align="right"
            trigger={({ open, toggle }) => (
              <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label="Profile menu" className="h-9 w-9 rounded-full bg-st-surface border border-st-line text-sm font-semibold text-st-ink hover:border-[#D4D4D4] flex items-center justify-center">
                {email[0]?.toUpperCase()}
              </button>
            )}
          >
            {() => (
              <div role="menu">
                <div className="px-3 py-2.5 border-b border-st-line mb-1">
                  <p className="text-sm font-medium truncate">{email}</p>
                  <p className="text-xs text-st-mute capitalize">{org ? `${org.role} · ${org.name}` : ''}</p>
                </div>
                <button role="menuitem" onClick={() => supabase().auth.signOut()} className={menuItem}>
                  <LogOut size={15} aria-hidden /> Sign out
                </button>
              </div>
            )}
          </Popover>
        </header>

        <main id="studio-main" className="flex-1 overflow-y-auto">
          <div className={`${wide ? 'max-w-[1800px]' : 'max-w-[960px]'} mx-auto px-4 md:px-8 py-6 md:py-8`}>{children}</div>
        </main>
      </div>
    </Overlay>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function go(create: boolean) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const sb = supabase();
      if (create) {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMsg('Check your email to confirm the account, then sign in.');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setMsg(errorText(e));
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(false);
      }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2.5 mb-1">
        <span className="h-7 w-7 rounded-lg bg-18-orange text-white flex items-center justify-center text-sm font-bold" aria-hidden>C</span>
        <h1 className="text-lg font-semibold tracking-tight">Content Studio</h1>
      </div>
      <p className="text-xs text-st-mute">Private to your team. Sign in, or create an account with the email you were invited with.</p>
      <div>
        <label className={label} htmlFor="studio-email">Email</label>
        <input id="studio-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="studio-password">Password</label>
        <input id="studio-password" type="password" required minLength={6} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
      </div>
      <ErrorNote text={msg} />
      <div className="flex gap-2">
        <button disabled={busy} className={btn}>{busy ? <Spinner /> : null} Sign in</button>
        <button type="button" disabled={busy || !email || password.length < 6} onClick={() => go(true)} className={btnGhost}>
          Create account
        </button>
      </div>
    </form>
  );
}
