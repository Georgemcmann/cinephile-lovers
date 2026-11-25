"use client";

import { useEffect, useRef } from "react";

import { usePersistentVideo } from "@/components/persistent-layer";

/**
 * TEMPORARY verification harness (deleted after the E2E check). Loads
 * /sample.mkv through the real persistent layer and exposes the resulting
 * state/result on window for the CDP driver.
 */
export default function MkvHarnessPage() {
  const { state, loadLocalFile } = usePersistentVideo();
  const startedRef = useRef(false);
  const reportedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const response = await fetch("/sample.mkv");
        const buffer = await response.arrayBuffer();
        const file = new File([buffer], "sample.mkv", {
          type: "video/x-matroska",
        });
        loadLocalFile(file);
      } catch (error) {
        (window as unknown as Record<string, unknown>).__mkvTest = {
          ok: false,
          error: String(error),
        };
      }
    })();
  }, [loadLocalFile]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__mkvState = state;
    const video = document.querySelector("video");
    const result = {
      ok: state.status === "ready",
      status: state.status,
      fileName: state.fileName,
      fileSize: state.fileSize,
      duration: state.duration,
      progress: state.progress,
      error: state.error,
      playing: state.playing,
      currentTime: state.currentTime,
      resumeNeeded: state.resumeNeeded,
      isBlob: Boolean(video?.currentSrc.startsWith("blob:")),
      readyState: video?.readyState ?? null,
    };
    if ((state.status === "ready" || state.status === "error") && !reportedRef.current) {
      if (state.status === "error" || video?.readyState === 1) {
        reportedRef.current = true;
        (window as unknown as Record<string, unknown>).__mkvTest = result;
      }
    }
  }, [state]);

  return <pre id="harness">{JSON.stringify(state, null, 2)}</pre>;
}
