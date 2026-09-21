---
name: Jev inbox triage
description: >-
  Use this when running an on-demand work board or briefing (dónde estoy /
  briefing / tablero / qué toca), batch-triaging Chat/mail/calendar/Odoo/PRs so
  only high-signal items get deep work, gating outbound drafts before
  pre-authorization, or choosing rápido vs a fondo effort on profundizar items.
---
# Jev inbox triage (complement gate)

Cheap typed filter before deep LLM/tool work. Jev is **not** a substitute for the main assistant — it only decides depth, effort, and (for drafts) send readiness.

## Model / API

- OpenRouter Decisions API: `POST https://openrouter.ai/api/alpha/decisions`
- Model: `typesafe/jev-1.13`
- Auth: Bearer token from env `OPENROUTER_API_KEY` (never commit the key; load from a local secret store)
- Keep each call small; batch items sequentially or in a short loop

## Collect items (thread-level, not every ping)

Gather a short list of **inbox items** for today / recent window:

1. **Calendar** — today’s events (meetings, dailies)
2. **Gmail (work)** — open threads that need attention (tickets, client mail, invites); skip noise
3. **Google Chat** — active threads with colleagues (last ~5–10 messages as state, not one-liners alone)
4. **Odoo** — assigned open tasks / hot helpdesk tickets relevant to the board
5. **Bitbucket PRs** (optional) — review requested / failing CI that needs a look

Cap roughly 8–15 items. Deduplicate (e.g. same ticket in mail + calendar → one ticket item + optional calendar note).

## Questions schema — inbox item

```json
{
  "depth": {
    "type": "choice",
    "instructions": "How should the assistant handle this inbox item as a complement filter?",
    "criteria": {
      "ignorar": "Noise, already handled, or no action for the user",
      "anotar": "Worth noting on the board but no deep work now",
      "profundizar": "Open context and propose or do concrete next steps now"
    }
  },
  "bot": {
    "type": "choice",
    "instructions": "Which specialist lane fits best? (label only — Master deepens unless the user asks to involve a specialist)",
    "criteria": {
      "master": "Cross-cutting coordination / meeting / triage",
      "webforms": "Webforms / helpdesk / plantillas",
      "ambici": "AMBici / mobility",
      "zigurat": "Zigurat web",
      "tea": "TEA / DI-TEA",
      "personal": "Personal life only"
    }
  },
  "urgency": {
    "type": "score",
    "instructions": "Urgency for the user in the current work window",
    "criteria": ["Later", "Today", "First thing / blocking"]
  },
  "effort": {
    "type": "choice",
    "instructions": "If depth is profundizar, how deep should the executor go? If not profundizar, prefer rapido.",
    "criteria": {
      "rapido": "1–2 targeted tool calls; short answer or next-step line",
      "a_fondo": "Full context: ticket/mail/code as needed, concrete plan or draft"
    }
  },
  "executor_tier": {
    "type": "choice",
    "instructions": "If depth is profundizar, which executor class should the host run? If not profundizar, prefer fast. The host maps this to a concrete model (see ORCHESTRATION.md).",
    "criteria": {
      "fast": "Light deepen; short factual next step",
      "default": "Normal deepen with tools",
      "strong": "Hard reasoning, multi-file, or ambiguous client risk"
    }
  }
}
```

`state` for each item: source label + short factual context (who, what, status). Prefer thread/ticket state over isolated messages. **Profundizar** = needs a concrete next action now, not “message is long”.

## Output to the user

1. **Board** — compact table: item, depth, bot, urgency, **effort**, **executor_tier** (for profundizar)
2. **Deepen only `profundizar`** — host maps `executor_tier` → concrete model (Codex / Claude / Grok / Kimi adapters in `ORCHESTRATION.md`), then opens tools; respect `rapido` vs `a_fondo` (no auto handoff to specialist bots)
3. **`anotar`** — one line on the board; do not open heavy context
4. **`ignorar`** — omit from narrative or fold into a quiet “filtered N” count

If a calendar meeting exists only to prep a ticket that is already `profundizar`, treat the meeting as schedule context on that ticket (do not skip the deepen).

## Pre-send guard (outbound mail / Chat)

Never auto-send. When a reply is warranted:

1. Draft the message
2. Run Jev on the draft with this schema:

```json
{
  "verdict": {
    "type": "choice",
    "instructions": "Should this outbound draft be sent after user pre-authorization?",
    "criteria": {
      "enviar": "Clear, complete, appropriate tone; ready for user approve→send",
      "retocar": "Needs edits (tone, missing facts, too long, wrong audience)",
      "no_mandar": "Should not go out (wrong thread, premature, risky, or no ask)"
    }
  },
  "client_risk": {
    "type": "score",
    "instructions": "Risk if sent as-is to an external client",
    "criteria": ["Low", "Medium", "High"]
  },
  "missing_info": {
    "type": "choice",
    "instructions": "Does the draft claim or omit something that still needs confirmation?",
    "criteria": {
      "ok": "No material gaps",
      "falta": "Missing confirmation, owner, dates, or technical fact"
    }
  }
}
```

`state` = recipients + purpose + full draft text (and one-line ticket context if any).

3. Show **pre-authorization** to the user (widget or connector draft) including Jev verdict
4. Send only after explicit approve / edit+confirm

## Orchestration

Jev classifies; the **host** routes. See [ORCHESTRATION.md](./ORCHESTRATION.md) for `executor_tier` → model maps (Codex, Claude, Grok, Kimi). Do not replace Jev with another classifier.

## Failure modes

- Missing OpenRouter key → say so; fall back to a short manual board without inventing Jev scores
- Bad bot label on thin state → correct in the deepen pass; do not re-ask the user
- Never send mail/chat unasked; deepening may draft, not send
- `effort=a_fondo` / `executor_tier=strong` is not permission to hand off to another bot or to send outbound mail
