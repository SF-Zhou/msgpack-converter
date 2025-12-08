# MsgPack Converter

An online tool for converting between Base64-encoded MessagePack and JSON with full uint64 support.

![MsgPack Converter Screenshot](https://github.com/user-attachments/assets/5cb768e2-a8ea-4b64-8fbc-ca433a8932ec)

## Features

- 🔄 **Bidirectional Conversion**: Convert Base64-encoded MsgPack to JSON and vice versa
- 🔢 **Full uint64 Support**: Preserves large integers that exceed JavaScript's safe integer limit (2^53 - 1)
- 🎨 **Beautiful UI**: Clean, modern interface with dark mode support
- 📱 **Responsive Design**: Works on desktop and mobile devices
- 🦀 **Rust Powered**: Built with Rust for reliable type handling and performance

## Live Demo

Visit [https://sf-zhou.github.io/msgpack-converter/](https://sf-zhou.github.io/msgpack-converter/) to use the tool online.

## Development

### Prerequisites

- Rust (1.70 or higher)
- Trunk (for building and serving)

### Setup

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add wasm target
rustup target add wasm32-unknown-unknown

# Install Trunk
cargo install trunk

# Start development server
trunk serve

# Build for production
trunk build --release
```

### Tech Stack

- **Leptos** - Rust web framework
- **serde** - Serialization framework
- **serde_json** - JSON handling with proper integer support
- **rmp-serde** - MessagePack encoding/decoding
- **Trunk** - WASM build tool

## Why Rust/Leptos?

The previous JavaScript/TypeScript implementation had limitations with handling large integers and distinguishing between integers and floats during JSON parsing. By using Rust with serde, this implementation:

- Correctly preserves uint64 values without precision loss
- Properly handles the distinction between integers and floats
- Provides better type safety and reliability
- Eliminates JavaScript's Number type limitations

## License

MIT License - see [LICENSE](LICENSE) for details.
