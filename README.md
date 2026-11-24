# makefun-pumpfun-bot

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/mbelsbrow/makefun-pumpfun-bot/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/mbelsbrow/makefun-pumpfun-bot/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A pump.fun launch-sniper trading bot for Solana bonding curves. It buys a new coin only when the launch looks genuine — the creator bought 0.5–2.5 SOL in the create slot, at least 3 unrelated wallets bought with them, and the curve already holds 1–30 SOL — then exits on take-profit (+25%), stop-loss (−8%), a trailing stop, a 50-slot time limit, or the moment the creator sells. One buy per coin, never split, so the ~125 bps curve fees plus 105,000 lamports per transaction stay a small share of each trade.

Dev window (2–3 Nov 2026, 1,222 sampled coins): net PnL **+0.275 SOL** over 135 coins, 270 fills, 28.9% win rate, 1.1% max drawdown, guardrails met. The shipped pilot sniper loses −0.47 SOL on the same window; the edge here sits in the entry filter, not in a tuned exit.

## Run it

```sh
node main.ts
```

`main.ts` speaks agent-fun/replay/v2 on stdin/stdout (see `vendor/makefun-bot.ts`, a byte-identical copy of the kit's SDK shim). It runs on Node 22.18+ with no dependencies and no install step.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6engv5qa&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
