import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { openCashSession, tillToOpen } from '@/data/cash';
import { Button, Dialog, TextField, ToastRegion, useToast } from '@/design';
import { businessDate } from '@/domain/businessDate';
import { formatTRY } from '@/domain/money';
import { typedAmount } from './tender';

const DISMISSED_KEY = 'rk.tillPrompt';

/** "K1:2026-11-21": the register and the day the prompt was put off for. */
function dismissedFor(deviceCode: string, day: string): string {
  return `${deviceCode}:${day}`;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function saveDismissed(value: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Storage refused: the prompt comes back next time the floor opens, which is harmless.
  }
}

/**
 * The morning's first look at the floor: a register that starts the business day with its till
 * not open asks a person who closes the day for the cash put in it, so the Z counts it. It can be
 * put off for the day ("Şimdi değil"); a day already closed on this register is not asked about.
 */
export function TillOpenPrompt(): JSX.Element | null {
  const { db, settings, runner } = useData();
  const session = useSession();
  const { cutoffMinutes } = useMarketSettings();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const allowed = session.can('closeDay');
  const day = businessDate(new Date(), { cutoffMinutes });

  useEffect(() => {
    if (!allowed || readDismissed() === dismissedFor(settings.deviceCode, day)) {
      return;
    }
    let live = true;
    void (async () => {
      // A restaurant still being set up (no menu yet) is not asked about its till.
      const hasMenu = (await db.products.count()) > 0;
      const toOpen =
        hasMenu && (await tillToOpen(db, settings.deviceCode, new Date(), cutoffMinutes));
      if (live) {
        setAsking(toOpen);
      }
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [allowed, db, settings.deviceCode, cutoffMinutes, day]);

  function putOff() {
    saveDismissed(dismissedFor(settings.deviceCode, day));
    setAsking(false);
  }

  async function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = typedAmount(text);
    if (amount === null) {
      setError('Tutarı rakamla girin.');
      return;
    }
    setSaving(true);
    try {
      const opening = amount ?? 0;
      await openCashSession(
        db,
        { deviceCode: settings.deviceCode, openingCash: opening },
        new Date(),
      );
      setAsking(false);
      toast.show(`Kasa açıldı · ${formatTRY(opening)}`);
      void runner.run();
    } catch {
      // Opened meanwhile (another tab of the app): nothing more to ask.
      setAsking(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {asking ? (
        <Dialog
          open
          onOpenChange={(next) => !next && putOff()}
          title="Kasayı aç"
          description="Güne başlarken kasaya konan parayı girin; gün sonunda (Z) beklenen nakde eklenir."
        >
          <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void open(event)}>
            <TextField
              label="Açılış tutarı"
              hint="Boş bırakılırsa 0 sayılır."
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={text}
              error={error}
              onChange={(event) => {
                setText(event.target.value);
                setError(undefined);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="lg" disabled={saving}>
                Kasayı aç
              </Button>
              <Button variant="ghost" size="lg" onClick={putOff}>
                Şimdi değil
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      <ToastRegion message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </>
  );
}
