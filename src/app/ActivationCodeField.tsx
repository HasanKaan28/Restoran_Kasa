import { useId, type JSX } from 'react';
import { typedActivationCode } from '@/domain/activationCode';

export type ActivationCodeFieldProps = {
  /** The twelve characters after RK-, grouped (ABCD-EFGH-JKMN). */
  value: string;
  onChange(next: string): void;
};

/**
 * The seller's one-time code. The field shows the RK- itself and keeps what is typed in capitals
 * and groups of four; a whole WhatsApp message can be pasted and the code is taken out of it.
 */
export function ActivationCodeField({ value, onChange }: ActivationCodeFieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-text">
        Kurulum kodu
      </label>
      <div className="flex min-h-touch items-center rounded-control border border-line-strong bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:focus-ring hover:border-text-2">
        <span aria-hidden="true" className="pl-3.5 font-mono text-base text-muted select-none">
          RK-
        </span>
        <input
          id={id}
          name="activation-code"
          aria-describedby={hintId}
          value={value}
          onChange={(event) => onChange(typedActivationCode(event.target.value))}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="XXXX-XXXX-XXXX"
          required
          className="min-w-0 flex-1 bg-transparent py-2 pr-3.5 pl-0.5 font-mono text-base tracking-wider text-text placeholder:text-muted focus-visible:outline-none"
        />
      </div>
      <p id={hintId} className="text-meta text-muted">
        Satıcınızın gönderdiği, RK- ile başlayan tek kullanımlık kod.
      </p>
    </div>
  );
}
