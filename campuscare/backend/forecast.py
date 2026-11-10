"""Reproducible synthetic next-14-day event experiment; never a real-campus claim.

Training and test devices are disjoint. Features end at day 120; labels only use
days (120, 134]. Hidden simulator parameters are not exposed as features.
"""

import math
import random
import json
from functools import lru_cache
from datetime import datetime, timezone


def features(events, cutoff):
    past = sorted(t for t in events if t <= cutoff)
    counts = [sum(cutoff - d < t <= cutoff for t in past) for d in [7, 30, 90]]
    recency = min(90, cutoff - past[-1]) if past else 90
    short = sum(0 < b - a <= 14 for a, b in zip(past, past[1:]) if b > cutoff - 90)
    return [*counts, recency / 30, short]


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-30, min(30, x))))


def simulate(seed, n):
    rng = random.Random(seed)
    rows = []
    for device in range(n):
        base = rng.uniform(0.002, 0.035)
        wear = rng.uniform(0, 0.025)
        events = []
        last = -100
        for day in range(1, 135):
            # Heterogeneous recurrence and exposure, intentionally simplified.
            hazard = base + wear * (day / 120) + (0.06 if day - last < 12 else 0)
            if rng.random() < hazard:
                events.append(day)
                last = day
        rows.append((features(events, 120), int(any(120 < t <= 134 for t in events))))
    return rows


def auc(y, p):
    pos = [s for a, s in zip(y, p) if a]
    neg = [s for a, s in zip(y, p) if not a]
    return sum(1 if a > b else 0.5 if a == b else 0 for a in pos for b in neg) / max(
        1, len(pos) * len(neg)
    )


@lru_cache(maxsize=1)
def train():
    rows = simulate(883, 800)
    test = simulate(2026, 300)
    dim = 5
    mean = [sum(x[j] for x, y in rows) / len(rows) for j in range(dim)]
    scale = [
        math.sqrt(sum((x[j] - mean[j]) ** 2 for x, y in rows) / len(rows)) or 1
        for j in range(dim)
    ]
    xx = [[1] + [(x[j] - mean[j]) / scale[j] for j in range(dim)] for x, y in rows]
    yy = [y for x, y in rows]
    w = [0.0] * (dim + 1)
    for epoch in range(500):
        grad = [0.0] * (dim + 1)
        for x, y in zip(xx, yy):
            err = sigmoid(sum(a * b for a, b in zip(w, x))) - y
            for j in range(dim + 1):
                grad[j] += err * x[j]
        for j in range(dim + 1):
            w[j] -= 0.12 * (grad[j] / len(rows) + (0.01 * w[j] if j else 0))

    def pred(x):
        return sigmoid(
            w[0] + sum(w[j + 1] * (x[j] - mean[j]) / scale[j] for j in range(dim))
        )

    y = [y for x, y in test]
    p = [pred(x) for x, y in test]
    baseline = [x[1] for x, y in test]
    metrics = {
        "train_assets": len(rows),
        "test_assets": len(test),
        "horizon_days": 14,
        "model_auc": auc(y, p),
        "baseline_auc": auc(y, baseline),
        "brier": sum((a - b) ** 2 for a, b in zip(y, p)) / len(y),
        "test_positive_rate": sum(y) / len(y),
        "seed": [883, 2026],
        "features": [
            "events_7d",
            "events_30d",
            "events_90d",
            "days_since_last_div30",
            "recurrences_14d",
        ],
        "disclaimer": "Synthetic asset experiment: training and test sets use separate assets. The 14-day window after the observation cutoff is used only for labels. Results do not measure real campus performance.",
    }
    return w, mean, scale, metrics


def evaluate():
    return train()[3]


def rank_assets(c):
    w, mean, scale, _ = train()
    now = datetime.now(timezone.utc)
    rank = []
    for a in c.execute("SELECT id,name FROM assets"):
        dates = [
            datetime.fromisoformat(r["created"])
            for r in c.execute(
                'SELECT created FROM tickets WHERE asset_id=? AND status!="cancelled"',
                (a["id"],),
            )
        ]
        # A ticket is a reporting event, not a confirmed physical failure.
        events = [-(now - d).total_seconds() / 86400 for d in dates]
        x = features(events, 0)
        score = (
            sigmoid(
                w[0] + sum(w[j + 1] * (x[j] - mean[j]) / scale[j] for j in range(5))
            )
            if len(events) >= 3
            else None
        )
        rank.append(
            {
                "id": a["id"],
                "name": a["name"],
                "score": score,
                "level": (
                    "Insufficient records"
                    if score is None
                    else "Elevated" if score >= 0.5 else "Moderate"
                ),
                "reason": (
                    f"{x[1]} reports in the past 30 days and {x[2]} in the past 90 days. Counts may include unverified reports and demo records."
                    if score is not None
                    else "Fewer than three historical reports. No risk score is available."
                ),
            }
        )
    eligible = sorted(
        (a for a in rank if a["score"] is not None), key=lambda a: -a["score"]
    )
    return eligible[:12] + [a for a in rank if a["score"] is None][:2]


if __name__ == "__main__":
    print(json.dumps(evaluate(), ensure_ascii=False, indent=2))
