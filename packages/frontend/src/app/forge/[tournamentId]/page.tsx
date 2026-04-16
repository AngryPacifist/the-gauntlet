'use client';

import { use } from 'react';
import { redirect } from 'next/navigation';

export default function ForgePage({ params }: { params: Promise<{ tournamentId: string }> }) {
    const { tournamentId } = use(params);
    redirect(`/leaderboard/${tournamentId}`);
}
