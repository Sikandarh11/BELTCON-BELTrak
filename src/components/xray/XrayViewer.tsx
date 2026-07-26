import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { XrayScan } from "@/types/xray";
import { XrayEmptyState } from "./XrayEmptyState";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const ROTATION_STEP = 90;

interface XrayViewerProps {
  bagId: string;
  scan: XrayScan;
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not supplied";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
}

export function XrayViewer({ bagId, scan }: XrayViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [imageLoadError, setImageLoadError] = useState(false);
  const activeImage = scan.images[activeIndex] ?? scan.images[0];

  useEffect(() => {
    setActiveIndex(0);
    setZoom(1);
    setRotation(0);
    setImageLoadError(false);
  }, [bagId, scan.id, scan.updatedAt]);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setImageLoadError(false);
  }, [activeImage?.id]);

  if (!activeImage) {
    return (
      <XrayEmptyState
        kind="failed"
        title="Scan contains no image views"
        description="HBSS marked this scan available but did not provide a usable image."
        showManualInspectionWarning
      />
    );
  }

  function resetTransform() {
    setZoom(1);
    setRotation(0);
  }

  return (
    <div className="bg-slate-950 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Current view</div>
          <div className="mt-0.5 text-[13px] font-medium">{activeImage.label}</div>
        </div>
        <div className="font-mono text-[12px] text-slate-300">
          {activeIndex + 1} / {scan.images.length}
        </div>
      </div>

      <div className="relative flex h-112 items-center justify-center overflow-hidden bg-slate-900 sm:h-128">
        {imageLoadError ? (
          <div className="flex flex-col items-center px-6 text-center">
            <ImageOff className="size-8 text-warning" aria-hidden="true" />
            <div className="mt-3 text-sm font-medium">Image view unavailable</div>
            <p className="mt-1 text-[12px] text-slate-400">
              The image URL could not be loaded. Select another view or retrieve the scan again.
            </p>
          </div>
        ) : (
          <img
            src={activeImage.url}
            alt={`${activeImage.label} for bag ${bagId}`}
            draggable={false}
            onLoad={() => setImageLoadError(false)}
            onError={() => setImageLoadError(true)}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
          />
        )}

        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/15 bg-slate-950/90 p-1 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
            disabled={activeIndex === 0}
            className="flex size-9 items-center justify-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Previous X-ray view"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
            className="flex size-9 items-center justify-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Zoom out"
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
            className="flex size-9 items-center justify-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Zoom in"
          >
            <ZoomIn className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setRotation((value) => value + ROTATION_STEP)}
            className="flex size-9 items-center justify-center rounded hover:bg-white/10"
            aria-label="Rotate X-ray clockwise"
          >
            <RotateCw className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={resetTransform}
            disabled={zoom === 1 && rotation === 0}
            className="flex size-9 items-center justify-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Reset X-ray view"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setActiveIndex((index) => Math.min(scan.images.length - 1, index + 1))}
            disabled={activeIndex === scan.images.length - 1}
            className="flex size-9 items-center justify-center rounded hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Next X-ray view"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-white/10 px-4 py-4 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Captured</dt>
          <dd className="mt-1">{formatTimestamp(scan.capturedAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Source</dt>
          <dd className="mt-1 font-mono">{scan.sourceSystem}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Threat type</dt>
          <dd className="mt-1">{scan.threatType ?? "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Threat level</dt>
          <dd className="mt-1">
            {scan.threatLevel === null ? "Not reported" : `${scan.threatLevel} / 5`}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Zoom</dt>
          <dd className="mt-1 font-mono">{Math.round(zoom * 100)}%</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Rotation</dt>
          <dd className="mt-1 font-mono">{rotation % 360}°</dd>
        </div>
      </dl>
    </div>
  );
}
