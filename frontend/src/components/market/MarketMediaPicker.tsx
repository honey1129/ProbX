"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { ImagePlus, Link2, Loader2, UploadCloud, X } from "lucide-react";
import { isBackendApiConfigured, uploadBackendMedia } from "@/lib/backendApi";

type MarketMediaPickerProps = {
  value: string;
  onChange: (value: string) => void;
};

const maxInputBytes = 5 * 1024 * 1024;
const targetPayloadLength = 340_000;
const outputSize = 512;

export function MarketMediaPicker({ value, onChange }: MarketMediaPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const trimmed = value.trim();
  const hasMedia = Boolean(trimmed);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setFileInfo(null);

    if (!file.type.startsWith("image/")) {
      setMessage("Please choose an image file.");
      return;
    }
    if (file.size > maxInputBytes) {
      setMessage("Image is too large. Please choose a file under 5 MB.");
      return;
    }

    setIsProcessing(true);
    try {
      const processed = await imageToMedia(file);
      if (isBackendApiConfigured()) {
        try {
          const uploaded = await uploadBackendMedia(processed.blob, processed.filename);
          onChange(uploaded.url);
          setFileInfo(`${file.name} · ${formatBytes(file.size)} · uploaded`);
          return;
        } catch {
          // Keep the media usable even if the API upload endpoint is unavailable.
        }
      }
      onChange(processed.dataUrl);
      setFileInfo(`${file.name} · ${formatBytes(file.size)} · embedded`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not process image.");
    } finally {
      setIsProcessing(false);
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void handleFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div className="grid gap-3 rounded-lg border border-line bg-black/25 p-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`grid grid-cols-[112px_minmax(0,1fr)] gap-4 rounded-lg border p-3 transition ${
          isDragging ? "border-solBlue/70 bg-solBlue/10" : "border-line bg-slate-950/35"
        }`}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="grid h-28 w-28 place-items-center overflow-hidden rounded-lg border border-line bg-slate-950/70 text-solPurple transition hover:border-solPurple/50"
          aria-label="Upload market image"
        >
          {hasMedia ? (
            <img src={trimmed} alt="" className="h-full w-full object-cover" />
          ) : isProcessing ? (
            <Loader2 size={26} className="animate-spin" />
          ) : (
            <ImagePlus size={28} />
          )}
        </button>

        <div className="grid min-w-0 content-center gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isProcessing}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-solPurple/45 bg-solPurple/15 px-3 text-sm font-black text-violet-100 transition hover:bg-solPurple/25 disabled:opacity-60"
            >
              {isProcessing ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              {isProcessing ? "Processing" : "Upload Image"}
            </button>
            {hasMedia ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setFileInfo(null);
                  setMessage(null);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-bold text-muted transition hover:border-no/45 hover:text-no"
              >
                <X size={15} /> Remove
              </button>
            ) : null}
          </div>
          <p className="text-xs text-muted">Click or drop an image here. Large images are resized before saving.</p>
          {fileInfo ? <p className="truncate text-xs text-yes">{fileInfo}</p> : null}
        </div>
      </div>

      <label className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-line bg-black/35 px-3">
        <Link2 size={15} className="shrink-0 text-muted" />
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setFileInfo(null);
            setMessage(null);
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-muted"
          placeholder="https://... or uploaded image data"
        />
      </label>

      <input ref={inputRef} type="file" accept="image/*" onChange={handleInput} className="hidden" />
      {message ? <p className="rounded-md border border-no/30 bg-no/10 px-3 py-2 text-xs text-no">{message}</p> : null}
    </div>
  );
}

async function imageToMedia(file: File) {
  if (file.type === "image/svg+xml") {
    const svg = await readFileAsDataUrl(file);
    if (svg.length > targetPayloadLength) throw new Error("SVG payload is too large. Please use a smaller image.");
    return {
      dataUrl: svg,
      blob: file,
      filename: safeFilename(file.name, ".svg")
    };
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, outputSize / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= targetPayloadLength) {
      return {
        dataUrl,
        blob: dataUrlToBlob(dataUrl),
        filename: safeFilename(file.name.replace(/\.[^.]+$/, ""), ".jpg")
      };
    }
  }
  throw new Error("Image is still too large after compression.");
}

function dataUrlToBlob(dataUrl: string) {
  const [header, payload] = dataUrl.split(",");
  const contentType = header.match(/^data:(.*?);base64$/)?.[1] || "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: contentType });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function safeFilename(name: string, extension: string) {
  const base = name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "market-image";
  return `${base}${extension}`;
}
