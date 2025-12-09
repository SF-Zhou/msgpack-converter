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
