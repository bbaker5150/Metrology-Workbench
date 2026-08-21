import React, { createContext, useState, useEffect, useContext, useRef, useCallback } from 'react';
import { gsap } from 'gsap';

const ThemeContext = createContext();

export const useTheme = () => useContext(ThemeContext);

// Background colors used for the reveal overlay. Kept in sync with the
// `--background-color` token defined in App.css for `:root` (light) and
// `body.dark-mode` (dark). If those tokens change, update these too.
const THEME_REVEAL_BG = {
    light: '#f5f7fb',
    dark: '#0b1220',
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const applyThemeToBody = (nextTheme) => {
    document.body.classList.remove('light-mode', 'dark-mode');
    document.body.classList.add(`${nextTheme}-mode`);
};

const persistTheme = (nextTheme) => {
    try {
        localStorage.setItem('theme', nextTheme);
    } catch (_) {
        /* noop — storage may be unavailable */
    }
    if (window.require) {
        try {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('theme-changed', nextTheme);
        } catch (error) {
            console.error('Failed to sync theme with Electron:', error);
        }
    }
};

export const ThemeProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => {
        try {
            return localStorage.getItem('theme') || 'light';
        } catch (_) {
            // Sandboxed SharePoint/srcdoc hosts may deny storage access. Theme
            // switching still works for the current page in memory.
            return 'light';
        }
    });

    // Mirror `theme` in a ref so the toggle handler can read the latest value
    // without re-creating itself, and so side effects don't have to live
    // inside the state updater (which would fire twice under StrictMode).
    const themeRef = useRef(theme);
    useEffect(() => {
        themeRef.current = theme;
    }, [theme]);

    // Track the active wipe so rapid clicks cancel cleanly without leaving
    // orphaned overlays on top of the UI.
    const activeWipeRef = useRef(null);

    useEffect(() => {
        applyThemeToBody(theme);
        persistTheme(theme);
    }, [theme]);

    const toggleTheme = useCallback((event) => {
        const prevTheme = themeRef.current;
        const nextTheme = prevTheme === 'light' ? 'dark' : 'light';

        // Reduced motion or no DOM (SSR safety): just swap.
        if (prefersReducedMotion() || typeof document === 'undefined') {
            setTheme(nextTheme);
            return;
        }

        // Resolve the wipe origin. Prefer the click coordinates; fall back to
        // the bounding rect of the event target; finally to the top-right
        // corner where the toggle lives.
        let originX = window.innerWidth - 32;
        let originY = 32;
        if (event) {
            if (
                typeof event.clientX === 'number' &&
                typeof event.clientY === 'number' &&
                (event.clientX !== 0 || event.clientY !== 0)
            ) {
                originX = event.clientX;
                originY = event.clientY;
            } else if (event.currentTarget && event.currentTarget.getBoundingClientRect) {
                const r = event.currentTarget.getBoundingClientRect();
                originX = r.left + r.width / 2;
                originY = r.top + r.height / 2;
            }
        }

        // Cancel any in-flight wipe before starting a new one.
        if (activeWipeRef.current) {
            activeWipeRef.current.cleanup();
            activeWipeRef.current = null;
        }

        const dx = Math.max(originX, window.innerWidth - originX);
        const dy = Math.max(originY, window.innerHeight - originY);
        // 24px margin past the farthest corner so the soft mask edge fully
        // clears the viewport at the end of the tween.
        const maxRadius = Math.hypot(dx, dy) + 24;

        // Apply the new theme synchronously so the live UI underneath the
        // overlay is already painted in its new colors. The wipe then just
        // erases the old canvas to reveal it.
        applyThemeToBody(nextTheme);
        setTheme(nextTheme);

        // The overlay paints the OUTGOING theme's canvas color across the
        // viewport. A radial mask punches a soft-edged hole that grows from
        // the click point — so the user sees their real new UI bloom into
        // view rather than a solid color sweeping over it.
        const overlay = document.createElement('div');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'pointer-events:none',
            `background:${THEME_REVEAL_BG[prevTheme]}`,
            'z-index:2147483646',
            'will-change:mask-image,-webkit-mask-image',
            'contain:strict',
        ].join(';');

        // Feather width controls how organic the leading edge feels. ~18px
        // reads as a soft, intentional bloom without looking blurry.
        const FEATHER = 18;
        const setMask = (r) => {
            const inner = Math.max(0, r - FEATHER * 0.35);
            const outer = r + FEATHER * 0.65;
            const value = `radial-gradient(circle at ${originX}px ${originY}px, transparent ${inner}px, black ${outer}px)`;
            overlay.style.maskImage = value;
            overlay.style.webkitMaskImage = value;
        };
        setMask(0);

        document.body.appendChild(overlay);

        const cleanup = () => {
            gsap.killTweensOf(proxy);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        };

        const proxy = { r: 0 };
        gsap.to(proxy, {
            r: maxRadius,
            duration: 0.55,
            // expo.out: rapid initial release, long graceful settle. Reads
            // like the natural decay of a ripple.
            ease: 'expo.out',
            onUpdate: () => setMask(proxy.r),
            onComplete: () => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                activeWipeRef.current = null;
            },
        });

        activeWipeRef.current = { cleanup };
    }, []);

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};
