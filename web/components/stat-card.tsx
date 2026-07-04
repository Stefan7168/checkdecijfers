// WP20 (open-questions #80): the stat card — a compact, visually separate
// rendering of a single validated number, plus "Download als afbeelding".
// The card IS an SVG, and the PNG export serializes THAT SAME NODE (via
// canvas at 2x), so the downloaded image structurally cannot drift from what
// was shown on screen. Dumb-renderer discipline (WP8 precedent): everything
// drawn here comes verbatim from StatCardData; the only transformation is
// display truncation of long labels.
'use client';

import { useRef, useState } from 'react';
import type { StatCardData } from '../lib/stat-card-data.ts';

/** Display-only truncation for the fixed card width. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const FONT = 'system-ui, -apple-system, sans-serif';

export function StatCard({ data }: { data: StatCardData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);

  function downloadPng(): void {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      setFailed(true);
    };
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 630;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        URL.revokeObjectURL(svgUrl);
        setFailed(true);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((png) => {
        if (png === null) {
          setFailed(true);
          return;
        }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(png);
        link.download = `checkdecijfers-${data.tableId}.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      }, 'image/png');
    };
    image.src = svgUrl;
  }

  // '%' hugs the number (CBS style); other units get a space.
  const unitText = data.unit === '%' ? '%' : ` ${data.unit}`;

  return (
    <div className="mb-2 inline-block max-w-full">
      <svg
        ref={svgRef}
        width={600}
        height={315}
        viewBox="0 0 600 315"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={`${data.measureTitle}: ${data.value}${unitText}`}
        className="h-auto w-full max-w-[420px] rounded border border-zinc-200"
      >
        <rect x="0" y="0" width="600" height="315" fill="#ffffff" />
        <text x="32" y="56" fontFamily={FONT} fontSize="22" fill="#52525b">
          {truncate(data.measureTitle, 46)}
        </text>
        {data.provisional ? (
          <g>
            <rect x="472" y="28" width="96" height="34" rx="6" fill="#fef3c7" />
            <text x="520" y="51" fontFamily={FONT} fontSize="17" fill="#b45309" textAnchor="middle">
              voorlopig
            </text>
          </g>
        ) : null}
        <text x="32" y="170" fontFamily={FONT} fontSize="76" fontWeight="700" fill="#18181b">
          {data.value}
          <tspan fontSize="30" fontWeight="400" fill="#52525b">
            {unitText}
          </tspan>
        </text>
        {data.context !== '' ? (
          <text x="32" y="218" fontFamily={FONT} fontSize="22" fill="#52525b">
            {truncate(data.context, 48)}
          </text>
        ) : null}
        <text x="32" y="284" fontFamily={FONT} fontSize="15" fill="#a1a1aa">
          {`CBS StatLine · tabel ${data.tableId} · gesynchroniseerd ${data.syncedDate} · checkdecijfers.nl`}
        </text>
      </svg>
      <div className="mt-1">
        <button
          type="button"
          onClick={downloadPng}
          className="text-xs text-zinc-400 underline"
        >
          Download als afbeelding
        </button>
        {failed ? <span className="ml-2 text-xs text-red-600">Downloaden lukte niet in deze browser.</span> : null}
      </div>
    </div>
  );
}
