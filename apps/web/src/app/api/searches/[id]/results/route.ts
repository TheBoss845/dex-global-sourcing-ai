import { NextResponse } from 'next/server';
import { listJobOffers } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? undefined;
  const sort = (url.searchParams.get('sort') as 'priceUsd' | 'supplier' | 'country' | 'extractedAt') || 'priceUsd';
  const order = (url.searchParams.get('order') as 'asc' | 'desc') || 'asc';
  const includePossible = url.searchParams.get('includePossible') === 'true';

  const offers = await listJobOffers(id, { q, sort, order, includePossible, limit: 10 });
  return NextResponse.json({ offers });
}
