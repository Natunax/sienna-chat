# Contributing to Sienna

Thanks for helping. Sienna is a small app with a few firm principles, so a short read here saves us both time.

## Before you start

- **Bugs:** open an issue that says what you did, what you expected and what happened, with the macOS version and your Sienna commit.
- **Features and larger changes:** open an issue first and describe the problem you want to solve. Some ideas would conflict with the principles below, and it is better to find that out before you write code.
- **Security problems:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Principles

- **The API key is sacred.** It stays in the Keychain, never reaches logs, files, the UI or commands Claude runs, and Sienna never falls back to a Claude subscription login.
- **The project folder is a boundary.** Anything that widens what Claude can read, write or run needs a strong reason, a test in `sidecar/project.test.mjs` and a line in the README's security section.
- **Native and quiet.** The app should feel like a Mac app: system fonts and materials, light and dark mode, keyboard access and no decoration for its own sake.
- **Both languages.** Every text lives in `src/i18n.ts` in English and German. TypeScript fails the build if one is missing.

## Making a change

```bash
npm install
npm run sidecar:install
npm run dev          # browser preview with sample data
npm run tauri dev    # the real app
```

Keep pull requests focused on one change, and match the style of the code around you. Before you push, run:

```bash
npx tsc --noEmit
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

UI changes need a screenshot in light and dark mode in the pull request.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
