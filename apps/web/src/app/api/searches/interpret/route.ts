import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import { interpretProductQuery } from '@dex/ai';
import { getServerEnv } from '@/lib/server-env';

/**
 * Interpret a free-form product request ("the tiny raspberry pi computer")
 * into a concrete product to search for. Recent user corrections are fed
 * back into the prompt so the assistant learns from its mistakes.
 */
export async function POST(request: Request) {
  try {
    let body: { query?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const query = (body.query ?? '').trim();
    if (query.length < 2 || query.length > 300) {
      return NextResponse.json({ error: 'Describe the product you want' }, { status: 400 });
    }

    const env = getServerEnv();
    if (env.AI_ENABLED && env.OPENAI_API_KEY) {
      try {
        const feedback = await prisma.interpretationFeedback.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        const interpretation = await interpretProductQuery({
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL,
          query,
          corrections: feedback.map((f) => ({ userSaid: f.query, theyMeant: f.correction })),
        });
        if (interpretation) {
          return NextResponse.json({ interpretation, method: 'ai' });
        }
      } catch {
        // fall through to the literal fallback below
      }
    }

    // AI unavailable: search for exactly what was typed (still works, just literal).
    return NextResponse.json({
      interpretation: {
        productName: query,
        searchTerm: query,
        confidence: 0.4,
        explanation: 'AI unavailable — will search for exactly what you typed.',
      },
      method: 'literal',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Interpretation failed' },
      { status: 500 },
    );
  }
}
