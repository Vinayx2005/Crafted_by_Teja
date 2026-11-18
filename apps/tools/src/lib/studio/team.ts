// Content Studio: organisations, members, invitations, brands and usage.
// Every handler checks, on the server, who is asking and what they may do.

import { createHash, randomBytes } from 'crypto';
import { authorise, checkInvite, checkMemberChange, organisationFor, ROLES, type Principal, type Role } from './access';
import { dbStore } from './access-db';
import { HttpError, notFound } from './errors';
import { safeUrl, stripControl } from './safety';
import { count, emailOf, insert, isPlatformAdmin, patch, remove, rows } from './server';

const user = (p: Principal) => {
  if (p.kind !== 'user') throw new HttpError(403, 'You do not have permission to do this.');
  return p;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const iso = (ms: number) => encodeURIComponent(new Date(Date.now() + ms).toISOString());
const text = (v: unknown, max: number) => stripControl(String(v ?? '')).trim().slice(0, max);

// ─── Organisations ─────────────────────────────────────────────────────
export async function orgList(p: Principal) {
  const me = user(p);
  const mine = await dbStore.orgsOf(me.id);
  const orgs = mine.length ? await rows<{ id: string; name: string; slug: string }>(`studio_organisations?select=id,name,slug&id=in.(${mine.map((m) => m.organisationId).join(',')})&order=name`) : [];
  return {
    organisations: orgs.map((o) => ({ ...o, role: mine.find((m) => m.organisationId === o.id)!.role })),
    canCreateOrganisation: isPlatformAdmin(me.email),
  };
}

const slugify = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'organisation';

export async function orgCreate(b: any, p: Principal) {
  const me = user(p);
  if (!isPlatformAdmin(me.email)) throw new HttpError(403, 'New organisations are created by invitation only for now.');
  const name = text(b.name, 100);
  if (!name) throw new HttpError(400, 'Give the organisation a name.');
  let slug = slugify(name);
  for (let n = 2; await count(`studio_organisations?select=id&slug=eq.${slug}`); n++) slug = `${slugify(name).slice(0, 45)}-${n}`;
  const [org] = await insert('studio_organisations', { name, slug, created_by: me.id });
  try {
    await insert('studio_org_members', { organisation_id: org.id, user_id: me.id, role: 'owner' }, 'return=minimal');
  } catch (e) {
    await remove(`studio_organisations?id=eq.${org.id}`); // never leave an organisation nobody owns
    throw e;
  }
  return { organisation: { ...org, role: 'owner' } };
}

export async function orgUpdate(b: any, p: Principal) {
  const a = await authorise(dbStore, p, 'admin', { organisationId: String(b.organisationId ?? '') });
  const name = text(b.name, 100);
  if (!name) throw new HttpError(400, 'Give the organisation a name.');
  await patch(`studio_organisations?id=eq.${a.organisationId}`, { name, updated_at: new Date().toISOString() });
  return { ok: true };
}

// ─── Members and invitations ───────────────────────────────────────────
export async function memberList(b: any, p: Principal) {
  const a = await authorise(dbStore, p, 'viewer', { organisationId: String(b.organisationId ?? '') });
  const list = await rows<{ user_id: string; role: Role; created_at: string }>(`studio_org_members?select=user_id,role,created_at&organisation_id=eq.${a.organisationId}&order=created_at`);
  const members = await Promise.all(list.map(async (m) => ({ userId: m.user_id, role: m.role, since: m.created_at, email: await emailOf(m.user_id) })));
  const canManage = a.role === 'owner' || a.role === 'admin';
  const invites = canManage
    ? await rows(`studio_org_invites?select=id,email,role,expires_at,created_at&organisation_id=eq.${a.organisationId}&accepted_at=is.null&order=created_at`)
    : [];
  return { members, invites, you: { userId: user(p).id, role: a.role } };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// The invitation is a link the Admin shares. Only a hash of the token is stored.
export async function memberInvite(b: any, p: Principal) {
  const me = user(p);
  const a = await authorise(dbStore, p, 'admin', { organisationId: String(b.organisationId ?? '') });
  const role = String(b.role ?? '') as Role;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Pick a role: admin, editor or viewer.');
  checkInvite(a.role as Role, role);
  const email = text(b.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (await count(`studio_org_invites?select=id&organisation_id=eq.${a.organisationId}&email=eq.${encodeURIComponent(email)}&accepted_at=is.null`))
    throw new HttpError(409, 'That person already has a pending invitation. Revoke it first to send a new one.');
  const token = randomBytes(32).toString('hex');
  const [invite] = await insert('studio_org_invites', {
    organisation_id: a.organisationId, email, role, invited_by: me.id, token_hash: sha(token),
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  return { invite: { id: invite.id, email, role, expires_at: invite.expires_at }, token };
}

export async function inviteRevoke(b: any, p: Principal) {
  const a = await authorise(dbStore, p, 'admin', { organisationId: String(b.organisationId ?? '') });
  const id = String(b.inviteId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  await remove(`studio_org_invites?id=eq.${id}&organisation_id=eq.${a.organisationId}&accepted_at=is.null`);
  return { ok: true };
}

const BAD_INVITE = () => new HttpError(404, 'This invitation is not valid. Ask for a new one.');

export async function inviteAccept(b: any, p: Principal) {
  const me = user(p);
  const token = String(b.token ?? '');
  if (!/^[0-9a-f]{64}$/.test(token)) throw BAD_INVITE();
  const [inv] = await rows<{ id: string; organisation_id: string; email: string; role: Role; expires_at: string; accepted_at: string | null }>(`studio_org_invites?select=*&token_hash=eq.${sha(token)}`);
  if (!inv || inv.accepted_at) throw BAD_INVITE();
  if (Date.parse(inv.expires_at) < Date.now()) throw new HttpError(410, 'This invitation has expired. Ask for a new one.');
  if (inv.email !== me.email) throw new HttpError(403, 'This invitation was sent to a different email address. Sign in with that one.');
  if (!(await dbStore.roleOf(me.id, inv.organisation_id))) {
    await insert('studio_org_members', { organisation_id: inv.organisation_id, user_id: me.id, role: inv.role }, 'return=minimal');
  }
  await patch(`studio_org_invites?id=eq.${inv.id}`, { accepted_at: new Date().toISOString() });
  return { organisationId: inv.organisation_id, role: inv.role };
}

async function changeMember(b: any, p: Principal, next: Role | null) {
  const me = user(p);
  const a = await authorise(dbStore, p, 'viewer', { organisationId: String(b.organisationId ?? '') });
  const userId = String(b.userId ?? '');
  const targetRole = await dbStore.roleOf(userId, a.organisationId);
  if (!targetRole) throw notFound();
  const owners = await count(`studio_org_members?select=id&organisation_id=eq.${a.organisationId}&role=eq.owner`);
  checkMemberChange({ actor: a.role as Role, target: targetRole, next, ownerCount: owners, self: userId === me.id });
  const where = `studio_org_members?organisation_id=eq.${a.organisationId}&user_id=eq.${userId}`;
  if (next === null) await remove(where);
  else await patch(where, { role: next });
  return { ok: true };
}

export async function memberSetRole(b: any, p: Principal) {
  const role = String(b.role ?? '') as Role;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Pick a role: owner, admin, editor or viewer.');
  return changeMember(b, p, role);
}
export const memberRemove = (b: any, p: Principal) => changeMember(b, p, null);

// ─── Brands ────────────────────────────────────────────────────────────
const list = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : []).map((x) => text(x, maxLen)).filter(Boolean).slice(0, maxItems);

// Only known fields, trimmed and limited. Fields not sent are left alone.
function brandFields(b: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => b[k] !== undefined;
  if (has('name')) { out.name = text(b.name, 80); if (!out.name) throw new HttpError(400, 'A brand needs a name.'); }
  if (has('niche')) out.niche = text(b.niche, 300);
  if (has('description')) out.description = text(b.description, 1000) || null;
  if (has('audience')) out.audience = text(b.audience, 300) || null;
  if (has('voice')) out.voice = text(b.voice, 2000) || null;
  if (has('writing_rules')) out.writing_rules = text(b.writing_rules, 2000) || null;
  if (has('languages')) { out.languages = list(b.languages, 10, 30); if (!(out.languages as string[]).length) throw new HttpError(400, 'Pick at least one language.'); }
  if (has('prohibited_terms')) out.prohibited_terms = list(b.prohibited_terms, 50, 60);
  if (has('supported_platforms')) out.supported_platforms = list(b.supported_platforms, 20, 40);
  if (has('logo_url')) out.logo_url = safeUrl(b.logo_url) ?? null;
  return out;
}

export async function brandList(b: any, p: Principal) {
  const me = user(p);
  const orgIds = b.organisationId
    ? [(await authorise(dbStore, p, 'viewer', { organisationId: String(b.organisationId) })).organisationId]
    : (await dbStore.orgsOf(me.id)).map((m) => m.organisationId);
  if (!orgIds.length) return { brands: [] };
  const archived = b.includeArchived ? '' : '&archived_at=is.null';
  return { brands: await rows(`studio_brands?select=*&organisation_id=in.(${orgIds.join(',')})${archived}&order=name`) };
}

export async function brandCreate(b: any, p: Principal) {
  const me = user(p);
  const a = b.organisationId
    ? await authorise(dbStore, p, 'admin', { organisationId: String(b.organisationId) })
    : await organisationFor(dbStore, p, 'admin');
  const f = brandFields({ languages: ['English'], ...b, name: b.name });
  if (!f.name) throw new HttpError(400, 'A brand needs a name.');

  // A double click or a retry must not make two brands.
  const [again] = await rows(`studio_brands?select=*&organisation_id=eq.${a.organisationId}&created_by=eq.${me.id}&name=eq.${encodeURIComponent(String(f.name))}&created_at=gte.${iso(-6e4)}`);
  if (again) return { brand: again };

  const [brand] = await insert('studio_brands', { ...f, organisation_id: a.organisationId, created_by: me.id });
  return { brand };
}

export async function brandUpdate(b: any, p: Principal) {
  const a = await authorise(dbStore, p, 'admin', { brandId: String(b.brandId ?? '') });
  const f = brandFields(b);
  if (!Object.keys(f).length) throw new HttpError(400, 'Nothing to change.');
  await patch(`studio_brands?id=eq.${a.brandId}`, { ...f, updated_at: new Date().toISOString() });
  return { ok: true };
}

export async function brandArchive(b: any, p: Principal) {
  const a = await authorise(dbStore, p, 'admin', { brandId: String(b.brandId ?? '') }, { allowArchived: true });
  await patch(`studio_brands?id=eq.${a.brandId}`, { archived_at: b.archived === false ? null : new Date().toISOString() });
  return { ok: true };
}

// ─── Usage ─────────────────────────────────────────────────────────────
export async function usageGet(b: any, p: Principal) {
  const a = await authorise(dbStore, p, 'admin', { organisationId: String(b.organisationId ?? '') });
  const last24h = await count(`studio_ai_usage?select=id&organisation_id=eq.${a.organisationId}&created_at=gte.${iso(-864e5)}`);
  return { last24h, dailyLimit: Number(process.env.STUDIO_ORG_DAILY_AI_LIMIT) || 300, perUserPerMinute: Number(process.env.STUDIO_USER_MINUTE_AI_LIMIT) || 20 };
}
