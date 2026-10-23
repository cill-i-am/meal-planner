export const LifecycleFixtureByteCount = 2 * 1024 * 1024;
export const LifecycleFixtureDurationSeconds = 12;

/** The fixture models both source validation and derived-frame dimension probes. */
export const lifecycleFixtureProbe = (args: readonly string[]) =>
  args.includes("-show_format")
    ? {
        format: {
          duration: String(LifecycleFixtureDurationSeconds),
          format_name: "mov,mp4,m4a,3gp,3g2,mj2",
          size: String(LifecycleFixtureByteCount),
        },
        streams: [
          { codec_name: "h264", codec_type: "video", index: 0 },
          { codec_name: "aac", codec_type: "audio", index: 1 },
        ],
      }
    : { streams: [{ height: 720, width: 1280 }] };
