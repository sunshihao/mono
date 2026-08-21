#!/usr/bin/env python3
"""Read-only doctor scan: aggregates tool use, denials, hooks, skills from transcripts.
Only counts and identifiers are printed. No transcript string is executed."""
import json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.expanduser("~/claude-model/.claude-doubao/projects")
N = 50

files = []
for dirpath, _, names in os.walk(ROOT):
    for n in names:
        if n.endswith(".jsonl"):
            p = os.path.join(dirpath, n)
            try:
                files.append((os.path.getmtime(p), p))
            except OSError:
                pass
files.sort(reverse=True)
top = [p for _, p in files[:N]]
print(f"scan: {len(top)} most recent of {len(files)} transcript files")

tool_counter = Counter()          # tool name -> count
skill_counter = Counter()         # skill name -> count
bash_counter = Counter()          # "cmd sub" -> count
mcp_counter = Counter()           # mcp server -> count
denial_kinds = Counter()          # kind -> count
denied = []                       # (kind, tool_use_id)
tooluse_map = {}                  # tool_use_id -> {"name":..., "input":...}
hook_stats = defaultdict(lambda: {"n": 0, "ms": [], "timeouts": 0})
slash_counter = Counter()
assistant_files = Counter()       # file -> count of tool_use lines (window breadth)

S = re.compile(r"<command-name>([^<]*)</command-name>")

for path in top:
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                t = d.get("type")
                if t == "assistant":
                    msg = d.get("message") or {}
                    content = msg.get("content") if isinstance(msg, dict) else None
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") == "tool_use":
                                name = c.get("name", "?")
                                tool_counter[name] += 1
                                assistant_files[path] += 1
                                tid = c.get("id")
                                tooluse_map[tid] = {"name": name, "input": c.get("input", {})}
                                if name == "Skill":
                                    skill_counter[c.get("input", {}).get("skill", "?")] += 1
                                elif name == "Bash":
                                    cmd = c.get("input", {}).get("command", "")
                                    first = " ".join(cmd.split()[:2]) if cmd else "?"
                                    bash_counter[first] += 1
                                elif name.startswith("mcp__"):
                                    parts = name.split("__")
                                    mcp_counter[parts[1] if len(parts) > 1 else name] += 1
                elif t == "user":
                    kind = d.get("toolDenialKind")
                    if kind:
                        denial_kinds[kind] += 1
                        s = json.dumps(d)
                        ids = re.findall(r'"tool_use_id"\s*:\s*"([^"]+)"', s)
                        denied.append((kind, ids[0] if ids else None))
                    m = d.get("message") or {}
                    if isinstance(m, dict):
                        for part in m.get("content", []) or []:
                            if isinstance(part, dict):
                                text = part.get("text") or ""
                                for mm in S.findall(text):
                                    slash_counter[mm] += 1
                    elif isinstance(m, str):
                        for mm in S.findall(m):
                            slash_counter[mm] += 1
                elif t == "attachment":
                    a = d.get("attachment") or {}
                    if a.get("type", "").startswith("hook"):
                        key = (a.get("hookName", "?"), a.get("hookEvent", "?"))
                        st = hook_stats[key]
                        st["n"] += 1
                        ms = a.get("durationMs")
                        if isinstance(ms, (int, float)):
                            st["ms"].append(ms)
                        if a.get("timedOut"):
                            st["timeouts"] += 1
    except Exception:
        pass

print("\n== tool use (top 20) ==")
for name, n in tool_counter.most_common(20):
    print(f"{n:6d}  {name}")

print("\n== skills invoked ==")
for name, n in skill_counter.most_common():
    print(f"{n:6d}  {name}")

print("\n== bash first-words (top 15) ==")
for name, n in bash_counter.most_common(15):
    print(f"{n:6d}  {name}")

print("\n== mcp servers called ==")
for name, n in mcp_counter.most_common():
    print(f"{n:6d}  {name}")

print("\n== denial kinds ==")
for k, n in denial_kinds.most_common():
    print(f"{n:6d}  {k}")

print("\n== denied calls (recovered) ==")
for kind, tid in denied:
    info = tooluse_map.get(tid, {})
    name = info.get("name", "?")
    inp = info.get("input", {})
    detail = ""
    if name == "Bash":
        detail = repr(inp.get("command", "")[:120])
    elif name and name.startswith("mcp__"):
        detail = "mcp tool"
    elif name == "Skill":
        detail = repr(inp.get("skill", "?"))
    print(f"{kind:18s} id={tid} name={name} {detail}")

print("\n== hook stats ==")
for (hn, he), st in sorted(hook_stats.items()):
    ms = st["ms"]
    avg = sum(ms) / len(ms) if ms else 0
    mx = max(ms) if ms else 0
    print(f"{hn} / {he}: n={st['n']} avg={avg:.0f}ms max={mx}ms timeouts={st['timeouts']}")

print("\n== slash commands (top 15) ==")
for name, n in slash_counter.most_common(15):
    print(f"{n:6d}  {name}")

print("\n== window ==")
print(f"files with tool_use: {len(assistant_files)}; total tool_use lines: {sum(assistant_files.values())}")
