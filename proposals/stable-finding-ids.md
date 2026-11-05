# Proposal: stable finding IDs

Status: the first slice is built. Steps 2 to 4 are not. Answers what was an open
question in [`SPEC.md`](../SPEC.md): should findings carry a stable ID?

## Problem

Today a run produces a list and nothing more. The mod compares whole lists
(`fingerprint` in `hooks/lib/findings.ts` is `JSON.stringify` of the list), so
it knows *that* something changed, never *which* problem it was. So it cannot:

- show which problems are new since the last run;
- tell that a fix worked, rather than that the count went down;
- stop an agent that keeps failing on the same problem;
- remember any of this between sessions.

## Proposal

Each finding gets an `id`: the same problem gives the same `id` on every run.

```json
{
  "id": "bc8131b8769eae02f4abd9c74ad38ff9",
  "source": "jdlint",
  "code": "DUPLICATE_ID",
  "path": "10-19 Life/11 Me/11.11 Dup",
  "message": "11.11 is used more than once",
  "severity": "error"
}
```

### How the ID is made

`id` is the first 32 hex characters of the SHA-256 of a key. Places that show
an ID to a person show its first 8.

```
<source> NUL <root> NUL <code> NUL <anchor>
```

`root` is the name of the checker's root the finding came from: jdlint can
check several roots in one system, and each root's paths start fresh, so
`11.11` in one root and `11.11` in another are different problems. Empty when
the checker has a single root or no roots, as for a JDex finding.

The **anchor** is where the problem is, picked so that renaming a folder does
not make an old problem look new. The first rule that applies wins:

1. **The checker names the JD number.** jdlint's `DUPLICATE_ID` carries
   `"id": "11.11"`. Anchor: `11.11`.
2. **The path ends in a JD number.** `10-19 Life/11 Me/11.11 Me` ends in
   `11.11`; `10-19 Life/13 Stuff` ends in `13`; `10-19 Life` ends in `10-19`.
   Anchor: that number.
3. **Otherwise, the path.** `Stray` has no number. Anchor: `Stray`.
4. **No path.** Anchor: the empty string.

**Collisions.** Two findings can get the same key. In the fixture, `11.11 Dup`
and `11.11 Me` are both empty folders, so both are `EMPTY_FOLDER` at `11.11`.
When a key is shared within one run, each of those findings uses its path as
the anchor instead. That is rare, and it is the case where the path really is
what tells the problems apart. The cost: those findings lose the rename
protection below. Renaming `11.11 Me` changes the ID of its `EMPTY_FOLDER`,
because here the path is the only thing that tells it from `11.11 Dup`.

**Alias.** Fixing `11.11 Dup` ends the collision, so the `EMPTY_FOLDER` at
`11.11 Me` goes back to the number as its anchor and its ID changes. It is the
same problem, so each numbered finding also carries the other hash as `alias`.
A problem counts as seen before if its `id` matches any earlier `id` or `alias`.

The other way to break a tie is a counter, as GitHub code scanning does: the
first `EMPTY_FOLDER` at `11.11` is `#1`, the second `#2`. A counter survives a
rename but not a fix: fix `#1` and the old `#2` becomes `#1`, so it looks
fixed and its neighbour looks new, with no way to tell. A fix is the moment an
ID most needs to hold, so this proposal uses the path and the alias.

### What it means in practice

| Change | Same ID? |
| --- | --- |
| Rename `11.11 Me` to `11.11 Myself` | Yes, unless its key collided (above) |
| Rename `13 Stuff` to `13 Things` | Yes |
| Renumber `11.11` to `11.12` | No: it is now a different ID in the system |
| Rename `Stray` to `Strays` | No: it has no number, so its path is its name |
| Edit a file inside `11.11 Me` | Yes |

Renumbering counts as a new problem on purpose: in Johnny Decimal the number
*is* the identity.

### Who computes it

The adapter that turns a checker's output into findings. The checker contract
does not change: a checker MAY print `id` itself, and the adapter computes it
only when it is missing. jdlint does not print one.

## What it enables, in order

1. **New versus existing.** Keep the IDs of the session's first good run. The
   strip reads `5 errors · 1 new`; new rows get a `new` mark. The footer count
   does not change. Not the previous run: every Bash command runs the check, so
   "new" would vanish at the next command.
2. **Fix confirmed.** After a fix, report the IDs that went away, not just the
   new count.
3. **Retry cap.** Count fix attempts per ID. After three on the same ID, stop
   and show the person. This is what makes option B (the agent fixes on its
   own) safe, and why it is listed after this in `NOTES.md`.
4. **A baseline.** Write the last findings, with IDs, to
   `$XJD_STATE_HOME/findings.json`, which `SPEC.md` already reserves. "New"
   then means new since the last session, not just since the last run. This
   is what PHPStan, detekt and golangci-lint call a baseline.

## First slice

Small enough to build and test in one go:

- Add `id` to the finding format in `SPEC.md` and to the `Finding` type.
- Compute it in `parseJdlint`, with the anchor rules and the collision rule.
- Keep the first good run's IDs in mod state. Show `· N new` in the strip and a
  `new` mark on rows.
- Keep the whole-list string for the "did anything change" check. A rename keeps
  the ID but changes the path, and the row has to redraw.
- Tests: the fixture's five findings get the expected anchors; a rename keeps
  every ID; the two `EMPTY_FOLDER` findings at `11.11` get different IDs;
  the same problem in two roots gets two IDs; fixing one of a pair does not make
  the other look new.

Steps 2 to 4 come after, each on its own.

## Prior art

jdlint has no IDs. It can ignore paths (`linter.ignore`, `--ignore`) and turn
off whole rules (`linter.disable_rules`), but it cannot name one problem.
Other tools have met the same need:

| Tool | ID made from | What this proposal takes |
| --- | --- | --- |
| GitHub code scanning (SARIF `primaryLocationLineHash`) | rule, a hash of the flagged line's content, a counter for repeats | Anchor on content, not position. Its counter is the rejected tie-break above. |
| GitLab Code Quality / Code Climate `fingerprint` | SHA-256 of `path \0 function \0 metric`, cut to 32 hex | The NUL-separated key and the 32-character length. |
| detekt baseline | `RuleID:FileName:Signature` | A meaningful anchor (the function's signature; here, the JD number). |
| ESLint baseline tools | file, rule, message, without line numbers | Leave out what drifts for unrelated reasons (here, folder names). |
| PHPStan baseline | message, path, count per file | Counts alone cannot say which problem was fixed, so this proposal does not use them. |

Nothing found does this for Johnny Decimal.

Sources:
[GitHub SARIF support](https://docs.github.com/code-security/secure-coding/sarif-support-for-code-scanning),
[GitLab Code Quality](https://gitlab.com/gitlab-org/gitlab-foss/-/blob/75631c919c0515e7933ec4550ea07534a23d6f22/doc/ci/testing/code_quality.md),
[a Code Climate fingerprint in practice](https://docs.rs/big-code-analysis/latest/src/big_code_analysis/output/code_climate.rs.html),
[a survey of baselines (arch-lint #10)](https://github.com/ynishi/arch-lint/issues/10),
[PHPStan #5085](https://github.com/phpstan/phpstan/issues/5085),
[eslint-baseline](https://github.com/lukahartwig/eslint-baseline).

## Decided

- **The first run of a session counts nothing as new.** It is what later runs
  are compared with, and opening a session should not shout.
- **The ID ignores `message`.** Rewording a message keeps the ID. Two different
  problems with the same code at the same number cannot happen within one
  jdlint root: each issue is about one file or folder, and each code is
  reported at most once per file. Same-number cases are folders sharing a
  number, which the collision rule covers. Across roots it can happen, which
  is why the key carries `root`.
