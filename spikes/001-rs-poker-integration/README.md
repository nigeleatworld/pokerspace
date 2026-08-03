# Spike 001 — rs-poker as River Room's engine/AI foundation

**Date tested:** 2026-08-02  
**Target:** fully offline browser game, ideally one HTML file; 6/7/8-handed NLHE; legal and challenging bots  
**Upstream:** <https://github.com/elliottneilclark/rs-poker>

## Executive decision

`rs-poker` 5.0.0 is a credible **native Rust poker simulator/evaluator** and its core evaluator can be wrapped as small WASM. It is **not a drop-in browser engine or a validated challenging-bot foundation** for River Room:

- the `arena`/CFR feature does not build for `wasm32-unknown-unknown` at the tested commit;
- it has no JavaScript/WASM API;
- the default CFR estimator explicitly uses opponents' true hole cards;
- the public `Agent` boundary receives the full `GameState`, including every hand;
- the non-cheating built-in alternative is uniform random ranges, not an opponent model;
- a nontrivial 8-seat CFR probe used about **150 MB RSS**, built **429,235 tree nodes in one hand**, and exceeded the nominal 100 ms action deadline at wave boundaries (p95/max **334.839 ms** in the observed hand);
- the upstream docs call arena “experimental,” and no test/benchmark establishes that these bots are challenging.

Use rs-poker only behind a **narrow evaluator seam** if desired. Do not adopt its arena/CFR layer as River Room's browser gameplay/AI foundation without owning a substantial fork.

## Pinned source and license

Fresh clone and remote HEAD agreed:

```sh
rm -rf /tmp/rs-poker-river-room-spike
git clone https://github.com/elliottneilclark/rs-poker /tmp/rs-poker-river-room-spike
git -C /tmp/rs-poker-river-room-spike rev-parse HEAD
git ls-remote https://github.com/elliottneilclark/rs-poker HEAD
git -C /tmp/rs-poker-river-room-spike log -1 --format='%cI %s'
```

Observed:

```text
c9fff5de185ece2c148e6bd84c552b3ac93ec060
c9fff5de185ece2c148e6bd84c552b3ac93ec060 HEAD
2026-06-09T14:20:30-05:00 chore: Release rs_poker version 5.0.0
```

`Cargo.toml` says `version = "5.0.0"` and `license = "Apache-2.0"`. The repository has the full Apache 2.0 text in `LICENSE`; no `NOTICE` file was present. Observed checksums:

```text
Cargo.toml at HEAD: 068c24dbaa7a52a9aa8d364ce8c9b8a2f031710fe1c8058ca1bb7dfc6c90654f
LICENSE:            b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1
```

### Licensing implication

Apache-2.0 is permissive and compatible with distributing a commercial/offline browser game. Distribution must include a copy of the license, retain applicable notices, and mark modified upstream files prominently. Apache 2.0 also includes an express patent grant and patent-termination clause. There is no copyleft requirement to publish River Room's own source. For a one-file build, include the Apache text/attribution in an accessible licenses panel or embedded license section. This is an engineering reading, not legal advice.

## Capability findings

### Hold'em engine and table size — validated natively

- `GameStateBuilder` accepts 2 through 16 players (`MAX_PLAYERS = 16`), so 6/7/8 seats are structurally supported.
- `HoldemSimulation` deals cards, calls agents asynchronously, validates/applies actions, advances streets, and pays pots.
- `ConfigurableActionGenerator` offers call/check, minimum-raise multiples, pot multiples, setup shove, and all-in; returned actions are passed through validation.
- The action API is `f32` chip amounts. River Room should avoid fractional/rounding drift by mapping integer UI chips carefully if this layer were ever adopted.

The native probe ran a complete 8-player hand using configurable CFR agents and a complete 8-player `SingleTableTournament` using built-in random agent generators.

### `SingleTableTournament` — present and exercised

`src/arena/competition/tournament.rs` contains `SingleTableTournamentBuilder` and `SingleTableTournament::run()`. It repeatedly creates a `HoldemSimulation`, carries stacks forward, rotates the dealer, assigns bust-out places, and runs until one stack remains. It does **not** implement escalating blind levels, scheduled levels, rebuy rules, payout logic, or tournament breaks; blinds/ante remain those in the starting state.

Observed 8-player probe output:

```text
eight-player tournament places=[4, 1, 5, 8, 2, 7, 6, 3] rounds=27 wall_ms=0.124
```

This proves the built-in tournament path executes at eight seats, not that random agents or fixed blinds make a good River Room tournament.

### CFRAgent API — usable in Rust, not JS

Construction requires shared `CFRState`, `TraversalSet`, seat index, action-generator config, and optionally a `Budget`, estimator, and limiter:

```rust
CFRAgentBuilder::<ConfigurableActionGenerator>::new()
    .name("bot")
    .player_idx(seat)
    .cfr_state(cfr_state.clone())
    .traversal_set(traversal_set.clone())
    .action_gen_config(ConfigurableActionConfig::default())
    .estimator(Arc::new(UniformRandomEstimator))
    .budget(budget)
    .build()
```

`Agent::act` is async and receives `&GameState`; it explores actions, updates shared regrets, and samples a legal action. There are no `wasm-bindgen` exports, C ABI functions, serialized command API, TypeScript definitions, or browser runtime adapter upstream.

The fallback budget is only a 100 ms deadline, five root iterations, width one, and no recursion past depth zero. That is bounded but not evidence of strong play. The probe used the repository's richer example shape: deadline 100 ms, iterations `[24,3,1]`, and widths `[8,1,1]`.

### Public-only information boundary — invalid by default, partial with customization

The stock setup is not suitable for a fair bot boundary:

1. `GameState` publicly exposes `hands` for all seats (`game_state.rs:598-620`).
2. `Agent::act` receives that full state.
3. `CFRAgentBuilder` defaults to `KnownHandsEstimator`.
4. `KnownHandsEstimator` explicitly converts each opponent's true hole cards into a point-mass distribution (`hand_estimator/estimators.rs:31-55`).

`UniformRandomEstimator` is a useful no-cheat baseline for active opponents: it generates all 1,326 hole-card combos and `sample_world` re-deals each live opponent while preserving hero cards and board. The CFR tests exercised this path successfully. However:

- it ignores action history and opponent tendencies, so it is not a challenging range model;
- the estimator still receives the full state and therefore the API does not enforce information hiding;
- `sample_world` treats cards held by non-resampled seats (including folded/no-range seats) as dead, so hidden folded cards can still affect sampling;
- a custom `HandDistributionEstimator` can use the action log, but River Room would have to implement, test, and calibrate that model.

Conclusion: a developer can configure CFRAgent to avoid directly pinning live opponents' cards, but rs-poker does **not** provide a strict public-information-only agent API.

## Actual tests

Toolchain used:

```text
rustc 1.99.0-nightly (ad3d0bc14 2026-07-31)
cargo 1.99.0-nightly (7c83d4cc0 2026-07-29)
```

Commands run in the clean upstream clone:

```sh
cargo +nightly test --lib arena::competition::tournament::tests -- --nocapture
cargo +nightly test --lib arena::hand_estimator -- --nocapture
cargo +nightly test --lib arena::cfr -- --nocapture
```

Observed summaries:

```text
tournament: 2 passed; 0 failed; 1017 filtered out
estimators: 12 passed; 0 failed; 1007 filtered out
CFR:        231 passed; 0 failed; 788 filtered out; finished in 59.58s
```

The CFR set included action generation/validation, budgets, node arena, configurable actions, uniform estimator exploration, deadlines, mixed CFR/non-CFR play, heads-up simulations, and strategy assertions. These are meaningful implementation tests, but they do not measure exploitability or strength against competent poker bots/humans.

## Native probe: evaluator, 8-seat CFR, and tournament

Source: [`src/main.rs`](src/main.rs). Dependency is pinned by full Git revision in [`Cargo.toml`](Cargo.toml).

```sh
cd /Users/mrb/Playground/river-room-poker/spikes/001-rs-poker-integration
cargo +nightly build --release
/usr/bin/time -l ./target/release/rs-poker-river-room-probe
stat -f 'native_bytes=%z' ./target/release/rs-poker-river-room-probe
```

Observed final run:

```text
evaluator seven-card category=StraightFlush
eight-player one-hand actions=11 wall_ms=1392.900
decision_ms mean=126.615 p50=101.389 p95=334.839 max=334.839
final_stacks=[100.0, 99.0, 98.0, 98.0, 0.0, 305.0, 0.0, 100.0]
cfr_nodes=429235
eight-player tournament places=[4, 1, 5, 8, 2, 7, 6, 3] rounds=27 wall_ms=0.124
150224896 maximum resident set size
148767200 peak memory footprint
native_bytes=2008320
```

Interpretation:

- The evaluator and legal full-hand engine work.
- The configured online CFR search used about **143.3 MiB RSS** after one short 8-player hand and retained a 429k-node shared tree.
- The deadline is cooperative and checked at wave boundaries. A nominal 100 ms budget therefore did not guarantee a 100 ms response; one observed decision took 334.839 ms.
- Native execution used multiple threads (`12.33 s user` during `1.84 s real` for the whole process), which a normal single-thread browser WASM module cannot reproduce.
- CFR action selection uses thread-local `rand::rng()` after awaits, so the seeded simulation is not fully deterministic.
- This is a one-hand engineering load probe, not a strength benchmark. Longer sessions can retain/grow the shared tree, so 150 MB is a warning floor for this configuration rather than a safe browser envelope.

## WASM result

### Arena/CFR target — build invalidated

Direct build command from the probe (which enables `arena,serde`):

```sh
cargo +nightly build --release --target wasm32-unknown-unknown
```

First failure:

```text
error: The wasm32/64-unknown-unknown are not supported by default;
you may need to enable the "wasm_js" crate feature.
```

Adding a consumer target dependency on `getrandom = { version = "0.4", features = ["wasm_js"] }` got past RNG selection, then failed:

```text
error: Only features sync,macros,io-util,rt,time are supported on wasm.
```

This is not merely the probe's wrapper: upstream's `arena` feature enables Tokio configured with `rt-multi-thread`, `parking_lot`, `fs`, and `io-util`. Removing only `rt-multi-thread` in the disposable upstream clone still produced the same Tokio error because unsupported Tokio features remain. Arena historian modules also call `tokio::fs`, while CFR calls `tokio::spawn` and relies on timers/concurrency.

Making arena/CFR browser-buildable therefore requires an upstream fork or patch set that at least:

1. enables `getrandom/wasm_js` for browser targets;
2. splits native Tokio features from browser-safe features;
3. cfg-gates/replaces filesystem historians and comparison/export code;
4. chooses a current-thread browser executor and adapts spawning/timers;
5. exposes a wasm-bindgen/serialized API;
6. moves expensive decisions into a Web Worker to avoid freezing the UI;
7. revisits concurrency/atomics and tests runtime behavior in actual browsers.

That is a real port, not a Cargo flag.

### Core evaluator WASM — validated

A separate minimal wrapper at [`wasm-core/src/lib.rs`](wasm-core/src/lib.rs) disables all rs-poker default features, adds the browser RNG feature, and exports one `rank_category` function with `wasm-bindgen`.

```sh
cd wasm-core
cargo +nightly build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/rs_poker_wasm_core_probe.wasm
wasm-bindgen --target nodejs --out-dir pkg-node \
  target/wasm32-unknown-unknown/release/rs_poker_wasm_core_probe.wasm
node -e "const p=require('./pkg-node/rs_poker_wasm_core_probe.js'); console.log(p.rank_category('AsKsQsJsTs9d2c'))"
```

Observed execution and sizes:

```text
StraightFlush
raw cdylib wasm:        345231 bytes
web processed wasm:     330299 bytes
web wasm gzip -9:       188135 bytes
web JS glue:              8106 bytes
TypeScript declarations:  2179 bytes total
```

This proves the core evaluator can run offline in WASM. It does **not** make the arena/CFR layer browser-compatible. rs-poker's Rust API is not automatically callable from JavaScript; every function/state transition needs wrappers, or preferably one coarse serialized command API. A WASM file and JS loader are normally separate assets. Folding them into one HTML is possible only as an extra packaging step (for example embedding bytes/base64 and instantiating them), increasing complexity and transfer size.

## Fit matrix

| Requirement | Result | Evidence |
|---|---|---|
| Current, pinned source | **VALIDATED** | HEAD/revision matched; v5.0.0 |
| Permissive license | **VALIDATED** | Apache-2.0; license file present |
| 6/7/8-handed state | **VALIDATED** | 2–16 supported; 8-seat probes ran |
| Legal action machinery | **VALIDATED natively** | CFR/action tests pass; simulation applies/guards actions |
| Built-in single-table tournament | **VALIDATED, limited** | 8-seat run completed; fixed blinds only |
| CFRAgent Rust API | **VALIDATED natively** | 231 CFR tests + probe |
| Challenging bots | **NOT VALIDATED** | no strength/exploitability evidence; uniform range baseline |
| Strict public-only bot input | **INVALIDATED** | full hands in `GameState`; known-hands default; folded-card leak |
| Arena/CFR browser WASM build | **INVALIDATED** | reproducible getrandom then Tokio feature failures |
| Core evaluator browser WASM | **VALIDATED** | executed generated WASM; 330 KB / 188 KB gzip |
| One-HTML integration | **PARTIAL** | possible only with custom bindings and binary embedding |
| 8-seat browser latency/memory | **INVALIDATED for tested CFR config** | 126.6 ms mean, 334.8 ms p95/max, ~143 MiB RSS |

## Recommended integration seam

If River Room wants rs-poker at all, keep it narrow and replaceable:

```text
River Room JS state/rules/UI
        |
        | rank7(card_ids) -> category/tiebreak value
        v
small, stateless rs-poker core WASM evaluator
```

Do **not** pass River Room's mutable game into `HoldemSimulation` or expose `GameState` to bots. Keep the JS game authoritative and give each bot an immutable, explicitly sanitized observation: its own hole cards, board, stacks, bets, position, legal actions, and public action history. For a one-file offline build, either retain the existing JS evaluator or embed the small core WASM during packaging only if independent evaluator correctness/performance tests justify the extra toolchain.

For challenging offline bots, prefer precomputed strategy/range tables plus bounded Monte Carlo/heuristics running in a Web Worker. If rs-poker CFR remains interesting, treat it as an **offline native training/evaluation tool** that emits compact browser strategy data—not as the runtime bot.

## Verdict: INVALIDATED

**rs-poker is invalidated as the combined engine/AI foundation for River Room's fully offline browser target.** Its native evaluator/simulator is real and well-tested, but the browser-critical arena/CFR layer does not compile to the target, lacks bindings and a fair information boundary, has no demonstrated bot strength, and showed unsuitable one-hand memory/latency under a nontrivial 8-player CFR budget.

### What worked

- Core seven-card evaluator in native Rust and actual WASM.
- Native 8-player legal simulation.
- Native 8-player `SingleTableTournament`.
- Relevant tournament, range-sampling, and CFR test suites.

### What did not

- Direct arena/CFR WASM build.
- Strict public-information-only bot API/default behavior.
- Browser-suitable memory/latency for the tested nontrivial CFR setup.
- Evidence that built-in agents are challenging.

### Recommendation for the real build

Keep River Room's browser game engine independent. Optionally use rs-poker core through a tiny evaluator-only WASM seam, and use native rs-poker tooling only for offline validation/training experiments. Do not port CFRAgent into production unless a later dedicated fork spike first proves browser compilation, worker execution, sanitized observations, bounded memory over long sessions, deadline compliance, and measured strength.
