'use client';

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client-side Supabase — CMS is a pure browser SPA that authenticates via
// Supabase auth and reads/writes via anon-key + RLS. Server-side rendering
// is minimal (just the shell); everything meaningful is client-fetched
// after the session is verified.
export const supabase = createClient(url, key);

// UI gate: hides CMS if the signed-in email isn't listed. RLS is the real
// security gate; this just prevents showing an empty CMS shell to strangers
// who somehow land on the URL.
export { AUTHOR_ALLOWLIST } from './allowlist';

export interface BlogPost {
  id: number;
  site: 'root' | 'pft';
  category: 'release' | 'tip' | 'insight' | null;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  cover_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  published_at: string | null;
  author_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Story {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  cover_url: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  published_at: string | null;
  author_email: string | null;
  // Dilse-specific fields
  read_time: string | null;
  genre: string | null;
  date_display: string | null;
  created_at: string;
  updated_at: string;
}

// Returned by the public.cms_users_overview() RPC — see
// migrations/cms_users_overview.sql for how `apps` is derived.
export interface CmsUser {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  apps: string[];
}
