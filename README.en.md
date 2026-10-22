# dsh-prompt-optimization · Prompt Refine

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
| **Configurable model source** | *Follow composer* (default), *Follow the app* or *Custom model* (any OpenAI-compatible endpoint) |
| **Local models** | Requests are made by the host side, so browser CORS never blocks Ollama / LM Studio / vLLM |
| **Show hint text** | Off by default (icon only); when on, both "Optimize prompt" and "Undo" labels are shown |
| **Empty-draft guidance** | Clicking optimize on an empty draft types a hint into the composer, holds it for 2 seconds, then erases it character by character; typing cancels it immediately |
| **Classified rewriting** | The original is classified into one of six types first — knowledge, coding, writing, analysis, process, conversion — and the type decides what to ask |
| **Question decomposition** | A question like "what is X" is never answered; it is decomposed into at least 3 analysis dimensions |
| **Five length tiers** | Tier is picked from the original length and type: tiny / short / standard / detailed / full, never mixed within one rewrite |
| **Cancellable optimization** | Click the spinner while the optimization runs to cancel it; the draft is restored |
| **Maximum wait** | Longest wait for one optimization, 15 seconds by default and 10 seconds at minimum; it aborts on its own |
| **Optimize with context (Beta)** | Optionally compress the current conversation first and rewrite against it, so the result fits your usual phrasing; off by default |
| **Reference guard** | Disabled when the draft contains file/session reference chips, which a plain-text rewrite would drop |
| **Failure-safe** | If the draft changes during the request the result is not applied; in-flight work aborts on page close or session switch |
| **Update check** | Check for a newer version from the settings page with a **configurable update source** (npm registry / GitHub Releases / any mirror); reads the version only and installs nothing |

The UI and dictionaries ship in **Simplified Chinese, Traditional Chinese, Japanese and English**.

---

## Installation

### Option 1 — Plugin manager (recommended)

Open **Settings → Plugins** in DSH, or install by package coordinate:

```text
plugin_manager install_bundle target=dsh-prompt-optimization
```

For a faster registry inside mainland China:

```text
plugin_manager install_bundle target=dsh-prompt-optimization registry=https://registry.npmmirror.com
```

Pin an exact version when you need one, e.g. `target=dsh-prompt-optimization@1.1.0`.

### Option 2 — From source

```bash
git clone https://github.com/KukaNo996/dsh-prompt-optimization
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
| Model source | *Follow composer*, *Follow the app* or *Custom model* | Follow composer |
| API base URL | OpenAI-compatible endpoint in custom mode, e.g. `http://127.0.0.1:11434/v1` | — |
| Model | Required in custom mode; empty in follow mode means automatic | — |
| Provider (optional) | Overrides the auto-resolved provider in follow mode | automatic |
| API key | Key for the custom endpoint; local models may leave it empty | — |
| Temperature | 0–2, lower is steadier | 0.3 |
| Max output tokens | 0 leaves it to the model default | 0 |
| Refinement instruction | Custom system prompt; empty uses the built-in one | built-in |
| Multi-candidate evaluation | Toggle plus candidate count (2–5) | off / 1 |
| Show hint text | When on the control shows the "Optimize prompt" and "Undo" labels; when off it shows icons only | off (icon only) |
| Update source | Address used by the update check; empty tries the built-in order | automatic |
| Optimize with context (Beta) | Compress the conversation first, then rewrite against it | off |
| Maximum wait | Longest wait for one optimization, covering compression, candidate generation and judging | 15 seconds |

Use **Test connection** to validate the current settings. Incomplete settings still save; the optimization call then returns a readable error instead of failing silently.

### Cancelling and the wait budget

While an optimization runs, **clicking the spinner cancels it** and the draft is restored.
The cancel ends the client request and the host-side model call, so the model does not keep generating in the background.

The **maximum wait** limits how long one optimization may take, **15 seconds by default and 10 seconds at minimum**.
It covers the whole operation — context compression, candidate generation and judging — not just the last model call.
When it runs out the plugin stops and says so.

### Classification

The original is classified before anything is written, and the type decides what the prompt should ask:

| Type | Typical phrasings | What the rewrite spells out |
| --- | --- | --- |
| Knowledge | what is, why, difference, principle | Several analysis dimensions, answered systematically |
| Coding | write, fix, refactor, error, performance | Inputs/outputs, language and framework, constraints, edge cases, acceptance |
| Writing | copy, naming, email, script, translation | Audience, purpose, tone, length, taboos |
| Analysis | compare, choose, evaluate, worth it | Candidates, evaluation dimensions, conclusion form, criteria |
| Process | how to, getting started, steps | Phases, per-phase output, dependencies, checkpoints |
| Conversion | summarise, shorten, rewrite, format | Target shape, what to keep, what to drop |

### Questions are never answered

When you ask "what is a closure" or "React or Vue", the plugin **never answers in an assistant voice**.
It rewrites your question into a prompt that another AI can answer:

- The question must be split into **at least 3 analysis dimensions**; a polished one-line question does not count;
- Six dimensions are available: definition, mechanism, taxonomy, applications, limits, practice;
- The reader level, depth and whether sources are needed are stated explicitly;
- Knowledge questions are written at the "detailed" tier even when the original is five characters long.

### Five length tiers

Length is decided by **the original length plus the question type**, so a short request is never expanded into a wall of text:

| Tier | Original | Output |
| --- | --- | --- |
| Tiny | under ~20 characters | 1–2 sentences; no headings, numbering or background |
| Short | 20–50 characters, one ask | 2–4 sentences or up to 3 short requirements |
| Standard | 50–150 characters, or 2–3 asks | 4–8 lines, at most 1–2 small headings |
| Detailed | 150–400 characters, or a type that needs a systematic answer | Structured sections: goal / dimensions / constraints / output shape / acceptance |
| Full | over 400 characters, or several dependent asks | The full structure with background, steps and checkpoints |

Tiers are never mixed within one rewrite. Shorter is better by one tier than the original justifies.
### Optimizing with context (Beta)

The **Optimize with context (Beta)** switch is **off by default**. When on, the plugin:

1. reads the messages **you actually typed** in this session (the host-injected runtime context does not count);
2. asks the model to compress them into a short brief of your phrasing, topics and exclusions;
3. rewrites the prompt against that brief.

**Only the compressed brief is sent with the rewrite; the raw transcript never is.**
Compression costs one extra model call, so the token usage goes up; if it fails the rewrite falls back to the normal path.

### Checking for updates

The settings page ends with a **Check for updates** block. It reports whether a newer version exists — it **reads the version only, downloads and installs nothing, and never rewrites the settings file**.

The update source accepts three forms:

| Form | Example |
| --- | --- |
| Built-in alias | `npm`, `npmmirror`, `github` |
| npm registry package URL | `https://registry.npmmirror.com/dsh-prompt-optimization` |
| GitHub Releases API URL | `https://api.github.com/repos/KukaNo996/dsh-prompt-optimization/releases/latest` |

When left empty the check tries **npm registry → npmmirror → GitHub Releases** and returns on the first success.

- A custom source is interpreted by its **payload shape** (`dist-tags.latest` or `tag_name`), so mirrors and proxies work regardless of hostname.
- Each source times out after 10 seconds and the check falls back to the next one; if all fail, every reason is listed.
- Version comparison follows semver precedence, including prerelease ordering.

### The three model sources

| Mode | Model used | When it is unavailable |
| --- | --- | --- |
| **Follow composer** (default) | The model currently picked at the bottom right of the input box | **Fails**; it never switches to another model |
| Follow the app | See the resolution order below | Falls back step by step |
| Custom model | The OpenAI-compatible endpoint you configured | Fails with a hint about the missing URL or model |

'Follow composer' **never falls back**: picking it means you want the optimization to run on
the very model you are talking to, so swapping in another one silently would defeat the point.
When the session has no recognisable selection yet, the plugin says so instead of deciding for you.

### Model resolution (follow the app)

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

- **API key storage**: stored in the host credential service when available (`keyStorage: credential`); `settings.json` only records whether a key exists. Without that service the key falls back to `$DSH_HOME/dsh-prompt-optimization/settings.json` with mode `0600`. Plaintext keys from older versions are migrated automatically and removed.
- **Browser**: only ever receives a mask such as `sk-••••1234`; no route returns the plaintext.
- **Endpoint protection**: every route except `/status` requires a per-process random ticket (fetched from `/status`) and validates `Origin`; model routes are rate limited to 10 calls/minute per source.
- **Where data goes**: the draft text is **sent to the configured model endpoint** (the app's own provider in follow mode). Do not optimize sensitive drafts against an untrusted third-party endpoint.
- **Cancellation**: closing the page, switching sessions, or clicking again aborts the request immediately; the host side answers 499 and stops the call.

---

## Implementation

### Host half (`index.js`)

Registers a same-origin prefix route `/dsh-prompt-optimization/*`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/status` | GET | Health check plus the request ticket |
| `/settings` | GET / POST | Read / save settings (the key is write-only) |
| `/optimize` | POST | Run the rewrite, including multi-candidate evaluation |
| `/test` | POST | Test the connection |
| `/update-check` | GET / POST | Check for updates (outside the model call budget) |

- Follow mode uses the DSH `llm` service (account auth and retry built in); custom mode calls an OpenAI-compatible `/chat/completions` from the Host
- Evaluation: with `candidates > 1` it generates N drafts in parallel, then asks the judge once for an index; if the judge fails or returns no valid index it falls back to a deterministic score (structure + numeric/identifier retention + length ratio)
- Cancellation: `req.on('close')` produces an AbortSignal forwarded to `llm.stream` / `fetch`
- Update check: an HTTPS GET to the update source (10s timeout, 2 MB cap) that reads a npm packument or a GitHub release by payload shape and compares versions with semver rules; read-only, it never writes the settings file

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
node .verify/preamble-test.mjs        # Preambles stripped, real prompts kept (12 checks)
node .verify/rename-migration-test.mjs # Rename migration: settings and key survive (9 checks)
node .verify/update-test.mjs          # Update check: source parsing, semver, timeout, auth (37 checks)
node .verify/composer-mode-test.mjs   # Follow composer mode (19 checks)
node .verify/disconnect-test.mjs      # A client disconnect must reach the Host (5 checks)
node .verify/wait-budget-test.mjs     # Wait budget and cancellation (34 checks)
python3 .verify/icon-weight.py        # Icon visual balance from a real 16px render
```

Or run everything CI runs:

```bash
npm run verify
```

### Committing

This directory is a complete Git repository with `origin` at <https://github.com/KukaNo996/dsh-prompt-optimization> and default branch `main`.

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
