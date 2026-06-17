import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X, ZoomIn, ZoomOut } from 'lucide-react';

type Props = {
  file: File;
  title?: string;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
};

const VIEWPORT = 280;
const OUTPUT = 800;

export default function AvatarCropModal({
  file,
  title = 'Adjust profile photo',
  onCancel,
  onConfirm,
}: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    const image = new Image();
    image.onload = () => {
      const cover = Math.max(VIEWPORT / image.naturalWidth, VIEWPORT / image.naturalHeight);
      setScale(cover);
      setPan({
        x: (VIEWPORT - image.naturalWidth * cover) / 2,
        y: (VIEWPORT - image.naturalHeight * cover) / 2,
      });
      setImg(image);
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const clampPan = useCallback(
    (nextScale: number, nextPan: { x: number; y: number }) => {
      if (!img) return nextPan;
      const w = img.naturalWidth * nextScale;
      const h = img.naturalHeight * nextScale;
      const minX = Math.min(0, VIEWPORT - w);
      const minY = Math.min(0, VIEWPORT - h);
      return {
        x: Math.min(0, Math.max(minX, nextPan.x)),
        y: Math.min(0, Math.max(minY, nextPan.y)),
      };
    },
    [img],
  );

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !img) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan(clampPan(scale, {
      x: dragStart.current.panX + dx,
      y: dragStart.current.panY + dy,
    }));
  }

  function onPointerUp(e: React.PointerEvent) {
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function adjustZoom(delta: number) {
    if (!img) return;
    const next = Math.min(Math.max(scale + delta, 0.5), 4);
    setPan(clampPan(next, pan));
    setScale(next);
  }

  async function handleConfirm() {
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not process image');

      const srcX = -pan.x / scale;
      const srcY = -pan.y / scale;
      const srcSize = VIEWPORT / scale;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          b => (b ? resolve(b) : reject(new Error('Could not save crop'))),
          'image/jpeg',
          0.9,
        );
      });

      const base = file.name.replace(/\.[^.]+$/, '') || 'avatar';
      onConfirm(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div
            className="relative mx-auto rounded-2xl overflow-hidden bg-gray-950 border border-gray-700 touch-none cursor-grab active:cursor-grabbing"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {img && previewUrl && (
              <img
                src={previewUrl}
                alt=""
                draggable={false}
                className="absolute select-none max-w-none pointer-events-none"
                style={{
                  width: img.naturalWidth * scale,
                  height: img.naturalHeight * scale,
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                }}
              />
            )}
            <div className="absolute inset-0 ring-2 ring-inset ring-white/30 rounded-2xl pointer-events-none" />
          </div>

          <p className="text-gray-500 text-xs text-center">Drag to reposition. Pinch or use zoom controls.</p>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => adjustZoom(-0.15)}
              className="w-10 h-10 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition"
              aria-label="Zoom out"
            >
              <ZoomOut size={18} />
            </button>
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.05}
              value={scale}
              onChange={e => {
                const next = parseFloat(e.target.value);
                setPan(clampPan(next, pan));
                setScale(next);
              }}
              className="flex-1 accent-blue-500"
            />
            <button
              type="button"
              onClick={() => adjustZoom(0.15)}
              className="w-10 h-10 flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl transition"
              aria-label="Zoom in"
            >
              <ZoomIn size={18} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!img || busy}
            className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm transition"
          >
            <Check size={16} />
            {busy ? 'Saving...' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
