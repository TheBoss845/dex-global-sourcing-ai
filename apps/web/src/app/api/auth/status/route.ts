import { NextResponse } from 'next/server';

export async function GET() {
  const authRequired =
    process.env.NODE_ENV === 'production' || Boolean(process.env.DEX_API_KEY?.trim());
  return NextResponse.json({ authRequired });
}
