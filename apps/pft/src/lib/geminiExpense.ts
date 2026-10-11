// Turns one spoken/typed expense sentence into structured fields with Gemini.
// Shared by /api/parse-expense (browser Quick Add) and /api/penguin/expense (voice assistant).

// gemini-flash-latest = stable alias to whatever flash model Google is
// currently supporting. See audio route for details + how to override.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are an expense parser for an Indian personal-finance app.
Given a user's spoken or typed message, extract:
  amount:      number in rupees (understand Indian numerics: "sau"=100, "hazaar"=1000, "lakh"=100000, "crore"=10000000; "do hazaar"=2000, "paanch sau"=500; paise as decimals like 99.50)
  description: short natural phrase for what it was
  category:    MUST equal one of the user's provided categories (case-insensitive), OR a reasonable NEW name if none fit
  bank:        MUST equal one of the user's provided banks (case-insensitive contains match), OR null if unclear
  date:        ISO YYYY-MM-DD in the user's local calendar. Understand: today/aaj, yesterday/kal, day before yesterday/parso, "N days ago", "last Monday", "on Saturday", "15 Dec", "15/12/2025"
  missing:     array of field names ("amount", "category", "bank") that you could NOT extract confidently

Return ONLY the JSON object matching the schema. No commentary, no markdown.`;

export interface ParsedExpense {
  amount: number | null;
  description: string;
  category: string | null;
  bank: string | null;
  date: string;
  missing: string[];
}

export class GeminiParseError extends Error {
  constructor(message: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Throws GeminiParseError (501 = no key, 502 = Gemini failed) so callers can map it to their own response. */
export async function parseExpenseWithGemini(
  transcript: string,
  banks: string[],
  categories: string[],
  offsetMinutes = 330 // IST: right for the vast majority of this app's audience
): Promise<ParsedExpense> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new GeminiParseError('GEMINI_API_KEY not set', 501);

  const localNow = new Date(Date.now() + offsetMinutes * 60_000);
  const todayIso = localNow.toISOString().slice(0, 10);

  const userPrompt = `Today is ${todayIso}.
User's banks: ${banks.length ? banks.join(', ') : '(none set up)'}
User's expense categories: ${categories.length ? categories.join(', ') : '(none yet — you may invent a name)'}

Message: """${transcript}"""`;

  const geminiBody = {
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      // Force structured JSON out — no need to strip markdown fences or hope.
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          amount: { type: 'number' },
          description: { type: 'string' },
          category: { type: 'string', nullable: true },
          bank: { type: 'string', nullable: true },
          date: { type: 'string' },
          missing: { type: 'array', items: { type: 'string' } },
        },
        required: ['amount', 'description', 'date', 'missing'],
      },
      temperature: 0.1,
    },
  };

  let geminiRes: Response;
  try {
    geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
  } catch (err: any) {
    throw new GeminiParseError('Gemini network error', 502, { detail: err?.message });
  }

  if (!geminiRes.ok) {
    const detail = await geminiRes.text().catch(() => '');
    throw new GeminiParseError(`Gemini ${geminiRes.status}`, 502, { detail: detail.slice(0, 500) });
  }

  const data = await geminiRes.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiParseError('Empty Gemini response', 502, { raw: data });

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiParseError('Non-JSON Gemini response', 502, { raw: text.slice(0, 500) });
  }

  // Basic sanity: coerce and clamp fields to the shape the client expects.
  return {
    amount: typeof parsed.amount === 'number' && parsed.amount > 0 ? parsed.amount : null,
    description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
    category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim() : null,
    bank: typeof parsed.bank === 'string' && parsed.bank.trim() ? parsed.bank.trim() : null,
    date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : todayIso,
    missing: Array.isArray(parsed.missing) ? parsed.missing.filter((m: any) => typeof m === 'string') : [],
  };
}
