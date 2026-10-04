// Who writes the blog. Edited in the CMS (Author profile), read here by the
// root home page (which is the author profile), the byline on every post,
// and the Person / BlogPosting markup.
// The DEFAULTS below are a fallback only — if the table or row is missing the
// sites still render rather than breaking.
import { supabase } from './supabase';

export interface Author {
  name: string;
  role: string | null;
  bio: string | null;
  image_url: string | null;
  location: string | null;
  email: string | null;
  credentials: string | null;   // what you are — and plainly what you are not
  disclosure: string | null;    // how these posts are written
  links: { label: string; url: string }[];
}

export const AUTHOR_URL = 'https://www.craftedbyteja.com/';

const DEFAULTS: Author = {
  name: 'Teja Surishetti',
  role: 'Entrepreneur, author and builder',
  bio: 'Teja is an entrepreneur and author who has built software products, written books and published 200+ YouTube videos.',
  image_url: 'https://www.craftedbyteja.com/teja.jpg',
  location: null,
  email: null,
  credentials: null,
  disclosure: null,
  links: [],
};

export async function getAuthor(): Promise<Author> {
  const { data } = await supabase.schema('blog').from('author_profile').select('*').eq('id', 1).maybeSingle();
  if (!data) return DEFAULTS;
  return {
    ...DEFAULTS,
    ...(data as Partial<Author>),
    links: Array.isArray((data as any).links) ? (data as any).links.filter((l: any) => l?.url) : [],
  };
}
