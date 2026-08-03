# 002 — Tournament cadence

## Verdict: PARTIAL

A default **8-player, no-rebuy single-table tournament** is structurally viable with 3,000-chip stacks and **7 completed hands per blind level**. In a deterministic, agent-neutral pressure simulation, the recommended schedule finishes in a median **56 hands** (p10–p90: **46–64**) and spends a median **8 hands heads-up** (p90: 18).

That maps to a 45–60 minute median only when Normal pace averages roughly **49–64 seconds per completed hand**. At the working 54-second assumption, median duration is **50.4 minutes**, p10–p90 is **41.4–57.6 minutes**, and 75.7% finish in 45–60 minutes. The structure is therefore validated as a build candidate, not as a precise wall-clock promise. Production telemetry or full-game bot simulations must confirm real hand duration and elimination behavior.

## Question

> Given eight equal, neutral players and an adjustable game pace, when blind levels advance by completed hand count, can River Room usually complete a single-table tournament in 45–60 minutes without rebuys?

The largest risks are (1) Normal pace taking materially less or more than one minute per hand and (2) the actual poker agents eliminating players at a different rate from the pressure model.

## Recommended default

- **Mode:** Tournament (separate from the existing Cash mode)
- **Seats:** 8 fixed starting entrants
- **Starting stack:** 3,000 each (24,000 chips total)
- **Level length:** 7 **completed** hands; a resumed or partially dealt hand never advances the counter twice
- **Rebuys/add-ons:** None
- **Ante:** Standard per-player ante begins at Level 3 / Hand 15
- **Heads-up:** Button posts small blind and acts first preflop; big blind acts first postflop
- **Blind cap:** Continue the last listed level if an extreme outlier passes Hand 84; do not terminate by timer or chip chop

| Level | Completed-hand range | SB / BB | Ante | Starting average stack in BB |
|---:|---:|---:|---:|---:|
| 1 | 1–7 | 25 / 50 | — | 60.0 |
| 2 | 8–14 | 50 / 100 | — | 30.0 |
| 3 | 15–21 | 75 / 150 | 25 | 20.0 |
| 4 | 22–28 | 100 / 200 | 25 | 15.0 |
| 5 | 29–35 | 150 / 300 | 50 | 10.0 |
| 6 | 36–42 | 200 / 400 | 50 | 7.5 |
| 7 | 43–49 | 300 / 600 | 75 | 5.0 |
| 8 | 50–56 | 400 / 800 | 100 | 3.75 |
| 9 | 57–63 | 600 / 1,200 | 200 | 2.5 |
| 10 | 64–70 | 800 / 1,600 | 200 | 1.88 |
| 11 | 71–77 | 1,000 / 2,000 | 300 | 1.5 |
| 12 | 78–84+ | 1,500 / 3,000 | 500 | 1.0 |

“Starting average stack” is only a schedule-pressure reference (`3,000 / BB`), not the average stack of survivors later in the event.

### Why 7 hands rather than a clock

River Room exposes Normal/Fast/Instant pacing and human decision time is variable. A wall-clock level would change the number of poker decisions per level when pace changes, and could raise blinds during a paused or resumed hand. Seven settled hands gives identical game structure at every pace; only elapsed duration changes.

## Simulation

`simulate.py` is a seeded cadence model, not a hold'em engine:

1. Eight equal 3,000-chip stacks rotate button, blinds, and antes.
2. Neutral players enter pots with the same pressure-based probability; short stacks enter and shove more often.
3. Contested amounts scale with the current big blind and a bounded aggression multiplier.
4. Every participant has equal expected winning strength—there are no cards, personas, seats, or skill edges.
5. Chips are conserved after every hand, stacks cannot go negative, and zero stacks are eliminated with no rebuy.
6. The tournament runs until one stack owns the table; seeds make every run reproducible.

This abstraction is useful for schedule pressure and sensitivity. It does **not** model side-pot equity, range quality, human skill, actual River Room action timing, or correlations in the production agents. Its percentile outputs should be treated as engineering bands, not forecasts.

### Reproduce

```bash
cd spikes/002-tournament-cadence
python3 validate.py
python3 simulate.py --tournaments 20000 --hands-per-level 7 --aggression 1.0 --pretty
```

Fixed seed: `20260802`; 20,000 tournaments per scenario.

## Results

| Elimination behavior | Multiplier | Median hands | p10–p90 | Heads-up median / p90 | Completion by 180 hands |
|---|---:|---:|---:|---:|---:|
| Cautious | 0.8× | 60 | 51–68 | 7 / 17 | 100% |
| Baseline | 1.0× | 56 | 46–64 | 8 / 18 | 100% |
| Aggressive | 1.2× | 52 | 42–61 | 8 / 19 | 100% |

The ±20% elimination sensitivity moves the median by only four hands in either direction. That is encouraging, but it is partly a consequence of the escalating forced bets and should be checked against the real agents.

### Baseline elapsed-time sensitivity

| Mean completed-hand duration | Median tournament | p10–p90 | Finish in 45–60 min |
|---:|---:|---:|---:|
| 42 sec | 39.2 min | 32.2–44.8 | 9.7% |
| 48 sec | 44.8 min | 36.8–51.2 | 47.9% |
| 54 sec | 50.4 min | 41.4–57.6 | 75.7% |
| 60 sec | 56.0 min | 46.0–64.0 | 71.0% |

Duration is a direct hand-count conversion, intentionally separated from elimination simulation. The current released UI's Normal bot delays alone do not establish completed-hand duration because street count and human decision time dominate it.

## UI and state requirements

### Mode separation

- Setup must require an explicit **Cash / Tournament** choice; preserve current cash stacks, $5/$10 blinds, rebuy behavior, session profit, and cash persistence under Cash only.
- Tournament setup shows the fixed “8 players · 3,000 chips · 7 hands/level · no rebuys” summary before start.
- Never load a Cash save into Tournament or vice versa. Use a mode-keyed save or distinct storage keys and a schema version.

### Persistent tournament header

Show, without opening a panel:

- `Tournament · 8 players` and players remaining
- Current `SB / BB / ante`
- `Hand X` and `Y / 7` hands completed in the level
- Next level preview, e.g. `Next: 100 / 200 + 25 in 2 hands`
- Hero place once eliminated; champion/result state once complete

Pace remains an independent display/runtime control. Changing pace must not change stacks, blinds, level progress, or hand number.

### Required result states

1. **HAND_ACTIVE** — normal betting state.
2. **HAND_RESULT** — awards are settled and persisted; this is the single point that increments `completedHands` and may advance the level.
3. **HERO_BUSTED** — no rebuy CTA. Show finishing place, final hand summary, and `Watch tournament` / `New tournament` / `Return to menu`. If watching, continue bots with hero as spectator.
4. **TOURNAMENT_COMPLETE** — winner, finishing order, hands played, elapsed active time (informational only), and `Play again` / `Return to menu`.
5. **RESUMABLE** — setup card identifies Tournament, players remaining, level/blinds, and hand. Resume the exact current hand or exact settled result; never silently deal a new hand.

If multiple players bust in one hand, assign places using the production poker rule selected for equal-hand busts (recommended: smaller stack at hand start finishes lower; equal stacks tie by deterministic clockwise order) and persist the resolved order. The pressure script's simultaneous-bust ordering is merely deterministic test scaffolding, not a product rule.

### Minimum persisted shape

- `schemaVersion`, `mode: "tournament"`, `tournamentId`, `status`
- immutable config: entrants, starting stack, hands per level, full blind schedule, no-rebuy flag
- `handNumber`, `completedHands`, `levelIndex`, `handsCompletedInLevel`
- players: stable id/seat, stack, active/eliminated, finish place and bust hand
- dealer/button seat and all current-hand engine state (deck/board, pot/side pots, contributions, street, turn, pending actions, all-in/folded flags)
- settled awards and latest hand result, finishing order, winner
- pace preference separately; timestamps may support elapsed-time display but must not drive levels

Persist atomically after every accepted action, after settlement, after elimination ordering, and after tournament completion. On load, validate: chip total equals 24,000 across stacks + committed pots, exactly one winner only in complete state, no eliminated player has chips, and level counters agree with `completedHands // 7` (except the capped final level).

## Testable acceptance bands

### Structural acceptance (deterministic simulation)

- 20,000 baseline runs, fixed seed: **100% completion by 180 hands**.
- Baseline median: **52–62 hands**; p90: **≤72 hands**.
- 0.8× and 1.2× aggression scenarios: median remains **48–65 hands**, completion **≥99.9%**.
- Median heads-up segment: **5–12 hands**; p90 **≤22 hands**.
- Every simulated hand conserves exactly 24,000 chips and produces no negative stack.

The included `validate.py` enforces the core deterministic, conservation, completion, and baseline bands.

### Product acceptance (must be measured in the real game)

- Normal pace median completed-hand duration over at least 200 automated/full-table hands: **49–64 seconds**. If outside this band, retune **hands per level**, not timer delays or mid-event blinds.
- Across at least 500 seeded bot tournaments: median elapsed duration **45–60 minutes**, p90 **≤70 minutes**, and at least **65%** finish in 45–60 minutes.
- Median tournament hand count **52–62**, p90 **≤72**, and median heads-up **5–12 hands**.
- Reload tests at HAND_ACTIVE, HAND_RESULT, HERO_BUSTED, and TOURNAMENT_COMPLETE preserve chips, blind level, hand counter, place, and exact CTA state.
- Cash regression: existing cash session can resume, bust/rebuy, and report profit without reading or mutating tournament state.

If real Normal pace is around 42 seconds per hand, this schedule will feel too short (~39-minute median). The clean adjustment is 8–9 hands per level after telemetry, not slowing animations solely to hit a clock.

## What worked

- Seven-hand levels place the baseline median at Hand 56, near the end of Level 8.
- Forced-bet escalation keeps cautious and aggressive elimination sensitivities within an eight-hand median spread.
- Heads-up is long enough to register as a final phase without dominating the event.

## What did not establish certainty

- No current production measurement proves the Normal completed-hand duration.
- The pressure model cannot validate actual River Room agent strategy, side pots, or human think time.
- “45–60 minutes” cannot honestly be guaranteed for every tournament; variance is inherent.

## Recommendation for the real build

Implement this schedule behind a separate Tournament mode, instrument completed-hand elapsed time and elimination milestones, and run the product acceptance suite before calling the duration target validated. Keep the schedule hand-count-based and adjust only `handsPerLevel` from telemetry unless real-game elimination medians materially miss the 52–62 hand band.
