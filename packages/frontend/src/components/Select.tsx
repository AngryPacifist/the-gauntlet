// ============================================================================
// Custom Select / Combobox Component (Phase 8.i.5.D.6)
//
// Fully-styled dark-theme replacement for native <select> elements. Solves
// the blank-text-display bug (native <select> with `appearance: none` and
// CSS-applied `color` in some browsers fails to render the selected option's
// text in the trigger area) by rendering a custom button + popup.
//
// Features:
// - Keyboard nav: ArrowUp/ArrowDown to move highlight, Enter to select,
//   Escape to close, Tab to commit + close, Home/End to jump.
// - Type-to-search: typing characters filters the visible options.
// - Click-outside closes the popup.
// - Focus management: trigger gets focus on close.
// - ARIA: combobox + listbox + option roles; aria-expanded, aria-activedescendant,
//   aria-selected.
// - Controlled component (value + onChange).
// - Optional renderOption + renderValue overrides for custom display.
// ============================================================================

'use client';

import {
    useState,
    useEffect,
    useRef,
    useCallback,
    useId,
    type ReactNode,
    type KeyboardEvent,
} from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
    value: string;
    label: string;
    /** Optional metadata rendered in option (e.g. mint hint, asset feed_id, etc.) */
    hint?: string;
    disabled?: boolean;
}

export interface SelectProps {
    /** Current selected value (controlled). Empty string = nothing selected. */
    value: string;
    /** Called with new value on selection. */
    onChange: (value: string) => void;
    /** Available options. */
    options: SelectOption[];
    /** Placeholder shown when no value selected. Default: "— select —". */
    placeholder?: string;
    /** Disable the select entirely. */
    disabled?: boolean;
    /** Optional custom CSS class for the trigger button. */
    className?: string;
    /** Optional custom CSS class for the popup listbox. */
    popupClassName?: string;
    /** Optional override for rendering each option. Default: label + hint. */
    renderOption?: (option: SelectOption) => ReactNode;
    /** Optional override for rendering the selected value in the trigger. */
    renderValue?: (option: SelectOption | null) => ReactNode;
    /** Optional ARIA label (use when no visible <label> exists). */
    ariaLabel?: string;
}

export function Select({
    value,
    onChange,
    options,
    placeholder = '— select —',
    disabled = false,
    className = '',
    popupClassName = '',
    renderOption,
    renderValue,
    ariaLabel,
}: SelectProps) {
    const [open, setOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [searchBuffer, setSearchBuffer] = useState('');
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxRef = useRef<HTMLUListElement>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listboxId = useId();

    const selectedOption = options.find((o) => o.value === value) ?? null;
    const enabledOptions = options.filter((o) => !o.disabled);

    // Reset highlight to selected option (or 0) when opening
    useEffect(() => {
        if (open) {
            const idx = options.findIndex((o) => o.value === value);
            setHighlightedIndex(idx >= 0 ? idx : 0);
        }
    }, [open, options, value]);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (
                triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
                listboxRef.current && !listboxRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    // Scroll highlighted option into view
    useEffect(() => {
        if (!open || !listboxRef.current || highlightedIndex < 0) return;
        const optEl = listboxRef.current.children[highlightedIndex] as HTMLElement | undefined;
        if (optEl) optEl.scrollIntoView({ block: 'nearest' });
    }, [open, highlightedIndex]);

    const selectAt = useCallback((idx: number) => {
        const opt = options[idx];
        if (!opt || opt.disabled) return;
        onChange(opt.value);
        setOpen(false);
        triggerRef.current?.focus();
    }, [options, onChange]);

    function handleTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
        if (disabled) return;
        if (!open) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        // Open: navigation
        if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (highlightedIndex >= 0) selectAt(highlightedIndex);
            return;
        }
        if (e.key === 'Tab') {
            // Commit current highlight + close
            if (highlightedIndex >= 0) selectAt(highlightedIndex);
            setOpen(false);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = options.findIndex((o, i) => i > highlightedIndex && !o.disabled);
            if (next >= 0) setHighlightedIndex(next);
            else if (enabledOptions.length > 0) setHighlightedIndex(options.indexOf(enabledOptions[0]));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            for (let i = highlightedIndex - 1; i >= 0; i--) {
                if (!options[i].disabled) { setHighlightedIndex(i); return; }
            }
            if (enabledOptions.length > 0) setHighlightedIndex(options.indexOf(enabledOptions[enabledOptions.length - 1]));
            return;
        }
        if (e.key === 'Home') {
            e.preventDefault();
            if (enabledOptions.length > 0) setHighlightedIndex(options.indexOf(enabledOptions[0]));
            return;
        }
        if (e.key === 'End') {
            e.preventDefault();
            if (enabledOptions.length > 0) setHighlightedIndex(options.indexOf(enabledOptions[enabledOptions.length - 1]));
            return;
        }
        // Type-to-search: any single printable character
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const newBuffer = searchBuffer + e.key.toLowerCase();
            setSearchBuffer(newBuffer);
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = setTimeout(() => setSearchBuffer(''), 600);
            const match = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(newBuffer));
            if (match >= 0) setHighlightedIndex(match);
        }
    }

    const triggerLabel: ReactNode = renderValue
        ? renderValue(selectedOption)
        : selectedOption
            ? (selectedOption.hint ? `${selectedOption.label} (${selectedOption.hint})` : selectedOption.label)
            : <span className="select__placeholder">{placeholder}</span>;

    const showOption = (opt: SelectOption): ReactNode => {
        if (renderOption) return renderOption(opt);
        return (
            <span className="select__optionContent">
                <span className="select__optionLabel">{opt.label}</span>
                {opt.hint && <span className="select__optionHint">{opt.hint}</span>}
            </span>
        );
    };

    return (
        <div className={`select ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                role="combobox"
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-controls={open ? listboxId : undefined}
                aria-label={ariaLabel}
                aria-disabled={disabled}
                disabled={disabled}
                className="select__trigger"
                onClick={() => !disabled && setOpen((o) => !o)}
                onKeyDown={handleTriggerKey}
            >
                <span className="select__triggerLabel">{triggerLabel}</span>
                <ChevronDown size={14} className={`select__chevron ${open ? 'select__chevron--open' : ''}`} />
            </button>
            {open && (
                <ul
                    ref={listboxRef}
                    role="listbox"
                    id={listboxId}
                    className={`select__listbox ${popupClassName}`}
                    aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
                >
                    {options.length === 0 && (
                        <li className="select__empty">No options</li>
                    )}
                    {options.map((opt, i) => (
                        <li
                            key={opt.value}
                            id={`${listboxId}-option-${i}`}
                            role="option"
                            aria-selected={opt.value === value}
                            aria-disabled={opt.disabled}
                            className={`select__option ${i === highlightedIndex ? 'select__option--highlighted' : ''} ${opt.value === value ? 'select__option--selected' : ''} ${opt.disabled ? 'select__option--disabled' : ''}`}
                            onMouseEnter={() => !opt.disabled && setHighlightedIndex(i)}
                            onClick={() => selectAt(i)}
                        >
                            {showOption(opt)}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
