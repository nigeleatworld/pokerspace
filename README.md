# Pokerspace

A private cardroom for patient reads, hard decisions, and one more hand.

Pokerspace is a fully offline, single-file Texas Hold'em game. No accounts, no servers, no tracking. Open `index.html` in any browser and play.

## What it is

- **8-player single-table tournament** (default): 3,000 chips each, blinds rising every 7 hands, last player standing wins
- **Cash game**: $5/$10 blinds, $1,500 buy-in, rebuys, cumulative P/L tracking
- **5 bot personas** with distinct play styles: Pressure, Balanced, Value, Trap, Nit
- **Spectator equity**: fold and watch the hand play out with live win probabilities and exact outs on each remaining player
- **Post-hand analysis**: estimated fold/call EV from modeled opponent ranges, with raises left ungraded when the model cannot support a trustworthy verdict
- **Sequential all-in runouts**: community cards revealed one at a time for suspense
- **Persistent saves**: close the tab, come back, resume exactly where you left off
- **Mobile-first**: works on phones at 320px and up
- **Zero dependencies**: one HTML file, no external fonts, images, libraries, or network calls

## How to play

1. Open `index.html` in a browser
2. Choose Tournament or Cash
3. Click Start
4. Fold, Call/Check, or Raise to act on your turn
5. Fold at any point to enter spectator mode and watch the rest of the hand with live equity

## Bot AI

The bots use range-aware heuristics with public-information-only decisions. They model opponent ranges, adjust for position, board texture, SPR, and multiway dynamics. Each persona has different aggression, bluffing, and trapping frequencies measured across 15,000 hands:

| Persona | VPIP | PFR | 3-Bet | Bluff Freq (flop) |
|---------|------|-----|-------|-------------------|
| Pressure | 30.8% | 21.0% | 11.5% | 16.1% |
| Balanced | 29.8% | 19.3% | 9.4% | 9.2% |
| Value | 28.4% | 18.5% | 9.0% | 7.1% |
| Trap | 30.0% | 19.5% | 9.4% | 5.8% |
| Nit | 27.3% | 17.6% | 8.0% | 2.9% |

This is strong recreational/training AI, not solver-backed or GTO-grade.

## Files

- `index.html` - The game. This is all you need to play.
- `qa-tests.js` - Regression suite (run with `node qa-tests.js`)
- `ai-match-bench.js` - Adversarial benchmark
- `qa-mobile.html` - Mobile geometry harness
- `package-release.sh` - Rebuild the ZIP from the canonical game and verify it
- `release-check.sh` - Run QA and prove the ZIP contains the tested `index.html`
- `spikes/` - Research notes: WASM poker engine investigation, tournament cadence simulation, AI exploit benchmarks, heads-up telemetry, bot-style telemetry

## Run tests

```bash
node qa-tests.js
```

## Build the release

```bash
./package-release.sh
```

This regenerates `Pokerspace.zip`, runs the full QA suite, and verifies that the packaged `index.html` is byte-identical to the tested game.

## License

Private project.
