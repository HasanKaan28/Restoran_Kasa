import type { JSX } from 'react';
import { Logo } from '@/design';

/** A build without the server address has nothing to manage. */
export function ServerMissing(): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-plate border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <Logo className="size-11" />
          <h1 className="text-xl font-semibold">Restoran Kasa · Yönetim</h1>
        </div>
        <p role="alert" className="font-medium text-danger">
          Sunucu ayarlı değil: bu sürüm sunucu adresi olmadan derlenmiş.
        </p>
      </div>
    </main>
  );
}
