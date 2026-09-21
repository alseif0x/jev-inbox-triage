# Jev inbox triage

Skill para Grok Bot / Cursor: **Jev** (`typesafe/jev-1.13` vía OpenRouter Decisions) actúa como **prefiltro tipado** antes de gastar el agente caro.

La skill no ejecuta trabajo. Solo decide **profundidad** (y, en borradores, si está listo para enviar).

## Qué hace exactamente

### 1. Triage del tablero

Cuando pides *dónde estoy* / briefing / tablero:

1. El agente host recoge ~8–15 ítems recientes (Calendar, Gmail work, Chat, Odoo, PRs opcionales), a nivel de hilo/ticket.
2. Por cada uno manda a **Jev** un `state` corto (quién, qué, estado) + un schema tipado.
3. Jev responde:
   - `depth`: `ignorar` | `anotar` | `profundizar`
   - `bot`: label de lane (orientación; **sin** handoff automático)
   - `urgency`
   - si profundiza: `effort` → `rapido` | `a_fondo`
4. El host muestra el tablero y **solo abre tools/contexto** en `profundizar`, respetando el effort.

### 2. Pre-send (mail / Chat)

1. El host redacta el draft.
2. Jev valora: `enviar` | `retocar` | `no_mandar` (+ riesgo + si falta info).
3. Se muestra el veredicto al usuario.
4. **Nunca** auto-send: solo se manda tras autorización explícita.

## Qué no hace

- No sustituye al agente principal.
- No lanza subagentes solo.
- No manda mensajes.
- No ve el inbox completo: solo `state` corto por ítem.

## Por qué barato-primero

Objetivo: no mandar al modelo caro ruido, FYIs o cosas sin acción ahora.

Riesgo (el de “¿y si el barato se equivoca?”): se mitiga con state factual corto, sesgo a `profundizar` cuando hay acción concreta, tablero visible, y humano en cualquier send.

La inversa (agente caro todo → Jev solo decide si escalar) también es válida; esta skill implementa el prefiltro barato.

## Orquestación (modelo concreto)

Tras `profundizar`, Jev también puede devolver `executor_tier`: `fast` | `default` | `strong`.

Eso **no** lo ejecuta Jev: el host lo mapea a un modelo (Codex / Claude / Grok / Kimi). Detalle y ejemplos: [ORCHESTRATION.md](./ORCHESTRATION.md).

## Secrets

```bash
export OPENROUTER_API_KEY=...   # nunca lo commits
```

## Install

Copia `SKILL.md` a la carpeta de workflows/skills de tu agente.

## Archivos

- `SKILL.md` — receta operativa (schemas + reglas)
- `ORCHESTRATION.md` — router Jev → modelo (ejemplos Codex/Claude/Grok/Kimi)
- `README.md` — este overview

## License

Private / internal unless you choose otherwise.
