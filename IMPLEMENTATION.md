# Rust/Leptos Rewrite - Technical Summary

## Overview

This PR completely rewrites the msgpack-converter project from React/TypeScript to Rust/Leptos. This addresses fundamental limitations in JavaScript's number handling that cannot be fully resolved with JavaScript-based solutions.

## The Problem with JavaScript

JavaScript has a fundamental limitation with numeric types:
- All numbers are stored as IEEE 754 double-precision floats (64-bit)
- This gives a safe integer range of only ±2^53 - 1 (±9,007,199,254,740,991)
- Integers larger than this lose precision when represented as JavaScript Numbers

### Example of the Problem

```javascript
// JavaScript behavior
const largeInt = 9007199254740993; // MAX_SAFE_INTEGER + 2
console.log(largeInt); // Outputs: 9007199254740992 (wrong!)

// The value is silently corrupted
JSON.parse('{"value": 9007199254740993}').value // Returns: 9007199254740992
```

While libraries like `json-bigint` and `lossless-json` can help parse JSON with BigInt support, they add complexity and still have limitations when serializing to MessagePack.

## The Rust Solution

Rust's type system properly distinguishes between different integer and float types:
- `u64` for unsigned 64-bit integers (0 to 18,446,744,073,709,551,615)
- `i64` for signed 64-bit integers  
- `f64` for 64-bit floating point numbers

### How It Works

1. **JSON Parsing**: `serde_json` correctly parses large integers as u64/i64
2. **MessagePack Encoding**: `rmp-serde` uses the appropriate MessagePack type markers:
   - `0xcf` for uint64 values
   - `0xcb` for float64 values
   - Compact encoding for smaller integers (fixint, uint8, uint16, uint32)
3. **Type Preservation**: The distinction between integers and floats is maintained throughout

### Example with Rust

```rust
// Input JSON
let json = r#"{"value": 9007199254740993}"#;

// Parse with serde_json
let value: Value = serde_json::from_str(json).unwrap();
// value["value"] is a u64, not a float

// Encode to MessagePack with correct type marker
let msgpack = rmp_serde::to_vec(&value).unwrap();
// Uses 0xcf (uint64) marker, not 0xcb (float64)

// Decode back - value is preserved
let decoded: Value = rmp_serde::from_slice(&msgpack).unwrap();
// Still 9007199254740993, no precision loss
```

## Implementation Details

### Dependencies

- **leptos 0.7**: Modern Rust web framework with reactive signals
- **serde 1.0**: Serialization framework
- **serde_json 1.0**: JSON with proper integer support
- **rmp-serde 1.3**: MessagePack serialization
- **base64 0.22**: Base64 encoding/decoding

### Build Process

- **Trunk**: WASM build tool that compiles Rust to WebAssembly
- **GitHub Actions**: Automated deployment to GitHub Pages
- **Target**: wasm32-unknown-unknown (browser-compatible WASM)

### Code Structure

```
src/
├── lib.rs              # Entry point
├── converter.rs        # Core conversion logic
└── components/
    ├── mod.rs          # Component exports
    └── app.rs          # Main UI component
```

## Benefits

1. **Correctness**: Large integers are never corrupted
2. **Type Safety**: Rust's type system prevents errors at compile time
3. **Performance**: Compiled WASM is fast and efficient
4. **Simplicity**: No need for multiple JSON parsing libraries
5. **Maintainability**: Fewer dependencies, clearer code

## Testing

All conversion tests pass, including:
- Basic MessagePack ↔ JSON conversion
- Large integer handling (> MAX_SAFE_INTEGER)
- Base64 ↔ Hex conversion
- Round-trip conversions

## Deployment

The project builds to static files that can be deployed anywhere:
```bash
trunk build --release --public-url /msgpack-converter/
```

GitHub Actions automatically builds and deploys on push to main.
