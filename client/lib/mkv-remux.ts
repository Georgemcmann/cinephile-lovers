import type {
  Conversion,
  ConversionAudioOptions,
  StreamTargetChunk,
} from "mediabunny";

/**
 * MKV → MP4 repackaging, entirely on this device.
 *
 * Browsers cannot open the Matroska container in <video>. Mediabunny demuxes
 * the MKV and muxes the same encoded packets into MP4 (copy mode — no
 * re-encode for the usual H.264 video), transcode audio to AAC only when the
 * source codec is not reliably playable inside MP4. The result is a Blob the
 * persistent layer hands to its <video> element. Nothing is uploaded.
 */

export class MkvPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MkvPreparationError";
  }
}

/** Blob-backed playback of multi-GB conversions is not practical. */
const MAX_INPUT_BYTES = 4 * 1024 ** 3;

/** WebCodecs cannot decode these, so they cannot be converted to AAC. */
const UNDECODABLE_AUDIO_CODECS = new Set<string>([
  "ac3",
  "eac3",
  "dts",
  "truehd",
]);

/** MP4 can contain these, but browsers do not reliably play them. */
const TRANSCODE_AUDIO_CODECS = new Set<string>([
  "opus",
  "vorbis",
  "pcm-u8",
  "pcm-s8",
  "pcm-s16",
  "pcm-s16be",
  "pcm-s24",
  "pcm-s24be",
  "pcm-s32",
  "pcm-s32be",
  "pcm-f32",
  "pcm-f32be",
  "pcm-f64",
  "pcm-f64be",
  "ulaw",
  "alaw",
]);

const CANCELED_MESSAGE = "MKV preparation was canceled.";

const GENERIC_FAILURE =
  "The MKV could not be prepared for playback. Convert it to MP4 (H.264 + AAC) with HandBrake or ffmpeg and try again.";

const CONVERT_HINT =
  "Convert the file to MP4 (H.264 + AAC) with HandBrake or ffmpeg first.";

const CODEC_LABELS: Record<string, string> = {
  avc: "H.264",
  hevc: "HEVC",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  prores: "ProRes",
  aac: "AAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  truehd: "TrueHD",
};

function codecLabel(codec: string | null): string {
  if (!codec) return "unknown";
  if (codec.startsWith("pcm-")) return `PCM (${codec.slice(4)})`;
  return CODEC_LABELS[codec] ?? codec.toUpperCase();
}

async function canTranscodeToAac(
  mb: typeof import("mediabunny"),
  track: import("mediabunny").InputAudioTrack,
): Promise<boolean> {
  if (typeof AudioDecoder === "undefined" || typeof AudioEncoder === "undefined") {
    return false;
  }
  try {
    return await mb.canEncodeAudio("aac", {
      numberOfChannels: await track.getNumberOfChannels(),
      sampleRate: await track.getSampleRate(),
    });
  } catch {
    return false;
  }
}

type Write = {
  start: number;
  end: number;
  blob: Blob;
};

type Piece = {
  start: number;
  blob: Blob;
  offset: number;
  length: number;
};

/**
 * StreamTarget writes at byte offsets and may patch earlier regions (e.g. box
 * sizes at finalize). Later writes win; the surviving ranges are stitched into
 * one Blob with cheap Blob slices instead of holding a second full copy in the
 * JS heap.
 */
function assembleMp4(writes: Write[]): Blob {
  if (writes.length === 0) {
    throw new MkvPreparationError(GENERIC_FAILURE);
  }

  const pieces: Piece[] = [];
  const covered: Array<{ start: number; end: number }> = [];

  for (let i = writes.length - 1; i >= 0; i -= 1) {
    const write = writes[i];
    let remaining = [{ start: write.start, end: write.end }];

    for (const cover of covered) {
      if (remaining.length === 0) break;
      const next: typeof remaining = [];
      for (const range of remaining) {
        if (cover.end <= range.start || cover.start >= range.end) {
          next.push(range);
          continue;
        }
        if (cover.start > range.start) {
          next.push({ start: range.start, end: cover.start });
        }
        if (cover.end < range.end) {
          next.push({ start: cover.end, end: range.end });
        }
      }
      remaining = next;
    }

    for (const range of remaining) {
      pieces.push({
        start: range.start,
        length: range.end - range.start,
        blob: write.blob,
        offset: range.start - write.start,
      });
    }

    covered.push({ start: write.start, end: write.end });
    covered.sort((a, b) => a.start - b.start);
    for (let j = covered.length - 1; j > 0; j -= 1) {
      const previous = covered[j - 1];
      const current = covered[j];
      if (previous.end >= current.start) {
        previous.end = Math.max(previous.end, current.end);
        covered.splice(j, 1);
      }
    }
  }

  pieces.sort((a, b) => a.start - b.start);

  const parts: BlobPart[] = [];
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.start > cursor) {
      parts.push(new Uint8Array(piece.start - cursor));
    }
    parts.push(piece.blob.slice(piece.offset, piece.offset + piece.length));
    cursor = piece.start + piece.length;
  }

  return new Blob(parts, { type: "video/mp4" });
}

export type MkvPreparationOptions = {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
};

export async function prepareMkvForPlayback(
  file: File,
  options: MkvPreparationOptions = {},
): Promise<Blob> {
  const { onProgress, signal } = options;

  if (signal?.aborted) {
    throw new MkvPreparationError(CANCELED_MESSAGE);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new MkvPreparationError(
      "This MKV is too large to repackage in the browser (over 4 GB). " +
        CONVERT_HINT,
    );
  }
  if (typeof VideoDecoder === "undefined") {
    throw new MkvPreparationError(
      "This browser is too old to repackage MKV files. Update it, or " +
        CONVERT_HINT,
    );
  }

  const mb = await import("mediabunny");
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: new mb.BlobSource(file),
  });

  let conversion: Conversion | null = null;
  const onAbort = () => {
    void conversion?.cancel();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (!(await input.canRead())) {
      throw new MkvPreparationError(
        "This file could not be read as a video. It may be damaged or incomplete.",
      );
    }

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new MkvPreparationError("This file has no video track.");
    }

    const videoCodec = await videoTrack.getCodec();
    if (!videoCodec || !(await videoTrack.canDecode())) {
      throw new MkvPreparationError(
        videoCodec
          ? `This MKV's video codec (${codecLabel(videoCodec)}) cannot be decoded by this browser. ${CONVERT_HINT}`
          : `This MKV's video codec is not recognised by this browser. ${CONVERT_HINT}`,
      );
    }

    const audioTrack = await input.getPrimaryAudioTrack();
    let audioCodec: string | null = null;
    let audioOptions: ConversionAudioOptions | undefined;

    if (audioTrack) {
      audioCodec = await audioTrack.getCodec();
      if (!audioCodec || UNDECODABLE_AUDIO_CODECS.has(audioCodec)) {
        throw new MkvPreparationError(
          `This MKV's audio track (${codecLabel(audioCodec)}) cannot be decoded by this browser. ${CONVERT_HINT}`,
        );
      }
      if (TRANSCODE_AUDIO_CODECS.has(audioCodec)) {
        audioOptions = (await canTranscodeToAac(mb, audioTrack))
          ? { codec: "aac" }
          : undefined;
      }
    }

    if (signal?.aborted) {
      throw new MkvPreparationError(CANCELED_MESSAGE);
    }

    const writes: Write[] = [];
    const writable = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        writes.push({
          start: chunk.position,
          end: chunk.position + chunk.data.byteLength,
          blob: new Blob([chunk.data]),
        });
      },
    });

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: false }),
      target: new mb.StreamTarget(writable, {
        chunked: true,
        chunkSize: 8 * 1024 * 1024,
      }),
    });

    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      audio: audioOptions,
      copy: { mode: "preferred" },
      showWarnings: false,
    });

    if (signal?.aborted) {
      await conversion.cancel();
      throw new MkvPreparationError(CANCELED_MESSAGE);
    }

    const discardedVideo = conversion.discardedTracks.find(
      (entry) => entry.track === videoTrack,
    );
    if (discardedVideo) {
      throw new MkvPreparationError(
        `This MKV's video track (${codecLabel(videoCodec)}) cannot be repackaged for this browser. ${CONVERT_HINT}`,
      );
    }

    if (audioTrack) {
      const discardedAudio = conversion.discardedTracks.find(
        (entry) => entry.track === audioTrack,
      );
      if (discardedAudio) {
        throw new MkvPreparationError(
          `This MKV's audio track (${codecLabel(audioCodec)}) cannot be repackaged for this browser. ${CONVERT_HINT}`,
        );
      }
    }

    if (!conversion.isValid) {
      throw new MkvPreparationError(GENERIC_FAILURE);
    }

    conversion.onProgress = (progress) => {
      if (!signal?.aborted) {
        onProgress?.(progress);
      }
    };

    await conversion.execute();

    if (signal?.aborted) {
      throw new MkvPreparationError(CANCELED_MESSAGE);
    }

    return assembleMp4(writes);
  } catch (error) {
    if (
      signal?.aborted ||
      error instanceof mb.ConversionCanceledError ||
      (error instanceof MkvPreparationError &&
        error.message === CANCELED_MESSAGE)
    ) {
      throw new MkvPreparationError(CANCELED_MESSAGE);
    }
    if (error instanceof MkvPreparationError) {
      throw error;
    }
    throw new MkvPreparationError(GENERIC_FAILURE);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    input.dispose();
  }
}
