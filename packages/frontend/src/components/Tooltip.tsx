'use client';

import { useState, useRef, useId, type ReactNode } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
    /** Tooltip content. When undefined/null/empty, the wrapper becomes a transparent passthrough. */
    content: ReactNode;
    children: ReactNode;
    placement?: 'top' | 'bottom';
    delayMs?: number;
    /** Extra class merged onto the wrapper. Use to override `display: inline-flex` for grid/block trigger elements. */
    className?: string;
}

export function Tooltip({ content, children, placement = 'top', delayMs = 350, className }: TooltipProps) {
    const [visible, setVisible] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const tooltipId = useId();
    const hasContent = content !== undefined && content !== null && content !== '';

    function show() {
        if (!hasContent) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setVisible(true), delayMs);
    }
    function hide() {
        if (timerRef.current) clearTimeout(timerRef.current);
        setVisible(false);
    }

    if (!hasContent) return <>{children}</>;

    return (
        <span
            className={`${styles.wrapper}${className ? ` ${className}` : ''}`}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            aria-describedby={visible ? tooltipId : undefined}
        >
            {children}
            {visible && (
                <span
                    id={tooltipId}
                    role="tooltip"
                    className={`${styles.tooltip} ${placement === 'top' ? styles.placementTop : styles.placementBottom}`}
                >
                    {content}
                </span>
            )}
        </span>
    );
}
