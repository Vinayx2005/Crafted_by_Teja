'use client';

import { useEffect, useState } from 'react';
import { supabase, CmsUser } from '@/lib/supabase';
import { Users, Trash2 } from 'lucide-react';

// Tag colour per app. Anything not listed falls back to neutral.
const TAG: Record<string, string> = {
  PFT:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  Root:  'text-sky-400 bg-sky-500/10 border-sky-500/30',
  Blog:  'text-violet-400 bg-violet-500/10 border-violet-500/30',
  Dilse: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  Writer: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  CMS:   'text-18-orange bg-18-orange/10 border-18-orange/30',
};

// "3d ago" for anything inside a month, an actual date beyond that.
function lastUsed(iso: string | null) {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN');
}

export default function UsersList() {
  const [users, setUsers] = useState<CmsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (u: CmsUser) => {
    if (!confirm(`Delete ${u.email}?

This erases their account and every PFT record they own. Cannot be undone.`)) return;
    setBusy(u.id);
    const { error } = await supabase.rpc('cms_delete_user', { target: u.id });
    setBusy(null);
    if (error) return alert(error.message);
    setUsers((prev) => prev.filter((p) => p.id !== u.id));
  };

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('cms_users_overview');
      if (error) setErr(error.message);
      setUsers((data || []) as CmsUser[]);
      setLoading(false);
    })();
  }, []);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(needle) ||
          (u.full_name || '').toLowerCase().includes(needle) ||
          u.apps.some((a) => a.toLowerCase().includes(needle))
      )
    : users;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black text-white">Users</h1>
          <p className="text-xs text-white/50 mt-0.5">
            Everyone with an account, and the apps they show up in.
          </p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or app"
          className="bg-18-surface border border-18-border rounded-full px-4 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-18-orange w-full sm:w-64"
        />
      </div>

      {loading ? (
        <p className="text-white/50 text-sm">Loading…</p>
      ) : err ? (
        <div className="bg-18-surface border border-red-500/30 rounded-2xl p-5">
          <p className="text-sm text-red-400">{err}</p>
          <p className="text-xs text-white/50 mt-2">
            Run <code className="text-white/70">migrations/cms_users_overview.sql</code> in the
            Supabase SQL editor to create the <code className="text-white/70">cms_users_overview()</code> function.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-18-surface border border-18-border rounded-2xl p-8 text-center">
          <Users size={20} className="text-white/40 mx-auto mb-2" />
          <p className="text-white/60 text-sm">{users.length === 0 ? 'No users found.' : 'No matches.'}</p>
        </div>
      ) : (
        <div className="bg-18-surface border border-18-border rounded-2xl overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Apps</th>
                <th className="text-left px-4 py-3">Last used</th>
                <th className="text-left px-4 py-3">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t border-18-border/60">
                  <td className="px-4 py-3 text-white font-semibold">
                    {u.full_name || <span className="text-white/40 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-white/70">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.apps.length === 0 ? (
                      <span className="text-white/30">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {u.apps.map((a) => (
                          <span
                            key={a}
                            className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 border ${
                              TAG[a] || 'text-white/60 bg-white/5 border-white/10'
                            }`}
                          >
                            {a}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={u.last_sign_in_at ? 'text-white/70' : 'text-white/30'}>
                      {lastUsed(u.last_sign_in_at)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(u)}
                      disabled={busy === u.id}
                      title={`Delete ${u.email}`}
                      className="text-white/30 hover:text-red-400 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !err && (
        <p className="text-[11px] text-white/35 mt-3">
          {users.length} account{users.length === 1 ? '' : 's'} · PFT and Writer have sign-ups;
          Root / Blog / Dilse tags come from authored content.
        </p>
      )}
    </div>
  );
}
