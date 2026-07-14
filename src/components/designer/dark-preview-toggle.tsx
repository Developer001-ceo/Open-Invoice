'use client';

/**
 * Dark-preview background toggle.
 * Uiverse.io design by njesenberger — reproduced faithfully.
 *
 * The `:checked + .toggle ...` selectors from the original CSS are replicated
 * here via inline styles driven by the `checked` prop. This keeps the smooth
 * CSS transitions (fill .4s, transform .6s / .45s) while guaranteeing the
 * SVG + sibling-combinator styling renders correctly regardless of CSS scoping.
 */

interface DarkPreviewToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function DarkPreviewToggle({ checked, onCheckedChange }: DarkPreviewToggleProps) {
  const inactiveColor = '#d3d3d6';
  // Active state uses a black → pink → red gradient (left → right) instead of a
  // solid colour. Defined once in <defs> and referenced via url(#...) on the
  // background pill and the power-off icon.

  return (
    <label
      className="relative inline-block cursor-pointer"
      style={{
        aspectRatio: '292 / 142',
        height: '1.875em',
        fontSize: '15px',
      }}
      title={checked ? 'Switch to light preview background' : 'Switch to dark preview background'}
    >
      <input
        type="checkbox"
        className="absolute inset-0 m-0 cursor-pointer"
        style={{
          zIndex: 1,
          width: '100%',
          height: '100%',
          appearance: 'none',
          opacity: 0,
        }}
        aria-label={checked ? 'Switch to light preview background' : 'Switch to dark preview background'}
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 292 142"
        className="toggle"
        style={{ width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="dark-toggle-active" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#000000" />
            <stop offset="50%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <path
          d="M71 142C31.7878 142 0 110.212 0 71C0 31.7878 31.7878 0 71 0C110.212 0 119 30 146 30C173 30 182 0 221 0C260 0 292 31.7878 292 71C292 110.212 260.212 142 221 142C181.788 142 173 112 146 112C119 112 110.212 142 71 142Z"
          className="toggle-background"
          style={{ fill: checked ? 'url(#dark-toggle-active)' : inactiveColor, transition: 'fill .4s' }}
        />
        <rect
          rx="6"
          height="64"
          width="12"
          y="39"
          x="64"
          className="toggle-icon on"
          style={{ fill: checked ? '#fff' : inactiveColor, transition: 'fill .4s' }}
        />
        <path
          d="M221 91C232.046 91 241 82.0457 241 71C241 59.9543 232.046 51 221 51C209.954 51 201 59.9543 201 71C201 82.0457 209.954 91 221 91ZM221 103C238.673 103 253 88.6731 253 71C253 53.3269 238.673 39 221 39C203.327 39 189 53.3269 189 71C189 88.6731 203.327 103 221 103Z"
          fillRule="evenodd"
          className="toggle-icon off"
          style={{ fill: checked ? 'url(#dark-toggle-active)' : '#eaeaec', transition: 'fill .4s' }}
        />
        <g filter="url('#goo')">
          <rect
            fill="#fff"
            rx="29"
            height="58"
            width="116"
            y="42"
            x="13"
            className="toggle-circle-center"
            style={{
              transformOrigin: 'center',
              transition: 'transform .6s',
              transform: checked ? 'translateX(150px)' : 'translateX(0)',
            }}
          />
          <rect
            fill="#fff"
            rx="58"
            height="114"
            width="114"
            y="14"
            x="14"
            className="toggle-circle left"
            style={{
              transformOrigin: 'center',
              transition: 'transform .45s',
              backfaceVisibility: 'hidden',
              transform: checked ? 'scale(0)' : 'scale(1)',
            }}
          />
          <rect
            fill="#fff"
            rx="58"
            height="114"
            width="114"
            y="14"
            x="164"
            className="toggle-circle right"
            style={{
              transformOrigin: 'center',
              transition: 'transform .45s',
              backfaceVisibility: 'hidden',
              transform: checked ? 'scale(1)' : 'scale(0)',
            }}
          />
        </g>
        <filter id="goo">
          <feGaussianBlur stdDeviation="10" result="blur" in="SourceGraphic" />
          <feColorMatrix result="goo" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" mode="matrix" in="blur" />
        </filter>
      </svg>
    </label>
  );
}
