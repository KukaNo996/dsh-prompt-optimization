# dsh-prompt-refine · Prompt Refine

[中文](README.md) | English

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1%2B-purple)

Turn that one-line "just sort out my weekly report" into a professional prompt with a clear task, stated purpose, no ambiguity, a sensible plan, and precise acceptance criteria — in one click, and undo it just as easily.

This is a **DeepSeek Harness (DSH) Web plugin**. The *Optimize prompt* button sits in the composer toolbar right next to the model selector. The rewrite replaces the draft in place and can be reverted at any time. A dedicated settings page configures the model source, API key, and optional multi-candidate evaluation, supporting both online and local OpenAI-compatible endpoints.

---

## Why

Natural-language requests are usually vague: no context, no scope, no acceptance criteria, so the model has to guess. This plugin moves that guesswork into an explicit rewrite:

- **Goals**: clear task / clear purpose / unambiguous / well structured / sensible plan / precise objective
- **Principles**: stay faithful (never invent requirements or facts); when information is missing, mark an assumption or list at most three blocking questions — never answer with a question instead of a prompt
- **Adaptive depth**: short requests get a short prompt; complex ones expand into *Objective / Background / Tasks / Constraints / Steps / Output format / Acceptance criteria*

---

## Features

| Feature | Description |
| --- | --- |
| **One-click optimize** | Calls the model and writes the rewritten prompt back into the draft |
| **One-click undo** | The button becomes *Undo*; click to restore the original, then optimize again |
| **Multi-candidate evaluation** | Generate 2–5 drafts in parallel and let a judge model pick the best one; token cost is stated up front |
| **Configurable model source** | *Follow the app* (default) or *Custom model* (any OpenAI-compatible endpoint) |
| **Local models** | Requests are made by the host side, so browser CORS never blocks Ollama / LM Studio / vLLM |
| **Show hint text** | Off by default (icon only); when on, both "Optimize prompt" and "Undo" labels are shown |
| **Empty-draft guidance** | Clicking optimize on an empty draft types a hint into the composer, holds it for 5 seconds, then erases it character by character; typing cancels it immediately |
| **Reference guard** | Disabled when the draft contains file/session reference chips, which a plain-text rewrite would drop |
| **Failure-safe** | If the draft changes during the request the result is not applied; in-flight work aborts on page close or session switch |

The UI and dictionaries ship in **Chinese and English**.

---

## Installation

### Option 1 — Plugin manager (recommended)

Open **Settings → Plugins** in DSH, or install by package coordinate:

```text
plugin_manager install_bundle target=dsh-prompt-refine
```

For a faster registry inside mainland China:

```text
plugin_manager install_bundle target=dsh-prompt-refine registry=https://registry.npmmirror.com
```

Pin an exact version when you need one, e.g. `target=dsh-prompt-refine@1.1.0`.

### Option 2 — From source

```bash
git clone https://github.com/KukaNo996/dsh-promt-refine
```

```text
plugin_manager install_bundle target=<absolute path of the clone>
```

After installation the plugin row appears under **Settings → Plugins**, and its page under **Settings → Prompt Refine**.

---

## Quick start

1. Type a request into the composer, e.g. `help me sort out the weekly report`
2. Click **Optimize prompt** in the toolbar
3. Review the result — send it, or click **Undo**
4. If the model is unavailable, open **Settings → Prompt Refine** and pick a model source

---

## Settings

| Setting | Purpose | Default |
| --- | --- | --- |
| Model source | *Follow the app* or *Custom model* | Follow the app |
| API base URL | OpenAI-compatible endpoint in custom mode, e.g. `http://127.0.0.1:11434/v1` | — |
| Model | Required in custom mode; empty in follow mode means automatic | — |
| Provider (optional) | Overrides the auto-resolved provider in follow mode | automatic |
| API key | Key for the custom endpoint; local models may leave it empty | — |
| Temperature | 0–2, lower is steadier | 0.3 |
| Max output tokens | 0 leaves it to the model default | 0 |
| Refinement instruction | Custom system prompt; empty uses the built-in one | built-in |
| Multi-candidate evaluation | Toggle plus candidate count (2–5) | off / 1 |
| Show hint text | When on the control shows the "Optimize prompt" and "Undo" labels; when off it shows icons only | off (icon only) |

Use **Test connection** to validate the current settings. Incomplete settings still save; the optimization call then returns a readable error instead of failing silently.

### Model resolution (follow mode)

1. Provider + model explicitly set on the settings page
2. The model used by the session's most recent request (i.e. the model selector)
3. The app default model (**Settings → Models**)
4. Fallback `deepseek-account` / `deepseek-flash`

---

## Requirements

- **DeepSeek Harness 0.2.1 or newer** (uses the `conversation.input.right` and `settings.section` slots plus `inputActions.setDraft`)
- Follow mode needs a signed-in DeepSeek account or a configured model; otherwise use a custom endpoint

---

## Privacy & security

- **API key storage**: stored in the host credential service when available (`keyStorage: credential`); `settings.json` only records whether a key exists. Without that service the key falls back to `$DSH_HOME/dsh-prompt-refine/settings.json` with mode `0600`. Plaintext keys from older versions are migrated automatically and removed.
- **Browser**: only ever receives a mask such as `sk-••••1234`; no route returns the plaintext.
- **Endpoint protection**: every route except `/status` requires a per-process random ticket (fetched from `/status`) and validates `Origin`; model routes are rate limited to 10 calls/minute per source.
- **Where data goes**: the draft text is **sent to the configured model endpoint** (the app's own provider in follow mode). Do not optimize sensitive drafts against an untrusted third-party endpoint.
- **Cancellation**: closing the page, switching sessions, or clicking again aborts the request immediately; the host side answers 499 and stops the call.

---

## Implementation

### Host half (`index.js`)

Registers a same-origin prefix route `/dsh-prompt-refine/*`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/status` | GET | Health check plus the request ticket |
| `/settings` | GET / POST | Read / save settings (the key is write-only) |
| `/optimize` | POST | Run the rewrite, including multi-candidate evaluation |
| `/test` | POST | Test the connection |

- Follow mode uses the DSH `llm` service (account auth and retry built in); custom mode calls an OpenAI-compatible `/chat/completions` from the Host
- Evaluation: with `candidates > 1` it generates N drafts in parallel, then asks the judge once for an index; if the judge fails or returns no valid index it falls back to a deterministic score (structure + numeric/identifier retention + length ratio)
- Cancellation: `req.on('close')` produces an AbortSignal forwarded to `llm.stream` / `fetch`

### Client half (`client.js`)

Registers two slots through `window.__ModuleLoader__.load`:

- `conversation.input.right` — the optimize / undo control and its error bubble
- `settings.section` — the settings page

Drafts are read and written through the injected `inputActions` / `useInput` standard props; the DOM is never touched. Optimization is disabled while `occurrences` is non-empty. Styling uses only `--dsw-alias-*` theme tokens.

### Package contents

Only `index.js`, `client.js`, `cordis.patch.yml`, `locale/*.json`, and `icon.svg` are published; tests and docs stay in the repository.

---

## Development

```bash
node --check index.js
node --check client.js
node .verify/host-test.mjs            # Host: routes, ticket/rate limit, key storage, cancellation, evaluation (46 checks)
node .verify/client-test.mjs          # Client: module factory and slot registrations (14 checks)
node .verify/hint-animation-test.mjs  # Empty-draft guidance: type / hold / erase and interruption (31 checks)
node .verify/icon-test.mjs            # Icon structure contract (16 checks)
node .verify/locale-test.mjs          # Locale resolution and key parity (36 checks)
node .verify/translate-sim.mjs        # Actual output per language (14 checks)
python3 .verify/icon-weight.py        # Icon visual balance from a real 16px render
```

Or run everything CI runs:

```bash
npm run verify
```

### Committing

This directory is a complete Git repository with `origin` at <https://github.com/KukaNo996/dsh-promt-refine> and default branch `main`.

```bash
git status
git add -A -- . ':!.workbuddy'
git commit -m "fix: describe the change"
git push origin main
```

- **Local proxy**: this repository sets `http.proxy = http://127.0.0.1:7897`. For a different port:

  ```bash
  git config --local http.proxy http://127.0.0.1:<port>
  git config --local https.proxy http://127.0.0.1:<port>
  ```

  Once direct access works: `git config --local --unset http.proxy` and `--unset https.proxy`.
- **Credentials**: Git Credential Manager already holds the GitHub account; if it expires, follow the prompt from `git push`.
- **Identity and line endings**: repository-local `user.name=KukaNo996`, `user.email=1274666494@qq.com`, `core.autocrlf=false`.
- `.workbuddy/`, `*.tgz`, and `node_modules/` are ignored.

---

## FAQ

**The button does nothing, or reports that no model is available.**
No account signed in and no model configured. Open **Settings → Prompt Refine**, switch to *Custom model*, fill in the API base URL and model, then click **Test connection**.

**Why is the button greyed out after I typed?**
The draft contains file or session reference chips; a plain-text rewrite would drop them. Remove the references to continue.

**Is multi-candidate evaluation worth it?**
Yes when the result goes to someone else. N candidates cost roughly `N + 1`× the tokens of a single pass and take longer.

**The rewrite expands too much.**
The built-in instruction already asks for length to match the source. You can still tune the **Refinement instruction** in settings — for example set an explicit word limit.

---

## Known limitations

- Optimization and undo rewrite the draft as **plain text**; with reference chips the button is disabled (undo also restores text only)
- "The model selected in the composer" comes from the session's last request; right after switching models and before sending, the default model is used
- Custom endpoints must speak the OpenAI-compatible `/chat/completions` API
- Multi-candidate evaluation costs about `N + 1`× the tokens — best for quality-focused, latency-tolerant use
- Verified in the Web GUI only; the standalone Electron window is untested

---

## License

[MIT](LICENSE) © 2026 KukaNo996
