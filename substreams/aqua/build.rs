use anyhow::Result;
use substreams_ethereum::Abigen;

// Rust bindings for the Aqua registry ABI (the same file the subgraph uses).
fn main() -> Result<()> {
    Abigen::new("Aqua", "abi/Aqua.json")?
        .generate()?
        .write_to_file("src/abi/aqua.rs")?;
    Ok(())
}
