import { useState } from 'react';
import { Download } from 'lucide-react';

// Inline video playback via the browser's native decoders and controls (play,
// scrub, volume, fullscreen). Seeking works because GET /files/:id answers
// HTTP Range requests. Codecs the browser can't decode fall back to a link.
export function VideoAttachment({ url, fileName }: { url: string; fileName: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm hover:bg-muted"
      >
        <Download className="size-4 text-muted-foreground" />
        <span>{fileName}</span>
      </a>
    );
  }

  return (
    <video
      controls
      preload="metadata"
      src={url}
      onError={() => setFailed(true)}
      className="max-h-80 max-w-md rounded-lg border border-border bg-black"
    >
      <track kind="captions" />
    </video>
  );
}
