import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import './HexHighlighter.css';

interface HexHighlighterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  highlightRange?: { charStart: number; charEnd: number } | null;
}

export function HexHighlighter({
  value,
  onChange,
  placeholder,
  id,
  highlightRange,
}: HexHighlighterProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Create highlighted HTML
  const highlightedHtml = useMemo(() => {
    if (!value) return '';

    // Escape HTML special characters
    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    if (!highlightRange) {
      return escapeHtml(value);
    }

    const { charStart, charEnd } = highlightRange;
    const before = escapeHtml(value.slice(0, charStart));
    const highlighted = escapeHtml(value.slice(charStart, charEnd));
    const after = escapeHtml(value.slice(charEnd));

    return `${before}<span class="hex-highlight">${highlighted}</span>${after}`;
  }, [value, highlightRange]);

  // Sync scroll between textarea and highlight overlay
  const handleScroll = useCallback(() => {
    if (textareaRef.current) {
      setScrollTop(textareaRef.current.scrollTop);
      setScrollLeft(textareaRef.current.scrollLeft);
    }
  }, []);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
  }, [scrollTop, scrollLeft]);

  return (
    <div className="hex-highlighter-container">
      <pre ref={highlightRef} className="hex-highlight-overlay" aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml + (value.endsWith('\n') ? ' ' : '') }} />
      </pre>
      <textarea
        ref={textareaRef}
        id={id}
        className="hex-textarea input-area msgpack-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
      />
    </div>
  );
}
