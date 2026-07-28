import type { MetadataRoute } from 'next';

// Internal DEX tool on a public URL: keep it out of search engines.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
