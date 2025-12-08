use leptos::prelude::*;
use leptos::ev;
use crate::converter::{msgpack_to_json, json_to_msgpack, base64_to_hex, hex_to_base64};

#[component]
pub fn App() -> impl IntoView {
    let (msgpack_base64, set_msgpack_base64) = signal(String::new());
    let (msgpack_hex, set_msgpack_hex) = signal(String::new());
    let (json_input, set_json_input) = signal(String::new());
    let (error, set_error) = signal(String::new());

    // Handle base64 input change - update hex in real-time
    let handle_base64_change = move |ev: ev::Event| {
        let value = event_target_value(&ev);
        set_msgpack_base64.set(value.clone());
        
        if !value.trim().is_empty() {
            match base64_to_hex(&value.trim()) {
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
    let handle_hex_change = move |ev: ev::Event| {
        let value = event_target_value(&ev);
        set_msgpack_hex.set(value.clone());
        
        if !value.trim().is_empty() {
            match hex_to_base64(&value.trim()) {
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
        let base64_value = msgpack_base64.get();
        
        match msgpack_to_json(&base64_value.trim()) {
            Ok(json) => {
                set_json_input.set(json);
            }
            Err(err) => {
                set_error.set(err);
            }
        }
    };

    // Handle JSON to MsgPack conversion
    let handle_json_to_msgpack = move |_| {
        set_error.set(String::new());
        let json_value = json_input.get();
        
        match json_to_msgpack(&json_value.trim()) {
            Ok(msgpack) => {
                set_msgpack_base64.set(msgpack.clone());
                // Also update hex display
                if let Ok(hex) = base64_to_hex(&msgpack) {
                    set_msgpack_hex.set(hex);
                }
            }
            Err(err) => {
                set_error.set(err);
            }
        }
    };

    // Clear all fields
    let clear_all = move |_| {
        set_msgpack_base64.set(String::new());
        set_msgpack_hex.set(String::new());
        set_json_input.set(String::new());
        set_error.set(String::new());
    };

    view! {
        <div class="app">
            <header class="header">
                <h1>"🔄 MsgPack Converter"</h1>
                <p class="subtitle">
                    "Convert between Base64-encoded MessagePack and JSON with full uint64 support"
                </p>
            </header>

            <Show
                when=move || !error.get().is_empty()
                fallback=|| view! { }
            >
                <div class="error-banner">
                    <span class="error-icon">"⚠️"</span>
                    {move || error.get()}
                </div>
            </Show>

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
                                on:input=handle_base64_change
                                prop:value=move || msgpack_base64.get()
                            />
                        </div>
                        <div class="msgpack-input-group">
                            <label for="msgpack-hex-input" class="input-label">
                                <span class="label-icon">"🔢"</span>
                                "Hex (Space-separated)"
                            </label>
                            <textarea
                                id="msgpack-hex-input"
                                class="input-area msgpack-textarea"
                                placeholder="Or paste hex bytes here (e.g., 81 A5 68 65 6C 6C 6F)..."
                                on:input=handle_hex_change
                                prop:value=move || msgpack_hex.get()
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
                    <button class="clear-button" on:click=clear_all title="Clear all fields">
                        "🗑️ Clear"
                    </button>
                </div>

                <div class="input-section">
                    <label for="json-input" class="input-label">
                        <span class="label-icon">"📄"</span>
                        "JSON"
                    </label>
                    <textarea
                        id="json-input"
                        class="input-area"
                        placeholder="Paste JSON data here..."
                        on:input=move |ev| set_json_input.set(event_target_value(&ev))
                        prop:value=move || json_input.get()
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
