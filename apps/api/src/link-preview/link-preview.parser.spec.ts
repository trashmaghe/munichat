import { parseOgTags } from './link-preview.parser';

describe('parseOgTags', () => {
  it('extracts og:title, og:description, and og:image', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="A great article" />
        <meta property="og:description" content="Read all about it" />
        <meta property="og:image" content="https://example.com/og.png" />
      </head></html>
    `;

    const result = parseOgTags(html);

    expect(result).toEqual({
      title: 'A great article',
      description: 'Read all about it',
      imageUrl: 'https://example.com/og.png',
    });
  });

  it('falls back to <title> and meta description when OG tags are absent', () => {
    const html = `
      <html><head>
        <title>Plain Page Title</title>
        <meta name="description" content="A plain description" />
      </head></html>
    `;

    const result = parseOgTags(html);

    expect(result).toEqual({
      title: 'Plain Page Title',
      description: 'A plain description',
      imageUrl: null,
    });
  });

  it('returns nulls when nothing is present', () => {
    const result = parseOgTags('<html><head></head><body>hi</body></html>');

    expect(result).toEqual({ title: null, description: null, imageUrl: null });
  });
});
