import { useState, useLayoutEffect, useEffect } from 'react';

/**
 * Hook to manage floating window state + dragging logic.
 * * @param {Object} config
 * @param {boolean} config.isOpen - Whether the window is currently open (triggers recentering).
 * @param {number|string} config.defaultWidth - Width in pixels (or "auto").
 * @param {number|string} config.defaultHeight - Height in pixels (or "auto").
 * @param {Object} [config.initialPosition] - Optional override {x,y}.
 */
export const useFloatingWindow = ({
    isOpen,
    defaultWidth = 600,
    defaultHeight = 600,
    initialPosition = null
} = {}) => {
    // State
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    // Initialize in the true visible center. Clamp oversized defaults to a
    // small viewport margin so every popout starts fully reachable.
    useLayoutEffect(() => {
        if (isOpen) {
            if (initialPosition) {
                setPosition(initialPosition);
            } else if (typeof window !== 'undefined') {
                // Parse dimensions safely (handle "auto")
                const w = typeof defaultWidth === 'number' ? defaultWidth : 400; 
                const h = typeof defaultHeight === 'number' ? defaultHeight : 400;

                const viewportMargin = 16;
                const visibleWidth = Math.min(
                    w,
                    Math.max(0, window.innerWidth - viewportMargin * 2),
                );
                const visibleHeight = Math.min(
                    h,
                    Math.max(0, window.innerHeight - viewportMargin * 2),
                );
                const x = Math.max(0, (window.innerWidth - visibleWidth) / 2);
                const y = Math.max(0, (window.innerHeight - visibleHeight) / 2);

                setPosition({ x, y });
            }
        }
    }, [isOpen]); // Only re-center when it OPENS

    // Drag Handlers
    const handleMouseDown = (e) => {
        // Prevent drag if clicking buttons, inputs, or explicit no-drag areas
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.no-drag')) return;

        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        });
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isDragging) {
                // Calculate new position
                let newX = e.clientX - dragOffset.x;
                let newY = e.clientY - dragOffset.y;

                // BOUNDARY CHECK: Prevent dragging under the header (top of screen)
                // Assuming header is ~60px, we stop at 0 or a safe padding
                if (newY < 0) newY = 0; 
                
                // Optional: Prevent dragging completely off screen horizontally
                const windowWidth = window.innerWidth;
                if (newX + 50 > windowWidth) newX = windowWidth - 50; // Keep at least 50px visible right
                if (newX < -((typeof defaultWidth === 'number' ? defaultWidth : 400) - 50)) newX = -100; // Keep left edge somewhat visible

                setPosition({ x: newX, y: newY });
            }
        };
        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset, defaultWidth]);

    return {
        position,
        setPosition, 
        handleMouseDown,
        style: {
            position: 'fixed',
            top: position.y,
            left: position.x,
            margin: 0
        }
    };
};

export default useFloatingWindow;
