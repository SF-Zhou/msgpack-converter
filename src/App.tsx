import { useState, useCallback } from 'react';
import { msgpackToJson, jsonToMsgpack, base64ToHex, hexToBase64 } from './utils/converter';
import { JsonHighlighter } from './components/JsonHighlighter';
import './App.css';

function App() {
  const [msgpackBase64, setMsgpackBase64] = useState('');
  const [msgpackHex, setMsgpackHex] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');

  // Handle base64 input change - update hex in real-time
  const handleBase64Change = useCallback((value: string) => {
    setMsgpackBase64(value);
    if (value.trim()) {
      try {
        const hex = base64ToHex(value.trim());
        setMsgpackHex(hex);
        setError('');
      } catch {
        // Don't update hex if base64 is invalid
      }
    } else {
      setMsgpackHex('');
    }
  }, []);

  // Handle hex input change - update base64 in real-time
  const handleHexChange = useCallback((value: string) => {
    setMsgpackHex(value);
    if (value.trim()) {
      try {
        const base64 = hexToBase64(value.trim());
        setMsgpackBase64(base64);
        setError('');
      } catch {
        // Don't update base64 if hex is invalid
      }
    } else {
      setMsgpackBase64('');
    }
  }, []);

  const handleMsgpackToJson = () => {
    setError('');
    try {
      const json = msgpackToJson(msgpackBase64.trim());
      setJsonInput(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleJsonToMsgpack = () => {
    setError('');
    try {
      const msgpack = jsonToMsgpack(jsonInput.trim());
      setMsgpackBase64(msgpack);
      // Also update hex display
      try {
        const hex = base64ToHex(msgpack);
        setMsgpackHex(hex);
      } catch {
        // Ignore hex conversion errors
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const clearAll = () => {
    setMsgpackBase64('');
    setMsgpackHex('');
    setJsonInput('');
    setError('');
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🔄 MsgPack Converter</h1>
        <p className="subtitle">
          Convert between Base64-encoded MessagePack and JSON with full uint64 support
        </p>
      </header>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠️</span>
          {error}
        </div>
      )}

      <main className="converter-container">
        <div className="input-section">
          <div className="msgpack-inputs">
            <div className="msgpack-input-group">
              <label htmlFor="msgpack-base64-input" className="input-label">
                <span className="label-icon">📦</span>
                Base64 MsgPack
              </label>
              <textarea
                id="msgpack-base64-input"
                className="input-area msgpack-textarea"
                placeholder="Paste Base64-encoded MsgPack data here..."
                value={msgpackBase64}
                onChange={(e) => handleBase64Change(e.target.value)}
              />
            </div>
            <div className="msgpack-input-group">
              <label htmlFor="msgpack-hex-input" className="input-label">
                <span className="label-icon">🔢</span>
                Hex (Space-separated)
              </label>
              <textarea
                id="msgpack-hex-input"
                className="input-area msgpack-textarea"
                placeholder="Or paste hex bytes here (e.g., 81 A5 68 65 6C 6C 6F)..."
                value={msgpackHex}
                onChange={(e) => handleHexChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="buttons-section">
          <button
            className="convert-button to-json"
            onClick={handleMsgpackToJson}
            disabled={!msgpackBase64.trim()}
            title="Convert MsgPack to JSON"
          >
            <span className="button-icon">➡️</span>
            <span className="button-text">To JSON</span>
          </button>
          <button
            className="convert-button to-msgpack"
            onClick={handleJsonToMsgpack}
            disabled={!jsonInput.trim()}
            title="Convert JSON to MsgPack"
          >
            <span className="button-icon">⬅️</span>
            <span className="button-text">To MsgPack</span>
          </button>
          <button className="clear-button" onClick={clearAll} title="Clear all fields">
            🗑️ Clear
          </button>
        </div>

        <div className="input-section">
          <label htmlFor="json-input" className="input-label">
            <span className="label-icon">📄</span>
            JSON
          </label>
          <JsonHighlighter
            id="json-input"
            value={jsonInput}
            onChange={setJsonInput}
            placeholder="Paste JSON data here..."
          />
        </div>
      </main>

      <footer className="footer">
        <p>
          💡 <strong>Note:</strong> This tool supports uint64 values that exceed JavaScript's safe
          integer limit (2^53 - 1). Large integers are preserved exactly during conversion.
        </p>
      </footer>
    </div>
  );
}

export default App;
