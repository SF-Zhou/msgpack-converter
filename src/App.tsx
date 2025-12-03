import { useState } from 'react';
import { msgpackToJson, jsonToMsgpack } from './utils/converter';
import './App.css';

function App() {
  const [msgpackInput, setMsgpackInput] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');

  const handleMsgpackToJson = () => {
    setError('');
    try {
      const json = msgpackToJson(msgpackInput.trim());
      setJsonInput(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleJsonToMsgpack = () => {
    setError('');
    try {
      const msgpack = jsonToMsgpack(jsonInput.trim());
      setMsgpackInput(msgpack);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const clearAll = () => {
    setMsgpackInput('');
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
          <label htmlFor="msgpack-input" className="input-label">
            <span className="label-icon">📦</span>
            Base64 MsgPack
          </label>
          <textarea
            id="msgpack-input"
            className="input-area"
            placeholder="Paste Base64-encoded MsgPack data here..."
            value={msgpackInput}
            onChange={(e) => setMsgpackInput(e.target.value)}
          />
        </div>

        <div className="buttons-section">
          <button
            className="convert-button to-json"
            onClick={handleMsgpackToJson}
            disabled={!msgpackInput.trim()}
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
          <textarea
            id="json-input"
            className="input-area"
            placeholder="Paste JSON data here..."
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
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
