# Orquestación: Jev decide → el host elige modelo

La skill es el **harness** (gate tipado + reglas). Esta capa es **orquestación**: tras Jev, el host mapea `executor_tier` (y `effort`) a un modelo concreto y solo entonces ejecuta.

```
inbox item (state corto)
        │
        ▼
   Jev (clasificador)
        │
        ├─ ignorar  → nada
        ├─ anotar   → una línea en el tablero
        └─ profundizar
              │
              ├─ executor_tier + effort
              ▼
        router del host
              │
              ▼
     modelo / subagente concreto
```

Jev **no** ejecuta. Solo clasifica.

## Campo nuevo en el schema (`profundizar`)

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

Combinación típica:

| depth        | effort   | executor_tier | Qué hace el host                          |
|--------------|----------|---------------|-------------------------------------------|
| ignorar      | —        | —             | Omitir                                    |
| anotar       | —        | —             | Una línea                                 |
| profundizar  | rapido   | fast          | 1–2 tools, modelo ligero                  |
| profundizar  | a_fondo  | default       | Contexto completo, modelo estándar        |
| profundizar  | a_fondo  | strong        | Caso duro, modelo más capaz / más budget  |

Pre-send **no** elige modelo de envío: solo `enviar|retocar|no_mandar`. El draft lo escribe el executor que ya corría; el humano autoriza.

## Ejemplos de mapa por host

Sustituye los IDs por los que tu cuenta tenga habilitados. La idea es el **mapa**, no el slug exacto.

### Codex (OpenAI Codex CLI / agente)

```yaml
# adapters/codex.yaml
classifier: typesafe/jev-1.13   # OpenRouter Decisions — fijo
routing:
  fast:    gpt-5.6 luna high   # lane rápida Codex
  default: gpt-5.6 luna max    # turno normal del agente
  strong:  astra low           # máximo / reasoning lane
```

Pseudocódigo:

```text
verdict = jev.decide(state, schema)
if verdict.depth != profundizar: board_only(verdict)
else:
  model = map[verdict.executor_tier]
  codex.run(prompt=deepen_prompt(item), model=model, effort=verdict.effort)
```

### Claude (Claude Code / Agent SDK)

```yaml
# adapters/claude.yaml
classifier: typesafe/jev-1.13
routing:
  fast:    claude-opus LOW     # lane rápida del host
  default: claude-opus high    # default del proyecto
  strong:  claude-fable medium # máximo razonamiento
```

```text
verdict = jev.decide(...)
if profundizar:
  Task/subagent(model=map[tier], prompt=..., max_turns=effort_to_turns(effort))
```

### Grok (Grok Bot / xAI)

```yaml
# adapters/grok.yaml
classifier: typesafe/jev-1.13
routing:
  fast:    grok-fast           # o el modelo ligero disponible en el host
  default: grok                # agente principal (Master)
  strong:  grok-reasoning      # o cloud agent con más budget
```

En Grok Bot hoy: `fast/default` suelen ser el mismo host con distinto **effort de tools**; `strong` puede ser un cloud agent / subagente con más presupuesto. El mapa documenta la intención aunque el runtime no cambie de pesos cada vez.

### Kimi (Moonshot)

```yaml
# adapters/kimi.yaml
classifier: typesafe/jev-1.13
routing:
  fast:    kimi-fast
  default: kimi
  strong:  kimi-thinking       # lane con más reasoning si el producto lo expone
```

Misma forma: Jev → tier → `kimi.run(model=...)`.

## Reglas que no cambian

1. Clasificador = **Jev** (no otro modelo de triage).
2. Nunca auto-send.
3. `bot` es label de lane, no handoff automático.
4. Si falta `OPENROUTER_API_KEY`, tablero manual sin inventar scores.
5. El mapa de modelos vive en el **host/adapter**, no hardcodeado en Jev.

## Cómo probar

1. Un ítem ruido → `ignorar`.
2. Un FYI → `anotar`.
3. Un ticket con acción clara → `profundizar` + `fast` o `default`.
4. Un caso ambiguo/cliente → `strong` + pre-send si hay draft.
