#!/usr/bin/env python3
"""Question bank tooling: validate content, derive everything mechanical.

Adding questions should be a data-only change. Everything that used to be a
hand-maintained bookkeeping step -- per-week `count`, the `nextId` counters,
`bankVersion` in two files, the cache-busting constant in sw.js -- is derived
from the week files by `sync`. Forgetting one of those was the failure mode
where phones keep serving a stale bank from Cache Storage forever.

    python3 tools/bank.py check        validate content, exit 1 on errors
    python3 tools/bank.py next 4       print the next free ids for week 4
    python3 tools/bank.py new 4        scaffold data/week-04.json
    python3 tools/bank.py sync         rewrite all derived fields
    python3 tools/bank.py stats        per-week table
    python3 tools/bank.py release      check + sync + self-test

No dependencies beyond the standard library, matching tools/make-icons.py.
"""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "data" / "index.json"
VERSION_JSON = ROOT / "version.json"
SW = ROOT / "sw.js"
JSC = Path(
    "/System/Library/Frameworks/JavaScriptCore.framework"
    "/Versions/A/Helpers/jsc"
)

ID_RE = re.compile(r"^w(\d{2})-q(\d{3})$")
KINDS = {"concept", "compute"}

# Option rows wrap cleanly, so length is only a problem at the point where one
# option dwarfs the others and stops being scannable with a thumb.
MAX_OPTION_CHARS = 120
MAX_PROMPT_CHARS = 220
MIN_EXPLANATION_CHARS = 60

# There is no LaTeX renderer -- see the Unicode table in AUTHORING.md.
LATEX_RE = re.compile(r"\$|\\[a-zA-Z]{2,}|\\\(|\\\[")

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# ---------------------------------------------------------------- loading


def load_index() -> dict:
    try:
        return json.loads(INDEX.read_text())
    except json.JSONDecodeError as e:
        sys.exit(f"data/index.json is not valid JSON: {e}")


def week_path(week: int) -> Path:
    return ROOT / "data" / f"week-{week:02d}.json"


def load_weeks(index: dict) -> list[dict]:
    """Returns [{entry, path, data, questions}] for every week in the index."""
    out = []
    for entry in index.get("weeks", []):
        n = entry.get("week")
        path = week_path(n) if isinstance(n, int) else None
        data, questions = None, []
        if path and path.exists():
            try:
                data = json.loads(path.read_text())
                questions = data.get("questions") or []
            except json.JSONDecodeError as e:
                err(f"{path.name} is not valid JSON: {e}")
        out.append(
            {"entry": entry, "week": n, "path": path, "data": data,
             "questions": questions}
        )
    return out


# ---------------------------------------------------------------- checking


def check_text(where: str, text: str) -> None:
    if LATEX_RE.search(text):
        err(f"{where}: LaTeX found ({text[:60]!r}) -- use Unicode, "
            f"see AUTHORING.md")
    if text.count("`") % 2:
        err(f"{where}: unbalanced backtick ({text[:60]!r})")


def check_question(q: dict, week: int, seen: dict) -> None:
    qid = q.get("id")
    where = f"{qid or '<no id>'}"

    m = ID_RE.match(qid) if isinstance(qid, str) else None
    if not m:
        err(f"{where}: id must look like w04-q007")
        return
    if int(m.group(1)) != week:
        err(f"{where}: id week prefix does not match week {week}")
    if qid in seen:
        err(f"{where}: duplicate id (also in week {seen[qid]})")
    seen[qid] = week

    if not isinstance(q.get("rev"), int) or q["rev"] < 1:
        err(f"{where}: rev must be an integer >= 1")
    if q.get("kind") not in KINDS:
        err(f"{where}: kind must be 'concept' or 'compute'")
    if not str(q.get("topic") or "").strip():
        err(f"{where}: topic is required")

    prompt = str(q.get("prompt") or "")
    if not prompt.strip():
        err(f"{where}: prompt is required")
    else:
        check_text(f"{where} prompt", prompt)
        if len(prompt) > MAX_PROMPT_CHARS:
            warn(f"{where}: prompt is {len(prompt)} chars -- long for a phone")

    opts = q.get("options")
    if not isinstance(opts, list) or not all(isinstance(o, str) for o in opts):
        err(f"{where}: options must be a list of strings")
        opts = []
    elif opts == ["True", "False"]:
        pass
    elif len(opts) != 4:
        err(f"{where}: needs 4 options, or exactly ['True', 'False'] "
            f"(got {len(opts)})")
    if len(set(opts)) != len(opts):
        err(f"{where}: duplicate options")
    for i, o in enumerate(opts):
        if not o.strip():
            err(f"{where}: option {i} is empty")
        check_text(f"{where} option {i}", o)
        if len(o) > MAX_OPTION_CHARS:
            warn(f"{where}: option {i} is {len(o)} chars -- long enough to "
                 f"dwarf the others; tighten it")

    ans = q.get("answer")
    if not isinstance(ans, int) or isinstance(ans, bool):
        err(f"{where}: answer must be an integer index")
    elif opts and not 0 <= ans < len(opts):
        err(f"{where}: answer {ans} is out of range for {len(opts)} options")

    expl = str(q.get("explanation") or "")
    if not expl.strip():
        err(f"{where}: explanation is required -- it is why the app exists")
    else:
        check_text(f"{where} explanation", expl)
        if len(expl) < MIN_EXPLANATION_CHARS:
            warn(f"{where}: explanation is only {len(expl)} chars -- name the "
                 f"mistake, do not restate the answer")

    if "hint" in q and not isinstance(q["hint"], str):
        err(f"{where}: hint must be a string when present")

    unknown = set(q) - {"id", "rev", "kind", "topic", "prompt", "options",
                        "answer", "explanation", "hint"}
    if unknown:
        warn(f"{where}: unrecognised field(s) {sorted(unknown)} -- the app "
             f"ignores these")


def check_week_mix(week: int, questions: list[dict]) -> None:
    if len(questions) < 6:
        return
    concept = sum(1 for q in questions if q.get("kind") == "concept")
    ratio = concept / len(questions)
    if not 0.5 <= ratio <= 0.72:
        warn(f"week {week}: {round(ratio * 100)}% concept -- target ~60% "
             f"concept / ~40% compute")

    quad = [q for q in questions if len(q.get("options") or []) == 4]
    if len(quad) >= 8:
        counts = [sum(1 for q in quad if q.get("answer") == i) for i in range(4)]
        if max(counts) - min(counts) > 4:
            warn(f"week {week}: answer indices are lopsided ({counts}) -- "
                 f"the answer becomes guessable from position")


def check(index: dict, weeks: list[dict]) -> None:
    nums = [w["week"] for w in weeks]
    if nums != sorted(set(nums)):
        err("index.json weeks must be unique and ascending")

    seen: dict[str, int] = {}
    prompts: dict[str, str] = {}

    for w in weeks:
        entry, n, path = w["entry"], w["week"], w["path"]
        if not str(entry.get("title") or "").strip():
            err(f"week {n}: title is required in index.json")

        # A missing file is only a warning: sync repairs it by setting the week
        # back to "Coming soon", so erroring here would block the one command
        # that fixes it. A file that exists but won't parse is a hard error --
        # already reported by load_weeks -- because sync would silently drop
        # every question in it.
        if entry.get("file") and path is not None and not path.exists():
            warn(f"week {n}: index.json points at {entry['file']}, which does "
                 f"not exist -- sync will set week {n} to 'Coming soon'")
        if w["data"] is not None:
            if w["data"].get("week") != n:
                err(f"{path.name}: 'week' field should be {n}")
            if not w["questions"]:
                warn(f"{path.name}: no questions yet -- sync will keep week {n}"
                     f" as 'Coming soon'")

        for q in w["questions"]:
            check_question(q, n, seen)
            key = re.sub(r"\s+", " ", str(q.get("prompt") or "")).strip().lower()
            if key and key in prompts:
                warn(f"{q.get('id')}: prompt duplicates {prompts[key]}")
            elif key:
                prompts[key] = str(q.get("id"))

        check_week_mix(n, w["questions"])


# ---------------------------------------------------------------- deriving


def content_hash(weeks: list[dict]) -> str:
    """Fingerprint of the questions themselves.

    Deliberately excludes derived bookkeeping so `sync` is idempotent: running
    it twice must not bump bankVersion twice.
    """
    h = hashlib.sha256()
    for w in weeks:
        h.update(f"w{w['week']}:".encode())
        h.update(json.dumps(w["questions"], sort_keys=True,
                            ensure_ascii=False).encode())
    return h.hexdigest()[:16]


def next_ids(week: int, questions: list[dict], count: int = 1) -> list[str]:
    """Ids are append-only: allocate above the high-water mark, never reuse."""
    used = [int(m.group(2)) for q in questions
            if (m := ID_RE.match(str(q.get("id") or "")))]
    start = max(used, default=0) + 1
    return [f"w{week:02d}-q{n:03d}" for n in range(start, start + count)]


def sync(index: dict, weeks: list[dict], quiet: bool = False) -> list[str]:
    """Rewrite every derived field. Returns a list of what changed."""
    changed = []

    for w in weeks:
        entry, n = w["entry"], w["week"]
        authored = bool(w["questions"])
        want_file = f"./data/week-{n:02d}.json" if authored else None
        want_count = len(w["questions"])

        if entry.get("file") != want_file:
            entry["file"] = want_file
            state = "now authored" if authored else "back to Coming soon"
            changed.append(f"week {n}: {state}")
        if entry.get("count") != want_count:
            changed.append(f"week {n}: count {entry.get('count')} -> "
                           f"{want_count}")
            entry["count"] = want_count

        key = f"w{n:02d}"
        want_next = int(next_ids(n, w["questions"])[0].split("q")[1])
        if index.setdefault("nextId", {}).get(key) != want_next:
            changed.append(f"nextId.{key}: {index['nextId'].get(key)} -> "
                           f"{want_next}")
            index["nextId"][key] = want_next

    # bankVersion exists to invalidate caches, so it moves only when the
    # questions actually moved.
    digest = content_hash(weeks)
    if "contentHash" not in index:
        # First run: adopt the current content as-is. The existing bankVersion
        # is what these questions already shipped under.
        index["contentHash"] = digest
        changed.append(f"contentHash recorded ({digest})")
    elif index["contentHash"] != digest:
        index["contentHash"] = digest
        index["bankVersion"] = int(index.get("bankVersion") or 0) + 1
        changed.append(f"bankVersion -> {index['bankVersion']} "
                       f"(content changed)")

    bank_version = int(index["bankVersion"])
    write_json(INDEX, index)

    vj = json.loads(VERSION_JSON.read_text())
    if vj.get("bankVersion") != bank_version:
        vj["bankVersion"] = bank_version
        write_json(VERSION_JSON, vj)
        changed.append(f"version.json bankVersion -> {bank_version}")

    if sync_sw(bank_version):
        changed.append(f"sw.js BANK -> {bank_version} (cache busted)")

    if not quiet:
        if changed:
            print("synced:")
            for c in changed:
                print(f"  {c}")
        else:
            print("synced: already up to date")
    return changed


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def sync_sw(bank_version: int) -> bool:
    """Point sw.js's cache name at the current bank version.

    sw.js is fetched with updateViaCache:'none', so the browser only notices a
    new worker when these bytes change -- which is why the bank version has to
    land inside this file and not only in version.json.
    """
    src = SW.read_text()
    new, n = re.subn(r"^const BANK = \d+;", f"const BANK = {bank_version};",
                     src, count=1, flags=re.M)
    if not n:
        sys.exit("sw.js: expected a line `const BANK = <n>;` -- cannot sync")
    if new == src:
        return False
    SW.write_text(new)
    return True


# ---------------------------------------------------------------- commands


def cmd_check(strict: bool = False) -> int:
    index = load_index()
    weeks = load_weeks(index)
    check(index, weeks)

    for w in warnings:
        print(f"warn  {w}")
    for e in errors:
        print(f"ERROR {e}")

    total = sum(len(w["questions"]) for w in weeks)
    authored = sum(1 for w in weeks if w["questions"])
    print(f"\n{total} questions across {authored} authored week(s); "
          f"{len(errors)} error(s), {len(warnings)} warning(s)")
    if errors:
        return 1
    return 1 if (strict and warnings) else 0


def cmd_next(week: int, n: int) -> int:
    index = load_index()
    weeks = load_weeks(index)
    match = next((w for w in weeks if w["week"] == week), None)
    if match is None:
        sys.exit(f"week {week} is not in index.json")
    for qid in next_ids(week, match["questions"], n):
        print(qid)
    return 0


def cmd_new(week: int) -> int:
    index = load_index()
    path = week_path(week)
    if path.exists():
        sys.exit(f"{path.relative_to(ROOT)} already exists")
    entry = next((e for e in index.get("weeks", []) if e.get("week") == week),
                 None)
    if entry is None:
        sys.exit(f"week {week} is not in index.json -- add it there first")

    write_json(path, {
        "week": week,
        "title": entry.get("title", f"Week {week}"),
        "topics": [],
        "questions": [],
    })
    print(f"created {path.relative_to(ROOT)}  ({entry.get('title')})")
    print(f"first id: {next_ids(week, [], 1)[0]}")
    print("\nAdd questions, then: python3 tools/bank.py release")
    return 0


def cmd_stats() -> int:
    index = load_index()
    weeks = load_weeks(index)
    print(f"bankVersion {index.get('bankVersion')}   "
          f"contentHash {index.get('contentHash', '-')}\n")
    print(f"{'wk':>3}  {'n':>3}  {'concept':>7}  {'answers':>11}  title")
    for w in weeks:
        qs = w["questions"]
        n = w["week"]
        if not qs:
            print(f"{n:>3}  {'-':>3}  {'-':>7}  {'-':>11}  "
                  f"{w['entry'].get('title')}  (coming soon)")
            continue
        concept = sum(1 for q in qs if q.get("kind") == "concept")
        quad = [q for q in qs if len(q.get("options") or []) == 4]
        dist = "/".join(
            str(sum(1 for q in quad if q.get("answer") == i)) for i in range(4))
        print(f"{n:>3}  {len(qs):>3}  {round(concept / len(qs) * 100):>6}%  "
              f"{dist:>11}  {w['entry'].get('title')}")
    total = sum(len(w["questions"]) for w in weeks)
    print(f"\n{total} questions total")
    return 0


def cmd_release() -> int:
    code = cmd_check()
    if code:
        print("\nrefusing to sync while there are errors")
        return code
    print()
    index = load_index()
    sync(index, load_weeks(index))

    if not JSC.exists():
        print("\nskipped self-test: no JavaScriptCore helper on this machine")
        return 0
    print("\nself-test:", flush=True)   # flush: the subprocess shares stdout
    run = subprocess.run([str(JSC), "-m", "tools/selftest.mjs"], cwd=ROOT)
    if run.returncode:
        return run.returncode
    print("\nReady to commit. The installed app will show an update pill.")
    return 0


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "check"
    rest = argv[1:]

    if cmd == "check":
        return cmd_check(strict="--strict" in rest)
    if cmd == "stats":
        return cmd_stats()
    if cmd == "release":
        return cmd_release()
    if cmd == "sync":
        index = load_index()
        weeks = load_weeks(index)
        check(index, weeks)
        if errors:
            for e in errors:
                print(f"ERROR {e}")
            print("\nrefusing to sync while there are errors")
            return 1
        sync(index, weeks)
        return 0
    if cmd == "next":
        if not rest:
            sys.exit("usage: bank.py next <week> [count]")
        return cmd_next(int(rest[0]), int(rest[1]) if len(rest) > 1 else 1)
    if cmd == "new":
        if not rest:
            sys.exit("usage: bank.py new <week>")
        return cmd_new(int(rest[0]))

    print(__doc__)
    return 0 if cmd in ("-h", "--help", "help") else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
