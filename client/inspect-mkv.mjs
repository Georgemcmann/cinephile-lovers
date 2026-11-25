import { readFile } from "node:fs/promises";
import { Input, ALL_FORMATS, BlobSource } from "mediabunny";

const data = await readFile(process.argv[2]);
const file = new File([data], "sample.mkv", { type: "video/x-matroska" });
const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
console.log("canRead:", await input.canRead());
const format = await input.getFormat();
console.log("format:", format.name, format.mimeType);
const video = await input.getPrimaryVideoTrack();
const audio = await input.getPrimaryAudioTrack();
console.log("video:", video ? await video.getCodec() : null);
console.log("audio:", audio ? await audio.getCodec() : null);
console.log("duration:", await input.computeDuration());
const tracks = await input.getTracks();
console.log("tracks:", tracks.length);
input.dispose();
