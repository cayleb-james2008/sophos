//! `native_token_estimate` — estimate the token count of a string.
//!
//! Uses a lightweight heuristic (no model): ~4 chars/token blended with a
//! word-based estimate, taking the larger of the two. Good enough for context
//! budgeting and progress display; not a substitute for a real tokenizer.

use crate::contract::TokenEstimate;

/// Estimate tokens for `text`.
pub fn estimate(text: &str) -> TokenEstimate {
    let chars = text.chars().count();
    let words = text.split_whitespace().count();

    // ~4 chars per token for mixed prose/code.
    let by_chars = (chars as f64 / 4.0).ceil() as u64;
    // ~1.3 tokens per word.
    let by_words = (words as f64 * 1.3).ceil() as u64;

    let tokens = by_chars.max(by_words).max(1);
    TokenEstimate {
        tokens,
        chars,
        words,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_nonzero_for_empty() {
        let e = estimate("");
        assert!(e.tokens >= 1);
        assert_eq!(e.chars, 0);
        assert_eq!(e.words, 0);
    }

    #[test]
    fn counts_words_and_chars() {
        let e = estimate("hello world");
        assert_eq!(e.chars, 11);
        assert_eq!(e.words, 2);
        assert!(e.tokens >= 2);
    }

    #[test]
    fn longer_text_has_more_tokens() {
        let short = estimate("a").tokens;
        let long = estimate("a b c d e f g h i j k l m n o p").tokens;
        assert!(long > short);
    }
}
