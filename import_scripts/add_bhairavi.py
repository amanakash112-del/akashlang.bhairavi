# -*- coding: utf-8 -*-
"""
Add a `bhairavi` field to the source JSON data files.

Bhairavi is Joylang's own script and is phonemic: the web renderer
(js/bhairavi.js) tokenises a romanised Joylang string straight into glyphs.
So the "Bhairavi equivalent" stored here is the canonical phoneme string —
the exact text fed to `data-joy` on the site — derived from each entry's
`joylang` form (lower-cased, punctuation stripped, word boundaries kept).

Scope (per request):
  words      -> first 1000
  sentences  -> first 1000
  phrases    -> first 100 (all)
  clauses    -> first 100 (all)

Run: python add_bhairavi.py    (then re-run import_firestore.mjs to push)
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.dirname(HERE)  # akashlang.bhairavi/

# digraphs the script treats as one glyph — kept intact by the [a-z ] filter
def to_bhairavi(joylang: str) -> str:
    """Romanised Joylang -> canonical Bhairavi phoneme string (what data-joy renders)."""
    if not joylang:
        return ""
    s = joylang.lower()
    # keep letters and spaces; drop punctuation, digits, hyphens
    words = []
    for w in s.split():
        cleaned = re.sub(r"[^a-z]", "", w)
        if cleaned:
            words.append(cleaned)
    return " ".join(words)


def patch(filename, limit, field="joylang"):
    path = os.path.join(DATA, filename)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    n = min(limit, len(data))
    done = 0
    for rec in data[:n]:
        bz = to_bhairavi(rec.get(field, ""))
        if bz:
            rec["bhairavi"] = bz
            done += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  {filename}: bhairavi added to {done}/{n} records (of {len(data)} total)")


if __name__ == "__main__":
    print("Adding `bhairavi` field to source data...")
    patch("joylang_words.json",     1000)
    patch("joylang_sentences.json", 1000)
    patch("phrases.json",            100)
    patch("clauses.json",            100)
    print("Done. Re-run import_firestore.mjs to push to Firestore.")
