# Penguin English Teacher: how it communicates, trains and teaches

Penguin's English teacher mode turns Penguin into a **strict, professional spoken-English coach**. Everything is conversation: you speak (or type), Penguin marks every mistake, shows the corrected and the natural version, scores you, and then gives you a new impromptu task. Code: `english.py` (the lesson logic) and `penguin.py` (voice and window wiring).

## 1. Switching it on and off

| You do | What happens |
|---|---|
| Say **"Penguin, turn on English teaching mode"** (also "start English teacher mode", "teach me English", "English mode on") | The teacher greets you, says it will correct every mistake, and gives the first task: introduce yourself. |
| Click **English** in the window header | Same as above. The button turns purple ("🎓 English: on"). |
| Say **"stop English mode"** (also "exit English lesson", "that's enough") or click the button again | The lesson ends with a short summary: number of answers, average score, mistakes to work on. |

While the mode is on, **everything you say or type is treated as a practice answer**, with no need to say "Penguin". Other commands (music, notes, mail) pause until you leave the mode. Listening still follows the circle: click it on to speak, click it off to stop.

## 2. How Penguin communicates

**On screen (the full feedback card):**

```
🎓 Score 5/10 · level B1
✅ Good: <one or two things that were truly good, or nothing>
❌ Mistakes:
  1. “did payment” → “made a payment”  (collocation: we make a payment, not do one)
✔ Correct: I made a payment to my friend yesterday.
💬 Natural: I paid my friend yesterday.
📝 <the next task>
```

**Aloud (short, at most about 70 words):** the corrected sentence, the one or two most important mistakes with the rule, then the next task. The detail stays on screen so you can re-read it.

**Tone:** a demanding but fair teacher. No flattery. Praise is specific and rare. No rudeness. If you greet Penguin ("hi how are you") it greets you back in one line, then still marks your sentence. If your sentence is correct, it says so plainly and pushes you to something richer ("Hi, how are you doing?") instead of inventing faults.

## 3. How it corrects (the strict part)

Every answer is checked for: **tense, subject-verb agreement, articles (a/an/the), prepositions, word choice, collocations, word order, plurals, pronouns, missing words and unnatural phrasing**. Weak or very basic vocabulary and filler words are also pointed out when they hurt the sentence.

For each mistake you get the **exact wrong words**, the **corrected words**, **one short rule**, and a category (used for your progress report). Then the whole corrected sentence, and a "natural" version as a fluent speaker would say it.

**What it will not mark:** punctuation, capital letters and spelling (speech recognition adds those, so they say nothing about you), and choices between two acceptable options (for example "yesterday" at the start or the end of a sentence). A change that alters nothing is dropped before you see it.

**Correctness safeguard.** A strict teacher must teach true grammar. One rule is built in on purpose: the present perfect ("have done") **cannot** be used with a finished time such as *yesterday, last week, in 2019, ago*. So for "I did payment yesterday to my friend" the lesson is **not** "use *have done*". It is: *did payment* is the wrong collocation, and the correct sentence is **"I made a payment to my friend yesterday"** or "I paid my friend yesterday". "I have made the payment to my friend" is correct only when you give no finished time. If you ever see Penguin teach something you doubt, say "explain more" and check it against a grammar reference: it is a language model and can be wrong.

## 4. How it teaches (the lesson loop)

1. You give an answer (speak or type).
2. Penguin corrects it, scores it 0-10 and estimates your level (A2, B1, B2, C1).
3. If your answer was very short (under about three sentences), it asks you to **expand it** instead of moving on.
4. Otherwise it gives a **new impromptu task**. The task is picked **at random by the program** (not by the AI, which is bad at randomness), skipping the last eight tasks, then phrased naturally by the teacher and aimed at your recurring weak points when it fits.

**The task pool** (about 30, editable in `english.py`, `POOL`): introduce yourself; describe yesterday (past tenses); plans for next month (future); a one-minute talk on a topic (remote work, technology and learning, a mistake you learned from); describe a place; role-plays (a bank officer calling about a failed payment, an investor pitch, a job interview, returning a faulty product, negotiating a price); explain a process step by step; compare two things; give advice (should / could / had better); persuade the teacher; retell a film or video; **"what did you learn so far?"**; use three words in sentences (although, since, unless); correct one of your own recent mistakes; say a Hindi sentence in correct English; describe what you see around you; directions to your home; explain your company to a beginner; a news item with your opinion; ask five different kinds of questions.

You can also interrupt with a request: "explain more", "repeat that", "give me a new assignment", "how am I doing". The teacher answers it without counting it as a mistake and continues.

## 5. Progress and memory

Stored locally in `apps/penguin/english/progress.json` (not committed): lessons taken, answers given, average score, mistake counts per category, your last 40 corrections, and the last 30 tasks. At every turn the teacher is told a summary ("recurring weak areas: tense (12), articles (7); recent corrections: …"), so it keeps pressing on your weak points and its "what did you learn so far?" task is based on real history. At the end of a lesson you hear the summary: answers, average score, three weakest categories. Delete the file to start fresh.

## 6. What it cannot do (be aware)

- **Speech recognition can quietly fix your grammar.** Penguin transcribes your voice with Whisper, which tends to produce clean sentences even when you said something slightly wrong. If a mistake is missing from the feedback, **type the sentence** to be certain: typed answers are marked exactly as written.
- **No pronunciation or accent marking.** It only sees the transcribed words. Pronunciation and stress need a different kind of tool.
- **Each answer takes about 3 to 10 seconds** (one call to Gemini, then the spoken reply). The model is `gemini-3.5-flash`; set `PENGUIN_ENGLISH_MODEL` in `.env.local` to change it. If it fails, Penguin falls back to the faster default model.
- **It needs internet and Gemini quota.** If Gemini is out of quota, the mode cannot start and the window says so.
- **Strictness is an instruction, not a guarantee.** The teacher is told to be exacting, but a language model can occasionally miss or over-flag something.
- While the mode is on, **anything spoken near the microphone is marked as an answer**, so keep the circle off when you are talking to other people.

## 7. A sample lesson

> **You (mode on):** *Penguin, turn on English teaching mode.*
> **Penguin:** *Welcome. I will correct every mistake you make. First task: introduce yourself. Tell me your name, your work, where you live, and what you enjoy.*
>
> **You:** *My name is Teja and I am working in startup since two years. I am living in Hyderabad.*
> **Penguin (card):** Score 6/10, level B1. Mistakes: "in startup" → "at a startup" (preposition and article); "since two years" → "for two years" (*for* with a period, *since* with a starting point); "I am living" → "I live" (simple present for a permanent situation). Correct: *My name is Teja and I have been working at a startup for two years. I live in Hyderabad.* Next task: talk for about a minute on whether remote work is better than office work.
>
> **You:** *stop English mode.*
> **Penguin:** *Lesson over. 2 answers, average score 6.0 out of 10. Mistakes to work on: preposition (2), tense (1).*

## 8. Where to change things

| To change | Edit |
|---|---|
| How strict or how it explains | `SYSTEM` in `english.py` |
| The assignments | `POOL` in `english.py` |
| The AI model | `PENGUIN_ENGLISH_MODEL` in `.env.local` |
| The trigger phrases | the `english` lines in `commands.py` (`parse`) |
