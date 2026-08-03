#!/usr/bin/env python3
"""Deterministic, agent-neutral pressure model for River Room tournament cadence.

This is a throwaway structure model, not a poker strategy or hand-strength simulator.
It conserves chips, rotates forced bets, gives every active player equal expected
showdown strength, and lets stack depth/blind pressure drive pot size and busts.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
from dataclasses import dataclass
from typing import Iterable

SCHEDULE = (
    (25, 50, 0),
    (50, 100, 0),
    (75, 150, 25),
    (100, 200, 25),
    (150, 300, 50),
    (200, 400, 50),
    (300, 600, 75),
    (400, 800, 100),
    (600, 1200, 200),
    (800, 1600, 200),
    (1000, 2000, 300),
    (1500, 3000, 500),
)

@dataclass(frozen=True)
class Config:
    players: int = 8
    starting_stack: int = 3000
    hands_per_level: int = 6
    aggression: float = 1.0
    max_hands: int = 180


def percentile(xs: list[float], p: float) -> float:
    ys = sorted(xs)
    k = (len(ys) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return ys[lo]
    return ys[lo] * (hi - k) + ys[hi] * (k - lo)


def pay(stacks: list[int], seat: int, amount: int) -> int:
    paid = min(stacks[seat], amount)
    stacks[seat] -= paid
    return paid


def weighted_pick(rng: random.Random, seats: list[int], weights: list[float]) -> int:
    return rng.choices(seats, weights=weights, k=1)[0]


def run_one(seed: int, cfg: Config) -> dict:
    rng = random.Random(seed)
    stacks = [cfg.starting_stack] * cfg.players
    dealer = rng.randrange(cfg.players)
    hands = 0
    eliminations: list[dict] = []
    hu_start = None
    initial_chips = sum(stacks)

    while sum(s > 0 for s in stacks) > 1 and hands < cfg.max_hands:
        active = [i for i, s in enumerate(stacks) if s > 0]
        n_before = len(active)
        level = min(hands // cfg.hands_per_level, len(SCHEDULE) - 1)
        sb, bb, ante = SCHEDULE[level]
        # Button and blinds move only over occupied seats.
        dealer = next(i for i in active if i > dealer) if any(i > dealer for i in active) else active[0]
        dpos = active.index(dealer)
        if len(active) == 2:
            sb_seat, bb_seat = dealer, active[(dpos + 1) % 2]
        else:
            sb_seat, bb_seat = active[(dpos + 1) % n_before], active[(dpos + 2) % n_before]

        pot = 0
        for i in active:
            pot += pay(stacks, i, ante)
        pot += pay(stacks, sb_seat, sb)
        pot += pay(stacks, bb_seat, bb)

        live = [i for i in active if stacks[i] > 0]
        participants = set()
        if stacks[bb_seat] > 0:
            participants.add(bb_seat)
        # Neutral entry: no persona or card edge. Short stacks enter more often.
        for i in live:
            stack_bb = stacks[i] / max(bb, 1)
            pressure = min(1.0, 10.0 / max(stack_bb, 1.0))
            vpip = min(0.72, (0.22 + 0.15 * pressure) * cfg.aggression)
            if rng.random() < vpip:
                participants.add(i)
        if len(participants) < 2 and len(live) >= 2:
            candidates = [i for i in live if i not in participants]
            weights = [1.0 + min(2.0, 8.0 * bb / max(stacks[i], 1)) for i in candidates]
            participants.add(weighted_pick(rng, candidates, weights))
        participants = sorted(participants)

        # Contested chips scale with blind pressure. Short stacks sometimes shove;
        # otherwise a capped lognormal approximates a multi-street risk amount.
        contributions = {}
        for i in participants:
            stack_bb = stacks[i] / max(bb, 1)
            shortness = max(0.0, (12.0 - stack_bb) / 12.0)
            shove_p = min(0.72, (0.025 + 0.34 * shortness**1.35) * cfg.aggression)
            if rng.random() < shove_p:
                target = stacks[i]
            else:
                target_bb = rng.lognormvariate(math.log(1.8 * cfg.aggression), 0.72)
                target = min(stacks[i], max(0, round(target_bb * bb)))
            paid = pay(stacks, i, target)
            contributions[i] = paid
            pot += paid

        if participants:
            # Every participant has equal expected strength: no persona, seat, stack,
            # or card-quality edge is represented in this cadence-only model.
            winner = rng.choice(participants)
        else:
            winner = bb_seat
        stacks[winner] += pot

        hands += 1
        busted = [i for i in active if stacks[i] == 0]
        # Simultaneous bust order: lower pre-award contribution first; deterministic seat tie-break.
        for i in sorted(busted, key=lambda x: (contributions.get(x, 0), x)):
            eliminations.append({"seat": i, "hand": hands, "place": n_before})
            n_before -= 1
        remaining = sum(s > 0 for s in stacks)
        if remaining == 2 and hu_start is None:
            hu_start = hands
        assert sum(stacks) == initial_chips, (seed, hands, stacks)
        assert all(s >= 0 for s in stacks)

    winner = next((i for i, s in enumerate(stacks) if s > 0), None)
    return {
        "hands": hands,
        "winner": winner,
        "hu_hands": 0 if hu_start is None else hands - hu_start,
        "completed": winner is not None and sum(s > 0 for s in stacks) == 1,
        "eliminations": eliminations,
        "final_stacks": stacks,
    }


def summarize(cfg: Config, tournaments: int, seed: int, hand_seconds: Iterable[float]) -> dict:
    runs = [run_one(seed + i * 104729, cfg) for i in range(tournaments)]
    hands = [r["hands"] for r in runs]
    hu = [r["hu_hands"] for r in runs]
    out = {
        "config": cfg.__dict__,
        "tournaments": tournaments,
        "seed": seed,
        "completion_rate": sum(r["completed"] for r in runs) / tournaments,
        "hands": {"p10": percentile(hands, .10), "p25": percentile(hands, .25), "median": percentile(hands, .50), "p75": percentile(hands, .75), "p90": percentile(hands, .90), "mean": statistics.fmean(hands)},
        "heads_up_hands": {"median": percentile(hu, .50), "p90": percentile(hu, .90), "mean": statistics.fmean(hu)},
        "duration_minutes": {},
    }
    for seconds in hand_seconds:
        mins = [h * seconds / 60 for h in hands]
        out["duration_minutes"][str(seconds)] = {
            "p10": percentile(mins, .10), "median": percentile(mins, .50), "p90": percentile(mins, .90),
            "in_45_60": sum(45 <= x <= 60 for x in mins) / tournaments,
            "under_40": sum(x < 40 for x in mins) / tournaments,
            "over_70": sum(x > 70 for x in mins) / tournaments,
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tournaments", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=20260802)
    ap.add_argument("--aggression", type=float, default=1.0)
    ap.add_argument("--hands-per-level", type=int, default=6)
    ap.add_argument("--hand-seconds", type=float, nargs="+", default=[42, 48, 54, 60])
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args()
    cfg = Config(aggression=args.aggression, hands_per_level=args.hands_per_level)
    print(json.dumps(summarize(cfg, args.tournaments, args.seed, args.hand_seconds), indent=2 if args.pretty else None, sort_keys=True))

if __name__ == "__main__":
    main()
