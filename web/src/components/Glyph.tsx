/* The incognito mark: hat and glasses.

   Deliberately NOT a trench-coated spy. Spy imagery signals "getting away with something",
   which attracts the wrong user and reads badly to anyone regulatory looking at this later.
   Chrome's own icon is clinical and monochrome for exactly that reason.
   Target feeling: discreet, not conspiratorial — a private room, not a heist. */
export function Glyph({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* brim + crown */}
      <path
        d="M3.5 12.5h17M7 12.5c0-3.6.9-6 5-6s5 2.4 5 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* lenses */}
      <circle cx="8.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11.1 16.6c.6-.35 1.2-.35 1.8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
