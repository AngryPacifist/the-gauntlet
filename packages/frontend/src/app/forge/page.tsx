'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listTournaments } from '@/lib/api';
import { Flame } from 'lucide-react';

export default function ForgeIndexPage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function redirect() {
            try {
                const tournaments = await listTournaments();
                if (tournaments.length === 0) {
                    setError('No tournaments found.');
                    return;
                }

                // Prefer active, then completed, then most recent by id
                const active = tournaments.find((t) => t.status === 'active');
                if (active) {
                    router.replace(`/forge/${active.id}`);
                    return;
                }

                const completed = tournaments.find((t) => t.status === 'completed');
                if (completed) {
                    router.replace(`/forge/${completed.id}`);
                    return;
                }

                // Fallback: highest id
                const sorted = [...tournaments].sort((a, b) => b.id - a.id);
                router.replace(`/forge/${sorted[0].id}`);
            } catch {
                setError('Failed to load tournaments.');
            }
        }
        redirect();
    }, [router]);

    if (error) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                    <Flame size={48} style={{ margin: '0 auto 16px', opacity: 0.4 }} />
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                <Flame size={48} style={{ margin: '0 auto 16px', animation: 'pulse 2s infinite' }} />
                <p>Loading The Forge...</p>
            </div>
        </div>
    );
}
