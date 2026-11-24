// Pump.fun launch sniper — "creator skin in the game" edition.
//
// Idea (decided from the dev window, 2–3 Nov 2026, 1,222 sampled coins):
// most new pump.fun coins pump in their first slots and then bleed out, so a
// bot that buys every launch and holds loses to fees. The coins that keep
// running share one early fingerprint: the creator themself bought a
// meaningful amount in the create slot (dev buy 0.5–2.5 SOL — enough skin in
// the game, but not so much that the creator owns the curve and can dump it)
// and several unrelated wallets piled in with them (>= 3 distinct buyers)
// while the curve already holds real SOL (1–30 SOL). On the dev window that
// filter turns the shipped pilot sniper (-0.47 SOL) into a small positive
// one (+0.22 SOL on the full window, positive in every 6h block), and the
// result is flat across the whole exit grid — the edge sits in the entry
// filter, not in a finely tuned exit. Only the binding filters are
// implemented here; the pilot's other knobs (sell ratio, big sell, run-up,
// flow) sit at disabled values on the tested settings and are left out.
//
// Entry: one buy per coin, at most 0.2 SOL and at most 1% of the curve's real
// SOL reserve, decided within 10 slots of the CreateEvent, never after the
// creator has sold, never on a completed curve.
// Exit: take profit at +25% over cost, stop loss at -8%, a trailing stop that
// arms at +10% and exits on a -5% pullback from the best value seen, a 50-slot
// time limit, or immediately when the creator sells while we hold.
// Fees: every round trip pays ~125 bps of curve fees plus 105,000 lamports of
// transaction fees per order, so orders are never split and a coin is never
// bought twice.
//
// Deterministic by construction: no clock, no environment, no randomness —
// only slot numbers and the events the harness sends. Two executions of the
// same replay therefore produce byte-identical action logs.

import { runBot, type Batch, type BotState, type OrderInput } from './vendor/makefun-bot.ts';

const BPS = 10_000n;
/** Curve fees on a sale: protocol 95 bps + creator 30 bps. */
const CURVE_FEE_BPS = 125n;
/** Most SOL to put into one coin. Bigger stakes cut the fixed transaction fee
 *  to a smaller share of the trade; most buys stay capped at 1% of the curve's
 *  real SOL reserve either way, so only the largest launches take the full size. */
const STAKE_LAMPORTS = 500_000_000n;
/** Smallest single buy worth paying the transaction fee for. */
const MIN_BUY_LAMPORTS = 5_000_000n;
/** The curve must already hold this much real SOL when we decide (and no more than MAX_REAL_SOL). */
const MIN_REAL_SOL_LAMPORTS = 1_000_000_000n;
const MAX_REAL_SOL_LAMPORTS = 30_000_000_000n;
/** The creator's own buys in the create slot must fall in this window. */
const MIN_DEV_BUY_LAMPORTS = 500_000_000n;
const MAX_DEV_BUY_LAMPORTS = 2_500_000_000n;
/** Distinct non-creator buyers seen before entry. */
const MIN_BUYERS = 3;
/** Oldest age (slots since create) at which a first buy may be decided. */
const MAX_AGE_SLOTS = 10;
/** Exit when the position is worth this far over its cost (bps). */
const TAKE_PROFIT_BPS = 2_500n;
/** Exit when it is worth this far under its cost (bps). */
const STOP_LOSS_BPS = 800n;
/** Trailing stop: arms once the value is this far over cost, exits on a fall of TRAIL_BPS from the best value. */
const TRAIL_ARM_BPS = 1_000n;
const TRAIL_BPS = 500n;
/** Exit after holding this many slots. */
const MAX_HOLD_SLOTS = 50;
/** Slippage tolerated on buys and sells (bps). */
const SLIPPAGE_BPS = 10_000;

interface Launch {
  mint: string;
  createdSlot: number;
  creator: string;
  /** Creator's own buys (lamports) in the create slot. */
  devBuy: bigint;
  /** Distinct non-creator buyers seen so far. */
  buyers: Set<string>;
  /** The creator sold at least once. */
  devSold: boolean;
  /** Decided already: bought, filtered out for good, or completed. */
  done: boolean;
}

interface OpenTrade {
  openedSlot: number;
  /** Transaction fees paid on this position's orders so far. */
  txPaid: bigint;
  /** Best liquidation value seen (lamports, tx fee deducted). */
  best: bigint;
  /** Whether the creator had already sold when the position opened. */
  devSoldAtOpen: boolean;
}

/** What selling `tokens` against reserves (vq, vt) pays after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const gross = (tokens * vq) / (vt + tokens);
  const fee = (gross * CURVE_FEE_BPS + BPS - 1n) / BPS;
  return gross - fee;
}

/**
 * Every exit rule in one place: take profit, stop loss, trailing stop from
 * the best value, the holding-time limit, and the creator selling while we
 * hold. Returns true when the position should be sold whole now.
 */
function shouldExit(
  value: bigint,
  basis: bigint,
  best: bigint,
  heldSlots: number,
  devSoldNow: boolean,
  devSoldAtOpen: boolean,
): boolean {
  if (basis > 0n) {
    if (value * BPS >= basis * (BPS + TAKE_PROFIT_BPS)) return true;
    if (value * BPS <= basis * (BPS - STOP_LOSS_BPS)) return true;
    if (
      best * BPS >= basis * (BPS + TRAIL_ARM_BPS) &&
      value * BPS <= best * (BPS - TRAIL_BPS)
    ) {
      return true;
    }
  }
  if (heldSlots >= MAX_HOLD_SLOTS) return true;
  if (devSoldNow && !devSoldAtOpen) return true;
  return false;
}

const launches = new Map<string, Launch>();
const open = new Map<string, OpenTrade>();

function hasPending(state: BotState, mint: string, side: 'buy' | 'sell'): boolean {
  for (const p of state.pending.values()) {
    if (p.order.mint === mint && p.order.side === side) return true;
  }
  return false;
}

await runBot({
  onBatch(state, batch: Batch): OrderInput[] {
    // Take the batch's events into the launch table.
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        launches.set(e.mint, {
          mint: e.mint,
          createdSlot: e.slot,
          creator: e.creator,
          devBuy: 0n,
          buyers: new Set(),
          devSold: false,
          done: false,
        });
      } else if (e.event === 'TradeEvent') {
        const launch = launches.get(e.mint);
        if (launch === undefined) continue;
        const sol = BigInt(e.sol_amount);
        if (e.is_buy) {
          if (e.user === launch.creator) {
            if (e.slot === launch.createdSlot) launch.devBuy += sol;
          } else {
            launch.buyers.add(e.user);
          }
        } else if (e.user === launch.creator) {
          launch.devSold = true;
        }
      } else {
        const launch = launches.get(e.mint);
        if (launch !== undefined) launch.done = true;
      }
    }

    // Fold the fills in: track tx fees per open trade, open a trade on a buy
    // fill, drop trades the harness closed itself.
    const txFee = state.txFeeLamports();
    for (const f of batch.fills) {
      if (f.client_id.startsWith('_')) {
        open.delete(f.mint);
        continue;
      }
      const trade = open.get(f.mint);
      if (trade !== undefined && f.status !== 'rejected') {
        trade.txPaid += BigInt(f.tx_fee_lamports);
      }
      if (f.side === 'buy' && f.status === 'filled' && trade === undefined) {
        const launch = launches.get(f.mint);
        open.set(f.mint, {
          openedSlot: f.slot,
          txPaid: BigInt(f.tx_fee_lamports),
          best: 0n,
          devSoldAtOpen: launch?.devSold ?? false,
        });
      }
    }
    // Drop trades whose position is gone and nothing is in flight for them.
    for (const mint of [...open.keys()]) {
      if (!state.positions.has(mint) && !hasPending(state, mint, 'buy') && !hasPending(state, mint, 'sell')) {
        open.delete(mint);
      }
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;

    // Exits first: one whole-position sell per trade that trips a rule.
    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (hasPending(state, mint, 'sell')) continue;
      const launch = launches.get(mint);
      let trade = open.get(mint);
      if (trade === undefined) {
        trade = { openedSlot: state.slot, txPaid: txFee, best: 0n, devSoldAtOpen: launch?.devSold ?? false };
        open.set(mint, trade);
      }
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const mark = batch.marks.find((m) => m.mint === mint);
      const vq = mark !== undefined ? BigInt(mark.virtual_quote_reserves) : curve.virtual_quote_reserves;
      const vt = mark !== undefined ? BigInt(mark.virtual_token_reserves) : curve.virtual_token_reserves;
      const value = sellValue(pos.token_amount, vq, vt) - txFee;
      const basis = pos.cost_lamports + trade.txPaid;
      if (value > trade.best) trade.best = value;
      const exit = shouldExit(
        value,
        basis,
        trade.best,
        state.slot - trade.openedSlot,
        launch?.devSold ?? false,
        trade.devSoldAtOpen,
      );
      if (!exit) continue;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SLIPPAGE_BPS });
      if (launch !== undefined) launch.done = true;
    }

    // Entries: one buy per qualifying launch, never split, never twice.
    // Cash already accounts for the transaction fees of the sells above.
    let free = state.freeCashLamports() - txFee * BigInt(orders.length);
    let room = state.hello.caps.max_open_positions - state.committedPositionCount();
    for (const launch of launches.values()) {
      if (orders.length >= cap) break;
      if (launch.done) continue;
      const age = state.slot - launch.createdSlot;
      if (age > MAX_AGE_SLOTS) {
        launch.done = true;
        continue;
      }
      if (launch.devSold) {
        launch.done = true;
        continue;
      }
      if (launch.buyers.size < MIN_BUYERS) continue;
      if (launch.devBuy < MIN_DEV_BUY_LAMPORTS || launch.devBuy > MAX_DEV_BUY_LAMPORTS) continue;
      const curve = state.curves.get(launch.mint);
      if (curve === undefined || curve.complete) continue;
      if (
        curve.real_quote_reserves < MIN_REAL_SOL_LAMPORTS ||
        curve.real_quote_reserves > MAX_REAL_SOL_LAMPORTS
      ) {
        continue;
      }
      if (room <= 0) continue;
      const maxBuy = state.maxBuyLamports(launch.mint);
      const amount = STAKE_LAMPORTS < maxBuy ? STAKE_LAMPORTS : maxBuy;
      if (amount < MIN_BUY_LAMPORTS) continue;
      if (free < amount + txFee) continue;
      orders.push({ side: 'buy', mint: launch.mint, quote_lamports: amount, max_slippage_bps: SLIPPAGE_BPS });
      free -= amount + txFee;
      room -= 1;
      launch.done = true;
    }
    return orders;
  },
});
