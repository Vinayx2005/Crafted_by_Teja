"""Maths for Penguin, handed to Gemini as tools (language models get arithmetic wrong, so every sum goes through here).
calculate: BODMAS expressions. funding_round / cap_table_after_round: startup valuation, dilution and holding pattern.
Amounts are plain numbers in any one currency (say rupees); results use lakh/crore wording when large. Run `python maths.py` to self-check."""
import ast, math, operator as op

_BIN = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv, ast.FloorDiv: op.floordiv, ast.Mod: op.mod, ast.Pow: op.pow}
_FUN = {"sqrt": math.sqrt, "abs": abs, "round": round, "min": min, "max": max, "log": math.log, "log10": math.log10, "ceil": math.ceil, "floor": math.floor}
_CONST = {"pi": math.pi, "e": math.e}

def _ev(n):
    if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool): return n.value
    if isinstance(n, ast.BinOp) and type(n.op) in _BIN:
        a, b = _ev(n.left), _ev(n.right)
        if isinstance(n.op, ast.Pow) and abs(b) > 100: raise ValueError("exponent too large")
        return _BIN[type(n.op)](a, b)
    if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)): return _ev(n.operand) * (-1 if isinstance(n.op, ast.USub) else 1)
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FUN and not n.keywords: return _FUN[n.func.id](*map(_ev, n.args))
    if isinstance(n, ast.Name) and n.id in _CONST: return _CONST[n.id]
    raise ValueError("unsupported expression")

def _num(x):
    x = round(x, 6)
    return str(int(x)) if x == int(x) and abs(x) < 1e15 else f"{x:,.6g}" if abs(x) < 1e6 else str(x)

def money(x):
    """12500000 -> '1.25 crore' (Indian wording from 1 lakh up)."""
    a = abs(x); s = "-" if x < 0 else ""
    if a >= 1e7: return f"{s}{a / 1e7:,.2f} crore"
    if a >= 1e5: return f"{s}{a / 1e5:,.2f} lakh"
    return f"{s}{a:,.2f}"

def calculate(expression: str) -> str:
    """Evaluate a maths expression with correct BODMAS/PEMDAS order, e.g. '(12 + 8) * 3 / 4 - 2 ** 3'. Supports + - * / // % **, brackets,
    sqrt, abs, round, min, max, log, log10, ceil, floor, pi. Write percentages as numbers: '20% of 5000' -> '0.20 * 5000'. Convert spoken
    'lakh' (100000) and 'crore' (10000000) to digits yourself."""
    try: return _num(_ev(ast.parse(expression.strip().replace("^", "**").replace("×", "*").replace("÷", "/"), mode="eval").body))
    except ZeroDivisionError: return "cannot divide by zero"
    except Exception as e: return f"could not calculate {expression!r}: {e}"

def funding_round(pre_money: float, investment: float, existing_shares: float = 0) -> str:
    """Startup funding-round maths. pre_money: valuation before the round. investment: money raised. existing_shares: optional current total shares
    (adds new shares to issue and price per share). Returns post-money valuation, investor stake and how much existing holders are diluted."""
    if pre_money <= 0 or investment <= 0: return "pre_money and investment must be positive"
    post = pre_money + investment; stake = investment / post
    out = (f"post-money {money(post)}; investor gets {stake:.2%}; existing holders keep {1 - stake:.2%} of what they had "
           f"(diluted by {stake:.2%}), e.g. a 40% holder falls to {0.40 * (1 - stake):.2%}")
    if existing_shares > 0:
        price = pre_money / existing_shares; new = investment / price
        out += f"; price per share {money(price)}; issue {new:,.0f} new shares (total {existing_shares + new:,.0f})"
    return out

def cap_table_after_round(holdings: str, pre_money: float, investment: float, esop_top_up_percent: float = 0) -> str:
    """Holding pattern (cap table) after a funding round. holdings: 'name:value' pairs separated by commas, values are % or share counts,
    e.g. 'Founder A:50, Founder B:30, ESOP:10, Angel:10'. Adds the new investor and optionally tops up the ESOP pool to esop_top_up_percent of the
    POST-round company (carved out of the pre-money, so only existing holders are diluted). Returns each holder's % before/after and the value of their stake."""
    try:
        rows = [(n.strip(), float(v)) for n, v in (p.rsplit(":", 1) for p in holdings.split(",") if p.strip())]
    except ValueError: return "holdings must look like 'Founder A:50, Founder B:30, ESOP:10'"
    total = sum(v for _, v in rows)
    if not rows or total <= 0 or pre_money <= 0 or investment <= 0: return "need holdings, a positive pre_money and a positive investment"
    inv = investment / (pre_money + investment); pool = esop_top_up_percent / 100
    if inv + pool >= 1: return "investor stake plus ESOP top-up would be 100% or more"
    keep = 1 - inv - pool; post = pre_money + investment
    lines = [f"{n}: {v / total:.2%} -> {v / total * keep:.2%} (worth {money(v / total * keep * post)})" for n, v in rows]
    lines.append(f"New investor: {inv:.2%} (worth {money(investment)})")
    if pool: lines.append(f"New ESOP pool top-up: {pool:.2%}")
    return f"post-money {money(post)}; " + "; ".join(lines)

TOOLS = [calculate, funding_round, cap_table_after_round]

if __name__ == "__main__":
    assert calculate("2 + 3 * 4") == "14" and calculate("(2 + 3) * 4") == "20" and calculate("2 ** 3 ** 2") == "512"
    assert calculate("100 / 8 - 2 ^ 3") == "4.5" and calculate("-3 ** 2") == "-9" and calculate("sqrt(144) + 10 % 4") == "14"
    assert calculate("1/0") == "cannot divide by zero" and calculate("__import__('os')").startswith("could not")
    assert calculate("9 ** 9 ** 9").startswith("could not")
    assert money(12_500_000) == "1.25 crore" and money(450_000) == "4.50 lakh" and money(5_000) == "5,000.00"
    r = funding_round(40_000_000, 10_000_000, 1_000_000)
    assert "post-money 5.00 crore" in r and "investor gets 20.00%" in r and "price per share 40.00" in r and "250,000 new shares" in r, r
    t = cap_table_after_round("Founder A:50, Founder B:30, ESOP:10, Angel:10", 40_000_000, 10_000_000, 5)
    assert "Founder A: 50.00% -> 37.50%" in t and "New investor: 20.00%" in t and "ESOP pool top-up: 5.00%" in t, t
    assert cap_table_after_round("x", 1, 1).startswith("holdings must")
    print("maths OK;", funding_round(40_000_000, 10_000_000), "|", t)
