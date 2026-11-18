'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Plus, X } from 'lucide-react';
import { api, errorText, supabase } from '@/lib/studio/client';
import { ROLES, type Role } from '@/lib/studio/roles';
import type { Page } from '@/lib/studio/shared';
import PageForm, { type PageValues } from './page-form';
import { btn, btnGhost, card, ErrorNote, field, Spinner, useConfirm } from './ui';

export default function StudioHome() {
  const router = useRouter();
  const [pages, setPages] = useState<Page[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [orgs, setOrgs] = useState<Org[]>([]);

  useEffect(() => {
    supabase()
      .from('studio_brands')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => (error ? setError(error.message) : setPages(data as Page[])));
    api('org.list').then((d) => setOrgs(d.organisations)).catch((e) => setError(errorText(e)));
  }, []);

  const admin = orgs.find((o) => o.role === 'owner' || o.role === 'admin');

  async function create(v: PageValues) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { brand } = await api('brand.create', { organisationId: admin?.id, name: v.name, niche: v.niche, audience: v.audience, voice: v.voice, languages: v.languages });
      router.push(`/studio/${brand.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-st-ink">Home</h1>
          <p className="text-st-mute text-sm mt-1">Pick a brand to create content, or manage your team below.</p>
        </div>
        {!creating && admin && (
          <button onClick={() => setCreating(true)} className={btn}>
            <Plus size={16} aria-hidden /> New brand
          </button>
        )}
      </div>

      <ErrorNote text={error} />

      {creating && (
        <div className={`${card} p-5 mb-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-st-ink">New brand</h2>
            <button onClick={() => setCreating(false)} aria-label="Cancel" className="text-st-mute hover:text-st-ink p-1.5 -m-1.5">
              <X size={18} />
            </button>
          </div>
          <PageForm submitLabel="Create brand" busy={busy} onSubmit={create} />
        </div>
      )}

      {pages === null ? (
        !error && <p className="text-st-mute text-sm flex items-center gap-2"><Spinner /> Loading…</p>
      ) : pages.length === 0 ? (
        !creating && <p className="text-st-mute text-sm">No brands yet. Create the first one to get started.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {pages.map((p) => (
            <Link key={p.id} href={`/studio/${p.id}?section=create`} className={`${card} group p-5 hover:border-18-orange/40 transition`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-st-ink truncate">{p.name}</h2>
                  <p className="text-sm text-st-mute mt-1 line-clamp-2">{p.niche}</p>
                  <p className="text-[11px] text-st-mute mt-3">{p.languages.join(' · ')}</p>
                </div>
                <ArrowRight size={16} className="text-st-mute group-hover:text-18-orange shrink-0 mt-1" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      )}

      {orgs.map((o) => <Team key={o.id} org={o} />)}
    </div>
  );
}

// People in the organisation, their roles and invitations. The server decides
// what each role may do; this only hides buttons that would be refused.
type Org = { id: string; name: string; role: Role };
type Member = { userId: string; role: Role; email: string | null };
type Invite = { id: string; email: string; role: Role; expires_at: string };
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

function Team({ org }: { org: Org }) {
  const [ask, dialog] = useConfirm();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [you, setYou] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const manage = org.role === 'owner' || org.role === 'admin';

  const load = () =>
    api('member.list', { organisationId: org.id })
      .then((d) => { setMembers(d.members); setInvites(d.invites); setYou(d.you.userId); })
      .catch((e) => setError(errorText(e)));
  useEffect(() => { load(); }, [org.id]);

  const run = (action: string, body: object) => api(action, { organisationId: org.id, ...body }).then(load).catch((e) => setError(errorText(e)));

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLink('');
    try {
      const d = await api('member.invite', { organisationId: org.id, email, role });
      setLink(`${window.location.origin}/studio?invite=${d.token}`);
      setEmail('');
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className={`${card} p-5 mt-10`}>
      {dialog}
      <h2 className="font-semibold text-st-ink">Team · {org.name}</h2>
      <p className="text-xs text-st-mute mt-1 mb-4">
        Owner and Admin manage people and brands. Editor creates and edits content. Viewer can only read.
      </p>
      <ul className="space-y-1.5 mb-4">
        {members.map((m) => {
          const mine = m.userId === you;
          const canChange = manage && !mine && (org.role === 'owner' || m.role !== 'owner');
          return (
            <li key={m.userId} className="flex items-center justify-between gap-3 text-sm text-st-ink">
              <span className="truncate">{m.email ?? m.userId}{mine && <span className="text-st-mute"> (you)</span>}</span>
              <span className="flex items-center gap-2 shrink-0">
                {canChange ? (
                  <select value={m.role} aria-label={`Role of ${m.email}`} onChange={(e) => run('member.setRole', { userId: m.userId, role: e.target.value })} className={`${field} !py-1 !w-auto`}>
                    {(org.role === 'owner' ? ROLES : ROLES.filter((r) => r !== 'owner')).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span className="text-st-mute text-xs">{ROLE_LABEL[m.role]}</span>
                )}
                {(canChange || (mine && m.role !== 'owner')) && (
                  <button onClick={async () => (await ask(mine ? 'Leave this organisation?' : `Remove ${m.email} from the team?`, mine ? 'Leave' : 'Remove')) && run('member.remove', { userId: m.userId })} aria-label={`Remove ${m.email}`} className="text-st-mute hover:text-red-600 p-1.5 -m-1.5">
                    <X size={14} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {manage && (
        <>
          {invites.length > 0 && (
            <ul className="space-y-1.5 mb-4 text-xs text-st-mute">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">Invited: {i.email} as {ROLE_LABEL[i.role]} (expires {new Date(i.expires_at).toLocaleDateString()})</span>
                  <button onClick={() => run('invite.revoke', { inviteId: i.id })} className="hover:text-red-600 shrink-0">Revoke</button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={invite} className="flex flex-wrap gap-2">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" aria-label="Teammate email" className={`${field} flex-1 min-w-[12rem]`} />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role" className={`${field} !w-auto`}>
              {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className={btnGhost}>Create invite link</button>
          </form>
          {link && (
            <div className="mt-3 text-xs text-st-ink/70 break-all">
              Send this link to them (shown once, works for 7 days, only for that email):
              <div className="mt-1 flex gap-2 items-start">
                <code className="flex-1 bg-st-surface rounded px-2 py-1">{link}</code>
                <button type="button" onClick={() => navigator.clipboard?.writeText(link)} className={btnGhost}>Copy</button>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </section>
  );
}
