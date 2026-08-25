import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

const ContextMenu = ({ menu, onClose }) => {
    const menuRef = useRef(null);
    const [position, setPosition] = useState({ x: menu?.x || 0, y: menu?.y || 0 });

    useLayoutEffect(() => {
        if (!menu || !menuRef.current) return;
        const bounds = menuRef.current.getBoundingClientRect();
        const margin = 8;
        const viewportX = Number(menu.x || 0) - window.scrollX;
        const viewportY = Number(menu.y || 0) - window.scrollY;
        setPosition({
            x: Math.max(margin, Math.min(viewportX, window.innerWidth - bounds.width - margin)),
            y: Math.max(margin, Math.min(viewportY, window.innerHeight - bounds.height - margin)),
        });
    }, [menu]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    if (!menu) return null;

    const style = {
        top: `${position.y}px`,
        left: `${position.x}px`,
    };

    return ReactDOM.createPortal(
        <>
            <div className="context-menu-overlay" onClick={onClose}></div>
            <div ref={menuRef} className="context-menu" style={style}>
                <ul>
                    {menu.items.map((item, index) => {
                        if (item.type === 'divider') {
                            return <li key={index} className="context-menu-divider"></li>;
                        }
                        return (
                            <li
                                key={index}
                                className={item.className || ''}
                                onClick={() => { item.action(); onClose(); }}
                            >
                                {item.icon && <FontAwesomeIcon icon={item.icon} className="context-menu-icon" />}
                                <span>{item.label}</span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </>,
        document.body
    );
};

export default ContextMenu;
