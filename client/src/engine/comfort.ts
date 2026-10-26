/**
 * Players who ask their device for reduced motion get no screen shake, no shockwave ripple
 * and only a faint glow for lightning. Flashes are kept well under 3 per second for everyone.
 */
export const calmMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
