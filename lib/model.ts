// Token radar value model (entry's own design). Node 22, standard library only, no network.
//
// Pipeline: classify -> category multiples -> implied value -> board selection -> farm plans.
//
//   1. A protocol HAS A TOKEN when mcap_usd, gecko_id or symbol is present; otherwise it is PRE-TOKEN.
//   2. For every category, multiple = median(mcap_usd / tvl_usd) over its has-token protocols with a
//      positive market cap and TVL. A category with fewer than MIN_SAMPLE such protocols uses the
//      global median (CEX excluded: an exchange's "TVL" is its reserves, not a protocol's locked value).
//   3. implied = tvl_usd x category multiple x growth factor x age factor, where
//        growth factor = 1 + 0.5 x clamp(change_7d, -50, +100) / 100        (range 0.75 .. 1.50; null -> 1)
//        age factor    = 0.60 + 0.40 x ln(1 + min(age, 1460)) / ln(1 + 1460) (range 0.60 .. 1.00; null -> 365 d)
//      age = days from listed_at to the snapshot's as_of, i.e. how long the protocol has been tracked
//      with no token. Rising TVL raises the claim, a long record with no token slowly earns more
//      credit than a brand-new listing.
//   4. The board holds every watchlist slug plus every other pre-token protocol (down to the snapshot's
//      own floor) that passes the watchlist's exclusion logic as far as the snapshot's ten fields
//      let it be applied: no versioned names, no wrapped/staked/staking names, no bridge / staking /
//      CEX categories, no exchange-name prefixes.
//   5. Each row gets a farm plan of 3..12 steps built from its category, chains, TVL tier and age.
//
// No protocol is special-cased by name: one function scores every row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'category-multiple-1';

/** The model's constants, stated in board.json's meta so a reader can audit every row. */
export const PARAMS = {
  min_sample: 5,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_weight: 0.5,
  age_floor: 0.6,
  age_range: 0.4,
  age_cap_days: 1460,
  unknown_age_days: 365,
  multiple_floor: 0.02,
  multiple_cap: 25,
};

export const MODEL_NOTE =
  'Implied value = TVL x category multiple x growth factor x age factor. The category multiple is the median market-cap-to-TVL ratio of the ' +
  'protocols in the same DefiLlama category whose token is already recorded (at least 5 of them, otherwise the global median of all token-bearing protocols). ' +
  'The growth factor is 1 + 0.5 x the 7-day TVL change in per cent (clamped to -50..+100), so it runs from 0.75 to 1.50 and is 1 when no change is reported. ' +
  'The age factor is 0.60 + 0.40 x ln(1 + days) / ln(1 + 1460), where days run from the day DefiLlama began tracking the protocol to the snapshot date (capped at four years; 365 when unknown): ' +
  'a brand-new listing counts for 0.60 of the claim and a protocol that has run four years with no token for the whole of it. ' +
  'It states what a token might be worth if the protocol\'s record stayed as it is, as this entry\'s own claim; it does not predict whether or when a token is issued, and a protocol that records no token here may still have one DefiLlama does not carry.';

// ---------------------------------------------------------------------------------------------
// Classification and exclusions
// ---------------------------------------------------------------------------------------------

export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Why the watchlist's logic would leave a protocol out (as far as the ten fields tell), or null. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked/staking product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Multiples
// ---------------------------------------------------------------------------------------------

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export interface CategoryMultiple {
  category: string;
  n: number;
  median: number | null;
  multiple: number;
  source: 'category' | 'global';
}

export interface Multiples {
  global: number;
  global_n: number;
  byCategory: Map<string, CategoryMultiple>;
}

const clampMultiple = (m: number): number => Math.min(PARAMS.multiple_cap, Math.max(PARAMS.multiple_floor, m));

export function computeMultiples(protocols: SnapshotProtocol[]): Multiples {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (!hasToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? '(none)';
    const r = p.mcap_usd / p.tvl_usd;
    (ratios.get(key) ?? ratios.set(key, []).get(key)!).push(r);
    if (p.category !== 'CEX') all.push(r);
  }
  const global = clampMultiple(median(all));
  const categories = new Set<string>(protocols.map((p) => p.category ?? '(none)'));
  const byCategory = new Map<string, CategoryMultiple>();
  for (const c of [...categories].sort()) {
    const rs = ratios.get(c) ?? [];
    const enough = rs.length >= PARAMS.min_sample;
    byCategory.set(c, {
      category: c,
      n: rs.length,
      median: rs.length > 0 ? median(rs) : null,
      multiple: enough ? clampMultiple(median(rs)) : global,
      source: enough ? 'category' : 'global',
    });
  }
  return { global, global_n: all.length, byCategory };
}

// ---------------------------------------------------------------------------------------------
// Implied value
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function growthFactor(change7d: number | null): { pct: number; factor: number } {
  const pct = change7d === null ? 0 : Math.min(PARAMS.growth_cap_pct, Math.max(PARAMS.growth_floor_pct, change7d));
  return { pct, factor: 1 + (pct / 100) * PARAMS.growth_weight };
}

export function ageFactor(age: number | null): number {
  const d = Math.min(PARAMS.age_cap_days, age ?? PARAMS.unknown_age_days);
  return PARAMS.age_floor + PARAMS.age_range * (Math.log1p(d) / Math.log1p(PARAMS.age_cap_days));
}

export interface Scored {
  p: SnapshotProtocol;
  multiple: CategoryMultiple;
  growth_pct: number;
  growth_factor: number;
  age_days: number | null;
  age_factor: number;
  implied: number;
}

export function scoreProtocol(p: SnapshotProtocol, asOf: string, m: Multiples): Scored {
  const multiple = m.byCategory.get(p.category ?? '(none)') ?? { category: p.category ?? '(none)', n: 0, median: null, multiple: m.global, source: 'global' as const };
  const g = growthFactor(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const af = ageFactor(age);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple.multiple * g.factor * af));
  return { p, multiple, growth_pct: g.pct, growth_factor: g.factor, age_days: age, age_factor: af, implied };
}

// ---------------------------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------------------------

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Rough one-transaction fee by chain, in dollars: the entry's own assumption, stated as such in the plan. */
function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 6;
  if (c === 'bitcoin') return 3;
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'ton' || c === 'sei') return 0.02;
  if (c === 'bsc' || c === 'polygon' || c === 'avalanche' || c === 'tron' || c === 'cronos' || c === 'gnosis') return 0.15;
  if (['arbitrum', 'optimism', 'base', 'linea', 'scroll', 'blast', 'mantle', 'zksync era', 'manta', 'mode', 'unichain', 'ink', 'soneium', 'berachain', 'sonic', 'hyperliquid l1', 'plasma'].includes(c)) return 0.25;
  return 0.5;
}

const usd = (n: number): string => (n >= 10 || Number.isInteger(n) ? `$${Math.round(n)}` : n >= 1 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`);

function capitalFor(tvl: number): number {
  if (tvl >= 2_000_000_000) return 200;
  if (tvl >= 500_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 30_000_000) return 75;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 90) return 60;
  if (age < 270) return 45;
  return 30;
}

type Family =
  | 'lending' | 'dex' | 'derivatives' | 'yield' | 'staking' | 'stable' | 'rwa' | 'bridge' | 'prediction'
  | 'launchpad' | 'index' | 'privacy' | 'payments' | 'chain' | 'insurance' | 'ai' | 'nft' | 'otc' | 'generic';

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (/lending|collateral|capital allocator|risk curator/.test(c)) return 'lending';
  if (/cdp|stablecoin|algo-stable|reserve currency|dual-token|dor/.test(c)) return 'stable';
  if (/dex|liquidity manager|launchpad/.test(c)) return c.includes('launchpad') ? 'launchpad' : 'dex';
  if (/derivative|perp|option|synthetic|basis/.test(c)) return 'derivatives';
  if (/yield|farm|vault/.test(c)) return 'yield';
  if (/staking|restak/.test(c)) return 'staking';
  if (/rwa/.test(c)) return 'rwa';
  if (/bridge/.test(c)) return 'bridge';
  if (/prediction/.test(c)) return 'prediction';
  if (/index/.test(c)) return 'index';
  if (/privacy/.test(c)) return 'privacy';
  if (/payment|card/.test(c)) return 'payments';
  if (/chain/.test(c)) return 'chain';
  if (/insurance/.test(c)) return 'insurance';
  if (/ai/.test(c)) return 'ai';
  if (/nft/.test(c)) return 'nft';
  if (/otc/.test(c)) return 'otc';
  return 'generic';
}

/** The category-specific core steps (2-3), each with its own cost and time. */
function coreSteps(f: Family, p: SnapshotProtocol, chain: string, cap: number, gas: number, age: number | null): FarmStep[] {
  const n = p.name;
  const half = Math.max(10, Math.round(cap / 2));
  const tenth = Math.max(5, Math.round(cap / 5));
  switch (f) {
    case 'lending':
      if (/curator|allocator/i.test(p.category ?? '')) {
        return [
          { text: `Deposit ${usd(cap)} of a major stablecoin into one ${n}-curated vault on ${chain}, picking the vault with the most depositors, and note the net rate after the curator's fee.`, cost: `${usd(cap)} stays deposited, plus ${usd(gas * 2)} gas for approve and deposit`, time: '15 minutes' },
          { text: `Read which underlying markets the ${n} vault allocates to and what its worst-case loss would be, then move ${usd(tenth)} to a second ${n} vault with a different risk mix.`, cost: `${usd(gas * 3)} gas and any withdrawal fee`, time: '20 minutes' },
          { text: `Check the ${n} app for a points, rewards or season tab and confirm your wallet is accruing before adding more.`, cost: 'free', time: '5 minutes' },
        ];
      }
      return [
        { text: `Supply ${usd(cap)} of a major stablecoin to a ${n} market on ${chain} and note the supply rate the app shows.`, cost: `${usd(cap)} stays in the market, plus ${usd(gas * 2)} gas for approve and deposit`, time: '15 minutes' },
        { text: `Borrow a small amount (about ${usd(half / 4)}) against volatile collateral on ${n}, keeping the health factor above 2, then repay it in full a few days later.`, cost: `${usd(gas * 4)} gas plus a few cents of interest`, time: '20 minutes, repay in 3-5 days' },
        { text: `Check the ${n} app for a points, rewards or season tab and confirm your wallet is accruing before adding more.`, cost: 'free', time: '5 minutes' },
      ];
    case 'dex':
      return [
        { text: `Swap ${usd(tenth)} through ${n} on ${chain} across two different pairs, one stable and one volatile, to show organic trading.`, cost: `${usd(gas * 2)} gas plus roughly ${usd(tenth * 0.003)} in swap fees`, time: '10 minutes' },
        { text: `Add ${usd(cap)} of liquidity to a ${n} pool with healthy volume on ${chain} and record the pool address and your share.`, cost: `${usd(cap)} stays in the pool, ${usd(gas * 3)} gas, with some impermanent-loss risk`, time: '20 minutes' },
        { text: `Come back after one week to compound or rebalance the ${n} position and note fees earned against impermanent loss.`, cost: `${usd(gas * 2)} gas`, time: '10 minutes' },
      ];
    case 'derivatives':
      return [
        { text: `Deposit ${usd(cap)} of margin into ${n} on ${chain} and open one small long and one small short at 2x or less, closing both within a day.`, cost: `${usd(gas * 4)} gas plus about ${usd(cap * 0.002)} in trading fees and funding`, time: '30 minutes' },
        { text: `Hold a hedged position (spot against perp, or call against put) sized ${usd(half)} on ${n} for a week so volume and open interest both count.`, cost: `${usd(half)} of margin and ${usd(gas * 3)} gas, with liquidation risk if leverage creeps up`, time: '15 minutes plus a week of checking' },
        { text: `If ${n} offers a liquidity or vault side, put ${usd(tenth)} there once to show you used both sides of its market.`, cost: `${usd(tenth)} plus ${usd(gas * 2)} gas`, time: '10 minutes' },
      ];
    case 'yield':
      return [
        { text: `Deposit ${usd(cap)} into the largest ${n} vault on ${chain}, preferring the one with the longest track record, and keep the vault share token.`, cost: `${usd(cap)} stays deposited, ${usd(gas * 2)} gas, possible small deposit fee`, time: '15 minutes' },
        { text: `Move ${usd(tenth)} between two ${n} strategies after a week to show active use rather than a single idle deposit.`, cost: `${usd(gas * 3)} gas and any withdrawal fee the vault states`, time: '15 minutes' },
        { text: `Read ${n}'s fee and withdrawal terms before adding capital, since lockups and performance fees decide whether the position pays at all.`, cost: 'free', time: '10 minutes' },
      ];
    case 'staking':
      return [
        { text: `Stake or restake ${usd(cap)} of an asset ${n} accepts on ${chain}, choosing one operator or pool with a clean history, and keep the receipt.`, cost: `${usd(cap)} locked, ${usd(gas * 2)} gas`, time: '15 minutes' },
        { text: `Find ${n}'s unstake delay in its docs before you commit, and put the release date in your calendar.`, cost: 'free', time: '5 minutes' },
        { text: `After two weeks, delegate or re-point ${usd(tenth)} of the ${n} stake to a second operator to show the position is managed.`, cost: `${usd(gas * 2)} gas`, time: '10 minutes' },
      ];
    case 'stable':
      return [
        { text: `Mint or deposit ${usd(cap)} against collateral on ${n} (${chain}) at a collateral ratio well above the minimum, so a price dip cannot liquidate you.`, cost: `${usd(cap * 1.5)} of collateral locked, ${usd(gas * 3)} gas, a small mint or stability fee`, time: '20 minutes' },
        { text: `Put the ${n} stable asset to work once, for example in its savings or stability module or one pool, and note where its yield comes from.`, cost: `${usd(half)} deployed, ${usd(gas * 2)} gas`, time: '15 minutes' },
        { text: `Repay part of the ${n} debt after two weeks and re-borrow, so your wallet shows both mint and repay activity.`, cost: `${usd(gas * 3)} gas plus accrued fee`, time: '15 minutes' },
      ];
    case 'rwa':
      return [
        { text: `Check ${n}'s eligibility rules (region, wallet allowlist, minimum ticket) before funding, since many real-world-asset products gate who may buy.`, cost: 'free', time: '15 minutes' },
        { text: `If eligible, buy the smallest allowed amount (at most ${usd(cap)}) of the ${n} yield-bearing asset on ${chain} and hold it through at least one distribution.`, cost: `${usd(cap)} or the minimum ticket, ${usd(gas * 2)} gas`, time: '20 minutes' },
        { text: `Redeem ${usd(tenth)} of it once to learn the exit path, fees and settlement time before relying on it.`, cost: `${usd(gas * 2)} gas and any redemption fee`, time: '15 minutes plus settlement' },
      ];
    case 'bridge':
      return [
        { text: `Send ${usd(half)} of stablecoin through ${n} to ${chain} (or from it), then use the arrived funds in one other app so the route is actually exercised.`, cost: `${usd(gas * 2)} gas plus the bridge fee, typically 0.05-0.3% of the amount`, time: '20 minutes' },
        { text: `Repeat the ${n} transfer in the opposite direction with ${usd(tenth)} after a week to show round-trip use.`, cost: `${usd(gas * 2)} gas plus bridge fee`, time: '20 minutes' },
      ];
    case 'prediction':
      return [
        { text: `Fund a ${n} account with ${usd(cap)} and take small positions (${usd(tenth)} each) on three different markets, at least one on each side.`, cost: `${usd(cap)} at risk, ${usd(gas * 2)} gas`, time: '30 minutes' },
        { text: `Provide liquidity or place resting orders worth ${usd(tenth)} on a ${n} market, if it supports it, and let one market resolve.`, cost: `${usd(tenth)} at risk plus ${usd(gas)} gas`, time: '15 minutes, resolution varies' },
      ];
    case 'launchpad':
      return [
        { text: `Join one live or upcoming sale on ${n} with the minimum allocation (at most ${usd(tenth)}), and read the vesting terms first.`, cost: `${usd(tenth)} at risk and ${usd(gas * 2)} gas, with high project risk`, time: '20 minutes' },
        { text: `Lock or stake the ${n} access asset if tiers need it, but only after reading how allocation is decided.`, cost: `${usd(half)} locked, ${usd(gas * 2)} gas`, time: '15 minutes' },
      ];
    case 'index':
      return [
        { text: `Buy ${usd(cap)} of one ${n} basket on ${chain}, read its rebalancing rule, and hold it through at least one rebalance.`, cost: `${usd(cap)} invested, ${usd(gas * 2)} gas, a mint or management fee`, time: '15 minutes' },
        { text: `Redeem ${usd(tenth)} of the ${n} basket once to confirm the exit works at close to net asset value.`, cost: `${usd(gas * 2)} gas plus redemption fee`, time: '10 minutes' },
      ];
    case 'privacy':
      return [
        { text: `Make one shielded deposit of ${usd(half)} into ${n} on ${chain}, wait for the stated delay, then withdraw to a second fresh wallet.`, cost: `${usd(gas * 3)} gas plus the protocol fee`, time: '30 minutes plus the delay' },
        { text: `Check that your jurisdiction allows using ${n} before you start, and stop if it does not.`, cost: 'free', time: '10 minutes' },
      ];
    case 'payments':
      return [
        { text: `Make three small real payments of about ${usd(tenth / 2)} each through ${n} (a transfer, a top-up and a spend) from one wallet on ${chain}.`, cost: `${usd(tenth * 1.5)} spent, ${usd(gas * 3)} gas`, time: '20 minutes' },
        { text: `Complete any identity or card-ordering step ${n} requires only if you accept the data it asks for, and note any card issuance fee first.`, cost: 'possibly a card or KYC fee, see the app', time: '15 minutes' },
      ];
    case 'chain':
      return [
        { text: `Bridge ${usd(half)} to ${n} and use two or three native apps there (a swap, a lend, a stake), since activity across the ecosystem is what a chain rewards.`, cost: `${usd(gas * 6)} gas across the actions plus a bridge fee`, time: '45 minutes' },
        { text: `Delegate or stake ${usd(half)} of the native asset on ${n} to a validator with a clean record.`, cost: `${usd(half)} locked, ${usd(gas)} gas`, time: '10 minutes' },
      ];
    case 'insurance':
      return [
        { text: `Buy a small cover policy of ${usd(tenth)} from ${n} on a protocol you actually use, for the shortest term offered.`, cost: `about ${usd(tenth * 0.05)} premium plus ${usd(gas * 2)} gas`, time: '15 minutes' },
        { text: `If ${n} lets you underwrite, add ${usd(half)} to a pool you have read the claims history of.`, cost: `${usd(half)} at risk plus ${usd(gas * 2)} gas`, time: '15 minutes' },
      ];
    case 'ai':
      return [
        { text: `Use ${n}'s main product once (an agent run, a model call or a task) with the smallest paid amount, and note what it charged.`, cost: `${usd(tenth)} or less plus ${usd(gas)} gas`, time: '20 minutes' },
        { text: `Link the wallet to your ${n} account only if it asks, and avoid approving unlimited token spending.`, cost: 'free', time: '5 minutes' },
      ];
    case 'nft':
      return [
        { text: `List and buy one low-priced item (under ${usd(tenth)}) on ${n}, then relist it, so your wallet shows both sides of the market.`, cost: `${usd(tenth)} for the item plus ${usd(gas * 3)} gas and marketplace fees`, time: '30 minutes' },
        { text: `Avoid wash trading between your own wallets on ${n}: it can disqualify the wallet from any later reward.`, cost: 'free', time: '5 minutes' },
      ];
    case 'otc':
      return [
        { text: `Place and fill one small ${usd(tenth)} over-the-counter order on ${n} with a counterparty you do not control.`, cost: `${usd(tenth)} swapped plus ${usd(gas * 2)} gas`, time: '20 minutes' },
        { text: `Read the ${n} settlement terms for failed or expired orders before locking anything larger.`, cost: 'free', time: '10 minutes' },
      ];
    default:
      return [
        { text: `Make the main deposit or first transaction the ${n} app offers on ${chain}, sized at ${usd(cap)}, and keep a screenshot of the confirmation.`, cost: `${usd(cap)} stays in the position plus ${usd(gas * 2)} gas`, time: '20 minutes' },
        { text: `Use a second feature of ${n} (a different pool, market or action) with ${usd(tenth)} so your activity is not one repeated click.`, cost: `${usd(tenth)} plus ${usd(gas * 2)} gas`, time: '15 minutes' },
      ];
  }
}

export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chains = p.chains.length > 0 ? p.chains : [];
  const chain = chains[0] ?? 'its main chain';
  const gas = gasUsd(chain);
  const cap = capitalFor(p.tvl_usd);
  const hold = holdDays(age);
  const fam = familyOf(p.category);
  const n = p.name;
  const catLabel = p.category ?? 'uncategorised';
  const steps: FarmStep[] = [];

  steps.push({
    text: `Open a dedicated wallet for ${n} that holds only the money you will farm with, and confirm the app's address from its official docs before connecting. ${n} is listed as ${catLabel} on ${chains.length > 1 ? `${chains.length} chains, led by ${chain}` : chain}.`,
    cost: `${usd(gas)} to fund it`,
    time: '10 minutes',
  });
  if (chain.toLowerCase() !== 'ethereum' && chain !== 'its main chain' && gas < 1) {
    steps.push({
      text: `Bring about ${usd(cap + 20)} of stablecoin onto ${chain} using the cheapest route your exchange or wallet offers, and keep ${usd(Math.max(1, gas * 12))} of the native token for gas.`,
      cost: `about ${usd(Math.max(1, gas * 4))} in transfer fees`,
      time: '15-30 minutes',
    });
  } else if (gas >= 3) {
    steps.push({
      text: `Fees on ${chain} run about ${usd(gas)} per transaction, so batch the setup into as few transactions as you can and avoid peak hours.`,
      cost: `budget ${usd(gas * 6)} for the whole plan`,
      time: '10 minutes of planning',
    });
  }
  steps.push(...coreSteps(fam, p, chain, cap, gas, age));
  if (chains.length > 1) {
    const other = chains.find((c) => c !== chain) ?? chains[1]!;
    steps.push({
      text: `${n} also runs on ${other}${chains.length > 2 ? ` and ${chains.length - 2} other chain${chains.length > 3 ? 's' : ''}` : ''}: repeat one small action there (about ${usd(Math.max(5, cap / 5))}) so the wallet shows use on more than one deployment.`,
      cost: `${usd(Math.max(5, cap / 5))} plus ${usd(gasUsd(other) * 2)} gas`,
      time: '15 minutes',
    });
  }
  if (age !== null && age < 120) {
    steps.push({
      text: `${n} was first tracked only ${age} days before the snapshot, so a young deployment can change terms quickly: start small, and re-read its docs and announcements before every top-up.`,
      cost: 'free',
      time: '5 minutes a week',
    });
  }
  steps.push({
    text: `Hold the ${n} position for at least ${hold} days and add one qualifying action a week, so the activity spans several snapshot windows instead of a single day.`,
    cost: `capital stays in place, about ${usd(gas * 2)} gas a week`,
    time: `${hold} days, 10 minutes a week`,
  });
  steps.push({
    text: `If ${n} ever announces a claim, use only the link on its own site or official account, never sign an unlimited approval, and exit any position you no longer trust.`,
    cost: 'free to check, never pay to claim',
    time: '10 minutes',
  });
  return steps.slice(0, 12);
}

export function stepText(s: FarmStep): string {
  let t = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
  if (t.length > 600) t = `${t.slice(0, 596)}...`;
  if (t.length < 20) t = `${t} Check the protocol's own page.`;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    multiple_source: 'category' | 'global';
    category_sample: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
  mcap_to_tvl: number | null;
}

const bySlugThenValue = (a: Scored, b: Scored): number => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface Radar {
  board: BoardRow[];
  live: LiveRow[];
  multiples: Multiples;
  counts: {
    protocols: number;
    has_token: number;
    pre_token: number;
    pre_token_excluded: number;
    board_rows: number;
    watchlist: number;
    watchlist_on_board: number;
    below_watchlist_floor_rows: number;
  };
  excluded: { slug: string; reason: string }[];
}

export function buildRadar(snapshot: Snapshot): Radar {
  const multiples = computeMultiples(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  const excluded: { slug: string; reason: string }[] = [];

  // The watchlist is the floor: every slug goes on the board.
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every other pre-token protocol the exclusion logic lets through, down to the snapshot's own floor.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || hasToken(p)) continue;
    const why = exclusionReason(p);
    if (why !== null) excluded.push({ slug: p.slug, reason: why });
    else chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => scoreProtocol(p, snapshot.as_of, multiples)).sort(bySlugThenValue);
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age_days,
    implied_value_usd: s.implied,
    model: {
      category_multiple: r4(s.multiple.multiple),
      multiple_source: s.multiple.source,
      category_sample: s.multiple.n,
      growth_pct: s.growth_pct,
      growth_factor: r4(s.growth_factor),
      age_factor: r4(s.age_factor),
    },
    farm_steps: farmPlan(s.p, s.age_days).map(stepText),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter(hasToken)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
      mcap_to_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? r4(p.mcap_usd / p.tvl_usd) : null,
    }));

  const preToken = snapshot.protocols.filter((p) => !hasToken(p)).length;
  return {
    board,
    live,
    multiples,
    excluded,
    counts: {
      protocols: snapshot.protocols.length,
      has_token: live.length,
      pre_token: preToken,
      pre_token_excluded: excluded.length,
      board_rows: board.length,
      watchlist: snapshot.watchlist.length,
      watchlist_on_board: snapshot.watchlist.filter((s) => board.some((r) => r.slug === s)).length,
      below_watchlist_floor_rows: board.filter((r) => !watch.has(r.slug)).length,
    },
  };
}

/** board.json's meta: the model note, constants and the category multiples the values came from. */
export function boardMeta(snapshot: Snapshot, radar: Radar): Record<string, unknown> {
  return {
    model_version: MODEL_VERSION,
    model_note: MODEL_NOTE,
    params: PARAMS,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    global_multiple: r4(radar.multiples.global),
    global_sample: radar.multiples.global_n,
    category_multiples: [...radar.multiples.byCategory.values()].map((c) => ({
      category: c.category,
      sample: c.n,
      median_mcap_to_tvl: c.median === null ? null : r4(c.median),
      multiple_used: r4(c.multiple),
      source: c.source,
    })),
    counts: radar.counts,
  };
}

/** The dashboard's whole dataset as one script (no fetch, no network). */
export function dataScript(snapshot: Snapshot, radar: Radar): string {
  const data = { meta: boardMeta(snapshot, radar), rows: radar.board, live: radar.live };
  return `window.RADAR=${JSON.stringify(data)};\n`;
}

// ---------------------------------------------------------------------------------------------
// Parsing and the gate's own checks
// ---------------------------------------------------------------------------------------------

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('no as_of date');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) throw new SnapshotError('no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('no watchlist of slugs');
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '-' && v !== '' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') throw new SnapshotError(`protocol ${i} lacks slug, name or tvl_usd`);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    } satisfies SnapshotProtocol;
  });
  return { as_of: o.as_of, source: typeof o.source === 'string' ? o.source : '', floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why the board would fail the gate (rows, ranks, order, coverage, farm steps), or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `${board.length} rows, the gate wants 100 to 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `invented slugs: ${invented.slice(0, 3).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} implied value ${r.implied_value_usd}`;
    if (r.name.trim() === '' || /\s/.test(r.slug) || r.slug.length > 128) return `${r.slug} has a bad name or slug`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all implied values are equal';
  return null;
}
