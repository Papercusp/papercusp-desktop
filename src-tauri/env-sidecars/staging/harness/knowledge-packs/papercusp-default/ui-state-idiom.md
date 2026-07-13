---
title: Follow the project's UI state idiom
kind: feedback
applies_to: [ui]
---

Before adding state, discover where this project keeps it — URL parameters, a store, component state — and what each is used for. Putting state in the wrong layer (e.g. local state for something shareable via URL) is a structural bug that works in the demo and fails in real use.
