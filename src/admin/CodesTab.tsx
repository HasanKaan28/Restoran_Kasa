import { MessageCircle, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Button, ChoiceGroup, SelectField, TextField } from '@/design';
import { whatsAppShareUrl } from '@/domain/whatsapp';
import type { ActivationCode, CodeStatus, OperatorApi } from './api';
import { codeMessage, dayText, MAX_DAYS, PERIODS, periodLabel, PLANS, type PlanId } from './model';
import { failed, useLoad } from './load';
import { Alert, CopyButton, Loading } from './ui';

/** A sold period in days, or a number of days typed in. */
type Period = number | 'custom';

type Issued = { codes: string[]; plan: PlanId; days: number };

/** How long the search waits after the last key before it asks the server. */
const SEARCH_DELAY_MS = 300;
const MAX_BULK = 50;

type StatusFilter = CodeStatus | 'all';

/**
 * New codes for restaurants, sent on WhatsApp or copied in bulk, and the latest codes with what
 * became of each, filtered by state or searched by note.
 */
export function CodesTab({ api }: { api: OperatorApi }): JSX.Element {
  const [issued, setIssued] = useState<Issued>();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const {
    data: codes,
    error,
    reload,
  } = useLoad(
    () => api.listCodes({ status: status === 'all' ? null : status, search }),
    `codes:${status}:${search}`,
  );

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
        {issued ? <IssuedCodes issued={issued} /> : null}
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
        <ChoiceGroup<StatusFilter>
          legend="Durum"
          hideLegend
          name="code-status"
          variant="chips"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Tümü' },
            { value: 'unused', label: 'Kullanılmadı' },
            { value: 'used', label: 'Kullanıldı' },
            { value: 'revoked', label: 'İptal' },
          ]}
        />
        <div className="relative">
          <TextField
            label="Notta ara"
            type="search"
            placeholder="Restoran, şehir, telefon"
            className="w-full pl-10"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Search
            aria-hidden="true"
            size={18}
            className="pointer-events-none absolute bottom-[15px] left-3.5 text-muted"
          />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {codes === undefined && !error ? <Loading /> : null}
        {codes?.length === 0 ? (
          <p className="text-text-2">
            {status === 'all' && search === '' ? 'Henüz kod üretilmedi.' : 'Uyan kod yok.'}
          </p>
        ) : null}
        {codes && codes.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-text-2">{`${codes.length} kod`}</p>
              <CopyButton
                variant="ghost"
                className="ml-auto"
                label="Listedekileri kopyala"
                text={codes.map(codeLine).join('\n')}
              />
            </div>
            <ul className="flex flex-col gap-2">
              {codes.map((code) => (
                <CodeRow key={code.code} code={code} api={api} onChanged={reload} />
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  );
}

/** One code as a line of text: the code, then its note when it has one. */
function codeLine(code: ActivationCode): string {
  return code.note ? `${code.code} · ${code.note}` : code.code;
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
  const [count, setCount] = useState('1');
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
    const many = Number(count);
    if (!Number.isInteger(many) || many < 1 || many > MAX_BULK) {
      setError(`Adet 1 ile ${MAX_BULK} arasında olmalı.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const codes =
        many === 1
          ? [await api.issueCode(plan, days, note)]
          : await api.issueCodes(plan, days, note, many);
      onIssued({ codes, plan, days });
      setNote('');
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  const many = Number(count) > 1;

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
      <div className="grid grid-cols-[6rem_1fr] gap-3">
        <TextField
          label="Adet"
          type="number"
          inputMode="numeric"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
        <TextField
          label="Not"
          hint="Kimin için: restoran adı, şehir, telefon. İsteğe bağlı."
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy}>
        {many ? `${Number(count)} kod üret` : 'Kod üret'}
      </Button>
    </form>
  );
}

function IssuedCodes({ issued }: { issued: Issued }): JSX.Element {
  const plan = PLANS.find((item) => item.id === issued.plan)?.name ?? issued.plan;
  const [first] = issued.codes;
  const single = issued.codes.length === 1 && first !== undefined;

  return (
    <div
      role="status"
      aria-label={single ? 'Üretilen kod' : 'Üretilen kodlar'}
      className="slip edge-open flex animate-pop-in flex-col gap-3 p-4"
    >
      <p className="text-sm text-text-2">
        {plan} · {periodLabel(issued.days)}
        {single ? '' : ` · ${issued.codes.length} kod`}
      </p>
      {single ? (
        <p className="font-mono text-[clamp(1.35rem,6.4vw,2rem)] leading-tight font-medium tracking-wide break-all select-all">
          {first}
        </p>
      ) : (
        <ol className="grid gap-1 font-mono text-body font-medium tracking-wide select-all sm:grid-cols-2">
          {issued.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
      )}
      {/* On a phone the two stack, sending first: that is what the seller came for. */}
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {single ? (
          <a
            href={whatsAppShareUrl(codeMessage(first))}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-transparent bg-accent px-4 font-semibold text-on-accent transition-colors hover:bg-accent-hover"
          >
            <MessageCircle aria-hidden="true" size={18} strokeWidth={1.75} />
            WhatsApp’ta gönder
          </a>
        ) : null}
        <CopyButton text={issued.codes.join('\n')} label={single ? 'Kopyala' : 'Tümünü kopyala'} />
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
      {error ? <Alert>{error}</Alert> : null}
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
