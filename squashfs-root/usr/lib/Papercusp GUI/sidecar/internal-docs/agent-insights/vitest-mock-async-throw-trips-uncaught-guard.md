# vi.mock + mockRejectedValue/async-throw trips vitest's uncaught-error guard even when the caller catches it — inject the reader instead
URL: /internal/docs/agent-insights/vitest-mock-async-throw-trips-uncaught-guard

In operator-core's vitest setup, driving a vi.mock'd module export (e.g. getFlag) with mockRejectedValue(err) or mockImplementation(async () => { throw }) to exercise a caller's try/catch fails the test as an uncaught error AT THE MOCK SITE — even though the caller genuinely catches it and returns a fallback. A synchronous throwing mockImplementation doesn't fix it either. The reliable pattern is dependency injection: give the function an optional reader/fn param and inject a throwing closure directly in the test, no module mock.

## The mistake this prevents

Testing an error-path in `operator-core` — "the caller must fail open (or
closed) when a dependency throws" — by `vi.mock`-ing the dependency's module
and driving it with `mockRejectedValue(err)` or
`mockImplementation(async () => { throw new Error(...) })` looks like the
obvious approach (it's the standard vitest idiom for "make this call reject").
It doesn't work reliably here: the repo's vitest setup treats the throw as an
**uncaught error at the mock call site**, and fails the test with that error —
even when the calling code has a real `try { … } catch { return fallback }`
around the call and the test's actual assertion (on the fallback value) would
otherwise pass. Switching to a **synchronous** throwing `mockImplementation`
does not fix it either; the guard still fires.

Concretely, this bit `FLAGS.HIVE_SEED_BUNDLE`'s fail-open gate
(`bootstrap-papercusp-pot.ts`): the requirement is "a flags-read hiccup must
never silently force the cold join path" — i.e. a thrown flag-read error
should make the gate behave as if the flag were ON. Mocking
`@papercusp/flags/server`'s `getFlag` to reject cost \~3 failed iterations
chasing the uncaught-error report before switching approach.

## The rule

**Don't module-mock a throwing async dependency to test a caller's catch
block — inject the reader instead.** Give the function under test an optional
parameter for the call it needs to make (defaulted to the real
implementation), and pass a throwing closure directly in the test:

```ts
// bootstrap-papercusp-pot.ts
export async function seedBundleEnabled(
  readFlag: () => Promise<boolean> = () => getFlag(FLAGS.HIVE_SEED_BUNDLE, 'system'),
): Promise<boolean> {
  try {
    return await readFlag();
  } catch {
    return true; // fail OPEN — a flags hiccup never silently forces cold
  }
}
```

```ts
// bootstrap-papercusp-pot-seed-flag.test.ts — no vi.mock at all
it('a flag-read THROW ⇒ fails OPEN (true)', async () => {
  expect(
    await seedBundleEnabled(async () => {
      throw new Error('posthog unreachable');
    }),
  ).toBe(true);
});
```

This is strictly better than the module-mock version even ignoring the guard
issue: no `vi.mock` hoisting, no module-path coupling, and the injected
closure makes the exact failure mode being tested (a rejected/throwing read)
completely explicit at the call site.

## When this applies

* You're testing that a caller correctly handles a dependency **throwing or
  rejecting**, specifically (not just returning an unusual value).
* The dependency is normally reached via a plain top-level import (not already
  behind an injected seam).
* You're in `operator-core` (or any package sharing its vitest config /
  fail-on-console-and-uncaught-error setup).

If the caller already accepts the dependency as a parameter (or the codebase's
`configure*()` seam convention already applies), there's no new work — this is
simply a reason to keep using that seam for error-path tests rather than
reaching for `vi.mock` + `mockRejectedValue`.

## Symptom signature

* The test fails with the mock's thrown `Error` reported as an **uncaught
  error**, pointing at the `mockRejectedValue(...)` / `mockImplementation`
  call site — not at the test's own `expect(...)` assertion, which may never
  even run.
* Switching `mockRejectedValue` → a synchronous throwing
  `mockImplementation(() => { throw ... })` does not change the outcome.
* The calling code's `try/catch` is provably correct (a plain unit test of the
  catch block in isolation, or manual inspection, confirms the fallback logic)
  — the test framework's uncaught-error detection is firing on the mock's
  throw before/around the caller's own catch, not a real bug in the caught
  code.
