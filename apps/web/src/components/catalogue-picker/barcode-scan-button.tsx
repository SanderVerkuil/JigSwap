"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { detectBarcode } from "@/lib/catalogue-search";
import { cn } from "@/lib/utils";
import { ScanBarcode } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Camera barcode scanning for the catalogue searches, as a progressive enhancement: only where
// the browser has the native BarcodeDetector (Android Chrome, not iOS Safari or Firefox) and the
// device has a touch screen, so no library ships for anyone. A scan only fills the search box;
// the existing barcode lookup does the rest (and an unknown code offers "Register it" with the
// EAN/UPC filled in). Needs the page's Permissions-Policy to allow camera=(self).

// The formats on puzzle boxes that the catalogue stores (see detectBarcode).
const FORMATS = ["ean_13", "upc_a"];
const COARSE_POINTER = "(pointer: coarse)";

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorClass = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

// Not in the TypeScript DOM lib yet.
const barcodeDetector = (): BarcodeDetectorClass | undefined =>
  (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(COARSE_POINTER);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = () =>
  !!barcodeDetector() &&
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  window.matchMedia(COARSE_POINTER).matches;

// The server (and hydration) render never shows the button; the client snapshot adds it.
const getServerSnapshot = () => false;

export function BarcodeScanButton({
  onScan,
  className,
}: {
  onScan: (code: string) => void;
  className?: string;
}) {
  const t = useTranslations("cataloguePicker.scan");
  const supported = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [open, setOpen] = useState(false);
  if (!supported) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t("open")}
        title={t("open")}
        className={cn("size-9 shrink-0 pointer-coarse:size-11", className)}
        onClick={() => setOpen(true)}
      >
        <ScanBarcode aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open: closing the dialog unmounts it, which stops the camera. */}
          {open && (
            <BarcodeScanner
              onScan={(code) => {
                setOpen(false);
                onScan(code);
              }}
              onError={(error) => {
                setOpen(false);
                const denied =
                  error instanceof DOMException &&
                  (error.name === "NotAllowedError" ||
                    error.name === "SecurityError");
                toast.error(t(denied ? "denied" : "failed"));
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// The live back-camera preview and the detect loop: one detect per animation frame (never two at
// once) until a code with an EAN-13/UPC-A shape is seen. Every camera track is stopped on
// unmount and as soon as a code is found.
function BarcodeScanner({
  onScan,
  onError,
}: {
  onScan: (code: string) => void;
  onError: (error: unknown) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleScan = useEffectEvent(onScan);
  const handleError = useEffectEvent(onError);

  useEffect(() => {
    const Detector = barcodeDetector();
    const video = videoRef.current;
    if (!Detector || !video) return;
    const detector = new Detector({ formats: FORMATS });
    let stopped = false;
    let frame = 0;
    let stream: MediaStream | undefined;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const scan = async () => {
      if (stopped) return;
      try {
        const found = await detector.detect(video);
        const code = found
          .map((barcode) => detectBarcode(barcode.rawValue))
          .find((value) => value !== null);
        if (code && !stopped) {
          stop();
          handleScan(code);
          return;
        }
      } catch {
        // No frame to read yet: try the next one.
      }
      if (!stopped) frame = requestAnimationFrame(() => void scan());
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (media) => {
        stream = media;
        if (stopped) {
          stop();
          return;
        }
        video.srcObject = media;
        await video.play();
        frame = requestAnimationFrame(() => void scan());
      })
      .catch((error: unknown) => {
        if (stopped) return;
        stop();
        handleError(error);
      });

    return stop;
  }, []);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      aria-hidden
      className="aspect-[4/3] w-full rounded-md bg-black object-cover"
    />
  );
}
