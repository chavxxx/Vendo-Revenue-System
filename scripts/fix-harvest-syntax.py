#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "api" / "src" / "server.ts"
s = p.read_text()
broken = '      }, include: { items: { include: { vendo: true, expenses: true, coinCounts: true } }, team: true });'
fixed  = '      }, include: { items: { include: { vendo: true, expenses: true, coinCounts: true } }, team: true } });'

if broken in s:
    p.write_text(s.replace(broken, fixed, 1))
    print("Fixed missing closing brace in harvest.create options.")
elif fixed in s:
    print("Harvest create syntax is already fixed.")
else:
    raise SystemExit("Expected harvest.create line not found; no changes made.")
