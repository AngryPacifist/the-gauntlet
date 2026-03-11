'use client';

import { useState } from 'react';
import { Share2, Check, Link2, Twitter } from 'lucide-react';

interface ShareButtonProps {
    text: string;
    url?: string;
    label?: string;
    compact?: boolean;
}

export default function ShareButton({ text, url, label = 'Share', compact = false }: ShareButtonProps) {
    const [showMenu, setShowMenu] = useState(false);
    const [copied, setCopied] = useState(false);

    function handleTweet() {
        const pageUrl = url || (typeof window !== 'undefined' ? window.location.href : '');
        const tweetText = `${text}\n\n${pageUrl}`;
        const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
        window.open(intentUrl, '_blank', 'noopener,noreferrer,width=550,height=420');
        setShowMenu(false);
    }

    async function handleCopyLink() {
        const pageUrl = url || window.location.href;
        try {
            await navigator.clipboard.writeText(pageUrl);
            setCopied(true);
            setTimeout(() => { setCopied(false); setShowMenu(false); }, 1500);
        } catch {
            // Fallback for older browsers
            const input = document.createElement('input');
            input.value = pageUrl;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setCopied(true);
            setTimeout(() => { setCopied(false); setShowMenu(false); }, 1500);
        }
    }

    function toggleMenu() {
        setShowMenu((prev) => !prev);
    }

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
                onClick={toggleMenu}
                className={`share-btn${compact ? ' share-btn--compact' : ''}`}
                title="Share"
                type="button"
            >
                <Share2 size={compact ? 13 : 14} />
                {!compact && <span>{label}</span>}
            </button>

            {showMenu && (
                <>
                    {/* Backdrop to close menu on outside click */}
                    <div
                        style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                        onClick={() => setShowMenu(false)}
                    />
                    <div className="share-menu">
                        <button className="share-menu__item" onClick={handleCopyLink} type="button">
                            {copied
                                ? <><Check size={14} /> <span>Copied!</span></>
                                : <><Link2 size={14} /> <span>Copy Link</span></>
                            }
                        </button>
                        <button className="share-menu__item" onClick={handleTweet} type="button">
                            <Twitter size={14} /> <span>Post on X</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
