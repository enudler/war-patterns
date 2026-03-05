import { useState, useRef, useEffect } from 'react';

export default function LocationSearch({ areas, onSelectArea }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const containerRef = useRef(null);

  const filtered =
    query.trim().length >= 1
      ? areas
          .filter((a) => {
            const q = query.toLowerCase();
            return (
              (a.area_name && a.area_name.toLowerCase().includes(q)) ||
              (a.area_name_he && a.area_name_he.includes(query))
            );
          })
          .slice(0, 8)
      : [];

  function handleSelect(area) {
    onSelectArea(area.area_name_he);
    setQuery('');
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.blur();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelect(filtered[highlightedIndex]);
    }
  }

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      listRef.current.children[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Input */}
      <div style={{ position: 'relative' }}>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 14,
            height: 14,
            color: '#555',
            pointerEvents: 'none',
          }}
        >
          <path
            fillRule="evenodd"
            d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
            clipRule="evenodd"
          />
        </svg>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search locations…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => {
            if (query.trim().length >= 1) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 30px 8px 30px',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            color: '#e5e5ef',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocusCapture={(e) => (e.target.style.borderColor = 'rgba(239,68,68,0.5)')}
          onBlurCapture={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.12)')}
        />
        {query && (
          <button
            onMouseDown={(e) => {
              e.preventDefault(); // prevent blur before click
              setQuery('');
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#555',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 2px',
              fontFamily: 'system-ui, sans-serif',
            }}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 3000,
            background: '#1a1a2e',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            maxHeight: 280,
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          {filtered.map((area, i) => (
            <div
              key={area.area_name_he}
              onMouseDown={() => handleSelect(area)}
              onMouseEnter={() => setHighlightedIndex(i)}
              style={{
                padding: '9px 14px',
                cursor: 'pointer',
                background: i === highlightedIndex ? 'rgba(239,68,68,0.15)' : 'transparent',
                borderBottom:
                  i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                transition: 'background 0.1s',
              }}
            >
              <div style={{ fontSize: 13, color: '#e5e5ef', fontWeight: 500 }}>
                {area.area_name || area.area_name_he}
              </div>
              {area.area_name_he && area.area_name && (
                <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>
                  {area.area_name_he}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* No results hint */}
      {isOpen && query.trim().length >= 1 && filtered.length === 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 3000,
            background: '#1a1a2e',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 12,
            color: '#555',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}
        >
          No locations found
        </div>
      )}
    </div>
  );
}
