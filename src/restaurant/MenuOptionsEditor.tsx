import type { JSX } from 'react';
import { Button, TextField } from '@/design';

export type PortionDraft = { label: string; price: string };
export type GroupDraft = { name: string; choices: string; required: boolean };

/**
 * A dish's portions (each at its own price) and the choices asked when it is ordered (a group
 * of choices, required or not). The plain portion is the product's own price.
 */
export function MenuOptionsEditor({
  portions,
  groups,
  error,
  onPortions,
  onGroups,
}: {
  portions: PortionDraft[];
  groups: GroupDraft[];
  error?: string;
  onPortions(next: PortionDraft[]): void;
  onGroups(next: GroupDraft[]): void;
}): JSX.Element {
  const setPortion = (index: number, patch: Partial<PortionDraft>) =>
    onPortions(portions.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const setGroup = (index: number, patch: Partial<GroupDraft>) =>
    onGroups(groups.map((item, at) => (at === index ? { ...item, ...patch } : item)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Porsiyonlar</p>
        <p className="text-sm text-text-2">
          Normal porsiyon yukarıdaki satış fiyatıdır. Yarım, 1,5, duble gibi diğerlerini fiyatıyla
          ekleyin; siparişte seçilir.
        </p>
        {portions.map((portion, index) => (
          <div
            key={index}
            role="group"
            aria-label={`Porsiyon ${index + 1}`}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="min-w-0 flex-[2_1_140px]">
              <TextField
                label="Porsiyon adı"
                autoComplete="off"
                value={portion.label}
                onChange={(event) => setPortion(index, { label: event.target.value })}
              />
            </div>
            <div className="w-32">
              <TextField
                label="Fiyatı"
                inputMode="decimal"
                autoComplete="off"
                value={portion.price}
                onChange={(event) => setPortion(index, { price: event.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              onClick={() => onPortions(portions.filter((_, at) => at !== index))}
            >
              Porsiyonu çıkar
            </Button>
          </div>
        ))}
        <div>
          <Button onClick={() => onPortions([...portions, { label: '', price: '' }])}>
            Porsiyon ekle
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Seçenekler</p>
        <p className="text-sm text-text-2">
          Siparişte sorulacaklar: acı, pişme derecesi, soğan. Zorunlu olan seçilmeden ürün eklenmez.
        </p>
        {groups.map((group, index) => (
          <div
            key={index}
            role="group"
            aria-label={`Seçenek grubu ${index + 1}`}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="w-36">
              <TextField
                label="Grup adı"
                autoComplete="off"
                value={group.name}
                onChange={(event) => setGroup(index, { name: event.target.value })}
              />
            </div>
            <div className="min-w-0 flex-[2_1_180px]">
              <TextField
                label="Seçenekler"
                hint="Virgülle ayırın: Acılı, Acısız"
                autoComplete="off"
                value={group.choices}
                onChange={(event) => setGroup(index, { choices: event.target.value })}
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={group.required}
                onChange={(event) => setGroup(index, { required: event.target.checked })}
                className="size-5 accent-accent"
              />
              Zorunlu
            </label>
            <Button
              variant="ghost"
              onClick={() => onGroups(groups.filter((_, at) => at !== index))}
            >
              Grubu çıkar
            </Button>
          </div>
        ))}
        <div>
          <Button onClick={() => onGroups([...groups, { name: '', choices: '', required: false }])}>
            Seçenek grubu ekle
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
