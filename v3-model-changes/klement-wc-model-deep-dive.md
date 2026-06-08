# Deep Dive: Joachim Klement's World Cup Model — and What to Borrow for Your WC2026 Model

**Subject:** Joachim Klement, "the economist who predicted three World Cups in a row"
**Goal:** Reverse-engineer his method, honestly backtest the track record, and turn it into a build plan for your own 2026 model.
**Prepared:** June 8, 2026

---

## Executive Summary

Joachim Klement is not really a mathematician — he is a London-based investment strategist and economist (head of research at Panmure Liberum, author of the *Klement on Investing* newsletter). His World Cup model is a simple econometric formula he built in 2014 partly as a joke, to mock economists who think they can forecast anything. It uses five "systemic" variables — GDP per capita, population, average temperature, FIFA ranking points, and a host-country bonus — to rate each team's strength, then runs a simulation of the bracket. It correctly named the champion in 2014 (Germany), 2018 (France), and 2022 (Argentina), and for 2026 it picks the Netherlands over Portugal.

The single most important thing to understand before copying him: Klement himself says roughly 50% of any match is luck, so the champion call is "more than 50% luck." His three-in-a-row is best read as a fund-manager-style hot streak — real skill in the strength rating, but the exact champion call is close to a coin flip dressed up in a model. That distinction is exactly what you want to design around.

The useful, repeatable part of his work is the strength-rating layer and the simulate-the-whole-bracket discipline — not the headline pick. Below is what he does, how well it really holds up, and a concrete blueprint for a stronger 2026 model.

---

## Part 1 — Who He Is (and why "mathematician" is wrong)

| Claim in the articles | What's actually true |
|---|---|
| "German mathematician" | German-born **economist / investment strategist**, CFA. Works in finance (Panmure Liberum), not academia or math. |
| Built a proprietary genius formula | Built a **deliberately simple** economic regression "to show how full of themselves economists are." |
| 100% accurate, 3 for 3 | Correct *champion* in 2014, 2018, 2022 — but he openly attributes the run mostly to luck. |

The framing matters for you: he is a smart generalist applying a known academic approach, publishing it once every four years as a fun note. He is not guarding a secret edge. The method is reproducible from public data.

---

## Part 2 — How the Model Actually Works

Klement's model has three layers. Most press coverage only describes layer one.

**Layer 1 — Team strength from systemic variables.**
Each team gets a strength score from five inputs:

- **GDP per capita** — proxy for football infrastructure, coaching, academies, sports science. Used as a ratio to the world average.
- **Population** — bigger talent pool. Used relative to world population.
- **Average temperature / climate** — historically correlates with footballing success (temperate-climate nations overperform).
- **FIFA ranking points** — the only direct on-pitch performance signal in the formula.
- **Host-country advantage** — a bonus for hosts (more fans, familiarity, travel/altitude). In 2026 this is split across USA/Mexico/Canada.

This layer descends from published academic work (e.g., University of Nottingham economics studies and the Groll et al. tournament-forecasting papers) that found GDP and population are statistically significant long-run predictors of national-team performance.

**Layer 2 — Turn strength into match probabilities.**
Two team-strength scores are converted into expected goals, and a **Poisson model** is used to generate a scoreline distribution for the match. The key behavioral rule he states explicitly: *the closer two teams are in strength, the more the result is luck.* When strengths are far apart, the favorite wins most simulated games; when they're close, it's near 50/50.

**Layer 3 — Monte Carlo simulation of the whole tournament.**
He doesn't just pick the strongest team. He simulates the actual bracket — group stage, the new 48-team / 12-group format, the specific draw and likely path — thousands of times (the academic versions use ~100,000 runs) and counts how often each team lifts the trophy. That's why his 2026 note can say the Netherlands has "a very difficult path" yet still emerge as the most frequent winner: it's a path-and-probability result, not "Netherlands is the best team."

**The honest caveat he repeats every time:** the five variables explain about half of what happens; the other ~50% is luck (refereeing, a post, an injury in the warm-up). So the model is really a *probability distribution over champions*, and he reports the mode.

---

## Part 3 — Backtesting the Track Record (the part the press skips)

This is where you should be skeptical, because it's where your own model can be smarter.

**Observation:** He correctly named the champion three times in a row.

**Interpretation — how impressive is that, really?**

1. **He picked favorites, mostly.** Germany (2014), France (2018) and Argentina (2022) were all among the pre-tournament top 3–4 favorites. A model that simply leans on strong teams will "predict the champion" fairly often, because favorites do win the World Cup more than half the time historically. The 2026 Netherlands pick is his first genuine underdog call (7th in FIFA ranking, ~8th in betting odds) — which is the real test of the model.

2. **One pick per tournament hides the distribution.** If his model gave, say, Germany an 18% chance in 2014, being "right" is a single draw from that distribution. Three correct modal picks in a row, when the favorite's win probability is ~15–25% each time, is roughly a 1-in-30 to 1-in-200 event by pure luck — uncommon but very far from proof of a crystal ball. He says this himself: it's the "star fund manager" illusion.

3. **No public out-of-sample error metric.** The press never reports how the *full distribution* scored (Brier score, log-loss, calibration) — only the binary "champion right/wrong." A model can nail three champions and still be poorly calibrated everywhere else. **This is the gap your model should close: score the whole bracket, not just the winner.**

**Bottom line of the backtest:** The strength-rating + simulation engine is legitimate and worth copying. The "three in a row" headline is mostly survivorship/luck and should not be your benchmark. Your benchmark should be *calibration and probabilistic accuracy across all matches*, measured against a proper baseline (bookmaker odds or Elo).

---

## Part 4 — What to Borrow vs. What to Improve

| Klement does | Borrow it? | Your upgrade for WC2026 |
|---|---|---|
| 5 systemic variables (GDP, population, temp, FIFA pts, host) | **Partly** | Keep GDP/population/host as priors; they're weak per-match but stabilize long-run strength. Demote raw FIFA ranking. |
| FIFA ranking as the on-pitch signal | **Replace** | Use **Elo (e.g., World Football Elo) and/or market-implied probabilities** — far better tested than FIFA points. Blend them. |
| Poisson scoreline model | **Yes** | Upgrade to **bivariate / Dixon-Coles Poisson** (corrects low-score dependence) or a goals model fit on recent results with time-decay weighting. |
| Monte Carlo of the full bracket | **Yes — essential** | Run ≥50k–100k sims over the real 48-team draw; report each team's probability per round, not just champion. |
| "~50% luck" framing | **Yes (philosophy)** | Encode it: report probabilities + confidence intervals, never a single deterministic winner. |
| Static variables, updated every 4 yrs | **Improve** | Add **current form**: squad value/market value, recent xG, injuries/availability, qualifier results, manager change. |
| Champion = modal pick | **Improve** | Evaluate with **Brier score / log-loss vs. bookmaker baseline**; calibrate so your 20% really means 20%. |

---

## Part 5 — A Build Blueprint for Your 2026 Model

A practical, layered design that keeps what works about Klement and fixes the weaknesses:

**1. Team strength rating (the prior).**
Blend three signals into one rating per team:
   - On-pitch: World Football Elo (history-based, transparent).
   - Market: implied win/advance probabilities from bookmaker odds or squad market value (Transfermarkt).
   - Systemic (Klement's): GDP per capita + population + host bonus as a slow-moving prior, down-weighted.
   Weight the blend by backtested accuracy, not intuition (e.g., start ~50% Elo / 35% market / 15% systemic, then tune).

**2. Form & availability adjustments.**
Layer recent signals on top of the prior: last 12–18 months of results with time-decay, attacking/defensive xG, key-player injuries, and qualifier performance. This is the single biggest thing missing from Klement's static model.

**3. Match engine.**
Convert two ratings into expected goals (λ_home, λ_away), then a **Dixon-Coles-adjusted Poisson** to get win/draw/loss and exact-score probabilities. Add a small neutral-site/host adjustment (relevant for USA/MEX/CAN venues, altitude in Mexico City, heat/humidity in southern US — a modern echo of Klement's "temperature" variable).

**4. Tournament simulation.**
Encode the real 2026 format (12 groups of 4, top 2 + 8 best third-placed advance, full knockout bracket). Monte Carlo it 50k–100k times. Output: probability of each team reaching each round and winning — plus your single modal pick if you want a headline.

**5. Evaluation (the discipline Klement skips publicly).**
Backtest on 2014/2018/2022 group + knockout matches. Score with **Brier score and log-loss**, and compare against two baselines: bookmaker closing odds and a pure-Elo model. If you can't beat the bookmaker baseline, your extra variables aren't earning their place. Check **calibration** with a reliability plot.

---

## Recommendations (prioritized)

1. **Build the simulation engine first, headline pick last.** The reusable value is the bracket Monte Carlo + calibrated match model — copy that from Klement, ignore the "winner reveal" theater.
2. **Replace FIFA ranking with Elo + market odds.** This is the highest-leverage accuracy upgrade and is well supported in the forecasting literature.
3. **Add current form and squad availability.** Klement's static, every-four-years variables are his biggest blind spot; recent xG and injuries move per-match probabilities a lot.
4. **Judge yourself on Brier/log-loss vs. a bookmaker baseline, not on "did I pick the champion."** Three correct champions is mostly luck; calibration is skill.
5. **Report distributions, not certainties.** Bake in his "50% luck" insight by always publishing probabilities and ranges.

---

## Open Questions for Further Research

- The exact functional form and coefficient weights of Klement's regression are not public — the 2026 PDF (panmureliberum.com/media/3179/strs_1031724.pdf) may contain his per-round probability table; worth pulling for the full distribution, not just the winner.
- Which Nottingham/Groll-style paper he originally based it on (to get published coefficient estimates for GDP/population).
- His historical *full* bracket accuracy, not just the champion — needed to fairly benchmark your model against his.

## Methodology Notes / Limitations

This synthesis is built from Klement's own newsletter, an SBS interview where he describes the five factors and the luck principle, and secondary coverage; plus the academic forecasting literature for the Poisson + Monte Carlo machinery. The precise model internals are proprietary, so Part 2 reconstructs the *approach* from his public statements and the academic lineage, not his exact code. The backtest critique (Part 3) is an interpretation of a small sample (3 tournaments) and base rates, not a computed error score — computing that properly is itself a recommended next step.

---

## Sources

- [beIN Sports — Klement predicts the Netherlands (2026)](https://www.beinsports.com/en-us/soccer/fifa-world-cup-2026/articles/the-german-mathematician-who-correctly-predicted-the-last-three-world-cup-champions-now-predicts-the-netherlands-will-lift-the-trophy-in-2026-2026-06-03)
- [SBS News — "He made a formula to mock his profession" (five factors + 50% luck)](https://www.sbs.com.au/news/article/this-economist-predicted-three-world-cup-winners-hes-backed-an-underdog-for-2026/4t8h0snpt)
- [Klement on Investing (Substack) — FIFA World Cup predictions 2026](https://klementoninvesting.substack.com/p/fifa-world-cup-predictions-2026)
- [Fortune — Argentina prediction, 2022](https://fortune.com/2022/09/21/world-cup-quatar-2022-predicted-winner-argentina-england/)
- [Yahoo Finance — "London stockbroker with a history of being right"](https://finance.yahoo.com/news/london-stockbroker-history-being-built-110000257.html)
- [Groll et al. — Prediction of major international soccer tournaments (academic basis)](https://epub.ub.uni-muenchen.de/31579/1/Groll_Prediction.pdf)
- [Nested Zero-Inflated Generalized Poisson Regression for FIFA World Cup 2022 (arXiv)](https://arxiv.org/pdf/2205.04173)
- [Random forest + team-ability approach, WC2018 (arXiv)](https://arxiv.org/pdf/1806.03208)
