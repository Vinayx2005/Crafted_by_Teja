// Roles, shared by the browser and the server. Lowest rank first.
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const ROLES: Role[] = ['viewer', 'editor', 'admin', 'owner'];
