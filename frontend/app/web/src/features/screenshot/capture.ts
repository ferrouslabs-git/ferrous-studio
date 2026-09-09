// Getting a screenshot into the editor: from another browser tab, from a file,
// or from the clipboard.
//
// BROWSER REALITY. Only Chrome and Edge on the desktop let the user pick a
// *tab* in the getDisplayMedia picker. Firefox omits single-tab capture;
// Safari uses the system picker and ignores `displaySurface` entirely; no
// mobile browser implements getDisplayMedia at all. There is no better API
// coming -- getViewportMedia is still an unshipped draft, and it captures the
// *current* tab, which is the wrong tab for reporting a bug in another one.
// So capture is the good path, not the only path, and the file and clipboard
// routes below are what make this usable everywhere.
//
// Not unit tested: it is media, video and clipboard end to end. vitest here
// runs in node with no DOM.
import { captureScale, OUTPUT_MAX_EDGE } from "./model/output";

export type CaptureSource = "tab" | "file" | "clipboard";

export interface Captured {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  source: CaptureSource;
  /** What the user actually shared -- "browser", "window", "monitor". Undefined
   *  where the browser does not say. Lets the UI adapt its advice. */
  surface?: string;
}

/** Whether a screen grab is possible at all. False on every mobile browser. */
export function canCaptureScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Thrown for a failure worth telling the user about. A cancelled picker is
 *  not one of those -- captureScreen resolves null for that instead. */
export class CaptureError extends Error {}

/**
 * One still frame of whatever the user picks.
 *
 * MUST be called synchronously from a click handler: getDisplayMedia needs
 * transient activation, and Safari is strictest about it -- an `await` before
 * this line is enough to break it.
 *
 * Resolves null if the user cancels the picker.
 */
export async function captureScreen(maxEdge: number = OUTPUT_MAX_EDGE): Promise<Captured | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // Advisory only: it preselects Chrome's "Chrome Tab" pane and is ignored
      // elsewhere. It restricts nothing.
      video: { displaySurface: "browser" },
      audio: false,
    });
  } catch (err) {
    // NotAllowedError covers both "user cancelled" and "policy refused", and
    // the two are indistinguishable by design. Treat both as a cancel: a
    // banner after someone deliberately pressed Escape is noise.
    if (err instanceof DOMException && err.name === "NotAllowedError") return null;
    throw new CaptureError("Could not start the capture. Try choosing an image file instead.");
  }

  const track = stream.getVideoTracks()[0];
  // Read this before stopping the track, or the settings are gone.
  const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  const video = document.createElement("video");

  try {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await firstFrame(video, track);

    // The truth about resolution is on the element, not the track: on a 2x
    // display a 1280-CSS-px tab arrives as 2560 native and the two disagree.
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) {
      throw new CaptureError("The capture came back empty. Try again, or choose an image file.");
    }

    const full = await createImageBitmap(video);
    return { ...(await downscale(full, maxEdge)), source: "tab", surface };
  } finally {
    // Unconditional, including on every error path: otherwise the browser's
    // "sharing your screen" bar stays up long after we are done with it.
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  }
}

/**
 * Wait for a frame that has actually been composited.
 *
 * `loadedmetadata` guarantees the dimensions but not that anything has been
 * painted, and drawing too early is the classic way to save a black rectangle.
 * requestVideoFrameCallback is the precise signal; where it is missing, two
 * animation frames after metadata is a good enough proxy. Bounded, so a stream
 * that never produces a frame fails rather than hanging.
 */
function firstFrame(video: HTMLVideoElement, track: MediaStreamTrack | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new CaptureError(message));
    };

    const timer = setTimeout(() => fail("The capture did not produce an image in time."), 5000);
    // The user can press "Stop sharing" before we get anything.
    if (track) track.addEventListener("ended", () => fail("Sharing stopped before the screenshot was taken."));

    const withFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof withFrameCallback.requestVideoFrameCallback === "function") {
      withFrameCallback.requestVideoFrameCallback(() => done());
      return;
    }
    const afterMetadata = () => requestAnimationFrame(() => requestAnimationFrame(done));
    if (video.readyState >= 1) afterMetadata();
    else video.addEventListener("loadedmetadata", afterMetadata, { once: true });
  });
}

/** An image file the user chose, dropped, or pasted. */
export async function fromFile(file: File, maxEdge: number = OUTPUT_MAX_EDGE): Promise<Captured> {
  if (!file.type.startsWith("image/")) throw new CaptureError("That file is not an image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CaptureError("That image could not be read.");
  }
  return { ...(await downscale(bitmap, maxEdge)), source: "file" };
}

/**
 * The first image on a paste, or null if the paste held none.
 *
 * This is the fallback that carries Firefox and Safari, and on Windows
 * (Win+Shift+S) and macOS (Cmd+Ctrl+Shift+4) it is genuinely the fastest route
 * for anyone. Reads the event's own clipboardData rather than
 * navigator.clipboard.read(), which is Chromium-only in practice and prompts.
 */
export async function fromClipboardEvent(
  event: ClipboardEvent,
  maxEdge: number = OUTPUT_MAX_EDGE,
): Promise<Captured | null> {
  const items = Array.from(event.clipboardData?.items ?? []);
  const image = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
  const file = image?.getAsFile();
  if (!file) return null;
  return { ...(await fromFile(file, maxEdge)), source: "clipboard" };
}

/**
 * Bring a bitmap down to `maxEdge` once, here, at the moment of capture.
 *
 * Doing it now is what keeps everything downstream honest: afterwards the
 * bitmap, the SVG viewBox, every stored coordinate and the saved file all mean
 * the same pixels, and flatten() is a 1:1 draw. It also keeps a 4K grab from
 * sitting in memory for the whole editing session.
 */
async function downscale(bitmap: ImageBitmap, maxEdge: number): Promise<Omit<Captured, "source">> {
  const scale = captureScale(bitmap.width, bitmap.height, maxEdge);
  if (scale === 1) return { bitmap, width: bitmap.width, height: bitmap.height };

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    });
    bitmap.close();
    return { bitmap: resized, width, height };
  } catch {
    // resizeWidth is not universally honoured; the full-size bitmap is a
    // correct, if heavier, answer.
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
}
