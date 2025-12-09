use leptos::prelude::*;
use wasm_bindgen::prelude::wasm_bindgen;
use web_sys::HtmlTextAreaElement;

mod converter;
mod highlighter;
mod position_mapper;

use converter::{base64_to_hex, hex_to_base64, json_to_msgpack, msgpack_to_json};
use highlighter::{highlight_hex, highlight_json};
use position_mapper::{
    byte_range_to_hex_char_range, create_position_mappings, find_hex_range_for_json_selection,
};

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    // State signals
    let (msgpack_base64, set_msgpack_base64) = signal(String::new());
    let (msgpack_hex, set_msgpack_hex) = signal(String::new());
    let (json_input, set_json_input) = signal(String::new());
    let (error, set_error) = signal(String::new());
    let (hex_highlight_range, set_hex_highlight_range) = signal(Option::<(usize, usize)>::None);

    // Handle base64 input change - update hex in real-time
    let handle_base64_change = move |value: String| {
        set_msgpack_base64.set(value.clone());
        if !value.trim().is_empty() {
            match base64_to_hex(value.trim()) {
                Ok(hex) => {
                    set_msgpack_hex.set(hex);
                    set_error.set(String::new());
                }
                Err(_) => {
                    // Don't update hex if base64 is invalid
                }
            }
        } else {
            set_msgpack_hex.set(String::new());
        }
    };

    // Handle hex input change - update base64 in real-time
    let handle_hex_change = move |value: String| {
        set_msgpack_hex.set(value.clone());
        if !value.trim().is_empty() {
            match hex_to_base64(value.trim()) {
                Ok(base64) => {
                    set_msgpack_base64.set(base64);
                    set_error.set(String::new());
                }
                Err(_) => {
                    // Don't update base64 if hex is invalid
                }
            }
        } else {
            set_msgpack_base64.set(String::new());
        }
    };

    // Handle MsgPack to JSON conversion
    let handle_msgpack_to_json = move |_| {
        set_error.set(String::new());
        let base64 = msgpack_base64.get();
        match msgpack_to_json(base64.trim()) {
            Ok(json) => {
                set_json_input.set(json);
            }
            Err(e) => {
                set_error.set(e);
            }
        }
    };

    // Handle JSON to MsgPack conversion
    let handle_json_to_msgpack = move |_| {
        set_error.set(String::new());
        let json = json_input.get();
        match json_to_msgpack(json.trim()) {
            Ok(msgpack) => {
                set_msgpack_base64.set(msgpack.clone());
                // Also update hex display
                if let Ok(hex) = base64_to_hex(&msgpack) {
                    set_msgpack_hex.set(hex);
                }
            }
            Err(e) => {
                set_error.set(e);
            }
        }
    };

    // Clear all fields
    let clear_all = move |_| {
        set_msgpack_base64.set(String::new());
        set_msgpack_hex.set(String::new());
        set_json_input.set(String::new());
        set_error.set(String::new());
        set_hex_highlight_range.set(None);
    };

    // Handle JSON selection changes to highlight corresponding hex bytes
    let handle_json_selection_change = move |sel_start: usize, sel_end: usize| {
        let base64 = msgpack_base64.get();
        let json = json_input.get();

        if base64.is_empty() || json.is_empty() || sel_start == sel_end {
            set_hex_highlight_range.set(None);
            return;
        }

        // Decode base64 to bytes
        if let Ok(bytes) =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64.trim())
        {
            let mappings = create_position_mappings(&bytes, &json);
            if let Some(byte_range) =
                find_hex_range_for_json_selection(&mappings, sel_start, sel_end)
            {
                let char_range = byte_range_to_hex_char_range(byte_range.0, byte_range.1);
                set_hex_highlight_range.set(Some(char_range));
            } else {
                set_hex_highlight_range.set(None);
            }
        } else {
            set_hex_highlight_range.set(None);
        }
    };

    // Computed values for highlighted HTML
    let json_highlighted = Memo::new(move |_| {
        let json = json_input.get();
        if json.is_empty() {
            String::new()
        } else {
            highlight_json(&json)
        }
    });

    let hex_highlighted = Memo::new(move |_| {
        let hex = msgpack_hex.get();
        let range = hex_highlight_range.get();
        if hex.is_empty() {
            String::new()
        } else {
            highlight_hex(&hex, range)
        }
    });

    view! {
        <div class="app">
            <header class="header">
                <h1>"🔄 MsgPack Converter"</h1>
                <p class="subtitle">
                    "Convert between Base64-encoded MessagePack and JSON with full uint64 support"
                </p>
            </header>

            {move || {
                let err = error.get();
                if !err.is_empty() {
                    view! {
                        <div class="error-banner">
                            <span class="error-icon">"⚠️"</span>
                            {err}
                        </div>
                    }.into_any()
                } else {
                    view! { <div></div> }.into_any()
                }
            }}

            <main class="converter-container">
                <div class="input-section">
                    <div class="msgpack-inputs">
                        <div class="msgpack-input-group">
                            <label for="msgpack-base64-input" class="input-label">
                                <span class="label-icon">"📦"</span>
                                "Base64 MsgPack"
                            </label>
                            <textarea
                                id="msgpack-base64-input"
                                class="input-area msgpack-textarea"
                                placeholder="Paste Base64-encoded MsgPack data here..."
                                prop:value=move || msgpack_base64.get()
                                on:input=move |ev| {
                                    let target = event_target::<HtmlTextAreaElement>(&ev);
                                    handle_base64_change(target.value());
                                }
                            />
                        </div>
                        <div class="msgpack-input-group">
                            <label for="msgpack-hex-input" class="input-label">
                                <span class="label-icon">"🔢"</span>
                                "Hex (Space-separated)"
                            </label>
                            <HexHighlighter
                                id="msgpack-hex-input"
                                value=msgpack_hex
                                highlighted_html=hex_highlighted
                                on_change=move |value: String| handle_hex_change(value)
                                placeholder="Or paste hex bytes here (e.g., 81 A5 68 65 6C 6C 6F)..."
                            />
                        </div>
                    </div>
                </div>

                <div class="buttons-section">
                    <button
                        class="convert-button to-json"
                        on:click=handle_msgpack_to_json
                        disabled=move || msgpack_base64.get().trim().is_empty()
                        title="Convert MsgPack to JSON"
                    >
                        <span class="button-icon">"➡️"</span>
                        <span class="button-text">"To JSON"</span>
                    </button>
                    <button
                        class="convert-button to-msgpack"
                        on:click=handle_json_to_msgpack
                        disabled=move || json_input.get().trim().is_empty()
                        title="Convert JSON to MsgPack"
                    >
                        <span class="button-icon">"⬅️"</span>
                        <span class="button-text">"To MsgPack"</span>
                    </button>
                    <button
                        class="clear-button"
                        on:click=clear_all
                        title="Clear all fields"
                    >
                        "🗑️ Clear"
                    </button>
                </div>

                <div class="input-section">
                    <label for="json-input" class="input-label">
                        <span class="label-icon">"📄"</span>
                        "JSON"
                    </label>
                    <JsonHighlighter
                        id="json-input"
                        value=json_input
                        highlighted_html=json_highlighted
                        on_change=move |value: String| set_json_input.set(value)
                        on_selection_change=handle_json_selection_change
                        placeholder="Paste JSON data here..."
                    />
                </div>
            </main>

            <footer class="footer">
                <p>
                    "💡 "
                    <strong>"Note:"</strong>
                    " This tool supports uint64 values that exceed JavaScript's safe integer limit (2^53 - 1). Large integers are preserved exactly during conversion."
                </p>
            </footer>
        </div>
    }
}

#[component]
fn HexHighlighter(
    #[prop(into)] id: String,
    value: ReadSignal<String>,
    highlighted_html: Memo<String>,
    on_change: impl Fn(String) + 'static,
    #[prop(into)] placeholder: String,
) -> impl IntoView {
    let on_change = std::rc::Rc::new(on_change);
    let on_change_clone = on_change.clone();

    view! {
        <div class="hex-highlighter-container">
            <pre class="hex-highlight-overlay" aria-hidden="true">
                <code inner_html=move || {
                    let html = highlighted_html.get();
                    let value = value.get();
                    if value.ends_with('\n') {
                        format!("{} ", html)
                    } else {
                        html
                    }
                }/>
            </pre>
            <textarea
                id=id
                class="hex-textarea input-area msgpack-textarea"
                placeholder=placeholder
                prop:value=move || value.get()
                on:input=move |ev| {
                    let target = event_target::<HtmlTextAreaElement>(&ev);
                    on_change_clone(target.value());
                }
                spellcheck="false"
            />
        </div>
    }
}

#[component]
fn JsonHighlighter(
    #[prop(into)] id: String,
    value: ReadSignal<String>,
    highlighted_html: Memo<String>,
    on_change: impl Fn(String) + 'static,
    on_selection_change: impl Fn(usize, usize) + 'static,
    #[prop(into)] placeholder: String,
) -> impl IntoView {
    let on_change = std::rc::Rc::new(on_change);
    let on_change_clone = on_change.clone();
    let on_selection_change = std::rc::Rc::new(on_selection_change);
    let on_selection_change_clone1 = on_selection_change.clone();
    let on_selection_change_clone2 = on_selection_change.clone();
    let on_selection_change_clone3 = on_selection_change.clone();

    let handle_select = move |ev: web_sys::Event| {
        let target = event_target::<HtmlTextAreaElement>(&ev);
        if let (Ok(start), Ok(end)) = (target.selection_start(), target.selection_end()) {
            if let (Some(start), Some(end)) = (start, end) {
                on_selection_change_clone1(start as usize, end as usize);
            }
        }
    };

    let handle_mouseup = move |ev: web_sys::MouseEvent| {
        let target = event_target::<HtmlTextAreaElement>(&ev);
        if let (Ok(start), Ok(end)) = (target.selection_start(), target.selection_end()) {
            if let (Some(start), Some(end)) = (start, end) {
                on_selection_change_clone2(start as usize, end as usize);
            }
        }
    };

    let handle_keyup = move |ev: web_sys::KeyboardEvent| {
        let target = event_target::<HtmlTextAreaElement>(&ev);
        if let (Ok(start), Ok(end)) = (target.selection_start(), target.selection_end()) {
            if let (Some(start), Some(end)) = (start, end) {
                on_selection_change_clone3(start as usize, end as usize);
            }
        }
    };

    view! {
        <div class="json-highlighter-container">
            <pre class="json-highlight-overlay" aria-hidden="true">
                <code class="language-json" inner_html=move || {
                    let html = highlighted_html.get();
                    let value = value.get();
                    if value.ends_with('\n') {
                        format!("{} ", html)
                    } else {
                        html
                    }
                }/>
            </pre>
            <textarea
                id=id
                class="json-textarea"
                placeholder=placeholder
                prop:value=move || value.get()
                on:input=move |ev| {
                    let target = event_target::<HtmlTextAreaElement>(&ev);
                    on_change_clone(target.value());
                }
                on:select=handle_select
                on:mouseup=handle_mouseup
                on:keyup=handle_keyup
                spellcheck="false"
            />
        </div>
    }
}
