#!/usr/bin/env bash
# Runs every check on a clean copy of the committed fixture, so the result does
# not depend on what an earlier session did to the working tree.
#
#   scripts/check.sh            all checks
#   scripts/check.sh --no-ui    skip the terminal smoke test
#
# Pinned: CLAUDE_VERSION (the Claude Code the mod is run and tested with).
# Needs: git, python3 (3.11+), npx, and tmux (or nix, which can supply it).

set -euo pipefail

CLAUDE_VERSION="${CLAUDE_VERSION:-2.1.316}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD="$ROOT/mods/xjd-lint"
CLAUDE=(npx --yes "@anthropic-ai/claude-code@$CLAUDE_VERSION")
WORK="$(mktemp -d)"
SESSION="xjd-check-$$"
FAILS=0

if command -v tmux >/dev/null 2>&1; then
  TMUX=(tmux)
else
  TMUX=(nix run nixpkgs#tmux --)
fi

cleanup() {
  "${TMUX[@]}" kill-session -t "$SESSION" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }

echo "fixture: a clean copy of HEAD"
git -C "$ROOT" archive HEAD fixtures/home | tar -x -C "$WORK"
HOME_DIR="$WORK/fixtures/home"

echo "jdlint: output matches the golden file"
(cd "$HOME_DIR" && python3 "$ROOT/vendor/jdlint/jdlint.py" -c jdlint.toml --json) >"$WORK/jdlint.json" || true
python3 -I - "$WORK/jdlint.json" "$ROOT/fixtures/expected-findings.json" <<'PY' && pass "findings equal fixtures/expected-findings.json" || fail "jdlint findings differ from fixtures/expected-findings.json"
import json, sys
got = sorted([e["type"], e["file"]] for r in json.load(open(sys.argv[1]))["roots"].values() for e in r["errors"])
want = json.load(open(sys.argv[2]))
if got != want:
    print("got: ", got)
    print("want:", want)
    sys.exit(1)
PY

echo "mod: validate and test (Claude Code $CLAUDE_VERSION)"
if "${CLAUDE[@]}" plugin validate "$MOD" >"$WORK/validate.txt" 2>&1 || grep -q "Validation passed" "$WORK/validate.txt"; then
  grep -q "Validation passed" "$WORK/validate.txt" && pass "plugin validate" || fail "plugin validate"
else
  fail "plugin validate"
fi
if "${CLAUDE[@]}" plugin test "$MOD" >"$WORK/test.txt" 2>&1; then
  pass "plugin test: $(grep -E '^ *[0-9]+ pass' "$WORK/test.txt" | tr -s ' ')"
else
  fail "plugin test"
  tail -20 "$WORK/test.txt"
fi

screen() { "${TMUX[@]}" capture-pane -t "$SESSION" -p; }

# wait_for <seconds> <extended regex>: polls the screen until it matches.
wait_for() {
  local i
  for ((i = 0; i < $1; i++)); do
    if screen | grep -Eq "$2"; then return 0; fi
    if screen | grep -q "trust this folder"; then
      if [[ "${XJD_CHECK_TRUST:-}" == 1 ]]; then
        # The person opted in: trust this folder, as a CI run would.
        "${TMUX[@]}" send-keys -t "$SESSION" Down Enter
        sleep 2
      else
        echo "  Claude Code does not trust $ROOT yet."
        echo "  Open it once with claude and accept, or run: XJD_CHECK_TRUST=1 scripts/check.sh"
        echo "  (that adds this folder to Claude Code's list of trusted folders)"
        return 2
      fi
    fi
    sleep 1
  done
  return 1
}

start_session() { # <columns>
  "${TMUX[@]}" kill-session -t "$SESSION" 2>/dev/null || true
  "${TMUX[@]}" new-session -d -s "$SESSION" -x "$1" -y 36 -c "$ROOT" \
    "XJD_HOME='$HOME_DIR' XJD_JDLINT='$ROOT/vendor/jdlint/jdlint.py' ${CLAUDE[*]} --plugin-dir '$MOD'"
}

if [[ "${1:-}" != "--no-ui" ]]; then
  echo "terminal: wide session (110 columns)"
  start_session 110
  if wait_for 90 '^5 errors'; then
    pass "strip shows 5 errors"
    screen | grep -Eq '^5 errors +ARBITRARY_CONTENT_WHERE_NOT_ALLOWED \+4 +fix +details' && pass "strip shows the lead code, fix and details" || fail "strip layout"
    "${TMUX[@]}" send-keys -t "$SESSION" "/xjd" Enter
    if wait_for 20 '^Problems +5'; then
      pass "/xjd opens the list"
      [[ "$(screen | grep -c '^● ')" == 5 ]] && pass "five rows" || fail "expected five rows"
      screen | grep -Eq '^● DUPLICATE_ID +10-19 Life/11 Me/11.11 Dup' && pass "a row has code, one space after the dot, and path" || fail "row layout"
    else
      fail "/xjd did not open the list"
    fi
  else
    fail "strip did not appear within 90 seconds"
    screen | head -20
  fi

  echo "terminal: narrow session (60 columns)"
  start_session 60
  if wait_for 90 '^5 errors'; then
    screen | grep -Eq '^5 errors +fix +details' && pass "count on one line, lead code dropped" || fail "narrow strip layout"
  else
    fail "narrow strip did not appear"
  fi

  echo "terminal: jdlint missing (failed state)"
  "${TMUX[@]}" kill-session -t "$SESSION" 2>/dev/null || true
  "${TMUX[@]}" new-session -d -s "$SESSION" -x 110 -y 36 -c "$ROOT" \
    "XJD_HOME='$HOME_DIR' XJD_JDLINT=/nonexistent/jdlint.py ${CLAUDE[*]} --plugin-dir '$MOD'"
  if wait_for 90 "Couldn't run jdlint"; then
    screen | grep -q 'as of' && fail "a time is shown although no run ever worked" || pass "note shown, no time"
  else
    fail "failed state did not appear"
  fi
fi

echo
if ((FAILS > 0)); then
  echo "$FAILS check(s) failed"
  exit 1
fi
echo "all checks passed"
