// WhatsApp Group Finder — shared by the /groups page (server only) and the
// daily crawler (scripts/wa-crawl.mjs). Plain JS so Node can run the crawler
// without a build step.

export const TOPICS = [
  { key: 'startups', label: 'Startups & founders', words: ['startup', 'startups', 'founder', 'founders', 'entrepreneur', 'entrepreneurs', 'entrepreneurship', 'saas', 'indie hacker', 'bootstrapp', 'd2c', 'smb', 'small business', 'business owners', 'vc', 'investors', 'angel', 'incubator', 'accelerator', 'side project', 'build in public'] },
  { key: 'tech', label: 'Tech & developers', words: ['developer', 'developers', 'dev', 'devs', 'programming', 'coding', 'coders', 'javascript', 'python', 'react', 'flutter', 'android', 'ios', 'web3', 'blockchain', 'devops', 'cloud', 'open source', 'opensource', 'hackathon', 'gdg', 'linux', 'rust', 'golang', 'java'] },
  { key: 'ai', label: 'AI & data', words: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'genai', 'data science', 'deep learning', 'chatgpt', 'analytics', 'data engineering'] },
  { key: 'design', label: 'Design & product', words: ['design', 'designer', 'designers', 'ui', 'ux', 'figma', 'product manager', 'product management', 'pm'] },
  { key: 'marketing', label: 'Marketing & content', words: ['marketing', 'seo', 'growth', 'content', 'creator', 'creators', 'social media', 'branding', 'copywriting', 'youtube', 'instagram'] },
  { key: 'jobs', label: 'Jobs & careers', words: ['job', 'jobs', 'hiring', 'career', 'careers', 'internship', 'internships', 'referral', 'referrals', 'placement', 'resume', 'interview'] },
  { key: 'freelance', label: 'Freelancing & remote', words: ['freelance', 'freelancer', 'freelancers', 'freelancing', 'remote work', 'gig'] },
  { key: 'students', label: 'Students & exams', words: ['student', 'students', 'college', 'university', 'campus', 'exam', 'exams', 'upsc', 'gate', 'jee', 'neet', 'cat', 'gre', 'study', 'batch', 'alumni'] },
  { key: 'books', label: 'Books & reading', words: ['book', 'books', 'reading', 'readers', 'book club', 'bookclub', 'novel', 'novels', 'literature', 'writers', 'writing', 'poetry', 'authors'] },
  { key: 'finance', label: 'Personal finance', words: ['personal finance', 'investing', 'investment', 'mutual fund', 'mutual funds', 'money', 'fire', 'tax', 'budgeting'] },
  { key: 'health', label: 'Health & fitness', words: ['fitness', 'running', 'runners', 'gym', 'yoga', 'cycling', 'health', 'marathon', 'trek', 'trekking', 'hiking'] },
  { key: 'travel', label: 'Travel', words: ['travel', 'travellers', 'travelers', 'backpacking', 'trip', 'trips', 'nomad', 'nomads'] },
  { key: 'hobbies', label: 'Hobbies & arts', words: ['photography', 'music', 'art', 'artists', 'film', 'movies', 'cooking', 'food', 'gardening', 'chess', 'gaming', 'gamers', 'anime', 'board games', 'dance', 'theatre'] },
  { key: 'sports', label: 'Sports', words: ['cricket', 'football', 'badminton', 'tennis', 'pickleball', 'sports', 'basketball', 'volleyball'] },
  { key: 'parents', label: 'Parents & family', words: ['parents', 'parenting', 'moms', 'mothers', 'dads', 'kids', 'family'] },
  { key: 'volunteer', label: 'Volunteering & causes', words: ['volunteer', 'volunteers', 'volunteering', 'ngo', 'climate', 'sustainability', 'social impact', 'community service'] },
  { key: 'community', label: 'Local & community', words: ['meetup', 'meetups', 'community', 'neighbourhood', 'neighborhood', 'residents', 'society', 'club'] },
];

export const TOPIC_KEYS = TOPICS.map((t) => t.key).concat('other');

export const CITIES = ['Online', 'Bengaluru', 'Mumbai', 'Delhi NCR', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Kochi', 'Chandigarh', 'Indore', 'Lucknow', 'Coimbatore', 'Visakhapatnam', 'Vijayawada', 'Nagpur', 'Bhubaneswar', 'Goa', 'Outside India'];

const CITY_WORDS = {
  Bengaluru: ['bangalore', 'bengaluru', 'blr'],
  Mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane'],
  'Delhi NCR': ['delhi', 'ncr', 'gurgaon', 'gurugram', 'noida'],
  Hyderabad: ['hyderabad', 'hyd', 'secunderabad'],
  Chennai: ['chennai', 'madras'],
  Pune: ['pune'],
  Kolkata: ['kolkata', 'calcutta'],
  Ahmedabad: ['ahmedabad', 'gandhinagar'],
  Jaipur: ['jaipur'],
  Kochi: ['kochi', 'cochin', 'kerala'],
  Chandigarh: ['chandigarh', 'mohali'],
  Indore: ['indore'],
  Lucknow: ['lucknow'],
  Coimbatore: ['coimbatore'],
  Visakhapatnam: ['vizag', 'visakhapatnam'],
  Vijayawada: ['vijayawada'],
  Nagpur: ['nagpur'],
  Bhubaneswar: ['bhubaneswar'],
  Goa: ['goa'],
};

// Anything matching these never gets listed — the usual WhatsApp-link spam.
const BLOCK = ['earn', 'earning', 'income', 'profit', 'sure shot', 'sureshot', 'stock tips', 'intraday', 'nifty', 'banknifty', 'option trading', 'trading', 'trader', 'forex', 'crypto signal', 'signals', 'pump', 'betting', 'bet', 'satta', 'matka', 'casino', 'rummy', 'lottery', 'loan', 'loans', 'mlm', 'network marketing', 'refer and earn', 'giveaway', 'free money', 'adult', '18+', 'sexy', 'hot girls', 'dating', 'escort', 'nude', 'leaked', 'pdf free', 'free pdf', 'hack', 'cracked', 'followers', 'likes', 'part time job', 'work from home job', 'task job', 'investment plan', 'double money', 'bot', 'bots', 'baileys', 'md', 'termux', 'password', 'script', 'scripts', 'apk'];

const has = (text, word) =>
  new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text);

export const isBlocked = (text) => BLOCK.some((w) => has(text.toLowerCase(), w));

// English-only for now: any letter outside plain a–z (accents included), or a
// common word from another Latin-script language, rules it out.
const FOREIGN = ['grupo', 'grupos', 'comunidade', 'comunidad', 'para', 'del', 'los', 'las', 'unete', 'participe', 'gruppo', 'unisciti', 'della', 'und', 'der', 'die', 'das', 'zur', 'von', 'mit', 'het', 'een', 'yang', 'dan', 'untuk', 'gabung', 'kami', 'groupe', 'rejoindre', 'pour', 'avec', 'nao', 'est'];
export const isEnglish = (text) =>
  !/(?![A-Za-z])\p{L}/u.test(text) && !FOREIGN.some((w) => has(text.toLowerCase(), w));

const GENERIC = /\b(join|joining|follow|our|the|my|this|a|an|here|now|link|links|click|official|updates?|whatsapp|group|groups|channel|community|chat|invite|us|on|to|via|please|and|or|for|at|is|setup|guide|contact|support|help)\b/gi;

// Crawled text that isn't a usable group name: code, leftover markup, an image
// caption ("!logo"), a social-links footer, or nothing left once filler words go.
export const badName = (name) =>
  name.length > 100 ||
  /^!|[=;{}$<\\]|\/\/|\b(const|let|var|href|function|github|instagram|linkedin|telegram|discord|twitter|img|logo|badge|png|svg)\b/i.test(name) ||
  name.replace(GENERIC, '').replace(/[^a-z0-9]/gi, '').length < 4;

// Up to 3 matching topics, strongest first; empty when nothing matches.
export function classify(text) {
  const t = text.toLowerCase();
  return TOPICS.map((topic) => [topic.key, topic.words.filter((w) => has(t, w)).length])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key);
}

export function findCities(text) {
  const t = text.toLowerCase();
  return Object.entries(CITY_WORDS).filter(([, words]) => words.some((w) => has(t, w))).map(([city]) => city);
}

// Every invite / channel link pattern people paste, reduced to one canonical URL.
const LINK = /(?:https?:\/\/)?(?:chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{20,24})|(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]{20,30}))/g;

export function findLinks(text) {
  return [...text.matchAll(LINK)].map((m) => ({
    url: m[1] ? `https://chat.whatsapp.com/${m[1]}` : `https://whatsapp.com/channel/${m[2]}`,
    kind: m[1] ? 'group' : 'channel',
    index: m.index,
    raw: m[0],
  }));
}

// Exactly one WhatsApp link in what the visitor pasted, or nothing.
export function canonical(input) {
  const links = findLinks(String(input));
  return links.length === 1 ? links[0] : null;
}

// Minimal PostgREST client — service role, server/crawler only.
export async function db(path, init = {}) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`db ${res.status}: ${await res.text()}`);
  return res;
}
