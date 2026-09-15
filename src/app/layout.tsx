import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Black_Ops_One, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { NavbarStyles } from "@/components/designer/navbar-styles";

// Google Fonts catalog for the Text/Table font-family selectors (`google: true`
// entries in src/lib/fonts.ts — see the comment in globals.css). Loaded via
// <link> because a remote @import url(...) in globals.css is dropped by the
// Tailwind v4 + Turbopack CSS pipeline.
const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Open+Sans:wght@400;700&family=Lato:wght@400;700&family=Montserrat:wght@400;700&family=Poppins:wght@400;700&family=Nunito:wght@400;700&family=Raleway:wght@400;700&family=Source+Sans+3:wght@400;700&family=Work+Sans:wght@400;700&family=Oswald:wght@400;700&family=Barlow:wght@400;700&family=PT+Sans:wght@400;700&family=Rubik:wght@400;700&family=Quicksand:wght@400;700&family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400;0,700;1,400&family=PT+Serif:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:ital,wght@0,400;0,700;1,400&family=EB+Garamond:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital,wght@0,400;0,700;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Roboto+Mono:wght@400;700&family=Source+Code+Pro:wght@400;700&family=JetBrains+Mono:wght@400;700&family=Fira+Code:wght@400;700&family=IBM+Plex+Mono:wght@400;700&family=Bebas+Neue&family=Anton&family=Archivo+Black&family=Righteous&family=Cinzel:wght@400;700&family=Abril+Fatface&family=Lobster&family=Pacifico&family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&family=Sacramento&family=Shadows+Into+Light&family=Kalam:wght@400;700&family=Satisfy&family=Cookie&family=Great+Vibes&display=swap";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Inter is the DEFAULT font family used by text elements on the canvas
// (see FONT_FAMILIES in rich-text-editor.tsx / properties-panel.tsx).
// It MUST be loaded here with both normal AND italic styles — otherwise
// `fontFamily: 'Inter, sans-serif'` falls back to the system sans-serif,
// whose italic is often not synthesized by the browser, making the italic
// toggle appear to do nothing. Loading the real italic face fixes this
// for the default font; the CSS rules in globals.css handle the remaining
// font options (Arial, Verdana, etc.) via font-synthesis.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

// Black Ops One — bold military/stencil display font used for the on-canvas
// keyboard shortcut hints. Only weight 400 is available on Google Fonts.
const blackOpsOne = Black_Ops_One({
  variable: "--font-black-ops-one",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Open Invoice",
  description: "Design custom invoice templates with full control over layout and styling.",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${blackOpsOne.variable} ${inter.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        {/* Static loading screen — visible immediately before React hydrates.
            Removed by the React LoadingScreen component once the app is ready.
            Uses the Uiverse.io SVG letter spinner (MJC) with gradient strokes. */}
        <div
          id="initial-loader"
          suppressHydrationWarning
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#ffffff',
            transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Hidden SVG with gradient + mask definitions */}
          <svg height="0" width="0" viewBox="0 0 64 64" style={{ position: 'absolute' }}>
            <defs>
              <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="b">
                <stop stopColor="#973BED"></stop>
                <stop stopColor="#007CFF" offset="1"></stop>
              </linearGradient>
              <linearGradient gradientUnits="userSpaceOnUse" y2="0" x2="0" y1="64" x1="0" id="c">
                <stop stopColor="#FFC800"></stop>
                <stop stopColor="#F0F" offset="1"></stop>
                <animateTransform repeatCount="indefinite" keySplines=".42,0,.58,1;.42,0,.58,1;.42,0,.58,1;.42,0,.58,1;.42,0,.58,1;.42,0,.58,1;.42,0,.58,1;.42,0,.58,1" keyTimes="0; 0.125; 0.25; 0.375; 0.5; 0.625; 0.75; 0.875; 1" dur="8s" values="0 32 32;-270 32 32;-270 32 32;-540 32 32;-540 32 32;-810 32 32;-810 32 32;-1080 32 32;-1080 32 32" type="rotate" attributeName="gradientTransform"></animateTransform>
              </linearGradient>
              <linearGradient gradientUnits="userSpaceOnUse" y2="2" x2="0" y1="62" x1="0" id="d">
                <stop stopColor="#00E0ED"></stop>
                <stop stopColor="#00DA72" offset="1"></stop>
              </linearGradient>
              <mask id="mask-m">
                <rect width="64" height="64" fill="black" />
                <path fill="none" stroke="white" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" d="M 10 56 L 10 8 L 22 8 L 32 34 L 42 8 L 54 8 L 54 56 L 46 56 L 46 22 L 37 44 L 27 44 L 18 22 L 18 56 Z" className="dash" pathLength="360" style={{ animation: 'dashArray 2s ease-in-out infinite, dashOffset 2s linear infinite' }} />
              </mask>
              <mask id="mask-j">
                <rect width="64" height="64" fill="black" />
                <path fill="none" stroke="white" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" d="M 24 8 L 46 8 L 46 42 C 46 52 38 58 30 58 C 22 58 14 52 14 42 L 14 36 L 22 36 L 22 42 C 22 48 26 50 30 50 C 34 50 38 48 38 42 L 38 16 L 24 16 Z" className="dash" pathLength="360" style={{ animation: 'dashArray 2s ease-in-out infinite, dashOffset 2s linear infinite' }} />
              </mask>
              <mask id="mask-c">
                <rect width="64" height="64" fill="black" />
                <path fill="none" stroke="white" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" d="M 54 18 C 46 8 40 6 32 6 C 16 6 6 18 6 32 C 6 46 16 58 32 58 C 40 58 46 56 54 46" className="dash" pathLength="360" style={{ animation: 'dashArray 2s ease-in-out infinite, dashOffset 2s linear infinite' }} />
              </mask>
            </defs>
          </svg>

          {/* Loader — MJC letters (scaled up) — solid fill revealed by animated mask */}
          <div style={{ display: 'flex', margin: '0.25em 0', transform: 'scale(4)' }}>
            {/* Letter M */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="64" width="64" style={{ display: 'inline-block' }}>
              <path fill="url(#b)" mask="url(#mask-m)" d="M 10 56 L 10 8 L 22 8 L 32 34 L 42 8 L 54 8 L 54 56 L 46 56 L 46 22 L 37 44 L 27 44 L 18 22 L 18 56 Z" />
            </svg>
            {/* Letter J */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="64" width="64" style={{ display: 'inline-block' }}>
              <path fill="url(#c)" mask="url(#mask-j)" d="M 24 8 L 46 8 L 46 42 C 46 52 38 58 30 58 C 22 58 14 52 14 42 L 14 36 L 22 36 L 22 42 C 22 48 26 50 30 50 C 34 50 38 48 38 42 L 38 16 L 24 16 Z" />
            </svg>
            <div style={{ width: '0.5em' }} />
            {/* Letter C */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="64" width="64" style={{ display: 'inline-block' }}>
              <path fill="url(#d)" mask="url(#mask-c)" d="M 54 18 C 46 8 40 6 32 6 C 16 6 6 18 6 32 C 6 46 16 58 32 58 C 40 58 46 56 54 46 Z" />
            </svg>
          </div>
        </div>

        {children}
        <Toaster />
        <NavbarStyles />
        {/* Suppress hydration mismatch warnings caused by browser extensions
            (e.g. bis_skin_checked, bis_register, __processed_* attributes)
            that inject attributes into the DOM before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const origError = console.error;
                console.error = function() {
                  const msg = Array.prototype.slice.call(arguments).join(' ');
                  if (msg.includes('bis_skin_checked') || msg.includes('bis_register') || msg.includes('__processed_')) return;
                  origError.apply(console, arguments);
                };
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
