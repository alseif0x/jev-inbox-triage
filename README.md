# Jev inbox triage

Grok Bot / Cursor **skill**: cheap typed OpenRouter Decisions filter (`typesafe/jev-1.13`) before deep LLM work.

## What it does

- **Board triage** (`dónde estoy` / briefing / tablero): classifies items as `ignorar` | `anotar` | `profundizar`, plus bot lane label, urgency, and effort (`rapido` | `a_fondo`).
- **Pre-send guard**: rates outbound drafts as `enviar` | `retocar` | `no_mandar` — never auto-sends; user always pre-authorizes.

## Secrets

Set `OPENROUTER_API_KEY` in your environment (or your agent secret store). **Do not** commit API keys.

## Install

Copy `SKILL.md` into your agent's workflows folder (or follow your host's skill-install path).

## License

Private / internal unless you choose otherwise.
