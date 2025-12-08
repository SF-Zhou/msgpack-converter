mod converter;
mod components;

use leptos::prelude::*;
use components::App;

pub fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(|| view! { <App /> })
}
