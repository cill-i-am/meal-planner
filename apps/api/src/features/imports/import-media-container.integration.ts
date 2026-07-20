import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- The root Alchemy TypeScript config disables synthetic default imports.
import { join } from "node:path";
import { promisify } from "node:util";

import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import { TikTokMediaContainerDockerfile } from "./import-media-container.runtime.js";
import {
  hasIsoBaseMediaFileType,
  validateMediaProbe,
} from "./import-media-validation.js";

const execFilePromise = promisify(execFile);
const enabled = process.env["MEAL_PLANNER_RUN_CONTAINER_TESTS"] === "1";
const maximumCommandOutputBytes = 16 * 1024 * 1024;

const docker = (
  args: readonly string[],
  options: { readonly allowFailure?: boolean; readonly timeout?: number } = {}
) =>
  Effect.tryPromise({
    catch: (cause) => ({ _tag: "DockerTestFailure" as const, cause }),
    try: async () => {
      try {
        return await execFilePromise("docker", [...args], {
          maxBuffer: maximumCommandOutputBytes,
          timeout: options.timeout ?? 60_000,
        });
      } catch (error) {
        if (options.allowFailure === true) {
          return { stderr: "", stdout: "" };
        }
        throw error;
      }
    },
  });

const expectRejectedProbe = async (
  probe: unknown,
  actualBytes: number,
  maximumBytes = 268_435_456
) => {
  const exit = await Effect.runPromiseExit(
    validateMediaProbe(probe, {
      actualBytes,
      maximumBytes,
      maximumDurationSeconds: 900,
    })
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected synthetic media rejection");
  }
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
    _tag: "TerminalMedia",
  });
};

describe.skipIf(!enabled)("pinned media container", () => {
  it("builds as non-root and validates deterministic real MP4/audio/video", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const builder = `meal-planner-gaia-109-${suffix}`;
    const container = `meal-planner-gaia-109-media-${suffix}`;
    const image = `meal-planner-gaia-109-media:${suffix}`;
    const root = await mkdtemp(join(tmpdir(), "meal-planner-container-test-"));
    const dockerfile = join(root, "Dockerfile");
    try {
      await writeFile(dockerfile, TikTokMediaContainerDockerfile);
      await Effect.runPromise(
        docker([
          "buildx",
          "create",
          "--driver",
          "docker-container",
          "--name",
          builder,
        ])
      );
      await Effect.runPromise(
        docker(
          [
            "buildx",
            "build",
            "--builder",
            builder,
            "--file",
            dockerfile,
            "--load",
            "--platform",
            "linux/amd64",
            "--tag",
            image,
            root,
          ],
          { timeout: 1_500_000 }
        )
      );
      const script = `
set -eu
test "$(id -u)" = "10001"
test "$(id -g)" = "10001"
test "$(yt-dlp --version)" = "2026.07.04"
ffmpeg -version | head -n 1 | grep "ffmpeg version 8.1.2"
ffmpeg -hide_banner -buildconf | grep -- "--disable-network"
if ffmpeg -hide_banner -protocols | grep -E '^[[:space:]]+(http|https|tcp|udp)$'; then exit 1; fi
printf '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttp://169.254.169.254/latest/meta-data/\n#EXT-X-ENDLIST\n' > /tmp/private-target.m3u8
set +e
ffprobe -v error -show_format -of json /tmp/private-target.m3u8 > /tmp/private-target.json 2> /tmp/private-target.stderr
private_target_status=$?
set -e
test "$private_target_status" != "0"
test -s /tmp/private-target.stderr
ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i color=c=blue:s=160x90:r=25:d=1 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 -map 0:v:0 -map 1:a:0 -c:v mpeg4 -c:a aac -shortest -movflags +faststart /tmp/valid.mp4
ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1 -c:a aac /tmp/audio-only.m4a
ffmpeg -nostdin -hide_banner -loglevel error -f lavfi -i color=c=red:s=160x90:r=25:d=1 -c:v mpeg4 /tmp/video-only.mp4
set +e
timeout 1 ffmpeg -re -nostdin -hide_banner -loglevel error -f lavfi -i sine=frequency=220:sample_rate=48000 -t 30 -f null -
timeout_status=$?
set -e
test "$timeout_status" = "124"
ffprobe -v error -show_format -show_streams -of json /tmp/valid.mp4 > /tmp/valid.json
ffprobe -v error -show_format -show_streams -of json /tmp/audio-only.m4a > /tmp/audio-only.json
ffprobe -v error -show_format -show_streams -of json /tmp/video-only.mp4 > /tmp/video-only.json
`;
      await Effect.runPromise(
        docker([
          "create",
          "--name",
          container,
          "--network",
          "none",
          "--platform",
          "linux/amd64",
          image,
          "sh",
          "-c",
          script,
        ])
      );
      await Effect.runPromise(
        docker(["start", "--attach", container], { timeout: 120_000 })
      );
      await Promise.all(
        [
          "valid.mp4",
          "valid.json",
          "audio-only.m4a",
          "audio-only.json",
          "video-only.mp4",
          "video-only.json",
        ].map((name) =>
          Effect.runPromise(
            docker(["cp", `${container}:/tmp/${name}`, join(root, name)])
          )
        )
      );

      const validBytes = await readFile(join(root, "valid.mp4"));
      const validProbe = JSON.parse(
        await readFile(join(root, "valid.json"), "utf-8")
      ) as unknown;
      const validated = await Effect.runPromise(
        validateMediaProbe(validProbe, {
          actualBytes: validBytes.byteLength,
          maximumBytes: 268_435_456,
          maximumDurationSeconds: 900,
        })
      );
      expect(hasIsoBaseMediaFileType(validBytes.subarray(0, 12))).toBe(true);
      expect(validated.audioStreams).toHaveLength(1);
      expect(validated.videoStreams).toHaveLength(1);
      expect(createHash("sha256").update(validBytes).digest("hex")).toMatch(
        /^[a-f\d]{64}$/u
      );

      await Promise.all(
        (
          [
            ["audio-only.m4a", "audio-only.json"],
            ["video-only.mp4", "video-only.json"],
          ] as const
        ).map(async ([mediaName, probeName]) => {
          const [media, probeText] = await Promise.all([
            readFile(join(root, mediaName)),
            readFile(join(root, probeName), "utf-8"),
          ]);
          await expectRejectedProbe(
            JSON.parse(probeText) as unknown,
            media.byteLength
          );
        })
      );
      await expectRejectedProbe(
        validProbe,
        validBytes.byteLength,
        validBytes.byteLength - 1
      );
    } finally {
      await Effect.runPromise(
        docker(["rm", "--force", container], { allowFailure: true })
      );
      await Effect.runPromise(
        docker(["image", "rm", "--force", image], { allowFailure: true })
      );
      await Effect.runPromise(
        docker(["buildx", "rm", "--force", builder], {
          allowFailure: true,
          timeout: 120_000,
        })
      );
      await rm(root, { force: true, recursive: true });
    }
  });
});
