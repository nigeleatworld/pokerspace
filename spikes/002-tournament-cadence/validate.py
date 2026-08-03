#!/usr/bin/env python3
"""Reproducible sensitivity sweep and smoke checks for the cadence spike."""
from __future__ import annotations

from simulate import Config, run_one, summarize

SEED = 20260802
TOURNAMENTS = 20000
HAND_SECONDS = [42, 48, 54, 60]


def fmt(x: float) -> str:
    return f"{x:.1f}"


def main() -> None:
    # Exact replay is part of the contract; run_one also asserts conservation/nonnegative stacks.
    assert run_one(SEED, Config(hands_per_level=7)) == run_one(SEED, Config(hands_per_level=7))
    print("aggression | median hands | p10-p90 | HU median/p90 | completion | median min @ 42/48/54/60s")
    print("---|---:|---:|---:|---:|---")
    reports = {}
    for label, aggression in (("cautious", .8), ("baseline", 1.0), ("aggressive", 1.2)):
        report = summarize(Config(hands_per_level=7, aggression=aggression), TOURNAMENTS, SEED, HAND_SECONDS)
        reports[label] = report
        h, hu = report["hands"], report["heads_up_hands"]
        durations = "/".join(fmt(report["duration_minutes"][str(s)]["median"]) for s in HAND_SECONDS)
        print(f"{label} ({aggression:.1f}x) | {fmt(h['median'])} | {fmt(h['p10'])}-{fmt(h['p90'])} | {fmt(hu['median'])}/{fmt(hu['p90'])} | {report['completion_rate']:.1%} | {durations}")

    base = reports["baseline"]
    assert base["completion_rate"] == 1.0
    assert 52 <= base["hands"]["median"] <= 62
    assert base["hands"]["p90"] <= 72
    assert 45 <= base["duration_minutes"]["54"]["median"] <= 60
    assert base["duration_minutes"]["54"]["in_45_60"] >= .65
    assert all(r["completion_rate"] >= .999 for r in reports.values())
    print("\nPASS: deterministic replay, chip invariants, completion, and baseline acceptance bands.")


if __name__ == "__main__":
    main()
