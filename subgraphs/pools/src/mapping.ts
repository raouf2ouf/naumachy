import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { Swap as SwapEvent, UniswapV3Pool } from "../generated/WethUsdc100/UniswapV3Pool";
import { ERC20 } from "../generated/WethUsdc100/ERC20";
import { Pool, PoolDayData, Swap, Token } from "../generated/schema";

const ZERO = BigInt.zero();
const ONE = BigInt.fromI32(1);

// A token is read once from the chain; a token that refuses to answer keeps a placeholder symbol
// and 18 decimals, and the mapping notes nothing else about it.
function token(addr: Address): Token {
  let id = addr.toHexString();
  let t = Token.load(id);
  if (t != null) return t;
  t = new Token(id);
  let erc = ERC20.bind(addr);
  let sym = erc.try_symbol();
  let dec = erc.try_decimals();
  t.symbol = sym.reverted ? "?" : sym.value;
  t.decimals = dec.reverted ? BigInt.fromI32(18) : BigInt.fromI32(dec.value);
  t.save();
  return t;
}

// A pool is created on its first swap in range: token addresses and fee from the pool itself.
function pool(addr: Address, block: BigInt): Pool {
  let id = addr.toHexString();
  let p = Pool.load(id);
  if (p != null) return p;
  let c = UniswapV3Pool.bind(addr);
  p = new Pool(id);
  p.token0 = token(c.token0()).id;
  p.token1 = token(c.token1()).id;
  p.feeTier = BigInt.fromI32(c.fee());
  p.txCount = ZERO;
  p.createdAtBlock = block;
  p.save();
  return p;
}

function scale(raw: BigInt, decimals: BigInt): BigDecimal {
  let d = BigInt.fromI32(10).pow(decimals.toI32() as u8).toBigDecimal();
  return raw.toBigDecimal().div(d);
}

export function handleSwap(event: SwapEvent): void {
  let p = pool(event.address, event.block.number);
  let t0 = Token.load(p.token0)!;
  let t1 = Token.load(p.token1)!;
  let amount0 = scale(event.params.amount0, t0.decimals);
  let amount1 = scale(event.params.amount1, t1.decimals);

  let s = new Swap(event.transaction.hash.toHexString() + "-" + event.logIndex.toString());
  s.pool = p.id;
  s.timestamp = event.block.timestamp;
  s.block = event.block.number;
  s.amount0 = amount0;
  s.amount1 = amount1;
  s.sqrtPriceX96 = event.params.sqrtPriceX96;
  s.tick = BigInt.fromI32(event.params.tick);
  s.save();

  p.txCount = p.txCount.plus(ONE);
  p.save();

  let day = event.block.timestamp.toI32() / 86400;
  let dayId = p.id + "-" + day.toString();
  let d = PoolDayData.load(dayId);
  if (d == null) {
    d = new PoolDayData(dayId);
    d.pool = p.id;
    d.date = day * 86400;
    d.txCount = ZERO;
    d.volumeToken0 = BigDecimal.zero();
    d.volumeToken1 = BigDecimal.zero();
    d.volumeUSD = BigDecimal.zero();
  }
  d.txCount = d.txCount.plus(ONE);
  let abs0 = amount0.lt(BigDecimal.zero()) ? amount0.neg() : amount0;
  let abs1 = amount1.lt(BigDecimal.zero()) ? amount1.neg() : amount1;
  d.volumeToken0 = d.volumeToken0.plus(abs0);
  d.volumeToken1 = d.volumeToken1.plus(abs1);
  d.save();
}
