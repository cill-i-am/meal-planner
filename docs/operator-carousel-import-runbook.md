# Operator TikTok Carousel Bundle

This runbook describes how an authorized operator prepares one complete,
lawfully downloaded TikTok photo/carousel bundle for the private import API.
It does not authorize downloading media, using a logged-in session, calling
providers, or running a live import. Live input remains a separate approval
gate.

## Prepare The Bundle

1. Work in a temporary directory outside this repository. Never add source
   media, bundle JSON, API tokens, or responses to Git.
2. Retain the original public TikTok `photo` or `photos` URL only for the
   request. The service resolves its canonical TikTok identity and discards
   query parameters; the durable manifest does not store the URL.
3. Export every page as JPEG. Name the files with zero-based, contiguous
   indexes such as `00.jpg`, `01.jpg`, and `02.jpg`, preserving the creator's
   original order.
4. Confirm there are between 1 and 12 images, no page is missing or repeated,
   each file is non-empty and at most 1 MiB, and the total decoded image bytes
   are at most 6 MiB.
5. Record each JPEG's pixel width, pixel height, byte-for-byte SHA-256 digest,
   and base64 content. On macOS, `sips -g pixelWidth -g pixelHeight 00.jpg`,
   `shasum -a 256 00.jpg`, and `base64 -i 00.jpg` provide those values.

Build an untracked JSON document with this shape:

```json
{
  "declaredPageCount": 2,
  "images": [
    {
      "height": 1280,
      "jpegBase64": "<base64 without whitespace>",
      "orderIndex": 0,
      "sha256": "<64 lowercase hexadecimal characters>",
      "width": 720
    },
    {
      "height": 1280,
      "jpegBase64": "<base64 without whitespace>",
      "orderIndex": 1,
      "sha256": "<64 lowercase hexadecimal characters>",
      "width": 720
    }
  ],
  "source": {
    "kind": "tiktok",
    "url": "https://www.tiktok.com/@creator/photo/<canonical-id>"
  }
}
```

## Submit Only After The Live Gate

The private endpoint is `POST /imports/operator-carousel`. It requires the
configured bearer token, `Content-Type: application/json`, and a unique
`Idempotency-Key`. Keep the same idempotency key only when replaying the exact
same bundle. A successful deterministic composition returns the import in
`needs_review`.

The service rejects malformed, incomplete, oversized, duplicated,
non-contiguous, dimension-mismatched, or checksum-mismatched bundles with
`request_complete_carousel`. Correct the whole bundle before retrying; no
partial recipe draft is created.

Evidence images and the manifest are private R2 objects with
`private, no-store`, verified SHA-256 metadata, exact page order, and the
existing seven-day deletion deadline. The carousel is never sent through the
normal video acquisition or transcription path.
