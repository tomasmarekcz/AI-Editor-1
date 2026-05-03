// Font injection only — no delayRender here.
// delayRender/continueRender is handled by the FontLoader component (useEffect),
// which is the Remotion-recommended pattern. Module-level delayRender is unreliable
// because setTimeout may not fire in Remotion's Chromium environment.

export const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@700;900' +
  '&family=Anton&family=Poppins:wght@700;900&family=Inter:wght@700;900' +
  '&family=Archivo+Black&family=League+Spartan:wght@700;900' +
  '&family=Raleway:wght@700;900&family=Oswald:wght@700' +
  '&family=Roboto+Condensed:wght@700&display=swap';

export const BOLD_FONT_FACE = `
  @font-face {
    font-family: 'TheBoldFont';
    src: local('Impact');
    font-weight: 700;
    font-style: normal;
  }
`;
