# Testing Tungsten 2.2 on a laptop

The `Build desktop installers` GitHub Actions workflow produces separate artifacts for Windows, macOS, and Linux. Download the artifact matching the laptop operating system and extract it before installation.

## Windows

Use `Tungsten-IDE-2.2.0-win-*.exe`:

- the NSIS installer provides a normal per-machine installation flow;
- the portable EXE runs without installation.

Windows may display a SmartScreen warning for unsigned development artifacts. Inspect the GitHub Actions provenance and file checksum before choosing **Run anyway**. Production releases should be Authenticode-signed.

## macOS

Use the DMG or ZIP artifact. Unsigned development builds may require **System Settings → Privacy & Security → Open Anyway**. Production releases should be Developer ID signed and notarized.

## Linux

Use the AppImage or DEB artifact. For AppImage:

```bash
chmod +x Tungsten-IDE-2.2.0-*.AppImage
./Tungsten-IDE-2.2.0-*.AppImage
```

Install the Debian package with:

```bash
sudo apt install ./Tungsten-IDE-2.2.0-*.deb
```

## Acceptance checklist

1. Launch Tungsten and open a local source-code folder.
2. Create, edit, save, rename, search, and delete a temporary file. Add a second workspace root and repeat search/edit there.
3. Open two terminal tabs, split the terminal, search its buffer, run an interactive shell command, restart Tungsten, and verify the terminal layout is restored.
4. Open a JavaScript or TypeScript file and test hover, completion, definition, references, rename, signature help, and quick fixes.
5. Start a configured debug adapter and test gutter/conditional breakpoints, stepping, threads, stack frames, scopes, variables, and watches.
6. Open Testing, refresh discovery, run one test, inspect its duration/failure/snapshot details, and load an LCOV report if the project provides one.
7. Open Source Control and test side-by-side diff, one-hunk and whole-file staging, commit, history, blame, stash, merge/rebase, conflict resolution, and GitHub lists.
8. If available, open an SSH folder and an SSH terminal. Verify project detection and an installed remote language server; optionally run a remote test and debug adapter. On Windows, test a detected WSL terminal; with Docker, test a running-container terminal.
9. Host a collaboration room on one computer and join from another on the same trusted network. Verify shared text, cursor presence, line comments, and reconnection after a brief network interruption.
10. Restart after leaving an unsaved change and verify recovery behavior.
11. Test the Accessible workspace profile, keyboard-only navigation, reduced motion, and high contrast. Rebind a shortcut, restart Tungsten, and verify it persists.
12. Install a sample extension, review its permissions, disable and re-enable it, then uninstall it.

Please record the operating system, CPU architecture, installer filename, and exact reproduction steps for any issue. Do not include passwords, private keys, access tokens, or private repository content in a report.
