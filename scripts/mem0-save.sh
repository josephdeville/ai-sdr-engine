#!/usr/bin/env bash
#
# mem0-save — checkpoint build progress to mem0.
#
#   mem0-save "ReachInbox adapter wired + typechecks; campaign ID still needed."
#   echo "longer note from a pipe" | mem0-save
#   mem0-save --list          # show what's already saved
#   mem0-save --infer "..."   # let mem0 extract atomic facts (default: verbatim)
#
# Saves under user_id=user (override with MEM0_USER_ID).
# Reads MEM0_API_KEY from the shell env (exported in your profile).
# Uses curl (macOS system cert store) — avoids the urllib SSL issue.
set -euo pipefail

USER_ID="${MEM0_USER_ID:-user}"
: "${MEM0_API_KEY:?MEM0_API_KEY not set in env}"
API="https://api.mem0.ai"

if [ "${1:-}" = "--list" ]; then
  curl -s -X POST "$API/v2/memories/" \
    -H "Authorization: Token $MEM0_API_KEY" -H "Content-Type: application/json" \
    -d "{\"filters\":{\"user_id\":\"$USER_ID\"}}" \
  | python3 -c 'import sys,json
mems=json.load(sys.stdin)
print(f"{len(mems)} memories under user_id={sys.argv[1]!r}:\n")
for m in mems: print("- "+m["memory"])' "$USER_ID"
  exit 0
fi

INFER=false
if [ "${1:-}" = "--infer" ]; then INFER=true; shift; fi

if [ "$#" -gt 0 ]; then TEXT="$*"; else TEXT="$(cat)"; fi
[ -n "${TEXT// /}" ] || { echo "nothing to save (pass text as args or via stdin)" >&2; exit 1; }

PAYLOAD=$(TEXT="$TEXT" USER_ID="$USER_ID" INFER="$INFER" python3 -c '
import os, json
print(json.dumps({
    "messages": [{"role": "user", "content": os.environ["TEXT"]}],
    "user_id": os.environ["USER_ID"],
    "infer": os.environ["INFER"] == "true",
}))')

curl -s -X POST "$API/v1/memories/" \
  -H "Authorization: Token $MEM0_API_KEY" -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
| python3 -c 'import sys,json
d=json.load(sys.stdin)
r=d.get("results") if isinstance(d,dict) else None
if r:
    for m in r: print("saved: "+m.get("memory",""))
elif r==[]:
    print("no new memory created (mem0 deduped against an existing one)")
else:
    print("response: "+json.dumps(d)[:400])'
