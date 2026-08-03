# Spike 004 — heads-up blind-fold telemetry

## Verdict: PARTIAL (current blind policy credible; stack response too flat)

The current extracted RiverCore no longer has the catastrophic heads-up blind-fold leak found at the start of this investigation. Its current heads-up population is approximately **60% SB raise / 28% limp / 12% open-fold**, while the BB responds to a button open with approximately **39% fold / 14% 3-bet / 47% call**. Those are credible strong-recreational heads-up frequencies and eliminate the former repeated blind-walk feel.

The remaining realism defect is that these frequencies are essentially unchanged from **5 through 60 BB**. The current policy has a fixed `HU_SB` target and explicitly bypasses the `<40 BB` adjustment for two-player nodes. At 5–15 BB, the raise/limp/jam and BB reshove/call mix should visibly change even if overall VPIP remains wide.

## Method and scope

- Both harnesses extract and execute the exact `RiverCore` seam from `../../index.html` at runtime. Current core SHA-256: `4752b94934c65e9071f31386448320621a915e758b3d946b0b9ec6149609fe8d`.
- Standard heads-up order is enforced: **button posts SB and acts first preflop; BB acts first postflop**.
- Five shipped styles (`pressure`, `balanced`, `value`, `trap`, `nit`) are tested in all 25 ordered matchups, so every persona occupies both SB/button and BB against every persona.
- Stable preflop run: **120,000 hands** total (60,000 current corrected HU context plus 60,000 legacy-context counterfactual), 400 deterministic seeds per ordered pair. Each persona/stack/role has 2,000 observations.
- Complete-hand run: **300 current-context hands**, 1,519 actions. This is sufficient for engine/information-boundary verification and descriptive street shape, but persona-level showdown/street percentages are intentionally not treated as stable because RiverCore's weighted postflop equity path makes a large full-hand grid expensive.
- Raw per-persona/per-stack results are retained in `preflop-results.json`; complete-hand results are in `results.json`.

## Current preflop telemetry by persona and stack

`SB fold/walk` is an immediate fold after posting the SB. BB rates are conditional on facing an SB open raise.

| Stack | Persona | SB raise | limp | fold/walk | BB fold/open | 3bet | call |
|---:|---|---:|---:|---:|---:|---:|---:|
| 5 | pressure | 61.5% | 27.9% | 10.6% | 38.52% | 14.62% | 46.86% |
| 5 | balanced | 65.1% | 23.55% | 11.35% | 37.87% | 14.34% | 47.79% |
| 5 | value | 60.7% | 27.6% | 11.7% | 44.35% | 11.13% | 44.52% |
| 5 | trap | 59.55% | 28.9% | 11.55% | 37.79% | 14.8% | 47.41% |
| 5 | nit | 56.8% | 28.65% | 14.55% | 41.09% | 13.14% | 45.76% |
| 10 | pressure | 62.85% | 26.1% | 11.05% | 37.49% | 16.32% | 46.19% |
| 10 | balanced | 58.95% | 30.1% | 10.95% | 39.73% | 13.54% | 46.74% |
| 10 | value | 56.75% | 29% | 14.25% | 41.29% | 11.89% | 46.82% |
| 10 | trap | 61.65% | 27.05% | 11.3% | 42.05% | 15.32% | 42.63% |
| 10 | nit | 60.6% | 25.35% | 14.05% | 42.32% | 12.69% | 44.99% |
| 15 | pressure | 60.8% | 28.35% | 10.85% | 35.77% | 15.82% | 48.41% |
| 15 | balanced | 62.25% | 25.95% | 11.8% | 36.39% | 14.9% | 48.71% |
| 15 | value | 60.85% | 26.3% | 12.85% | 38.25% | 11.18% | 50.57% |
| 15 | trap | 61.15% | 28.2% | 10.65% | 38.16% | 14.16% | 47.68% |
| 15 | nit | 59.05% | 27.6% | 13.35% | 41.44% | 10.95% | 47.61% |
| 25 | pressure | 63% | 26.65% | 10.35% | 37.1% | 13.69% | 49.22% |
| 25 | balanced | 60.4% | 27.85% | 11.75% | 37.52% | 14.18% | 48.3% |
| 25 | value | 62.4% | 24.1% | 13.5% | 38.77% | 12.59% | 48.64% |
| 25 | trap | 59.85% | 28.45% | 11.7% | 36.91% | 15.93% | 47.16% |
| 25 | nit | 58.55% | 26.95% | 14.5% | 41.52% | 10.23% | 48.25% |
| 40 | pressure | 60.75% | 28.9% | 10.35% | 36.09% | 15.29% | 48.62% |
| 40 | balanced | 62.15% | 25.15% | 12.7% | 39.39% | 14.69% | 45.93% |
| 40 | value | 56.75% | 30.3% | 12.95% | 41.38% | 13.94% | 44.69% |
| 40 | trap | 58.35% | 29.45% | 12.2% | 35.49% | 13.47% | 51.04% |
| 40 | nit | 58.95% | 26.45% | 14.6% | 38.33% | 11.29% | 50.37% |
| 60 | pressure | 60.2% | 29% | 10.8% | 37.12% | 14.85% | 48.03% |
| 60 | balanced | 57.35% | 31.25% | 11.4% | 38.19% | 14.83% | 46.98% |
| 60 | value | 59.85% | 28.05% | 12.1% | 41.37% | 9.77% | 48.86% |
| 60 | trap | 60.7% | 28.2% | 11.1% | 40.31% | 12.25% | 47.45% |
| 60 | nit | 57.45% | 28.3% | 14.25% | 43.78% | 11.68% | 44.54% |

Persona ordering is coherent but restrained: pressure is widest/most aggressive, nit and value fold more and 3-bet less, while trap retains a high call/limp component. The differences do not become caricatures.

## Blind-only sequences

Across 10,000 current-context preflop hands per stack (partitioned into 25 ordered 400-hand matchup sequences):

| Stack | walk rate | longest run | runs of 3+ | runs of 5+ |
|---:|---:|---:|---:|---:|
| 5 | 11.9% | 3 | 2 | 0 |
| 10 | 12.3% | 2 | 0 | 0 |
| 15 | 11.9% | 2 | 0 | 0 |
| 25 | 12.4% | 3 | 1 | 0 |
| 40 | 12.6% | 3 | 2 | 0 |
| 60 | 11.9% | 2 | 0 | 0 |

This is a substantial improvement over the old roughly coin-flip walk behavior. Consecutive blind-only hands are now uncommon and no five-hand sequence occurred.

## Complete-hand street shape (descriptive)

These are stack-level aggregates from only 50 current-context complete hands per stack; use them as a smoke test, not a population estimate.

| Stack | Walk | Showdown | Flop | Turn | River | Mean completed streets |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 4.0% | 28.0% | 52.0% | 46.0% | 32.0% | 1.30 |
| 10 | 10.0% | 30.0% | 60.0% | 54.0% | 32.0% | 1.46 |
| 15 | 20.0% | 12.0% | 34.0% | 34.0% | 24.0% | 0.92 |
| 25 | 12.0% | 40.0% | 66.0% | 62.0% | 54.0% | 1.82 |
| 40 | 10.0% | 28.0% | 52.0% | 42.0% | 36.0% | 1.30 |
| 60 | 8.0% | 30.0% | 62.0% | 58.0% | 40.0% | 1.60 |

The non-monotonic noise (especially 15 BB) demonstrates why these postflop figures should not be used as balance claims. Exact persona/stack smoke-test rows remain in `results.json`.

## Root cause trace

### Original leak observed at investigation start

The source changed concurrently while this read-only spike was running. The first extracted core had SHA-256 `94430399496b60ebd89872983a7162f3994c6a84e977d074b5d54c684ffee511`; the final source has the current hash above. The initial behavior and source seams made the cause unambiguous:

1. **Wrong live position at two players.** `tablePosition(i)` used the original eight-seat distance. The dealer was BTN, but the actual BB could be labeled `SB`, `BB`, `UTG`, `MP`, `HJ`, or `CO` depending on eliminated-seat gaps. Because `ctx.positionName` was explicitly supplied, RiverCore's fallback `positionName(ctx)` and correct `tableSize: 2` could not repair it.
2. **Wrong `nodeTarget` as a consequence.** A correctly labeled BB versus BTN used a 46% continue target in the old core. Mislabels selected 27% (`SB`), 24% (`CO`) or 16% (early/middle) targets. With the old geometry reproduced under the current policy, BB fold-to-open rises from roughly **39% to 75%**, isolating the position-description effect.
3. **No heads-up SB node or limp band.** The old button/SB was treated as six-max `RFI` with a 45% target. In `decideAction`, every continuing RFI hand raised and every non-continuing hand folded because the posted SB still had `toCall > 0`. The initial measured result was roughly **45–54% raise, 0% limp, 46–56% immediate fold/walk** depending on stack.
4. **Short-stack tightening amplified it.** The old `effectiveStack < 40` branch multiplied every non-RFI target by `.82`. Forced blind deductions meant even a nominal 40 BB hand could enter decisions below 40 BB. This tightened the already-wrong BB target at 5/10/15/25 and often 40 BB.
5. **Action order was not the cause.** `tournamentPositions` already returned dealer=SB=preflop-first and BB=postflop-first. The defect was the policy context, not dealing/order.

### Current source behavior

The current source now:

- special-cases live two-player tournament positions as BTN/BB;
- introduces `HU_SB` with 88% continue and 60% raise targets, creating a real limp band;
- uses a two-player BB-vs-open target of 62% and 14% raise target;
- exempts two-player nodes from the generic shallow-stack `.82` tightening.

The live bot context now correctly supplies `tableSize: 2`, `positionName: BTN/BB`, BTN opener position, standard action order, and a public-only effective stack. The normalized numeric metric still reflects the eight-seat shell, but the explicit name and `inPosition` boolean used by policy are correct in heads-up play.

## Integrity checks

- Applied illegal actions: **0**
- Stalls: **0**
- Chip-conservation failures: **0**
- Complete-hand public decision views: **1,519**
- Hidden-information reads: **0**
- Counterfactual checks (same public context after perturbing hidden opponent/deck data): **1,000**, all identical
- Live-wrapper legal fallbacks: **10** (invalid/unavailable policy proposals were safely converted through the production call/check fallback; no illegal mutation reached `applyAction`)
- Final production QA: `node qa-tests.js` → **All Pokerspace QA tests passed**

Decision contexts contain own hole cards and public board/action/price/stack/range metadata only. They contain no deck, opponent hole cards, folded cards, spectator state, or future randomness.

## Minimal recommended policy changes

1. **Do not loosen the current aggregate ranges further.** The catastrophic overfold has already been corrected; current walk, limp, defense and 3-bet rates are credible.
2. **Add heads-up stack buckets, not another blanket multiplier.** Keep total SB VPIP broad, but use explicit 5–10, 11–20, 21–40 and 40+ BB targets/sizes for SB raise-vs-limp and BB 3-bet/reshove-vs-call. The current near-identical 5–60 BB rows are the clearest remaining realism miss.
3. **Make sizing shallow-aware.** A universal 2.3 BB HU open plus ordinary 3-bet multiplier is not enough at 5–15 BB. Add legal mixed limp/minraise/jam and BB check/raise/jam behavior, tested as distributions rather than exact single actions.
4. **Keep the current two-player context assertions as release gates.** Explicitly assert BTN=SB, defender=BB, opener=BTN, preflop/postflop first actor, and no shallow generic tightening for every possible eliminated-seat gap.
5. **Retain this fast 120k preflop population test in QA.** Gate each persona/stack on SB fold/limp/raise, BB fold/call/3-bet, and consecutive-walk tails. Run a separate smaller complete-hand invariant smoke test; do not make release depend on a prohibitively large exact-equity postflop grid.

## Reproduction

```text
node --check spikes/004-heads-up-telemetry/preflop-telemetry.js
node spikes/004-heads-up-telemetry/preflop-telemetry.js --samples-per-pair 400 --seed 20260802
node --check spikes/004-heads-up-telemetry/heads-up-telemetry.js
node spikes/004-heads-up-telemetry/heads-up-telemetry.js --corrected-only --blocks 2 --hands-per-block 1 --seed 20260802
node qa-tests.js
```

## Files

- `heads-up-telemetry.js` — exact-core complete-hand harness with current and legacy-context modes
- `preflop-telemetry.js` — stable 120k blind population harness
- `preflop-results.json` — all persona/stack/role preflop metrics and walk sequences
- `results.json` — current-context complete-hand smoke telemetry
- `legacy-context-complete-results.json` — legacy-position complete-hand diagnostic run
- `run-output.txt` — retained interrupted oversized-run output (empty; see limitations)

## Limitations

- Complete postflop frequencies are deliberately labeled descriptive; 300 hands are not enough for stable persona-by-stack showdown estimates.
- The legacy counterfactual uses the current RiverCore with the old eight-seat position labeling, isolating the context bug but not recreating every byte of the initial core. The initial-core hash and observed old SB frequencies are recorded above because the production source changed concurrently.
- No solver was used as ground truth. The realism verdict compares broad heads-up population shape and internal stack sensitivity, not GTO accuracy.
