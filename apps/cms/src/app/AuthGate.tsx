'use client';

// Client-side auth gate. Renders <Login /> if there's no session or the
// signed-in email isn't in AUTHOR_ALLOWLIST; otherwise renders children
// wrapped in the CMS shell (sidebar + top bar). RLS in Supabase is the
// real security gate — this is just the UX.

import { useEffect, useState, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, AUTHOR_ALLOWLIST } from '@/lib/supabase';
import { PenLine, Sparkles, BookOpen, Users, UserCircle, LogOut } from 'lucide-react';

type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'unauthorized'; email: string }
  | { status: 'ready'; email: string };

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const evaluate = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user) return setState({ status: 'signed_out' });
      const email = session.user.email || '';
      if (!AUTHOR_ALLOWLIST.includes(email.toLowerCase()))
        return setState({ status: 'unauthorized', email });
      setState({ status: 'ready', email });
    };

    evaluate();
    const sub = supabase.auth.onAuthStateChange(() => evaluate());
    return () => { cancelled = true; sub.data.subscription.unsubscribe(); };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/50 text-sm">Loading…</div>
      </div>
    );
  }

  if (state.status === 'signed_out') return <Login />;
  if (state.status === 'unauthorized') return <NotAllowed email={state.email} />;
  return <Shell email={state.email}>{children}</Shell>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-18-surface border border-18-border rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="bg-18-orange h-7 w-7 rounded-full flex items-center justify-center">
            <span className="text-white font-bold text-[10px]">CBT</span>
          </div>
          <span className="font-bold text-sm">CMS · Crafted by Teja</span>
        </div>
        <label className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mt-1 mb-4 bg-18-surface-2 border border-18-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-18-orange"
        />
        <label className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Password</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mt-1 mb-4 bg-18-surface-2 border border-18-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-18-orange"
        />
        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-18-orange text-white font-bold text-sm rounded-full py-2.5 hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function NotAllowed({ email }: { email: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <p className="text-sm text-white/60 mb-2">Signed in as <span className="text-white font-semibold">{email}</span></p>
        <p className="text-white/80">This account isn&apos;t on the CMS allowlist.</p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-4 text-xs text-18-orange hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function Shell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const NAV = [
    { href: '/blog',    label: 'Blog',    icon: PenLine,  match: '/blog' },
    { href: '/agent',   label: 'Blog agent', icon: Sparkles, match: '/agent' },
    { href: '/stories', label: 'Dilse',   icon: BookOpen, match: '/stories' },
    { href: '/author',  label: 'Author profile', icon: UserCircle, match: '/author' },
    { href: '/users',   label: 'Users',   icon: Users,    match: '/users' },
  ];
  const isActive = (n: typeof NAV[0]) => pathname === n.href || pathname.startsWith(n.match + '/');

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="md:w-60 md:min-h-screen border-b md:border-b-0 md:border-r border-18-border/60 bg-18-surface/50 p-4 flex md:flex-col justify-between md:justify-start gap-4">
        <div>
          <Link href="/" className="flex items-center gap-2 mb-6">
            <div className="bg-18-orange h-7 w-7 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">CBT</span>
            </div>
            <span className="font-bold text-sm">CMS</span>
          </Link>
          <nav className="flex md:flex-col gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = isActive(n);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? 'bg-18-orange text-white font-semibold'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon size={14} /> {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="md:mt-auto">
          <p className="text-[10px] text-white/40 truncate md:mb-2" title={email}>{email}</p>
          <button
            onClick={signOut}
            className="hidden md:inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
