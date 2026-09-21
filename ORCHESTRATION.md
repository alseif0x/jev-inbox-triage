# Orchestration: Jev decides → host picks the model

The skill is the **harness** (typed gate + rules). This layer is **orchestration**: after Jev, the host maps `executor_tier` (and `effort`) to a concrete model and only then executes.

```
inbox item (short state)
        │
        ▼
   Jev (classifier)
        │
        ├─ ignorar  → nothing
        ├─ anotar   → one line on the board
        └─ profundizar
              │
              ├─ executor_tier + effort
              ▼
        host router
              │
              ▼
     concrete model / subagent
```

Jev **does not** execute. It only classifies.

## Classifier backends

| Backend | Endpoint | Auth | Model |
|---------|----------|------|-------|
| **TypeSafe native** (preferred) | `POST https://api.typesafe.ai/v1/systemone` | `TYPESAFE_API_KEY` | `jev-latest` |
| OpenRouter Decisions (optional) | OpenRouter Decisions API | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` |

See [adapters/typesafe-native.yaml](./adapters/typesafe-native.yaml) and [docs.typesafe.ai](https://docs.typesafe.ai/introduction).

## Schema field (`profundizar`)

```json
"executor_tier": {
  "type": "choice",
  "instructions": "If depth is profundizar, which executor class should run? If not profundizar, prefer fast.",
  "criteria": {
    "fast": "Short factual next step; light tools",
    "default": "Normal deepen with tools",
    "strong": "Hard reasoning, multi-file, ambiguous client risk"
  }
}
```

Typical combinations:

| depth | effort | executor_tier | Host action |
|-------|--------|---------------|-------------|
| ignorar | — | — | Skip |
| anotar | — | — | One line |
| profundizar | rapido | fast | 1–2 tools, light model |
| profundizar | a_fondo | default | Full context, standard model |
| profundizar | a_fondo | strong | Hard case, stronger model / more budget |

Pre-send does **not** choose a send model: only `enviar|retocar|no_mandar`. The draft is written by the executor that already ran; a human authorizes.

## Host maps (examples)

Replace IDs with ones enabled on your account. The point is the **map**, not the exact slug.

### Codex

```yaml
# adapters/codex.yaml
classifier: typesafe native (jev-latest)
routing:
  fast:    gpt-5.6 luna high
  default: gpt-5.6 luna max
  strong:  astra low
```

```text
verdict = jev.decide(state, schema)   # native or OpenRouter
if verdict.depth != profundizar: board_only(verdict)
else:
  model = map[verdict.executor_tier]
  codex.run(prompt=deepen_prompt(item), model=model, effort=verdict.effort)
```

### Claude

```yaml
# adapters/claude.yaml
classifier: typesafe native (jev-latest)
routing:
  fast:    claude-opus low
  default: claude-opus high
  strong:  claude-fable medium
```

### Grok

```yaml
# adapters/grok.yaml
classifier: typesafe native (jev-latest)
routing:
  fast:    grok-fast
  default: grok
  strong:  grok-reasoning
```

On Grok Bot today, `fast`/`default` are often the same host with different tool depth; `strong` may mean a higher-budget cloud/subagent when available.

### Kimi

```yaml
# adapters/kimi.yaml
classifier: typesafe native (jev-latest)
routing:
  fast:    kimi-fast
  default: kimi
  strong:  kimi-thinking
```

## Rules that do not change

1. Classifier = **Jev** (not another triage model).
2. Never auto-send.
3. `bot` is a lane label, not an automatic handoff.
4. Missing API key → manual board; do not invent scores.
5. Model maps live in the **host/adapter**, not inside Jev.

## How to test

1. Noise item → `ignorar`
2. FYI → `anotar`
3. Ticket with a clear action → `profundizar` + `fast` or `default`
4. Ambiguous / client-sensitive → `strong` + pre-send if there is a draft
