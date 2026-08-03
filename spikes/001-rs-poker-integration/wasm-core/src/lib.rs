use rs_poker::core::{Hand, Rankable};
use wasm_bindgen::prelude::*;

/// Smallest useful browser seam: parse 5-7 cards and return the rank category.
/// rs-poker itself exposes Rust types only, so every browser operation needs a
/// wrapper like this (or a larger serialized command/state API).
#[wasm_bindgen]
pub fn rank_category(cards: &str) -> Result<String, JsError> {
    let hand = Hand::new_from_str(cards).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(format!("{:?}", hand.rank().category()))
}
