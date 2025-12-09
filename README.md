# MsgPack Converter

An online tool for converting between Base64-encoded MessagePack and JSON with full uint64 support.

![MsgPack Converter Screenshot](https://github.com/user-attachments/assets/f9ecc9c7-e0fc-416c-9cc1-082fbf415af3)

## Features

- 🔄 **Bidirectional Conversion**: Convert Base64-encoded MsgPack to JSON and vice versa
- 🔢 **Full uint64 Support**: Preserves large integers that exceed JavaScript's safe integer limit (2^53 - 1) using Rust's native integer types
- 🎨 **Beautiful UI**: Clean, modern interface with dark mode support
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🦀 **Rust/WebAssembly**: Built with Leptos framework for fast, reliable conversion
- 🔍 **JSON Syntax Highlighting**: PrismJS-powered syntax highlighting for JSON
- ✨ **Hex Highlighting**: Select text in JSON to highlight corresponding bytes in hex view

## Live Demo

Visit [https://sf-zhou.github.io/msgpack-converter/](https://sf-zhou.github.io/msgpack-converter/) to use the tool online.

## Development

### Prerequisites

- Rust (latest stable)
- [trunk](https://trunkrs.dev/) - WASM web application bundler

### Setup

```bash
# Install trunk
cargo install trunk

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Start development server
trunk serve

# Build for production
trunk build --release
```

### Tech Stack

- **Leptos** - Rust reactive UI framework
- **WebAssembly** - High-performance web runtime
- **serde / serde_json** - JSON serialization
- **rmp-serde** - MessagePack encoding/decoding
- **PrismJS** - Syntax highlighting
- **trunk** - WASM build tool

## License

MIT License - see [LICENSE](LICENSE) for details.
