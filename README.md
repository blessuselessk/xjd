# XJD

XJD is the Costa Decimal System: a Johnny Decimal based way of organizing a
business. This repository holds three things:

- [`SPEC.md`](SPEC.md): where an XJD system, its config and its checkers live
  on disk, modeled on the XDG base directory spec. Draft.
- [`mods/xjd-lint`](mods/xjd-lint): a Claude Code mod that runs
  [jdlint](https://github.com/SiriusStarr/jdlint) over an XJD tree and shows the
  problems above the prompt.
- [`NOTES.md`](NOTES.md): things to look at after version one.

## xjd-lint

When Claude changes files in your system, the mod runs jdlint and shows what is
wrong:

```
5 errors  ARBITRARY_CONTENT_WHERE_NOT_ALLOWED +4                       fix  details
```

- `details`, or the `/xjd` command, opens the list: one row per problem, with
  jdlint's own code and the path. Long paths are cut from the left.
- `fix` puts the problems in the prompt box. You read them and send. Nothing
  is sent for you.
- `auto-fix` is shown but off. It is not built yet.
- When there are no problems, or the session is outside an XJD system, the mod
  draws nothing.
- If jdlint fails to run, the last results stay, dimmed, with the time of the
  last good run.

### Needs

- Claude Code 2.1.287 or later. On 2.1.280 the mod does not load.
- Python 3.11 or later, for jdlint.
- jdlint. The repo carries it as a submodule: `git clone --recurse-submodules`.
  Or point `XJD_JDLINT` at a `jdlint.py` of your own.

### Install

From GitHub, at the prompt of a terminal session:

```
/plugin install xjd-lint --marketplace blessuselessk/xjd
```

From a local clone, in a shell (this also works for the desktop app's local
sessions):

```
claude plugin marketplace add /path/to/this/repo
claude plugin install xjd-lint@xjd
```

### Try it

`fixtures/home` is a small broken tree with its `xjd.toml` and jdlint config.

```
XJD_HOME=$PWD/fixtures/home claude --plugin-dir $PWD/mods/xjd-lint
```

You should see five errors. Ask Claude to rename or delete a folder in
`fixtures/home` and the strip updates by itself.

### How it finds your system

1. `XJD_HOME`, if set.
2. Otherwise the nearest parent folder with an `xjd.toml`.
3. Otherwise nothing: the mod stays out of the way.

The home's `xjd.toml` names the jdlint config and what to watch. See
`SPEC.md`. Both `xjd.toml` and the jdlint config must be in jdlint's ignore
list, or jdlint reports them as stray files.

### When it runs

At session start, and after a Bash command, or a Write, Edit, MultiEdit or
NotebookEdit on a file that matches the watch list. A Bash command can change
any file, so every one triggers a run. A run that finds nothing new redraws
nothing.

### Checks

```
claude plugin validate mods/xjd-lint
claude plugin test mods/xjd-lint
```

Both pass. The tests cover jdlint parsing, the config and glob readers, and
each visible state on terminal and desktop. They do not show how it looks.
Terminal has been seen working. Desktop has not been looked at yet.

### Known issues

- No footer count by the model name yet.
- jdlint prints no severity or message. The mod calls every jdlint finding an
  error and writes its own short sentence for the common codes.
- Paths are shown as jdlint reports them. With several roots they are not
  prefixed with the root's name.
