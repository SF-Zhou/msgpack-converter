# MsgPack Converter

An online tool for converting between Base64-encoded MessagePack and JSON with full uint64 support.

![MsgPack Converter Screenshot](https://github.com/user-attachments/assets/5cb768e2-a8ea-4b64-8fbc-ca433a8932ec)

## Features

- 🔄 **Bidirectional Conversion**: Convert Base64-encoded MsgPack to JSON and vice versa
- 🔢 **Full uint64 Support**: Preserves large integers that exceed JavaScript's safe integer limit (2^53 - 1)
- 🎨 **Beautiful UI**: Clean, modern interface with dark mode support
- 📱 **Responsive Design**: Works on desktop and mobile devices
- ✅ **Unit Tested**: Comprehensive tests ensure uint64 values are preserved correctly

## Live Demo

Visit [https://sf-zhou.github.io/msgpack-converter/](https://sf-zhou.github.io/msgpack-converter/) to use the tool online.

## Development

### Prerequisites

- Node.js 18 or higher
- npm

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Tech Stack

- **React** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **@msgpack/msgpack** - MessagePack encoding/decoding
- **json-bigint** - JSON parsing with BigInt support
- **Vitest** - Testing framework

## License

MIT License - see [LICENSE](LICENSE) for details.
