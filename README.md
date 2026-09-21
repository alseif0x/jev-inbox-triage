# Jev inbox triage

Grok Bot / Cursor **skill**: use **Jev** (TypeSafe System One) as a **typed prefilter** before spending a costly agent.

The skill does not do the work. It only decides **depth** (and, for drafts, send readiness).

Classifier backends:

1. **TypeSafe native API** (recommended) — `POST https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY` ([docs](https://docs.typesafe.ai/introduction))
2. **OpenRouter Decisions** — `typesafe/jev-1.13` with `OPENROUTER_API_KEY` (legacy / optional)

## What it does

### 1. Board triage

When you ask *dónde estoy* / briefing / board:

1. The host agent collects ~8–15 recent items (Calendar, work Gmail, Chat, Odoo, optional PRs) at thread/ticket level.
2. **Phase A** — for each item it sends Jev a short `state` (who, what, status) and asks:
   - `depth`: `ignorar` | `anotar` | `profundizar`
   - `bot`: lane label from `adapters/lanes.yaml` (orientation only; **no** auto-handoff)
   - `urgency`
3. The host reads the **confidence**, not just the label: a low-confidence depth escalates one step toward `profundizar`, never away from it (rules in `SKILL.md`).
4. **Phase B** — only for `profundizar`, same `state`:
   - `effort` → `rapido` | `a_fondo`
   - `executor_tier` → `fast` | `default` | `strong`
5. The host shows the board and **only opens tools/context** on `profundizar`, respecting effort and mapping `executor_tier` → a concrete executor model.

### 2. Pre-send (mail / Chat)

1. Host drafts the message.
2. Jev rates: `enviar` | `retocar` | `no_mandar` (+ risk + missing info).
3. Show the verdict to the user.
4. **Never** auto-send — only after explicit authorization.

## What it does not do

- Replace the main agent
- Launch subagents on its own
- Send messages
- See the full inbox — only a short `state` per item

## Why cheap-first

Goal: do not send noise, FYIs, or no-action items to the expensive model.

Risk (“what if the cheap classifier is wrong?”): mitigated with short factual state, confidence thresholds that only ever escalate toward `profundizar`, a visible board that marks every escalation, and a human on every send.

## What leaves the machine

Every `state` goes to a third-party classifier. It is a short summary the host writes — never a raw thread, never an attachment — with credentials, tokenised links and account numbers stripped first. The one exception is the pre-send guard, which rates the **full draft text** and says so in the pre-authorization view. Items the user marks sensitive skip Jev and go on the board as `profundizar` by hand. Details in `SKILL.md`.

The inverse (expensive agent always-on → Jev only decides whether to escalate) is also valid; this skill implements the cheap prefilter.

## Orchestration (concrete model)

After `profundizar`, Jev can return `executor_tier`: `fast` | `default` | `strong`.

Jev does **not** run that model — the **host** maps the tier (Codex / Claude / Grok / Kimi). See [ORCHESTRATION.md](./ORCHESTRATION.md).

## Secrets

```bash
# Preferred — TypeSafe native
export TYPESAFE_API_KEY=...

# Optional — OpenRouter Decisions
export OPENROUTER_API_KEY=...
```

Never commit API keys.

## Install

Copy `SKILL.md` into your agent’s workflows/skills folder and put your lanes in `adapters/lanes.yaml`. A host that makes the HTTP calls itself can copy `reference/jev.mjs` (no dependencies, Node 18+) or use it as the spec for its own client.

```bash
node --test reference/jev.test.mjs   # rules checked against fixtures; no network, no key needed
```

## Files

- `SKILL.md` — operational recipe (two-phase schemas, confidence rules, what leaves the machine)
- `ORCHESTRATION.md` — Jev → executor model router (Codex / Claude / Grok / Kimi)
- `adapters/` — host maps, your lanes, TypeSafe native vs OpenRouter
- `reference/jev.mjs` — reference client: timeout, one retry, answer validation, escalation thresholds
- `reference/jev.test.mjs` — the rules as tests
- `README.md` — this overview

## License

Private / internal unless you choose otherwise.
