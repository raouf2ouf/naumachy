mod abi;
#[allow(unused)]
mod pb;

use hex_literal::hex;
use pb::naumachy::aqua::v1 as aqua;
use substreams::Hex;
use substreams_ethereum::pb::eth::v2 as eth;
use substreams_ethereum::Event;

substreams_ethereum::init!();

// The two Aqua registries share one address on every chain 1inch deployed them to.
const CANONICAL: [u8; 20] = hex!("1111113ccf1426a8e30e2bff5e005d929bf6a90a");
const LEGACY: [u8; 20] = hex!("499943e74fb0ce105688beee8ef2abec5d936d31");

fn hex0x(bytes: &[u8]) -> String {
    format!("0x{}", Hex(bytes))
}

fn at(blk: &eth::Block, tx: &eth::TransactionTrace, log: &eth::Log) -> Option<aqua::Ref> {
    Some(aqua::Ref {
        block_number: blk.number,
        block_time: Some(blk.timestamp().to_owned()),
        tx_hash: hex0x(&tx.hash),
        tx_from: hex0x(&tx.from),
        log_index: log.block_index,
        ordinal: log.ordinal,
        registry: hex0x(&log.address),
    })
}

// Decodes the four registry events from the logs of successful transactions. The block filter
// in the manifest keeps blocks without a registry log from reaching this module at all.
#[substreams::handlers::map]
fn map_events(blk: eth::Block) -> Result<aqua::Events, substreams::errors::Error> {
    let mut events = aqua::Events::default();
    for rcpt in blk.receipts() {
        let tx = rcpt.transaction;
        for log in rcpt.receipt.logs.iter().filter(|l| l.address == CANONICAL || l.address == LEGACY) {
            if let Some(e) = abi::aqua::events::Shipped::match_and_decode(log) {
                events.shipped.push(aqua::Shipped {
                    at: at(&blk, tx, log),
                    maker: hex0x(&e.maker),
                    app: hex0x(&e.app),
                    strategy_hash: hex0x(&e.strategy_hash),
                    strategy: e.strategy,
                });
            } else if let Some(e) = abi::aqua::events::Docked::match_and_decode(log) {
                events.docked.push(aqua::Docked {
                    at: at(&blk, tx, log),
                    maker: hex0x(&e.maker),
                    app: hex0x(&e.app),
                    strategy_hash: hex0x(&e.strategy_hash),
                });
            } else if let Some(e) = abi::aqua::events::Pushed::match_and_decode(log) {
                events.pushed.push(aqua::Pushed {
                    at: at(&blk, tx, log),
                    maker: hex0x(&e.maker),
                    app: hex0x(&e.app),
                    strategy_hash: hex0x(&e.strategy_hash),
                    token: hex0x(&e.token),
                    amount: e.amount.to_string(),
                });
            } else if let Some(e) = abi::aqua::events::Pulled::match_and_decode(log) {
                events.pulled.push(aqua::Pulled {
                    at: at(&blk, tx, log),
                    maker: hex0x(&e.maker),
                    app: hex0x(&e.app),
                    strategy_hash: hex0x(&e.strategy_hash),
                    token: hex0x(&e.token),
                    amount: e.amount.to_string(),
                });
            }
        }
    }
    Ok(events)
}
