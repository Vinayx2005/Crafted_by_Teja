'use client';

// Opened by Penguin's "Connect" button: /connect-penguin?port=8765&state=...
// Sign in with Google (or the existing session), confirm, and the page hands a Penguin-only session to
// Penguin running on THIS computer (127.0.0.1 only — the target is hard-coded, never taken from the URL).

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import GoogleAuthButton from '@/components/GoogleAuthButton';

function Connect() {
  const params = useSearchParams();
  const port = params.get('port') || '';
  const state = params.get('state') || '';
  const valid = /^\d{2,5}$/.test(port) && /^[A-Za-z0-9_-]{16,128}$/.test(state);

  const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined = still checking
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<Record<string, string> | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  // Once the link is minted, post it to Penguin with a normal form navigation (no CORS needed).
  useEffect(() => {
    if (payload) form.current?.submit();
  }, [payload]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Please sign in first.');
      const res = await fetch('/api/penguin/link', { method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not connect Penguin.');
      setPayload(body);
    } catch (e: any) {
      setError(e.message || 'Could not connect Penguin.');
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-18-bg text-white">
      <div className="w-full max-w-sm space-y-5 text-center">
        <h1 className="text-xl font-semibold">Connect Penguin to Personal FT</h1>
        {!valid ? (
          <p className="text-sm text-red-400">This link is not valid. Start again from Penguin → Apps → Personal FT → Connect.</p>
        ) : email === undefined ? (
          <p className="text-sm opacity-70">Checking your sign-in…</p>
        ) : email === null ? (
          <>
            <p className="text-sm opacity-70">Sign in to the account Penguin should add expenses to.</p>
            <GoogleAuthButton redirectTo={typeof window !== 'undefined' ? window.location.href : undefined} />
          </>
        ) : (
          <>
            <p className="text-sm opacity-80">
              Let Penguin on this computer add expenses to <b>{email}</b>?
            </p>
            <button onClick={connect} disabled={busy} className="w-full py-3 rounded-lg bg-orange-500 font-semibold disabled:opacity-50">
              {busy ? 'Connecting…' : 'Connect Penguin'}
            </button>
            <button
              onClick={async () => { await supabase.auth.signOut(); setEmail(null); }}
              className="text-xs underline opacity-60"
            >
              Use a different account
            </button>
          </>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {payload && (
          <form ref={form} method="POST" action={`http://127.0.0.1:${port}/pft-callback`} className="hidden">
            <input name="state" value={state} readOnly />
            {Object.entries(payload).map(([k, v]) => <input key={k} name={k} value={v} readOnly />)}
          </form>
        )}
      </div>
    </main>
  );
}

export default function ConnectPenguinPage() {
  return <Suspense><Connect /></Suspense>;
}
