// Permission and isolation tests for the Content Studio.
// Two organisations, users at every role, an outsider and the daily job.
// No database: the Store is an in-memory fake, so these run in milliseconds.

import { describe, expect, it } from 'vitest';
import { authorise, checkInvite, checkMemberChange, organisationFor, rank, type Principal, type Role, type Store } from '@/lib/studio/access';
import { HttpError } from '@/lib/studio/errors';

// Organisation A has a brand with a competitor and a script, a second brand, and an archived brand.
// Organisation B has its own brand, competitor and script.
const ORG_A = 'org-a', ORG_B = 'org-b';
const members: Record<string, Record<string, Role>> = {
  [ORG_A]: { ownerA: 'owner', adminA: 'admin', editorA: 'editor', viewerA: 'viewer' },
  [ORG_B]: { ownerB: 'owner', both: 'viewer' },
};
members[ORG_A].both = 'editor'; // "both" is a member of A (editor) and B (viewer)

const brands = {
  a1: { id: 'a1', organisationId: ORG_A, archived: false },
  a2: { id: 'a2', organisationId: ORG_A, archived: false },
  aOld: { id: 'aOld', organisationId: ORG_A, archived: true },
  b1: { id: 'b1', organisationId: ORG_B, archived: false },
};
const competitors = { cA1: { id: 'cA1', brandId: 'a1' }, cB1: { id: 'cB1', brandId: 'b1' } };
const scripts = { sA1: { id: 'sA1', brandId: 'a1' }, sB1: { id: 'sB1', brandId: 'b1' } };
const contents = { kA1: { id: 'kA1', brandId: 'a1', organisationId: ORG_A }, kB1: { id: 'kB1', brandId: 'b1', organisationId: ORG_B } };

const store: Store = {
  roleOf: async (u, o) => members[o]?.[u] ?? null,
  orgsOf: async (u) => Object.entries(members).flatMap(([o, m]) => (m[u] ? [{ organisationId: o, role: m[u] }] : [])),
  brand: async (id) => (brands as any)[id] ?? null,
  competitor: async (id) => (competitors as any)[id] ?? null,
  script: async (id) => (scripts as any)[id] ?? null,
  content: async (id) => (contents as any)[id] ?? null,
};
const user = (id: string): Principal => ({ kind: 'user', id, email: `${id}@test.local` });
const cron: Principal = { kind: 'cron' };

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpError ? e.status : 500;
  }
};

describe('role matrix on a brand', () => {
  const people = ['viewerA', 'editorA', 'adminA', 'ownerA'] as const;
  const needs: Role[] = ['viewer', 'editor', 'admin', 'owner'];
  for (const p of people) {
    for (const need of needs) {
      const allowed = rank(members[ORG_A][p]) >= rank(need);
      it(`${members[ORG_A][p]} ${allowed ? 'can' : 'cannot'} do a "${need}" action`, async () => {
        expect(await status(authorise(store, user(p), need, { brandId: 'a1' }))).toBe(allowed ? 200 : 403);
      });
    }
  }
});

describe('isolation between organisations', () => {
  it('an outsider is told "not found" for a brand, competitor, script and content of another organisation', async () => {
    for (const ref of [{ brandId: 'a1' }, { competitorId: 'cA1' }, { scriptId: 'sA1' }, { contentId: 'kA1' }, { organisationId: ORG_A }]) {
      expect(await status(authorise(store, user('ownerB'), 'viewer', ref))).toBe(404);
    }
  });
  it('members of A cannot reach anything in B', async () => {
    for (const p of ['ownerA', 'adminA', 'editorA', 'viewerA']) {
      for (const ref of [{ brandId: 'b1' }, { competitorId: 'cB1' }, { scriptId: 'sB1' }, { contentId: 'kB1' }]) {
        expect(await status(authorise(store, user(p), 'viewer', ref))).toBe(404);
      }
    }
  });
  it('a non-member and a missing id give the SAME answer, so ids cannot be probed', async () => {
    const missing = await authorise(store, user('ownerB'), 'viewer', { brandId: 'does-not-exist' }).catch((e) => e);
    const foreign = await authorise(store, user('ownerB'), 'viewer', { brandId: 'a1' }).catch((e) => e);
    expect([missing.status, missing.message]).toEqual([foreign.status, foreign.message]);
  });
  it('someone in both organisations gets the role of the organisation the resource lives in', async () => {
    expect((await authorise(store, user('both'), 'editor', { brandId: 'a1' })).role).toBe('editor');
    expect(await status(authorise(store, user('both'), 'editor', { brandId: 'b1' }))).toBe(403); // only a viewer in B
    expect((await authorise(store, user('both'), 'viewer', { brandId: 'b1' })).role).toBe('viewer');
  });
});

describe('everything a request names must belong together', () => {
  it('a script of the right brand is accepted', async () => {
    expect((await authorise(store, user('editorA'), 'editor', { brandId: 'a1', scriptId: 'sA1' })).brandId).toBe('a1');
  });
  it('a script from ANOTHER BRAND in the same organisation is refused (the "revise someone else\'s script" attack)', async () => {
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'a2', scriptId: 'sA1' }))).toBe(404);
  });
  it('a script from ANOTHER ORGANISATION is refused even if the brand is yours', async () => {
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'a1', scriptId: 'sB1' }))).toBe(404);
    expect(await status(authorise(store, user('ownerB'), 'editor', { brandId: 'b1', scriptId: 'sA1' }))).toBe(404);
  });
  it('a competitor from another brand or organisation is refused', async () => {
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'a1', competitorId: 'cB1' }))).toBe(404);
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'a2', competitorId: 'cA1' }))).toBe(404);
  });
  it('content must match both its brand and its organisation', async () => {
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'a1', contentId: 'kA1' }))).toBe(200);
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'a2', contentId: 'kA1' }))).toBe(404);
    expect(await status(authorise(store, user('editorA'), 'editor', { organisationId: ORG_B, contentId: 'kA1' }))).toBe(404);
  });
  it('a stated organisation that disagrees with the brand is refused', async () => {
    expect(await status(authorise(store, user('ownerA'), 'viewer', { organisationId: ORG_B, brandId: 'a1' }))).toBe(404);
  });
  it('a request that names nothing is rejected, not guessed', async () => {
    expect(await status(authorise(store, user('ownerA'), 'viewer', {}))).toBe(400);
  });
});

describe('archived brands', () => {
  it('can still be read', async () => {
    expect(await status(authorise(store, user('viewerA'), 'viewer', { brandId: 'aOld' }))).toBe(200);
  });
  it('cannot be written to until restored', async () => {
    expect(await status(authorise(store, user('editorA'), 'editor', { brandId: 'aOld' }))).toBe(409);
  });
  it('can be restored by an admin (and only an admin)', async () => {
    expect(await status(authorise(store, user('adminA'), 'admin', { brandId: 'aOld' }, { allowArchived: true }))).toBe(200);
    expect(await status(authorise(store, user('editorA'), 'admin', { brandId: 'aOld' }, { allowArchived: true }))).toBe(403);
  });
});

describe('the daily job', () => {
  it('is allowed only on actions that say so', async () => {
    expect(await status(authorise(store, cron, 'editor', { competitorId: 'cA1' }, { cronAllowed: true }))).toBe(200);
    expect(await status(authorise(store, cron, 'editor', { competitorId: 'cA1' }))).toBe(403);
    expect(await status(authorise(store, cron, 'admin', { brandId: 'a1' }))).toBe(403);
  });
  it('still gets the right organisation for the usage counter', async () => {
    expect(await authorise(store, cron, 'editor', { competitorId: 'cB1' }, { cronAllowed: true })).toMatchObject({ organisationId: ORG_B, brandId: 'b1', role: 'cron' });
  });
  it('cannot fall back to "my organisation"', async () => {
    expect(await status(organisationFor(store, cron, 'editor'))).toBe(403);
  });
});

describe('actions that do not name a brand yet (search, sources)', () => {
  it('use the single organisation the person can write in', async () => {
    expect((await organisationFor(store, user('editorA'), 'editor')).organisationId).toBe(ORG_A);
  });
  it('ask which brand when the person works in several organisations', async () => {
    members[ORG_B].both = 'editor';
    expect(await status(organisationFor(store, user('both'), 'editor'))).toBe(400);
    members[ORG_B].both = 'viewer';
  });
  it('refuse a viewer, and tell a stranger nothing', async () => {
    expect(await status(organisationFor(store, user('viewerA'), 'editor'))).toBe(403);
    expect(await status(organisationFor(store, user('nobody'), 'editor'))).toBe(404);
  });
});

describe('team rules', () => {
  const change = (actor: Role, target: Role, next: Role | null, ownerCount = 2, self = false) =>
    status(Promise.resolve().then(() => checkMemberChange({ actor, target, next, ownerCount, self })));

  it('editors and viewers cannot manage the team', async () => {
    expect(await change('editor', 'viewer', 'admin')).toBe(403);
    expect(await change('viewer', 'editor', null)).toBe(403);
  });
  it('admins manage editors and viewers', async () => {
    expect(await change('admin', 'editor', 'viewer')).toBe(200);
    expect(await change('admin', 'viewer', null)).toBe(200);
    expect(await change('admin', 'editor', 'admin')).toBe(200);
  });
  it('admins cannot touch Owners or make anyone an Owner', async () => {
    expect(await change('admin', 'owner', 'admin')).toBe(403);
    expect(await change('admin', 'owner', null)).toBe(403);
    expect(await change('admin', 'editor', 'owner')).toBe(403);
  });
  it('an Owner can hand ownership over and demote another Owner', async () => {
    expect(await change('owner', 'admin', 'owner')).toBe(200);
    expect(await change('owner', 'owner', 'admin', 2)).toBe(200);
  });
  it('the last Owner can never be removed or demoted, by anyone', async () => {
    expect(await change('owner', 'owner', null, 1)).toBe(409);
    expect(await change('owner', 'owner', 'admin', 1, true)).toBe(409);
    expect(await change('owner', 'owner', null, 1, true)).toBe(409);
  });
  it('nobody promotes themselves', async () => {
    expect(await change('admin', 'admin', 'owner', 2, true)).toBe(403);
    expect(await change('editor', 'editor', 'admin', 2, true)).toBe(403);
  });
  it('anyone may leave an organisation they are not the last Owner of', async () => {
    expect(await change('viewer', 'viewer', null, 2, true)).toBe(200);
    expect(await change('owner', 'owner', null, 2, true)).toBe(200);
  });
  it('invitations never create Owners and need an Admin', () => {
    expect(() => checkInvite('admin', 'editor')).not.toThrow();
    expect(() => checkInvite('admin', 'owner')).toThrow();
    expect(() => checkInvite('owner', 'owner')).toThrow();
    expect(() => checkInvite('editor', 'viewer')).toThrow();
  });
});
