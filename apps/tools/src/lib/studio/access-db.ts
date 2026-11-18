// Content Studio: the real data behind access.ts. Reads memberships and
// ownership from the database with the server's own key.

import type { Role, Store } from './access';
import { rows } from './server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id is simply "not found", never put into a query.
const one = async <T>(table: string, select: string, id: string): Promise<T | null> =>
  UUID.test(id) ? ((await rows<T>(`${table}?select=${select}&id=eq.${id}`))[0] ?? null) : null;

export const dbStore: Store = {
  async roleOf(userId, organisationId) {
    if (!UUID.test(userId) || !UUID.test(organisationId)) return null;
    const [m] = await rows<{ role: Role }>(`studio_org_members?select=role&organisation_id=eq.${organisationId}&user_id=eq.${userId}`);
    return m?.role ?? null;
  },
  async orgsOf(userId) {
    if (!UUID.test(userId)) return [];
    const list = await rows<{ organisation_id: string; role: Role }>(`studio_org_members?select=organisation_id,role&user_id=eq.${userId}`);
    return list.map((m) => ({ organisationId: m.organisation_id, role: m.role }));
  },
  async brand(id) {
    const b = await one<{ id: string; organisation_id: string; archived_at: string | null }>('studio_brands', 'id,organisation_id,archived_at', id);
    return b ? { id: b.id, organisationId: b.organisation_id, archived: !!b.archived_at } : null;
  },
  async competitor(id) {
    const c = await one<{ id: string; page_id: string }>('studio_competitors', 'id,page_id', id);
    return c ? { id: c.id, brandId: c.page_id } : null;
  },
  async script(id) {
    const s = await one<{ id: string; page_id: string }>('studio_scripts', 'id,page_id', id);
    return s ? { id: s.id, brandId: s.page_id } : null;
  },
  async content(id) {
    const c = await one<{ id: string; brand_id: string; organisation_id: string }>('studio_content', 'id,brand_id,organisation_id', id);
    return c ? { id: c.id, brandId: c.brand_id, organisationId: c.organisation_id } : null;
  },
};
