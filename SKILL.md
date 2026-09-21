---
name: jev-inbox-triage
description: >-
  Use this when running an on-demand work board or briefing (dónde estoy /
  briefing / tablero / qué toca), batch-triaging Chat/mail/calendar/Odoo/PRs so
  only high-signal items get deep work, gating outbound drafts before
  pre-authorization, or choosing rápido vs a fondo effort on profundizar items.
---
# Jev inbox triage (complement gate)

Cheap typed filter before deep LLM/tool work. Jev is **not** a substitute for the main assistant — it only decides depth, effort, and (for drafts) send readiness.

## Model / API

Preferred — **TypeSafe native** ([docs](https://docs.typesafe.ai/introduction)):

- `POST https://api.typesafe.ai/v1/systemone`
- Model: `jev-latest`
- Auth: Bearer `TYPESAFE_API_KEY` (never commit the key)

Optional — OpenRouter Decisions:

- Model: `typesafe/jev-1.13`
- Auth: Bearer `OPENROUTER_API_KEY`

One `state` per call. Keep each call small and run items in a short loop. Give every call a **timeout (5 s)** and retry **once** on timeout or 5xx; on a second failure, fall back for that item as described under *Failure modes*. See `adapters/typesafe-native.yaml` and `reference/jev.mjs`.

## What leaves the machine

Every `state` is sent to a third-party classifier. Treat it as an outbound message:

- `state` is a **short factual summary the host writes** (who, what, status) — never a raw thread dump, never attachments, never message bodies beyond what the decision needs.
- Strip before sending: credentials, tokens, links carrying tokens, account or card numbers, and anything the user marked confidential.
- The pre-send guard is the exception: it sends the **full draft text**, because that is what it rates. Say so in the pre-authorization view.
- For a client or thread the user has marked sensitive, skip Jev and put the item on the board as `profundizar` by hand. No score is invented.

## Collect items (thread-level, not every ping)

Gather a short list of **inbox items** for today / recent window:

1. **Calendar** — today’s events (meetings, dailies)
2. **Gmail (work)** — open threads that need attention (tickets, client mail, invites); skip noise
3. **Google Chat** — active threads with colleagues (last ~5–10 messages as state, not one-liners alone)
4. **Odoo** — assigned open tasks / hot helpdesk tickets relevant to the board
5. **Bitbucket PRs** (optional) — review requested / failing CI that needs a look

Cap roughly 8–15 items. Deduplicate (e.g. same ticket in mail + calendar → one ticket item + optional calendar note).

## Two phases per item

Effort and executor tier only mean something for items that will be deepened, so they are not asked until `depth` says so. Phase A runs for every item; Phase B only for `profundizar`. A board of 15 items with 3 to deepen makes 18 calls instead of 15 five-question calls, and the classifier never has to answer a question whose premise is false.

### Phase A — depth, lane, urgency (every item)

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
    "criteria": { "…": "lanes from adapters/lanes.yaml" }
  },
  "urgency": {
    "type": "score",
    "instructions": "Urgency for the user in the current work window",
    "criteria": ["Later", "Today", "First thing / blocking"]
  }
}
```

The `bot` criteria are the host’s lanes, kept in [`adapters/lanes.yaml`](./adapters/lanes.yaml) so the recipe stays generic and the lane list stays yours. Copy that map into the question verbatim.

### Phase B — effort and executor tier (`profundizar` only)

```json
{
  "effort": {
    "type": "choice",
    "instructions": "How deep should the executor go on this item?",
    "criteria": {
      "rapido": "1–2 targeted tool calls; short answer or next-step line",
      "a_fondo": "Full context: ticket/mail/code as needed, concrete plan or draft"
    }
  },
  "executor_tier": {
    "type": "choice",
    "instructions": "Which executor class should the host run? The host maps this to a concrete model (see ORCHESTRATION.md).",
    "criteria": {
      "fast": "Light deepen; short factual next step",
      "default": "Normal deepen with tools",
      "strong": "Hard reasoning, multi-file, or ambiguous client risk"
    }
  }
}
```

Send the same `state` as Phase A. Items that are not `profundizar` get no Phase B and no effort/tier on the board.

`state` for each item: source label + short factual context (who, what, status). Prefer thread/ticket state over isolated messages. **Profundizar** = needs a concrete next action now, not “message is long”.

## Read the confidence, not just the label

Every answer comes with `confidence` and, for `choice`/`score`, `probabilities`. A `depth` of `ignorar` at 0.34 with `profundizar` at 0.33 is not a decision; it is a coin toss with a label on it. The rules below turn the README’s “bias to profundizar” into something a reader can check:

| Signal | Rule |
|--------|------|
| `depth.confidence < 0.60` | Escalate one step: `ignorar` → `anotar`, `anotar` → `profundizar`. |
| `depth.probabilities.profundizar ≥ 0.30` | Never `ignorar`; the floor is `anotar`. |
| `verdict = enviar` and `confidence < 0.70` | Treat as `retocar`. |
| `verdict = no_mandar` | Never downgraded, whatever the confidence. |
| `bot.confidence < 0.50` | Show the lane as tentative; the deepen pass may correct it. |

Escalation only ever moves **toward** doing the work, never away from it. Mark escalated items on the board (e.g. `anotar↑`) so the user can see where the filter was unsure. The thresholds are starting points; tune them after a few boards, and change them in one place (`reference/jev.mjs`).

## Output to the user

1. **Board** — compact table: item, depth, bot, urgency, and for `profundizar` also **effort** and **executor_tier**. Mark escalations.
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

`state` = recipients + purpose + full draft text (and one-line ticket context if any). This is the one call that sends full text off the machine; the pre-authorization view says so.

3. Show **pre-authorization** to the user (widget or connector draft) including Jev verdict and confidence
4. Send only after explicit approve / edit+confirm

## Orchestration

Jev classifies; the **host** routes. See [ORCHESTRATION.md](./ORCHESTRATION.md) for `executor_tier` → model maps (Codex, Claude, Grok, Kimi). Do not replace Jev with another classifier.

## Failure modes

- Missing `TYPESAFE_API_KEY` (or OpenRouter key if that backend is used) → say so; fall back to a short manual board without inventing Jev scores
- Timeout or 5xx after the one retry → that item goes on the board as `profundizar` with a `sin Jev` mark; do not drop it and do not guess its depth
- Answer missing a question, or a label outside the criteria → same as a failed call; never coerce a bad answer into a valid one
- Bad bot label on thin state → correct in the deepen pass; do not re-ask the user
- Never send mail/chat unasked; deepening may draft, not send
- `effort=a_fondo` / `executor_tier=strong` is not permission to hand off to another bot or to send outbound mail
