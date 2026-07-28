import { NextResponse } from 'next/server';
import { prisma } from '@dex/db';
import { interpretProductQuery } from '@dex/ai';
import { getServerEnv } from '@/lib/server-env';
import { rateLimit } from '@/lib/rate-limit';

/**
 * The user said the interpretation was wrong and told us what they meant.
 * Store the correction (future interpretations learn from it) and
 * re-interpret immediately using the new knowledge.
 */
export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'local';
    const limited = rateLimit(`feedback:${ip}`, { limit: 10, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
    }

    let body: {
      query?: string;
      interpretedName?: string;
      interpretedMpn?: string;
      correction?: string;
    } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const query = (body.query ?? '').trim();
    const correction = (body.correction ?? '').trim();
    if (query.length < 2 || correction.length < 2 || correction.length > 300) {
      return NextResponse.json(
        { error: 'Tell me what you actually meant (a few words is enough)' },
        { status: 400 },
      );
    }

    await prisma.interpretationFeedback.create({
      data: {
        query: query.slice(0, 300),
        interpretedName: body.interpretedName?.slice(0, 120) ?? null,
        interpretedMpn: body.interpretedMpn?.slice(0, 80) ?? null,
        correction: correction.slice(0, 300),
      },
    });

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
          return NextResponse.json({ ok: true, learned: true, interpretation, method: 'ai' });
        }
      } catch {
        // fall through
      }
    }

    // AI unavailable: honor the user's correction literally.
    return NextResponse.json({
      ok: true,
      learned: true,
      interpretation: {
        productName: correction,
        searchTerm: correction,
        confidence: 0.9,
        explanation: 'Using your correction directly.',
      },
      method: 'literal',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Feedback failed' },
      { status: 500 },
    );
  }
}
