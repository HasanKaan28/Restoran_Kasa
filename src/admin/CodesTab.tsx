import { Check, Copy, MessageCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Button, ChoiceGroup, SelectField, TextField } from '@/design';
import { whatsAppShareUrl } from '@/domain/whatsapp';
import type { ActivationCode, OperatorApi } from './api';
import { codeMessage, dayText, MAX_DAYS, PERIODS, periodLabel, PLANS, type PlanId } from './model';

/** A sold period in days, or a number of days typed in. */
type Period = number | 'custom';

type Issued = { code: string; plan: PlanId; days: number };

const failed = (error: unknown) =>
  error instanceof Error ? error.message : 'Bağlantı kurulamadı.';

/** A new code for a restaurant, sent on WhatsApp, and the latest codes with what became of each. */
export function CodesTab({ api }: { api: OperatorApi }): JSX.Element {
  const [codes, setCodes] = useState<ActivationCode[]>();
  const [listError, setListError] = useState<string>();
  const [issued, setIssued] = useState<Issued>();

  // Bumped to read the list again: after a new code, a revoke, or "Yenile".
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((now) => now + 1);

  useEffect(() => {
    let live = true;
    api.listCodes().then(
      (list) => {
        if (live) {
          setCodes(list);
          setListError(undefined);
        }
      },
      (error: unknown) => live && setListError(failed(error)),
    );
    return () => {
      live = false;
    };
  }, [api, version]);

  return (
    <>
      <section aria-labelledby="new-code" className="flex flex-col gap-4">
        <h2 id="new-code" className="text-title font-semibold">
          Yeni kurulum kodu
        </h2>
        <IssueForm
          api={api}
          onIssued={(next) => {
            setIssued(next);
            reload();
          }}
        />
        {issued ? <IssuedCode issued={issued} /> : null}
      </section>

      <section aria-labelledby="recent-codes" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="recent-codes" className="text-label font-semibold">
            Son kodlar
          </h2>
          <Button variant="ghost" className="ml-auto" onClick={reload}>
            Yenile
          </Button>
        </div>
        {listError ? (
          <p role="alert" className="font-medium text-danger">
            {listError}
          </p>
        ) : null}
        {codes === undefined && !listError ? (
          <p role="status" className="text-text-2">
            Yükleniyor…
          </p>
        ) : null}
        {codes?.length === 0 ? <p className="text-text-2">Henüz kod üretilmedi.</p> : null}
        {codes && codes.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {codes.map((code) => (
              <CodeRow key={code.code} code={code} api={api} onChanged={reload} />
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

function IssueForm({
  api,
  onIssued,
}: {
  api: OperatorApi;
  onIssued(issued: Issued): void;
}): JSX.Element {
  const [plan, setPlan] = useState<PlanId>('restoran');
  const [period, setPeriod] = useState<Period>(365);
  const [customDays, setCustomDays] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const days = period === 'custom' ? Number(customDays) : period;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      setError(`Süre 1 ile ${MAX_DAYS} gün arasında olmalı.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const code = await api.issueCode(plan, days, note);
      onIssued({ code, plan, days });
      setNote('');
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-plate border border-line bg-surface p-4"
      onSubmit={(event) => void submit(event)}
    >
      <SelectField
        label="Paket"
        value={plan}
        onChange={(event) => setPlan(event.target.value as PlanId)}
        options={PLANS.map((item) => ({ value: item.id, label: `${item.name} · ${item.devices}` }))}
      />
      <ChoiceGroup<Period>
        legend="Süre"
        name="period"
        wrap
        value={period}
        onChange={setPeriod}
        options={[
          ...PERIODS.map((item) => ({ value: item.days, label: item.label })),
          { value: 'custom', label: 'Özel' },
        ]}
      />
      {period === 'custom' ? (
        <TextField
          label="Gün sayısı"
          type="number"
          inputMode="numeric"
          required
          value={customDays}
          onChange={(event) => setCustomDays(event.target.value)}
        />
      ) : null}
      <TextField
        label="Not"
        hint="Kimin için: restoran adı, şehir, telefon. İsteğe bağlı."
        maxLength={200}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        Kod üret
      </Button>
    </form>
  );
}

function IssuedCode({ issued }: { issued: Issued }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const plan = PLANS.find((item) => item.id === issued.plan)?.name ?? issued.plan;

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, an insecure page): the code stays on screen to copy by hand.
    }
  }

  return (
    <div
      role="status"
      aria-label="Üretilen kod"
      className="slip edge-open flex animate-pop-in flex-col gap-3 p-4"
    >
      <p className="text-sm text-text-2">
        {plan} · {periodLabel(issued.days)}
      </p>
      <p className="font-mono text-[clamp(1.35rem,6.4vw,2rem)] leading-tight font-medium tracking-wide break-all select-all">
        {issued.code}
      </p>
      {/* On a phone the two stack, sending first: that is what the seller came for. */}
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <a
          href={whatsAppShareUrl(codeMessage(issued.code))}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-transparent bg-accent px-4 font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          <MessageCircle aria-hidden="true" size={18} strokeWidth={1.75} />
          WhatsApp’ta gönder
        </a>
        <Button
          onClick={() => void copy()}
          icon={
            copied ? (
              <Check aria-hidden="true" size={18} strokeWidth={1.75} />
            ) : (
              <Copy aria-hidden="true" size={18} strokeWidth={1.75} />
            )
          }
        >
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </Button>
      </div>
    </div>
  );
}

const STATUS: Record<ActivationCode['status'], { label: string; edge: string; chip: string }> = {
  unused: { label: 'Kullanılmadı', edge: 'edge-open', chip: 'bg-accent/12 text-accent' },
  used: { label: 'Kullanıldı', edge: 'edge-ready', chip: 'bg-success-bg text-success' },
  revoked: { label: 'İptal', edge: 'edge-quiet', chip: 'bg-bg text-text-2' },
};

function CodeRow({
  code,
  api,
  onChanged,
}: {
  code: ActivationCode;
  api: OperatorApi;
  onChanged(): void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const status = STATUS[code.status];

  async function revoke() {
    setBusy(true);
    setError(undefined);
    try {
      await api.revokeCode(code.code);
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className={`slip ${status.edge} flex flex-col gap-1.5 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-body font-medium tracking-wide">{code.code}</span>
        <span className={`rounded-chip px-2.5 py-0.5 text-meta font-semibold ${status.chip}`}>
          {code.status === 'used' && code.marketName
            ? `${status.label} · ${code.marketName}`
            : status.label}
        </span>
      </div>
      <p className="text-sm text-text-2">
        {code.planName} · {periodLabel(code.days)} · {dayText(code.createdAt)}
      </p>
      {code.note ? <p className="text-sm">{code.note}</p> : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {code.status === 'unused' ? (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm">Bu kod iptal edilsin mi?</span>
              <Button variant="danger" disabled={busy} onClick={() => void revoke()}>
                İptal et
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Vazgeç
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="-ml-2" onClick={() => setConfirming(true)}>
              İptal et…
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
