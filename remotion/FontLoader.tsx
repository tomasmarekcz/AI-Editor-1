import { useEffect } from 'react';
import { continueRender, delayRender } from 'remotion';
import { GOOGLE_FONTS_URL, BOLD_FONT_FACE } from './loadFonts';

/**
 * Mounts once inside the composition and uses Remotion's recommended
 * useEffect-based pattern for delayRender/continueRender.
 * This is reliable because useEffect always runs in the browser context
 * after the component is mounted, unlike module-level setTimeout.
 */
export function FontLoader() {
  useEffect(() => {
    const handle = delayRender('Loading fonts');
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      continueRender(handle);
    };

    // Hard cap: release after 5 s no matter what.
    // Remotion's own timeout is 28 s — this fires well before that.
    const hardCap = setTimeout(release, 5000);

    // 1. TheBoldFont — served from the bundle's publicDir
    const style = document.createElement('style');
    style.textContent = BOLD_FONT_FACE;
    document.head.appendChild(style);

    // 2. Google Fonts (external — may not be reachable in every environment)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = GOOGLE_FONTS_URL;

    link.onload = () => {
      clearTimeout(hardCap);
      document.fonts.ready
        .then(release)
        .catch(release);
    };
    link.onerror = () => {
      clearTimeout(hardCap);
      release();
    };

    document.head.appendChild(link);

    return () => {
      clearTimeout(hardCap);
    };
  }, []);

  return null;
}
