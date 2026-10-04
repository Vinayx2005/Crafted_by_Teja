// Author allowlist — kept in sync with the RLS policies in
// migrations/create_content_tables.sql and migrations/blog_agent.sql.
// Plain module (no 'use client') so server routes can import it too.
export const AUTHOR_ALLOWLIST = [
  'vinayteja23@gmail.com',
];
