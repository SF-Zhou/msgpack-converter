use wasm_bindgen::prelude::*;
use js_sys::Reflect;

/// Escape HTML special characters to prevent XSS attacks
pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#039;")
}

/// Call Prism.highlight from JavaScript
fn call_prism_highlight(code: &str, grammar: &JsValue, language: &str) -> Option<String> {
    let window = web_sys::window()?;
    let prism = Reflect::get(&window, &JsValue::from_str("Prism")).ok()?;
    let highlight_fn = Reflect::get(&prism, &JsValue::from_str("highlight")).ok()?;
    
    let highlight_fn: js_sys::Function = highlight_fn.dyn_into().ok()?;
    
    let result = highlight_fn.call3(
        &prism,
        &JsValue::from_str(code),
        grammar,
        &JsValue::from_str(language),
    ).ok()?;
    
    result.as_string()
}

/// Get the Prism JSON grammar from the global Prism object
fn get_prism_json_grammar() -> Option<JsValue> {
    let window = web_sys::window()?;
    let prism = Reflect::get(&window, &JsValue::from_str("Prism")).ok()?;
    let languages = Reflect::get(&prism, &JsValue::from_str("languages")).ok()?;
    Reflect::get(&languages, &JsValue::from_str("json")).ok()
}

/// Highlight JSON code using PrismJS
/// Falls back to escaped HTML if PrismJS is not available
pub fn highlight_json(code: &str) -> String {
    if code.is_empty() {
        return String::new();
    }

    // Try to use PrismJS if available
    if let Some(grammar) = get_prism_json_grammar() {
        if let Some(highlighted) = call_prism_highlight(code, &grammar, "json") {
            return highlighted;
        }
    }
    
    // Fallback to escaped HTML
    escape_html(code)
}

/// Highlight hex code with optional range highlighting
pub fn highlight_hex(code: &str, highlight_range: Option<(usize, usize)>) -> String {
    if code.is_empty() {
        return String::new();
    }

    match highlight_range {
        Some((char_start, char_end)) => {
            if char_start > char_end || char_end > code.len() {
                // Invalid range: fallback to escaped HTML
                escape_html(code)
            } else {
                let before = escape_html(&code[..char_start]);
                let highlighted = escape_html(&code[char_start..char_end]);
                let after = escape_html(&code[char_end..]);
                format!(r#"{}<span class="hex-highlight">{}</span>{}"#, before, highlighted, after)
            }
        }
        None => escape_html(code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_html_basic() {
        assert_eq!(escape_html("hello"), "hello");
        assert_eq!(escape_html(""), "");
    }

    #[test]
    fn test_escape_html_special_chars() {
        assert_eq!(escape_html("<script>"), "&lt;script&gt;");
        assert_eq!(escape_html("a & b"), "a &amp; b");
        assert_eq!(escape_html(r#""quoted""#), "&quot;quoted&quot;");
        assert_eq!(escape_html("it's"), "it&#039;s");
    }

    #[test]
    fn test_escape_html_xss_prevention() {
        let malicious = r#"<script>alert('xss')</script>"#;
        let escaped = escape_html(malicious);
        assert!(!escaped.contains('<'));
        assert!(!escaped.contains('>'));
        assert!(escaped.contains("&lt;"));
        assert!(escaped.contains("&gt;"));
    }

    #[test]
    fn test_highlight_hex_empty() {
        assert_eq!(highlight_hex("", None), "");
        assert_eq!(highlight_hex("", Some((0, 0))), "");
    }

    #[test]
    fn test_highlight_hex_no_range() {
        assert_eq!(highlight_hex("81 A5", None), "81 A5");
    }

    #[test]
    fn test_highlight_hex_with_range() {
        let result = highlight_hex("81 A5 68", Some((3, 5)));
        assert!(result.contains(r#"<span class="hex-highlight">A5</span>"#));
    }

    #[test]
    fn test_highlight_hex_invalid_range() {
        // char_start > char_end
        assert_eq!(highlight_hex("81 A5", Some((5, 3))), "81 A5");
        // char_end > code.len()
        assert_eq!(highlight_hex("81 A5", Some((0, 100))), "81 A5");
    }

    #[test]
    fn test_highlight_hex_escapes_content() {
        let result = highlight_hex("<script>", Some((0, 4)));
        assert!(result.contains("&lt;scr"));
    }

    // Note: highlight_json tests are only available in wasm32 target
    // since they require PrismJS/browser environment
    #[cfg(target_arch = "wasm32")]
    #[test]
    fn test_highlight_json_empty() {
        assert_eq!(highlight_json(""), "");
    }

    #[cfg(target_arch = "wasm32")]
    #[test]
    fn test_highlight_json_fallback() {
        // Without PrismJS available, should fallback to escaped HTML
        let result = highlight_json(r#"{"key": "value"}"#);
        // Should at least be non-empty and contain escaped content
        assert!(!result.is_empty());
    }
}
