'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useRef } from 'react';

interface LoadingScreenProps {
  isLoading: boolean;
}

type Phase = 'static' | 'animated' | 'dismissing' | 'gone';

/**
 * Loading screen with animated SVG letter spinner (Uiverse.io by SelfMadeSystem).
 * Shows "MJC" as three animated SVG letter paths with gradient strokes.
 * White background.
 */
export function LoadingScreen({ isLoading }: LoadingScreenProps) {
  const [phase, setPhase] = useState<Phase>('static');
  const dismissSequenceStarted = useRef(false);

  useEffect(() => {
    const staticLoader = document.getElementById('initial-loader');
    if (staticLoader) {
      staticLoader.style.opacity = '0';
      setTimeout(() => staticLoader.remove(), 500);
    }
    const timer = setTimeout(() => setPhase('animated'), 0);
    return () => clearTimeout(timer);
  }, []);

  const dismissTimersRef = useRef<{ dismiss: ReturnType<typeof setTimeout> | null; gone: ReturnType<typeof setTimeout> | null }>({ dismiss: null, gone: null });

  useEffect(() => {
    if (!isLoading && phase === 'animated' && !dismissSequenceStarted.current) {
      dismissSequenceStarted.current = true;
      dismissTimersRef.current.dismiss = setTimeout(() => setPhase('dismissing'), 300);
      dismissTimersRef.current.gone = setTimeout(() => setPhase('gone'), 900);
    }
  }, [isLoading, phase]);

  useEffect(() => {
    return () => {
      if (dismissTimersRef.current.dismiss) clearTimeout(dismissTimersRef.current.dismiss);
      if (dismissTimersRef.current.gone) clearTimeout(dismissTimersRef.current.gone);
    };
  }, []);

  if (phase === 'gone') return null;

  // The SVG loader markup — identical to the Uiverse.io original, but with
  // M, J, C letter paths instead of Y, O, U. The defs (gradients) are inlined
  // so the SVG is self-contained.
  const loaderSVG = (
    <div className="loader" style={{ display: 'flex', margin: '0.25em 0' }}>
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

          {/* Masks: white animated stroke reveals the filled letter progressively.
              The thick stroke (16) creates a wide "paint" band so the letter
              fills in as a solid shape, not just an outline trace. */}
          <mask id="mask-m">
            <rect width="64" height="64" fill="black" />
            <path fill="none" stroke="white" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round"
              d="M 10 56 L 10 8 L 22 8 L 32 34 L 42 8 L 54 8 L 54 56 L 46 56 L 46 22 L 37 44 L 27 44 L 18 22 L 18 56 Z"
              className="dash" pathLength="360"
              style={{ animation: 'dashArray 2s ease-in-out infinite, dashOffset 2s linear infinite' }} />
          </mask>
          <mask id="mask-j">
            <rect width="64" height="64" fill="black" />
            <path fill="none" stroke="white" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round"
              d="M 24 8 L 46 8 L 46 42 C 46 52 38 58 30 58 C 22 58 14 52 14 42 L 14 36 L 22 36 L 22 42 C 22 48 26 50 30 50 C 34 50 38 48 38 42 L 38 16 L 24 16 Z"
              className="dash" pathLength="360"
              style={{ animation: 'dashArray 2s ease-in-out infinite, dashOffset 2s linear infinite' }} />
          </mask>
          <mask id="mask-c">
            <rect width="64" height="64" fill="black" />
            <path fill="none" stroke="white" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round"
              d="M 54 18 C 46 8 40 6 32 6 C 16 6 6 18 6 32 C 6 46 16 58 32 58 C 40 58 46 56 54 46"
              className="dash" pathLength="360"
              style={{ animation: 'dashArray 2s ease-in-out infinite, dashOffset 2s linear infinite' }} />
          </mask>
        </defs>
      </svg>

      {/* Letter M — solid fill revealed by animated mask (drawing effect) */}
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="64" width="64" style={{ display: 'inline-block' }}>
        <path
          fill="url(#b)" mask="url(#mask-m)"
          d="M 10 56 L 10 8 L 22 8 L 32 34 L 42 8 L 54 8 L 54 56 L 46 56 L 46 22 L 37 44 L 27 44 L 18 22 L 18 56 Z"
        />
      </svg>

      {/* Letter J — solid fill revealed by animated mask */}
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="64" width="64" style={{ display: 'inline-block' }}>
        <path
          fill="url(#c)" mask="url(#mask-j)"
          d="M 24 8 L 46 8 L 46 42 C 46 52 38 58 30 58 C 22 58 14 52 14 42 L 14 36 L 22 36 L 22 42 C 22 48 26 50 30 50 C 34 50 38 48 38 42 L 38 16 L 24 16 Z"
        />
      </svg>

      <div style={{ width: '0.5em' }} />

      {/* Letter C — solid fill revealed by animated mask */}
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" height="64" width="64" style={{ display: 'inline-block' }}>
        <path
          fill="url(#d)" mask="url(#mask-c)"
          d="M 54 18 C 46 8 40 6 32 6 C 16 6 6 18 6 32 C 6 46 16 58 32 58 C 40 58 46 56 54 46 Z"
        />
      </svg>
    </div>
  );

  return (
    <AnimatePresence>
      {(phase as Phase) !== 'gone' && (
        <motion.div
          key="loading-screen"
          initial={{ opacity: 1 }}
          animate={{ opacity: phase === 'dismissing' ? 0 : 1 }}
          transition={{ duration: phase === 'dismissing' ? 0.5 : 0, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center pb-[14vh]"
          style={{ backgroundColor: '#ffffff' }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            style={{ transform: 'scale(4)' }}
          >
            {loaderSVG}
          </motion.div>

          <style jsx>{`
            @keyframes dashArray {
              0% { stroke-dasharray: 0 1 359 0; }
              50% { stroke-dasharray: 0 359 1 0; }
              100% { stroke-dasharray: 359 1 0 0; }
            }
            @keyframes spinDashArray {
              0% { stroke-dasharray: 270 90; }
              50% { stroke-dasharray: 0 360; }
              100% { stroke-dasharray: 270 90; }
            }
            @keyframes dashOffset {
              0% { stroke-dashoffset: 365; }
              100% { stroke-dashoffset: 5; }
            }
            @keyframes spin {
              0% { rotate: 0deg; }
              12.5%, 25% { rotate: 270deg; }
              37.5%, 50% { rotate: 540deg; }
              62.5%, 75% { rotate: 810deg; }
              87.5%, 100% { rotate: 1080deg; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
