import * as cheerio from 'cheerio';

export interface ParsedOgTags {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

export function parseOgTags(html: string): ParsedOgTags {
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDescription = $('meta[property="og:description"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');

  const title = ogTitle?.trim() || $('title').first().text().trim() || null;
  const description =
    ogDescription?.trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    null;
  const imageUrl = ogImage?.trim() || null;

  return { title, description, imageUrl };
}
