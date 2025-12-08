use leptos::prelude::*;
use leptos::ev;

#[component]
pub fn HexHighlighter<F>(
    value: String,
    on_input: F,
    #[prop(optional)] placeholder: Option<String>,
    #[prop(optional)] highlight_range: Option<(usize, usize)>,
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
        <div class="hex-highlighter-container">
            <div 
                class="hex-highlight-overlay"
                aria-hidden="true"
                inner_html=move || create_highlighted_hex(&value_for_highlight, highlight_range)
            />
            <textarea
                class="hex-textarea input-area msgpack-textarea"
                placeholder=placeholder.clone().unwrap_or_default()
                on:input=handle_input
                spellcheck="false"
            >
                {value_for_textarea}
            </textarea>
        </div>
    }
}

fn create_highlighted_hex(text: &str, range: Option<(usize, usize)>) -> String {
    if text.is_empty() {
        return String::new();
    }
    
    let escaped = escape_html(text);
    
    if let Some((start, end)) = range {
        if start < end && end <= escaped.len() {
            let before = &escaped[..start];
            let highlighted = &escaped[start..end];
            let after = &escaped[end..];
            return format!(
                "{}<span class=\"hex-highlight\">{}</span>{}",
                before, highlighted, after
            );
        }
    }
    
    escaped
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
