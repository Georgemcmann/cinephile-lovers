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

export function videoExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * File pickers on some platforms report no MIME type (or
 * application/octet-stream) for containers like MKV, so the extension is the
 * fallback. The browser's decoder remains the final authority on playback.
 */
export function isLikelyVideoFile(file: File): boolean {
  if (file.type.toLowerCase().startsWith("video/")) return true;
  const extension = videoExtension(file.name);
  return extension !== null && VIDEO_EXTENSIONS.has(extension);
}
