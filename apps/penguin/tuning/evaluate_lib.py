import re
from num2words import num2words

def norm(t):
    t = t.lower().replace(":", " ").replace("-", " ")
    t = re.sub(r"(?<=\d),(?=\d)", "", t)
    t = re.sub(r"\d+", lambda m: " " + num2words(int(m[0])).replace("-", " ").replace(" and ", " ") + " ", t)
    return re.sub(r"[^a-z ]", "", t).split()

def wer(ref, hyp):
    r, h = norm(ref), norm(hyp)
    d = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        prev, d[0] = d[0], i
        for j, hw in enumerate(h, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (rw != hw))
    return d[-1], len(r)

