use leptos::prelude::*;
use leptos::ev;

#[component]
pub fn JsonHighlighter<F>(
    value: String,
    on_input: F,
    #[prop(optional)] placeholder: Option<String>,
    #[prop(optional)] on_selection_change: Option<Box<dyn Fn(usize, usize)>>,
) -> impl IntoView
where
    F: Fn(String) + 'static,
{
    let value_for_highlight = value.clone();
    let value_for_textarea = value.clone();
    
    let handle_input = move |ev: ev::Event| {
        on_input(event_target_value(&ev));
    };
    
    view! {
        <div class="json-highlighter-container">
            <div 
                class="json-highlight-overlay"
                aria-hidden="true"
                inner_html=move || highlight_json(&value_for_highlight)
            />
            <textarea
                class="json-textarea input-area"
                placeholder=placeholder.unwrap_or_default()
                on:input=handle_input
                spellcheck="false"
            >
                {value_for_textarea}
            </textarea>
        </div>
    }
}

fn highlight_json(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    
    // Escape HTML first
    let text = escape_html(text);
    
    // Simple JSON syntax highlighting
    let mut result = String::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let mut in_string = false;
    let mut escape_next = false;
    
    while i < chars.len() {
        let ch = chars[i];
        
        if escape_next {
            result.push(ch);
            escape_next = false;
            i += 1;
            continue;
        }
        
        if ch == '\\' && in_string {
            escape_next = true;
            result.push(ch);
            i += 1;
            continue;
        }
        
        if ch == '"' {
            if !in_string {
                // Start of string
                in_string = true;
                result.push_str("<span class=\"token string\">\"");
            } else {
                // End of string
                in_string = false;
                result.push_str("\"</span>");
            }
            i += 1;
            continue;
        }
        
        if in_string {
            result.push(ch);
            i += 1;
            continue;
        }
        
        // Check for numbers
        if ch.is_numeric() || (ch == '-' && i + 1 < chars.len() && chars[i + 1].is_numeric()) {
            result.push_str("<span class=\"token number\">");
            while i < chars.len() && (chars[i].is_numeric() || chars[i] == '.' || chars[i] == 'e' || chars[i] == 'E' || chars[i] == '-' || chars[i] == '+') {
                result.push(chars[i]);
                i += 1;
            }
            result.push_str("</span>");
            continue;
        }
        
        // Check for keywords
        if ch.is_alphabetic() {
            let mut word = String::new();
            while i < chars.len() && chars[i].is_alphabetic() {
                word.push(chars[i]);
                i += 1;
            }
            
            match word.as_str() {
                "true" | "false" => {
                    result.push_str(&format!("<span class=\"token boolean\">{}</span>", word));
                }
                "null" => {
                    result.push_str(&format!("<span class=\"token null\">{}</span>", word));
                }
                _ => {
                    result.push_str(&word);
                }
            }
            continue;
        }
        
        result.push(ch);
        i += 1;
    }
    
    result
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}





