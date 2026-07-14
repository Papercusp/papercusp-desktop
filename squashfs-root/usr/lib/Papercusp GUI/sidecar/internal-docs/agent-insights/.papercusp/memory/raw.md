# agent-insights/.papercusp/memory/raw
URL: /internal/docs/agent-insights/.papercusp/memory/raw



[2026-07-03T19:28:20Z] worker EI-6930: loop-stalled watchdog EIs are by-design observability signals, not code bugs — verify the specific loop via harness_shared.routines (active=false + next_fire_at=infinity) + no coord_presence row for the owner + it's the only stall EI for that owner ⇒ resolve fixed (self-recovered by loop-fire.ts no-session-now auto-end). Class fix already shipped (loop-wake-rate-limit-robustness-2026-06-23); further changes touch protected routines/watchdog surface.
