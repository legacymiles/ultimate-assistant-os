# Expert Advisors — 24/7 dual-direction bot

Dictated 2026-09-30. Twelve feature specs for one always-on MT4/MT5 Expert Advisor that holds buys and sells at the same time, trades the bounce/retrace, stacks winners with a basket trail, locks drawdown when it is wrong, and turns momentum shifts into the new working direction.

**Requires a hedging (non-FIFO) account.** The EA refuses to start on a netting or FIFO-restricted account by design.

Also live and searchable at /apps/ea-feature-list.

## Contents

1. Intelligent Position Addition Manager
2. Always-On Trading Charter (Non-FIFO Hedging Account)
3. Heartbeat Market Sensor
4. Dual-Direction Book
5. Bounce and Retrace Entry Engine
6. Next-Setup Anticipation Queue
7. Continuous Profit Harvest
8. Directional Stack with Basket Trailing
9. Momentum Shift Capitalizer
10. Drawdown Lock
11. Drawdown Governor
12. Dual-Objective Scorecard

---

# Intelligent Position Addition Manager

*Gates every additional position behind secured profit instead of price distance — a new 0.02 lot only opens when the floating profit and trailing stop can already absorb the extra exposure, and the trailing stop is recalculated for the new basket size.*

Tags: Position Management, Risk Control, Trailing Stop, Basket Exposure, Entry Logic, Lot Sizing

## Feature: Intelligent Position Addition Manager

Add a new feature to the existing EA that manages when additional positions may be opened.

This feature should not add positions based only on price movement or a fixed distance between trades. Instead, every new position must be evaluated to determine whether the current trade has enough protected profit to safely support another position.

The EA should continuously monitor the current floating profit and the location of the trailing stop.

Before opening another position (for example, another 0.02 lot trade), the EA must determine whether the existing profit and trailing stop provide enough protection for the additional exposure.

If adding another position would increase the possibility of the basket closing in a loss or increase drawdown beyond the protected profit, the EA must not add the position.

If the current trade has accumulated enough profit and the trailing stop has moved far enough to safely absorb the additional 0.02 lot position, the EA may open the new trade.

Every time a new position is opened, the EA must immediately recalculate the trailing stop to account for the increased total lot size and overall basket exposure.

As price continues moving in profit, the trailing stop should continue advancing. Each time additional profit is secured by the trailing stop, the EA should reevaluate whether another 0.02 lot position can now be safely added.

The goal is to allow the EA to gradually build larger positions while using previously secured profit to support future entries, rather than increasing exposure that the current trade cannot yet afford.

---

# Always-On Trading Charter (Non-FIFO Hedging Account)

*The governing doctrine for an EA meant to be left running: both directions open at once, no human in the loop, every decision scored on whether it lowered drawdown or raised profit, and a hard refusal to run on a FIFO or netting account.*

Tags: Always-On, Risk Control, Hedging, Broker Requirements, Drawdown Control

## Feature: Always-On Trading Charter (Non-FIFO Hedging Account)

This is the governing document for the EA. Every other feature is subordinate to it, and any feature that contradicts it is wrong.

The EA is built to be left running continuously. It may be switched on and off by hand, but nothing in its design may depend on a human being present. It must survive a restart, a disconnect, a weekend gap and a broker-side position change without losing track of what it owns.

The EA holds buy positions and sell positions at the same time, deliberately. This is not an accident of two strategies overlapping; it is the core mechanic. Because of this, the EA is only valid on a hedging account. It is not compatible with FIFO-restricted accounts and must not be run on one.

At startup the EA must detect the account's order-handling mode. If the account is netting, or if the broker reports FIFO closure rules, the EA must refuse to open any position, log the reason in plain language, and stand down. It must never silently degrade into a single-direction EA, because every risk assumption in the rest of the system depends on being able to hold both sides.

The standing objective, applied to every decision the EA makes, is twofold: lower drawdown, and increase profit. A decision that raises expected profit while also raising peak drawdown is not automatically accepted. A decision that reduces drawdown at no profit cost is always accepted. When the two conflict, drawdown wins, because the EA is judged on its ability to keep running rather than on any single result.

The EA is never idle. At any moment it is doing at least one of three things: managing open exposure, harvesting profit from open exposure, or preparing the next entry. "No trade right now" is a valid state only for opening new risk; it is never a valid state for the EA as a whole.

Every position the EA opens must have, at the moment it is opened, a known worst case expressed in account currency. If the EA cannot state what the position costs when it is wrong, it does not open it.

---

# Heartbeat Market Sensor

*One tick-rate pulse reader that every other module reads from — velocity, acceleration, tick density, spread and direction pressure rolled into a single named market state, recomputed on every tick instead of on bar close.*

Tags: Execution, Market Structure, Momentum, Always-On, Entry Logic

## Feature: Heartbeat Market Sensor

Add a single sensing module that acts as the EA's heartbeat. It is the only place in the EA where raw market data is turned into a judgement about the market. Every other module reads its output and none of them recompute it.

The heartbeat runs on every incoming tick, not on bar close. Waiting for a bar to close is forbidden for this module, because by the time a bar closes the condition it would have detected is already priced in.

On each tick the heartbeat maintains a rolling reading of:

- Velocity: how fast price is moving, measured over several short windows at once so that a fast move and a slow move are distinguishable.
- Acceleration: whether that velocity is rising or decaying. A move that is still moving but decelerating is the single most important reading in the whole EA.
- Tick density: how many ticks are arriving per unit of time compared with the recent normal. Thin tick flow means the EA's assumptions about fills are unreliable.
- Spread: current spread against its own recent distribution, not against a fixed number, because spread behaviour differs by session and by instrument.
- Direction pressure: the balance of up-ticks to down-ticks over the recent window, which often turns before price does.

From these readings the heartbeat publishes one named market state, and only one at a time. The states are: Drifting, Expanding, Exhausting, Reversing, and Dead. Every other feature in the EA makes its decisions by asking the heartbeat which state the market is in, rather than by reading indicators itself.

The heartbeat also owns the execution guard. When spread is outside its normal range, when tick flow has stalled, or when the platform reports an unusual delay between tick arrival and order response, the heartbeat publishes a guarded condition. While guarded, the EA may manage and close existing positions but may not open new ones. This guard is not optional and cannot be overridden by any other module.

This module is a decision-frequency sensor, not a latency-arbitrage engine. Its value is that the EA reacts within the same tick that the market changes, rather than one bar late. It must not be built on the assumption that the EA can win a race against other participants to the broker, because on a retail feed it cannot.

---

# Dual-Direction Book

*Longs and shorts are kept as two separate baskets, each with its own average price, exposure, trailing stop and state, with net and gross exposure tracked apart so a hedged book is never mistaken for a flat one.*

Tags: Hedging, Position Management, Basket Exposure, Broker Requirements, Risk Control

## Feature: Dual-Direction Book

The EA must keep its long positions and its short positions as two separate books, managed independently, even though they sit on the same instrument at the same time.

Each book maintains its own state: total lots, volume-weighted average entry price, floating profit or loss, protected profit floor, current trailing stop level, number of positions in the stack, and the time the book was opened.

The two books are never merged for management purposes. A long book that is in profit continues to trail and harvest on its own terms even while the short book is in loss, and the reverse. Closing one book never automatically closes the other.

The EA tracks two separate measures of exposure and must never confuse them:

- Net exposure is longs minus shorts. This is what the account gains or loses when price moves.
- Gross exposure is longs plus shorts. This is what the account is actually carrying, and it is what margin, swap and the risk ceilings are measured against.

A book that is perfectly hedged has zero net exposure and full gross exposure. The EA must treat that as a carried position with ongoing cost, not as a flat account. Any risk calculation that uses net exposure where gross exposure was meant is a defect.

Position ownership must survive a restart. On initialisation the EA reads the account's existing positions, sorts them into the correct book by direction and by its own magic number, and rebuilds each book's average price and stack depth from the actual fills. It must never orphan a position it previously opened, and it must never claim a position it did not open.

Because the two books exist simultaneously, this feature requires a hedging account and is incompatible with FIFO closure rules. The refusal-to-start check defined in the Always-On Trading Charter protects this feature.

---

# Bounce and Retrace Entry Engine

*Buys the bottom and sells the top by requiring three things in order — price reaching a range extreme, the heartbeat showing the move into that extreme decaying, and then a reclaim back through a threshold — so the EA never buys a knife that is still falling.*

Tags: Entry Logic, Market Structure, Momentum, Bounce / Retrace

## Feature: Bounce and Retrace Entry Engine

This is the EA's primary way into the market. Its intent is to buy near the bottom of a move and sell near the top of a move, using the bounce and retrace behaviour of price rather than chasing breakouts.

The engine maintains a live picture of the current swing structure: the most recent impulse leg, its start and end, and the range the market has been working inside.

An entry requires three conditions, in this order. All three are mandatory and the order matters.

First, reach. Price must have travelled into an extreme of the current structure — the low end of the range for a buy, the high end for a sell. Reach alone is never a reason to enter.

Second, exhaustion. The heartbeat must report that the move into that extreme is decaying: velocity falling while price still extends, direction pressure turning before price turns, or the market state moving to Exhausting. This is the condition that separates a bounce from a continuation. Without it the EA is buying a falling knife, which is forbidden.

Third, reclaim. Price must trade back through a reclaim threshold measured from the extreme. The threshold is a proportion of the impulse leg that produced the extreme, not a fixed distance, so it scales with how violent the move was. Only on reclaim does the EA open.

Retrace depth is always measured against the last impulse leg. A shallow retrace into a strong trend and a deep retrace into a weak one are different setups and must be scored differently, not treated as the same trigger at a different price.

Every entry produced by this engine carries an invalidation level defined at the moment of entry: the price at which the bounce thesis is simply wrong. That level is handed to the risk modules and is what the drawdown lock watches.

The engine may produce a buy setup and a sell setup at the same time at different levels. That is expected and is the reason the EA runs a dual-direction book.

---

# Next-Setup Anticipation Queue

*While trades are running, the EA is already scoring and arming the levels where the next best entry would be, with lot size, invalidation and direction precomputed, so a setup is taken the tick it confirms rather than found after the fact.*

Tags: Entry Logic, Always-On, Position Management, Momentum

## Feature: Next-Setup Anticipation Queue

The EA must never be in a position where it notices a setup only after price has reached it. While existing trades are open and being managed, a separate process is continuously working out where the next best entry would be.

The queue continuously identifies candidate levels — structure extremes, unfilled retrace zones, the far side of the current range, and the levels that would matter if the current move fails. Each candidate is scored on how good the entry would be if price arrived there: distance from current price, quality of the structure at that level, which direction it would open, and how it would sit against the exposure already carried.

The highest-scoring candidates are kept armed. An armed setup is not a pending order. It is a fully prepared decision held in memory: direction, trigger level, lot size, invalidation level, and the confirmation the heartbeat will need to supply. Because the work is already done, the EA can act on the tick the level is reached instead of spending that tick computing.

Armed setups are re-scored continuously and expire on their own terms. A setup whose structure has been invalidated is dropped immediately rather than left to trigger later on a level that no longer means anything.

The queue must always hold at least one armed setup in each direction where one is available. The opposite-direction armed setup is what the Momentum Shift Capitalizer promotes when the market flips, and keeping it warm is what makes the flip response immediate.

Arming a setup never commits risk. Every armed setup must still pass the drawdown governor at the moment of triggering, because conditions may have changed between arming and trigger.

---

# Continuous Profit Harvest

*Keeps the account earning while positions stay open — partial closes at measured milestones, the remainder left as a runner behind a stop at no worse than breakeven plus costs, and every harvest recorded as the basket's new protected floor.*

Tags: Profit Taking, Trailing Stop, Position Management, Basket Exposure, Always-On

## Feature: Continuous Profit Harvest

The EA should be realising profit continuously rather than waiting for a basket to reach a final target and close. The account should be earning while trades are still open.

Each book defines a series of harvest milestones measured in realised movement from its average entry price. The milestones are proportional to the size of the move that produced them, not fixed pip values, so the EA harvests in proportion to what the market actually gave.

At each milestone the EA closes a defined fraction of the book and leaves the remainder running. The fraction taken should decrease at later milestones, so that early profit is banked quickly and the final portion is left to run as long as the move lasts.

Once the first harvest is taken, the stop on the remainder must be moved to no worse than the book's breakeven plus accumulated costs — spread paid, commission and swap. A harvested book must never be allowed to return to an overall loss. This is a hard rule.

Every harvest updates the book's protected profit floor: the amount of profit that is now realised and can no longer be given back. That floor is the number the Intelligent Position Addition Manager reads when deciding whether the book can afford another position, and the number the drawdown governor reads when deciding how much further risk the account can carry.

Harvesting is suppressed while the heartbeat reports Expanding in the book's favour. A book running inside a strong expansion should be trailed rather than sliced, because harvesting into acceleration gives away the part of the move that pays for the losing trades.

---

# Directional Stack with Basket Trailing

*Multiple positions in one direction, trailed as a single basket off the volume-weighted average rather than per-ticket, with the trail recalculated on every add and allowed to move only in the tightening direction.*

Tags: Position Management, Trailing Stop, Basket Exposure, Lot Sizing, Risk Control

## Feature: Directional Stack with Basket Trailing

When a direction is working, the EA should be able to hold several positions in that direction and manage them as one basket, taking trailing profit on the whole stack rather than on individual tickets.

The trailing stop is computed from the book's volume-weighted average entry price and its current floating profit, never from any single ticket's entry. A basket of five positions has one trail level, and all five positions are closed together when it is hit.

The trail distance adapts to the heartbeat. In an Expanding state the trail is given more room, because tightening into acceleration closes the trade in the middle of the move. In a Drifting or Exhausting state the trail tightens, because the move is running out and the remaining profit is worth more than the remaining upside.

The trail may only ever move in the direction that reduces risk. Once it has advanced, it must never be widened, loosened, or reset — not on a new position, not on a new session, not on a restart. This must be enforced at the point of writing the value, so that no module anywhere in the EA can move it backwards.

Every time a position is added to the stack, the trail is immediately recalculated for the new average price and the new total lot size, and the recalculated level must be at least as protective as the one it replaces. If adding a position would force the trail to be loosened in order to stay valid, the position is not added.

Stack depth and total lots per direction are capped by the drawdown governor. The stack asks; the governor decides. A stack that has reached its cap continues to trail and harvest normally, it simply stops adding.

---

# Momentum Shift Capitalizer

*Treats a confirmed regime flip as the highest-value event the EA sees — stops feeding the fading side, harvests it, promotes the already-armed opposite setup, and begins stacking the new direction within the same heartbeat cycle.*

Tags: Momentum, Entry Logic, Market Structure, Position Management, Hedging

## Feature: Momentum Shift Capitalizer

A momentum shift is the most valuable event the EA will see, and the EA must be built to profit from it rather than to survive it.

A shift is confirmed when the heartbeat reports a change in the sign of direction pressure, accompanied by expansion in the new direction, and accompanied by a break of the structure level that was holding the old direction. All three are required. One or two of them is noise, and acting on noise here is expensive because the response is large.

On a confirmed shift the EA takes the following actions, in this order, within the same heartbeat cycle that detected it. Waiting for the next bar is forbidden.

Stop feeding the fading side. No further positions are added to the book that was working with the old direction, regardless of what its own entry logic wants.

Harvest the fading side. Take whatever profit that book is holding rather than letting the shift take it back. The trail tightens immediately to the tightest level the heartbeat permits.

Promote the armed opposite setup. The Next-Setup Anticipation Queue is already holding a prepared entry in the new direction. That setup is promoted and taken as soon as its trigger and confirmation are met, which is normally immediately, because a shift usually happens at the level the queue was watching.

Begin stacking the new direction under the normal rules of the Directional Stack.

If the fading side is in loss rather than profit, the shift handler does not close it at market. It hands the book to the Drawdown Lock, which is the correct owner of a losing position in a moving market.

A shift confirmed in the opposite direction within a short window of a previous shift is treated as chop, not as a second opportunity. The EA must count recent shifts and require progressively stronger confirmation as they cluster, so that a ranging market cannot whipsaw the EA into repeatedly flipping its whole book.

---

# Drawdown Lock

*Freezes a losing basket at a known number by opening an opposing position against it, converts the open-ended loss into a fixed debt, and releases the legs one at a time only at structure that favours the release — never both at once, never widened.*

Tags: Drawdown Control, Hedging, Recovery, Risk Control, Position Management

## Feature: Drawdown Lock

The EA must be able to stop a bad trade from getting worse without closing it at the worst possible moment. This is the mechanism that lets the EA be left running.

When a book's floating loss reaches its lock threshold, and the heartbeat confirms that the move against it is real rather than a spike — expansion against the book, structure broken, direction pressure sustained against it — the EA opens an opposing position sized to bring net exposure on that basket to zero.

From that moment the loss is fixed. It cannot grow with price. The EA records it as a debt in account currency, and the job changes from defending a position to earning that debt back.

The lock is one-directional in its tightness. It may be made tighter, never looser. The EA must never widen a lock, never partially unwind a lock to "give it room", and never add to the losing side while a lock is in place.

Release happens one leg at a time and only at structure that favours the release. The EA closes the leg that is in profit at a level where the heartbeat indicates the move in its favour is exhausting, leaving the other leg exposed in the direction it now expects. If it is wrong about that, the lock can be reapplied at the same threshold; that is an acceptable cost and is why the threshold is fixed. Closing both legs simultaneously is forbidden, because it realises the whole debt with nothing earned against it.

While a lock is in place, the debt is carried against the account's profit in every report the EA produces. A lock that is never released is a permanent unrealised loss wearing a disguise, and the EA must age its locks and escalate to the drawdown governor when a lock has been carried beyond its maximum age.

Swap and carrying cost on a locked basket must be accounted for. A hedged basket is not free to hold, and on some instruments the cost of both legs is material. The EA must include that running cost in the debt figure, so the recovery target is honest.

---

# Drawdown Governor

*The single authority every risk-adding module must ask first — hard ceilings on gross and per-direction lots, stack depth, floating loss, daily loss and equity-peak drawdown, enforced through three modes that can veto new risk but can never force a trade.*

Tags: Risk Control, Drawdown Control, Always-On, Basket Exposure, Lot Sizing

## Feature: Drawdown Governor

This is the feature that makes the EA safe to leave running. It is a single authority that every risk-adding module must ask before it can open or increase a position. It can refuse. It can never require a trade to be taken.

The governor enforces hard ceilings, all expressed relative to current equity rather than as fixed numbers, so that they scale as the account grows and tighten as it shrinks:

- Maximum gross lots across both books.
- Maximum lots in any one direction.
- Maximum positions in any one directional stack.
- Maximum total floating loss as a proportion of equity.
- Maximum loss in a single day, measured from that day's opening equity.
- Maximum drawdown from the highest equity the account has ever reached.

The governor operates in three modes and publishes its current mode to every other module.

In Normal mode, all features operate under their own rules subject to the ceilings above.

In Defensive mode — entered when any ceiling is approached, when a lock is carried, or when the heartbeat reports a guarded execution condition — the EA may manage, trail, harvest and release, but may not open any new position or add to any stack. Defensive mode is exited only when the condition that caused it has cleared and stayed clear for a defined period, so the EA cannot oscillate in and out of it.

In Lockdown — entered when a hard ceiling is breached — the EA closes everything in an orderly sequence and stops trading until it is manually reset. The reset must be explicit. The EA must never reset its own lockdown on a new day, a new session or a restart, because the whole value of a lockdown is that it survives the thing that caused it.

The governor also owns the calendar: scheduled high-impact news, the daily rollover window, the weekend close, and thin-liquidity sessions. In each of these windows the EA defaults to Defensive rather than Normal.

On restart, the governor is the first module to initialise. It reads the account's current state, adopts existing positions, recomputes every ceiling against current equity, and decides the starting mode before any other module is allowed to act.

---

# Dual-Objective Scorecard

*Keeps a running record of every completed cycle scored on both axes — did it lower drawdown, did it raise profit — and feeds that record back so the conditions and settings that produced bad cycles are throttled rather than repeated.*

Tags: Drawdown Control, Risk Control, Always-On, Recovery

## Feature: Dual-Objective Scorecard

The EA's standing objective is to lower drawdown and increase profit. This feature is how the EA knows whether it is actually doing that, rather than assuming it.

The EA defines a cycle as everything between one flat-or-hedged state and the next: the entries taken, the additions made, any lock applied and released, the harvests taken, and the final result.

For every completed cycle the EA records, at minimum: realised profit, peak floating drawdown reached during the cycle, the market state the cycle opened in, whether a lock was used, how long it was carried, how many positions were stacked, and which entry rule produced the first position.

Each cycle is then scored on both axes independently. A profitable cycle that reached a deep drawdown is not recorded as a clean win, and a small-loss cycle that never exposed the account is not recorded as a plain loss. Recording only the profit figure is what allows an EA to look healthy right up until the day it is not.

The EA uses this record to throttle itself. Conditions that have repeatedly produced deep-drawdown cycles have their maximum stack depth and lot size reduced. Conditions that have repeatedly produced clean cycles are allowed their full allowance. Throttling only ever reduces permission; the scorecard may never grant more risk than the drawdown governor's ceilings allow.

The record must persist across restarts and be readable outside the terminal, so that the EA's behaviour can be reviewed without having to watch it trade.

Nothing in this feature may act as an entry signal. It adjusts how much the EA is allowed to do; it never decides what the EA does.

---
