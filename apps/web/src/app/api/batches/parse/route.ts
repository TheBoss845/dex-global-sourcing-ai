import { NextResponse } from 'next/server';
import { parsePastedPartsList } from '@dex/core';
import { parsePartsListWithAi } from '@dex/ai';
import { getServerEnv } from '@/lib/server-env';

/**
 * Turn a messy pasted parts list into structured items.
 * Deterministic parsing first (SupplyItNow rows, tab/comma lists);
 * AI cleanup as fallback for unrecognized formats.
 */
export async function POST(request: Request) {
  try {
    let body: { text?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const text = (body.text ?? '').slice(0, 100_000);
    if (!text.trim()) {
      return NextResponse.json({ error: 'Paste a parts list first' }, { status: 400 });
    }

    const structured = parsePastedPartsList(text);
    if (structured.length > 0) {
      return NextResponse.json({ items: structured, method: 'structured' });
    }

    const env = getServerEnv();
    if (env.AI_ENABLED && env.OPENAI_API_KEY) {
      try {
        const aiItems = await parsePartsListWithAi({
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL,
          text,
        });
        if (aiItems && aiItems.length > 0) {
          return NextResponse.json({ items: aiItems, method: 'ai' });
        }
      } catch {
        // fall through to the error below
      }
    }

    return NextResponse.json(
      {
        error:
          'Could not find part numbers in that paste. Use one part per line, e.g. "LM7805CT, 5V regulator".',
      },
      { status: 422 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Parse failed' },
      { status: 500 },
    );
  }
}
