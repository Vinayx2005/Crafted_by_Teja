"""Instant weather (no Gemini): Open-Meteo forecast + geocoding, your city from your IP address once per run. ~0.8 s, ~0 s when prefetched.
Only a city name (or your IP, to find your city) leaves the laptop. `python weather.py [city]` self-checks."""
import json, re, sys, time, urllib.parse, urllib.request

CODES = {0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
         61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "heavy rain showers", 82: "violent rain showers",
         95: "a thunderstorm", 96: "a thunderstorm with hail", 99: "a thunderstorm with hail"}
ASK = re.compile(r"\b(weather|temperature|forecast)\b", re.I)
_home, _cache = [None], {}                       # your city (lat, lon, name) and {(lat, lon): (time, json)}

def _get(url):
    return json.load(urllib.request.urlopen(url, timeout=5))

def _where(city=None):
    if city:
        r = (_get("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + urllib.parse.quote(city)).get("results") or [None])[0]
        if r: return r["latitude"], r["longitude"], r["name"]
        raise LookupError(f"no place called {city}")
    if not _home[0]:                              # ponytail: IP geolocation is city-level; a laptop on a VPN shows the VPN's city. Add a "home_city" setting if that matters.
        g = _get("http://ip-api.com/json/?fields=status,city,lat,lon")
        if g.get("status") != "success": raise LookupError("could not work out your location")
        _home[0] = (g["lat"], g["lon"], g["city"])
    return _home[0]

def _forecast(lat, lon):
    hit = _cache.get((lat, lon))
    if hit and time.time() - hit[0] < 600: return hit[1]
    w = _get(f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code"
             "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2")
    _cache[(lat, lon)] = (time.time(), w); return w

def prefetch():
    """Warm your city's weather (call when the user starts talking) so the answer is instant."""
    try: lat, lon, _ = _where(); _forecast(lat, lon)
    except Exception: pass

def answer(question):
    """A spoken-style weather sentence for the question ('weather in Mumbai', 'will it rain tomorrow'), or None if it can't tell (Gemini then handles it)."""
    try:
        m = re.search(r"\b(?:in|at|for)\s+([A-Za-z][A-Za-z .'-]{1,30}?)(?:\s+(?:today|tomorrow|now|right now|tonight)|[?.!]*$)", question.strip())
        city = m.group(1) if m and m.group(1).lower() not in ("the", "my", "this", "here", "today", "tomorrow") else None
        lat, lon, name = _where(city); w = _forecast(lat, lon); d, c = w["daily"], w["current"]
        tomorrow = bool(re.search(r"\btomorrow\b", question, re.I)); i = 1 if tomorrow else 0
        sky, rain = CODES.get(d["weather_code"][i], "mixed weather"), d["precipitation_probability_max"][i]
        head = (f"Tomorrow in {name}: {sky}" if tomorrow else
                f"It is {round(c['temperature_2m'])} degrees in {name}, feels like {round(c['apparent_temperature'])}, {CODES.get(c['weather_code'], 'mixed weather')}, humidity {c['relative_humidity_2m']} percent")
        return f"{head}. High {round(d['temperature_2m_max'][i])}, low {round(d['temperature_2m_min'][i])}, {rain} percent chance of rain."
    except Exception: return None

if __name__ == "__main__":
    t = time.time(); print(answer(" ".join(sys.argv[1:]) or "what is the weather today")); print(f"{time.time() - t:.2f}s")
    t = time.time(); print(answer("will it rain tomorrow in Mumbai?")); print(f"{time.time() - t:.2f}s")
    assert ASK.search("what's the weather like") and not ASK.search("open chrome")
