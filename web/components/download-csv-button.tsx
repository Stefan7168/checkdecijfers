// WP21 #52: downloads a pre-built CSV as a client-side Blob — no server
// round-trip, nothing stored. Mirrors the stat card's failure honesty.
// Moved out of chat.tsx in session 126 (#318) so the own-data chart card
// (user-chart.tsx, over web/lib/user-csv.ts) shares the one button the CBS
// answer uses (over web/lib/csv.ts) rather than a second copy.
'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { Button } from './ui/button.tsx';

export function DownloadCsvButton({ csv }: { csv: { filename: string; content: string } }) {
  const [failed, setFailed] = useState(false);
  const t = useT();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => {
          try {
            const url = URL.createObjectURL(
              new Blob([csv.content], { type: 'text/csv;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = csv.filename;
            link.click();
            URL.revokeObjectURL(url);
          } catch {
            setFailed(true);
          }
        }}
      >
        <Download aria-hidden className="size-3.5" />
        {t('chat.downloadCsv')}
      </Button>
      {failed ? (
        <span className="text-xs text-destructive">{t('chat.downloadCsvFailed')}</span>
      ) : null}
    </>
  );
}
