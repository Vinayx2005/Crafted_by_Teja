// Content Studio: who may do what. Pure logic, no database and no network.
//
// Every API action asks `authorise()` before it does anything. The browser may
// send any id it likes; this module looks up who OWNS each thing on the server
// and checks the caller's role in that organisation. Data comes from a `Store`,
// so the production database and the test suite can both plug in.

import { HttpError, notFound } from './errors';
import { ROLES, type Role } from './roles';

export { ROLES, type Role };
export const rank = (r: Role | null | undefined): number => (r ? ROLES.indexOf(r) + 1 : 0);

export type Principal = { kind: 'user'; id: string; email: string } | { kind: 'cron' };

export interface Store {
  roleOf(userId: string, organisationId: string): Promise<Role | null>;
  orgsOf(userId: string): Promise<{ organisationId: string; role: Role }[]>;
  brand(id: string): Promise<{ id: string; organisationId: string; archived: boolean } | null>;
  competitor(id: string): Promise<{ id: string; brandId: string } | null>;
  script(id: string): Promise<{ id: string; brandId: string } | null>;
  content(id: string): Promise<{ id: string; brandId: string; organisationId: string } | null>;
}

// What a request names. Several can be named at once; they must all agree.
export type Ref = { organisationId?: string; brandId?: string; competitorId?: string; scriptId?: string; contentId?: string };
export type Access = { organisationId: string; brandId?: string; role: Role | 'cron' };

const forbidden = () => new HttpError(403, 'You do not have permission to do this.');

// Works out which organisation and brand a request is really about, and makes
// sure everything it names belongs together.
async function resolve(store: Store, ref: Ref): Promise<{ organisationId: string; brandId?: string; archived: boolean }> {
  let brandId = ref.brandId;
  let organisationId: string | undefined;

  const agree = (found: string) => {
    if (brandId && brandId !== found) throw notFound(); // two ids from different brands: refuse, say nothing more
    brandId = found;
  };

  if (ref.competitorId) {
    const c = await store.competitor(ref.competitorId);
    if (!c) throw notFound();
    agree(c.brandId);
  }
  if (ref.scriptId) {
    const s = await store.script(ref.scriptId);
    if (!s) throw notFound();
    agree(s.brandId);
  }
  if (ref.contentId) {
    const c = await store.content(ref.contentId);
    if (!c) throw notFound();
    agree(c.brandId);
    organisationId = c.organisationId;
  }

  let archived = false;
  if (brandId) {
    const b = await store.brand(brandId);
    if (!b) throw notFound();
    if (organisationId && organisationId !== b.organisationId) throw notFound();
    organisationId = b.organisationId;
    archived = b.archived;
  }
  if (ref.organisationId) {
    if (organisationId && organisationId !== ref.organisationId) throw notFound();
    organisationId = ref.organisationId;
  }
  if (!organisationId) throw new HttpError(400, 'Say which brand this is for.');
  return { organisationId, brandId, archived };
}

export type Options = {
  /** The daily refresh job may do this (a short, fixed list of actions). */
  cronAllowed?: boolean;
  /** For restoring or archiving a brand, which must work on an archived brand. */
  allowArchived?: boolean;
};

export async function authorise(store: Store, principal: Principal, need: Role, ref: Ref, opts: Options = {}): Promise<Access> {
  const target = await resolve(store, ref);

  if (principal.kind === 'cron') {
    if (!opts.cronAllowed) throw forbidden();
    return { organisationId: target.organisationId, brandId: target.brandId, role: 'cron' };
  }

  const role = await store.roleOf(principal.id, target.organisationId);
  if (!role) throw notFound(); // not a member: the same answer as "does not exist"
  if (rank(role) < rank(need)) throw forbidden();
  if (target.archived && !opts.allowArchived && rank(need) >= rank('editor')) throw new HttpError(409, 'This brand is archived. Restore it first.');
  return { organisationId: target.organisationId, brandId: target.brandId, role };
}

// For actions that do not name a brand yet (searching creators, finding sources):
// use the person's organisation if they belong to exactly one where they are allowed.
export async function organisationFor(store: Store, principal: Principal, need: Role): Promise<Access> {
  if (principal.kind === 'cron') throw forbidden();
  const mine = (await store.orgsOf(principal.id)).filter((m) => rank(m.role) >= rank(need));
  if (mine.length === 1) return { organisationId: mine[0].organisationId, role: mine[0].role };
  if (mine.length > 1) throw new HttpError(400, 'Say which brand this is for.');
  throw (await store.orgsOf(principal.id)).length ? forbidden() : notFound();
}

// ─── Team rules ────────────────────────────────────────────────────────
// `next` is the new role, or null to remove the person. `ownerCount` is how many
// Owners the organisation has right now.
export function checkMemberChange(a: { actor: Role; target: Role; next: Role | null; ownerCount: number; self: boolean }): void {
  const { actor, target, next, ownerCount, self } = a;
  if (rank(actor) < rank('admin') && !(self && next === null)) throw forbidden(); // leaving yourself is always allowed
  if (self && next !== null && rank(next) > rank(actor)) throw forbidden(); // nobody promotes themselves

  // Owner-level changes need an Owner.
  if ((target === 'owner' || next === 'owner') && actor !== 'owner' && !(self && next === null)) throw forbidden();

  // An organisation must always keep at least one Owner.
  if (target === 'owner' && next !== 'owner' && ownerCount <= 1) {
    throw new HttpError(409, 'An organisation needs at least one Owner. Make someone else an Owner first.');
  }
}

// Invitations never create Owners; ownership is handed over with a role change.
export function checkInvite(actor: Role, invited: Role): void {
  if (rank(actor) < rank('admin')) throw forbidden();
  if (invited === 'owner') throw new HttpError(400, 'Owners cannot be invited. Invite them as an Admin, then change their role.');
}
