const VIDEO_EXTENSIONS = new Set([
  "3g2",
  "3gp",
  "amv",
  "asf",
  "avi",
  "divx",
  "dv",
  "f4v",
  "flv",
  "h264",
  "hevc",
  "ismv",
  "m2ts",
  "m2v",
  "m4v",
  "mk3d",
  "mkv",
  "mov",
  "mp4",
  "mpe",
  "mpeg",
  "mpg",
  "mts",
  "mxf",
  "nut",
  "ogm",
  "ogv",
  "qt",
  "rm",
  "rmvb",
  "ts",
  "vob",
  "webm",
  "wmv",
  "xvid",
]);

export const VIDEO_FILE_ACCEPT = [
  "video/*",
  ...Array.from(VIDEO_EXTENSIONS, (extension) => `.${extension}`),
].join(",");

const MKV_EXTENSIONS = new Set(["mkv", "mk3d"]);

export function videoExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Matroska files cannot be opened by browsers' <video> element, so they are
 * repackaged locally (see lib/mkv-remux.ts) before playback. Extension is the
 * primary signal because pickers often report no MIME type for MKV.
 */
export function isMkvFile(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "video/x-matroska" || type === "audio/x-matroska") return true;
  const extension = videoExtension(file.name);
  return extension !== null && MKV_EXTENSIONS.has(extension);
}

/**
 * File pickers on some platforms report no MIME type (or
 * application/octet-stream) for containers like MKV, so the extension is the
 * fallback. For containers the browser can open directly, its decoder remains
 * the final authority on playback.
 */
export function isLikelyVideoFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith("video/")) return true;
  const extension = videoExtension(file.name);
  return extension !== null && VIDEO_EXTENSIONS.has(extension);
}
