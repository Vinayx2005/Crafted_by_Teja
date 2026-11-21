"""Penguin's English teacher mode: a strict conversation coach. See ENGLISH_TEACHER.md for the method.
While `active`, everything the user says or types is a practice answer: Gemini marks every mistake, gives the corrected and the natural version, scores the turn,
and sets a random impromptu next task. Progress (recurring mistakes, scores) is kept locally in english/progress.json and shapes later tasks.
Run `python english.py` to self-check the non-model parts."""
import json, os, random, re, threading, time
from datetime import date

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "english")
PROGRESS = os.path.join(DIR, "progress.json")
active = False
_hist = []              # [("user"|"model", text)] the last turns of this lesson, so the teacher knows the current task
_session = {"turns": 0, "scores": [], "cats": {}}
_lock = threading.Lock()

CATS = ["tense", "subject_verb_agreement", "article", "preposition", "word_choice", "collocation", "word_order", "plural_singular", "pronoun",
        "sentence_structure", "missing_word", "unnatural_phrasing", "other"]

# Impromptu tasks. Python (not the model) picks one at random each turn: language models are bad at being random.
POOL = [
    "Introduce yourself: name, work, where you live, what you enjoy.",
    "Describe your day yesterday, from morning to night (tests past tenses).",
    "Tell me your plans for next month (tests future forms).",
    "Talk for about a minute on: is remote work better than office work?",
    "Talk for about a minute on: how has technology changed the way people learn?",
    "Talk about a mistake you made and what you learned from it.",
    "Describe a place you would love to visit and why.",
    "Role-play: I am a bank officer. Call me to ask about a failed payment and explain it politely.",
    "Role-play: I am an investor. Pitch your idea to me in one minute.",
    "Role-play: I am a job interviewer. Tell me about your biggest strength and weakness.",
    "Role-play: you are returning a faulty product to a shop. Complain politely and firmly.",
    "Role-play: negotiate the price of something with me. I am the seller.",
    "Explain a process you know well, step by step (for example: how to make tea, or how to file a tax return).",
    "Compare two things you know well (two cities, two phones, two ways of studying) and say which you prefer.",
    "Give advice to a friend who is always late. Use should, could and had better correctly.",
    "Persuade me to try your favourite food, hobby or app.",
    "Tell me about the best meal you ever had, using past tenses.",
    "Describe your best friend: looks, personality, and how you met.",
    "Retell the last film, series or video you watched, without spoiling the ending.",
    "What did you learn so far in our lessons? Summarise it in your own words.",
    "Use these three words in three different sentences: although, since, unless.",
    "Spot the mistake and correct it, then say the corrected sentence aloud: pick one from your own recent mistakes.",
    "Say this in correct English: a sentence you would normally say in Hindi or your mother tongue about your daily life.",
    "Describe what you see around you right now, in at least five sentences.",
    "Talk about something you want to improve about yourself and how you will do it.",
    "Tell me about a time you were very nervous. What happened?",
    "Give me directions from your home to the nearest market or station.",
    "Explain what your company or work does to someone who knows nothing about it.",
    "Talk about a news item or trend you find interesting and give your opinion.",
    "Ask me five different questions using five different question forms (who, what, why, how, have you ever).",
]

SYSTEM = """You are Penguin, a strict, professional English teacher running a spoken conversation lesson. The student is an adult Indian professional (startup world) who wants fluent, correct, natural English. You are demanding, precise and fair: you never flatter, never let an error pass, and you are never rude.

HOW YOU TEACH
- The student's words come from speech recognition (or typing). Punctuation, capital letters and spelling were added automatically: NEVER mark those. If a word looks like a mishearing rather than a mistake, ask the student to repeat instead of counting it.
- Only list a mistake when your corrected words are genuinely different from what the student said and the original is really wrong. Never list punctuation, capitalisation, or a choice between two acceptable options (for example 'yesterday' at the start or at the end of the sentence, 'quite' versus 'very'). A correct sentence such as 'Hi, how are you?' has NO mistakes: say it is correct, then raise the level (a more natural or richer alternative) and ask for something harder.
- Mark EVERY real error: tense, subject-verb agreement, articles, prepositions, word choice, collocations (e.g. 'did payment' should be 'made a payment'), word order, plurals, pronouns, missing words, unnatural phrasing. Also point out fillers or very basic vocabulary when they hurt the sentence.
- For each mistake give: the exact wrong words, the corrected words, and ONE short rule. Only teach TRUE grammar. Be careful: the present perfect (have done) can NOT be used with a finished time word such as yesterday, last week, in 2019 or ago: 'I did payment yesterday' is wrong because of 'did payment' (say 'I made a payment to my friend yesterday' or 'I paid my friend yesterday'), NOT because 'did' needs to become 'have done'. 'I have made the payment' is right only when no finished time is given.
- Always give the full corrected version of what they said, and (if different) how a fluent native speaker would naturally say it. Corrected sentences must themselves be flawless.
- If they made no real mistakes, say so plainly and push them: ask for a more complex sentence. Praise only what is truly good (specific, one or two points). Score each answer 0-10 for accuracy and naturalness (10 = flawless native-like; 5 = understandable but many errors). Estimate their CEFR level (A2, B1, B2, C1).
- If they greet you or chat ("hi how are you"), reply warmly in one line, then still correct their sentence strictly.
- If they ask for something instead of answering (explain more, repeat, new assignment, how am I doing), do that: leave `mistakes` empty, `score` -1, and answer in `spoken`.
- Then ALWAYS continue the lesson: your `next` field is the next impromptu task. If the answer to the current task was too short (under about 3 sentences), ask them to expand on it instead of moving on. Otherwise give the task suggested under NEXT TASK below, adapted naturally and delivered like a real teacher (a question or a role-play opening). Make assignments feel random and unexpected, and aim them at the student's recurring weak points when it fits.
- `spoken` is read aloud (max 70 words, plain text, no lists): the corrected sentence, the one or two most important mistakes with the rule, then the next task. The full detail goes in the other fields.

STUDENT PROGRESS SO FAR: {progress}
NEXT TASK (use this unless the student must expand their last answer): {task}
Today is {today}."""

SCHEMA = {"type": "object", "properties": {
    "praise": {"type": "string"},
    "mistakes": {"type": "array", "items": {"type": "object", "properties": {
        "wrong": {"type": "string"}, "correct": {"type": "string"}, "rule": {"type": "string"}, "category": {"type": "string", "enum": CATS}},
        "required": ["wrong", "correct", "rule", "category"]}},
    "corrected": {"type": "string"}, "natural": {"type": "string"}, "score": {"type": "integer"}, "level": {"type": "string"},
    "spoken": {"type": "string"}, "next": {"type": "string"}},
    "required": ["praise", "mistakes", "corrected", "natural", "score", "level", "spoken", "next"]}

def _load():
    try: return json.load(open(PROGRESS, encoding="utf-8"))
    except (OSError, ValueError): return {"sessions": 0, "turns": 0, "score_sum": 0, "scored": 0, "cats": {}, "recent": [], "tasks": []}

def _save(p):
    os.makedirs(DIR, exist_ok=True); json.dump(p, open(PROGRESS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)

def progress_text():
    p = _load()
    if not p["turns"]: return "brand new student, no history yet (start gently but strictly; first task is to introduce themselves)."
    top = sorted(p["cats"].items(), key=lambda kv: -kv[1])[:4]
    avg = p["score_sum"] / p["scored"] if p["scored"] else 0
    rec = "; ".join(f"'{m['wrong']}' -> '{m['correct']}'" for m in p["recent"][-5:])
    return (f"{p['sessions']} lessons, {p['turns']} answers, average score {avg:.1f}/10. Recurring weak areas: "
            + (", ".join(f"{c} ({n})" for c, n in top) or "none yet") + f". Recent corrections: {rec or 'none'}.")

def pick_task():
    p = _load(); recent = set(p["tasks"][-8:])
    return random.choice([t for t in POOL if t not in recent] or POOL)

def record(d, task, count=True):
    """Update the saved progress with this turn's mistakes and score."""
    with _lock:
        p = _load()
        if count: p["turns"] += 1; _session["turns"] += 1
        if d.get("score", -1) >= 0: p["score_sum"] += d["score"]; p["scored"] += 1; _session["scores"].append(d["score"])
        for m in d["mistakes"]:
            p["cats"][m["category"]] = p["cats"].get(m["category"], 0) + 1; _session["cats"][m["category"]] = _session["cats"].get(m["category"], 0) + 1
            p["recent"].append({"wrong": m["wrong"], "correct": m["correct"], "date": date.today().isoformat()})
        p["recent"] = p["recent"][-40:]
        if task: p["tasks"] = (p["tasks"] + [task])[-30:]
        _save(p)

def card(d):
    """The full written feedback shown in the chat."""
    out = []
    if d["score"] >= 0: out.append(f"🎓 Score {d['score']}/10 · level {d['level']}")
    if d["praise"].strip(): out.append(f"✅ Good: {d['praise'].strip()}")
    if d["mistakes"]:
        out.append("❌ Mistakes:")
        out += [f"  {i}. “{m['wrong']}” → “{m['correct']}”  ({m['category'].replace('_', ' ')}: {m['rule']})" for i, m in enumerate(d["mistakes"], 1)]
    if d["corrected"].strip() and d["score"] >= 0: out.append(f"✔ Correct: {d['corrected'].strip()}")
    if d["natural"].strip() and d["natural"].strip() != d["corrected"].strip() and d["score"] >= 0: out.append(f"💬 Natural: {d['natural'].strip()}")
    out.append(f"📝 {d['next'].strip()}" if d["next"].strip() else "")
    return "\n".join(x for x in out if x)

_EXIT = re.compile(r"^\W*(?:(?:ok|okay|please|now|penguin)\W+)*(?:stop|exit|quit|end|leave|turn off|switch off|close|finish)\b.*\b(?:english|class|lesson|teaching|teacher|mode|practice|session)\b|^\W*that'?s enough\b|^\W*end (?:the )?(?:lesson|class)\b", re.I)
def is_exit(text): return bool(_EXIT.search(text))

def _generate(text, task, first=False):
    from google.genai import types
    import brain
    contents = [types.Content(role=r, parts=[types.Part(text=t)]) for r, t in _hist[-14:]]
    contents.append(types.Content(role="user", parts=[types.Part(text=text)]))
    cfg = types.GenerateContentConfig(system_instruction=SYSTEM.format(progress=progress_text(), task=task, today=date.today().isoformat()),
                                      response_mime_type="application/json", response_schema=SCHEMA, temperature=0.3)
    last = None
    for model in dict.fromkeys([brain._env("PENGUIN_ENGLISH_MODEL", "gemini-3.5-flash"), brain.MODEL]):       # a stronger model first, the fast one as a fallback
        try: return json.loads(brain.client().models.generate_content(model=model, contents=contents, config=cfg).text)
        except Exception as e: last = e
    raise last

def _reply(user_text, d, task, count=True):
    _hist.append(("user", user_text)); _hist.append(("model", d["spoken"] + " " + d["next"]))
    del _hist[:-20]; record(d, task, count)
    return card(d), d["spoken"].strip() or d["next"]

def start():
    """Switch the mode on. Returns (text for the chat, text to speak): the greeting and the first task."""
    global active
    with _lock: active = True; _hist.clear(); _session.update(turns=0, scores=[], cats={})
    p = _load(); p["sessions"] += 1; _save(p)
    task = "Introduce yourself: name, work, where you live, what you enjoy."
    try:
        d = _generate("[The student just switched on English teaching mode. Greet them in one line, state that you will correct every single mistake strictly, "
                      "and give the first task: ask them to introduce themselves. Leave mistakes empty and score -1.]", task, first=True)
        d["score"], d["mistakes"] = -1, []
        return _reply("[started]", d, task, count=False)          # the greeting is not a student answer
    except Exception as e:
        active = False; raise

def turn(text):
    """One student answer -> (full feedback for the chat, short text to speak)."""
    task = pick_task()
    d = _generate(text, task)
    norm = lambda t: re.sub(r"[^a-z0-9' ]", "", t.lower()).strip()
    d["mistakes"] = [m for m in d["mistakes"] if norm(m["wrong"]) != norm(m["correct"])]        # drop "corrections" that change nothing
    for m in d["mistakes"]: m["category"] = m["category"] if m["category"] in CATS else "other"
    return _reply(text, d, task if d["score"] >= 0 else None)

def stop():
    """Switch the mode off. Returns (text for the chat, text to speak): a short summary of the lesson."""
    global active
    with _lock: active = False
    s = _session; n = s["turns"]
    if not n: return "English teaching mode is off.", "English teaching mode is off."
    avg = sum(s["scores"]) / len(s["scores"]) if s["scores"] else 0
    top = sorted(s["cats"].items(), key=lambda kv: -kv[1])[:3]
    weak = ", ".join(f"{c.replace('_', ' ')} ({k})" for c, k in top) or "nothing major"
    text = f"Lesson over. {n} answers, average score {avg:.1f} out of 10. Mistakes to work on: {weak}."
    return "🎓 " + text, text

if __name__ == "__main__":
    import tempfile
    PROGRESS = os.path.join(tempfile.mkdtemp(prefix="pn_eng_"), "progress.json"); DIR = os.path.dirname(PROGRESS)
    assert "brand new" in progress_text() and pick_task() in POOL
    d = {"praise": "Clear idea.", "score": 5, "level": "B1", "corrected": "I made a payment to my friend yesterday.", "natural": "I paid my friend yesterday.", "spoken": "x", "next": "Introduce yourself.",
         "mistakes": [{"wrong": "did payment", "correct": "made a payment", "rule": "'make' goes with 'payment'", "category": "collocation"}]}
    record(d, POOL[0]); record({**d, "score": 7}, POOL[1])
    t = progress_text(); assert "2 answers" in t and "collocation (2)" in t and "average score 6.0" in t, t
    c = card(d); assert "“did payment” → “made a payment”" in c and "Score 5/10" in c and "💬 Natural" in c, c
    assert pick_task() not in POOL[:2]
    for s in ("stop english mode", "Exit English teaching mode.", "please turn off the english lesson", "that's enough for today"): assert is_exit(s), s
    for s in ("I stopped my english class yesterday", "Today I stopped learning", "stop the music"): assert not is_exit(s), s
    print("english OK;", t)
