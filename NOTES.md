# Notes

Things to explore after version one. Nothing here is decided.

## v2 candidates

- **Stable finding IDs.** A fingerprint (hash of code, path, key detail) so we
  can show "new" versus "existing", see when a fix worked, and stop the agent
  after three tries on the same finding. Caveat: renaming a folder changes its
  ID.
- **Nickel / Organist.** Nickel is a typed config language that exports to
  TOML and JSON. Organist writes Nix dev shells in Nickel. Possible uses:
  generate `xjd.toml` and `jdlint.toml` with checked shapes, derive the JD tree,
  JDex and lint config from one definition, and give this repo a reproducible
  shell with Python 3.11+. Decide when the flake is written: Nickel or plain Nix
  for generating config. Verify current Organist status first.
- **Flake and typix rebuilds.** How a rebuild reads findings. The findings
  format in SPEC.md is the hook.
- **Automatic agent reaction (option B).** Findings go into the agent's context
  and it fixes them, with a cap of three rounds, then stops and shows the user.
  Version one only offers (option A).
- **Fix actions.** Checkers only report for now.

## Open spec questions

- No default for `XJD_HOME`? (Leaning yes: out of scope until set.)
- TODO: do `XJD_CONFIG_DIRS` and `XJD_DATA_DIRS` belong in v1?
- Windows and macOS defaults.
- More than one home at a time.
