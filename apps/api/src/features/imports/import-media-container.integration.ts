import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Cause, Effect, Exit, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { TikTokMediaContainerDockerfile } from "./import-media-container.runtime.js";
import {
  MediaProbeOutput,
  hasIsoBaseMediaFileType,
  validateMediaProbe,
} from "./import-media-validation.js";
import { TerminalMediaError } from "./import-media.errors.js";

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
  probe: Schema.Json,
  actualBytes: number,
  maximumBytes = 268_435_456
) => {
  const exit = await Effect.runPromiseExit(
    Schema.decodeUnknownEffect(MediaProbeOutput)(probe).pipe(
      Effect.mapError(
        () =>
          new TerminalMediaError({
            code: "invalid_media",
            stage: "validation",
          })
      ),
      Effect.flatMap((decodedProbe) =>
        validateMediaProbe(decodedProbe, {
          actualBytes,
          maximumBytes,
          maximumDurationSeconds: 900,
        })
      )
    )
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
    const workspaceContainer = `meal-planner-gaia-169-workspace-${suffix}`;
    const image = `meal-planner-gaia-109-media:${suffix}`;
    const root = await mkdtemp(
      path.join(tmpdir(), "meal-planner-container-test-")
    );
    const dockerfile = path.join(root, "Dockerfile");
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
      const workspaceScript = `
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.getuid?.() !== 10001 || process.getgid?.() !== 10001) {
  throw new Error("installed image must run as the media user");
}
const ownedTemporaryRoot = await stat("/work/tmp");
if (!ownedTemporaryRoot.isDirectory()) {
  throw new Error("installed temporary root must be a directory");
}
if (ownedTemporaryRoot.uid !== 10001 || ownedTemporaryRoot.gid !== 10001) {
  throw new Error("installed temporary root must be owned by the media user");
}
if ((ownedTemporaryRoot.mode & 0o300) !== 0o300) {
  throw new Error("installed temporary root must be owner-writable and traversable");
}
let systemTemporaryRootUnavailable = false;
try {
  const unexpected = await mkdtemp("/tmp/meal-planner-unexpected-");
  await rm(unexpected, { force: true, recursive: true });
} catch {
  systemTemporaryRootUnavailable = true;
}
if (!systemTemporaryRootUnavailable) {
  throw new Error("system temporary root must be unavailable for this proof");
}
if (tmpdir() !== "/work/tmp") {
  throw new Error("installed image must select the owned temporary root");
}
const root = await mkdtemp(\`\${tmpdir()}/meal-planner-media-installed-\`);
if (!root.startsWith("/work/tmp/meal-planner-media-installed-")) {
  throw new Error("temporary workspace escaped the owned root");
}
const proofFile = join(root, "workspace-proof.txt");
const proofContents = "owned installed workspace";
await writeFile(proofFile, proofContents, "utf8");
if ((await readFile(proofFile, "utf8")) !== proofContents) {
  throw new Error("installed temporary workspace did not preserve written bytes");
}
await unlink(proofFile);
try {
  await stat(proofFile);
  throw new Error("installed temporary workspace file was not deleted");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  ) {
    throw error;
  }
}
await rm(root, { force: true, recursive: true });
try {
  await stat(root);
  throw new Error("installed temporary workspace was not removed");
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  ) {
    throw error;
  }
}
`;
      await Effect.runPromise(
        docker([
          "create",
          "--name",
          workspaceContainer,
          "--network",
          "none",
          "--platform",
          "linux/amd64",
          "--tmpfs",
          "/tmp:mode=000",
          image,
          "node",
          "--input-type=module",
          "--eval",
          workspaceScript,
        ])
      );
      await Effect.runPromise(
        docker(["start", "--attach", workspaceContainer], {
          timeout: 120_000,
        })
      );
      const script = `
set -eu
test "$(id -u)" = "10001"
test "$(id -g)" = "10001"
test "$(yt-dlp --version)" = "2026.08.19"
ffmpeg -version | head -n 1 | grep "ffmpeg version 9.0.1"
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
            docker(["cp", `${container}:/tmp/${name}`, path.join(root, name)])
          )
        )
      );

      const validBytes = await readFile(path.join(root, "valid.mp4"));
      const validProbe = Schema.decodeUnknownSync(Schema.Json)(
        JSON.parse(await readFile(path.join(root, "valid.json"), "utf-8"))
      );
      const decodedValidProbe =
        Schema.decodeUnknownSync(MediaProbeOutput)(validProbe);
      const validated = await Effect.runPromise(
        validateMediaProbe(decodedValidProbe, {
          actualBytes: validBytes.byteLength,
          maximumBytes: 268_435_456,
          maximumDurationSeconds: 900,
        })
      );
      expect(hasIsoBaseMediaFileType(validBytes.subarray(0, 12))).toBe(true);
      expect(validated.audioStreams).toHaveLength(1);
      expect(validated.videoStreams).toHaveLength(1);

      await Promise.all(
        (
          [
            ["audio-only.m4a", "audio-only.json"],
            ["video-only.mp4", "video-only.json"],
          ] as const
        ).map(async ([mediaName, probeName]) => {
          const [media, probeText] = await Promise.all([
            readFile(path.join(root, mediaName)),
            readFile(path.join(root, probeName), "utf-8"),
          ]);
          await expectRejectedProbe(
            Schema.decodeUnknownSync(Schema.Json)(JSON.parse(probeText)),
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
        docker(["rm", "--force", workspaceContainer], { allowFailure: true })
      );
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
