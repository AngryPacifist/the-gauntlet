'use client';

import { Share2 } from 'lucide-react';

interface ShareButtonProps {
    text: string;
    url?: string;
    label?: string;
    compact?: boolean;
}

export default function ShareButton({ text, url, label = 'Share', compact = false }: ShareButtonProps) {
    function handleShare() {
        const tweetText = url ? `${text}\n\n${url}` : text;
        const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
        window.open(intentUrl, '_blank', 'noopener,noreferrer,width=550,height=420');
    }

    return (
        <button
            onClick={handleShare}
            className={`share-btn${compact ? ' share-btn--compact' : ''}`}
            title="Share on X"
            type="button"
        >
            <Share2 size={compact ? 13 : 14} />
            {!compact && <span>{label}</span>}
        </button>
    );
}
