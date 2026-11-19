import { useState, type JSX } from 'react';
import { applyTheme, loadTheme, saveTheme, THEME_LABELS, type ThemeChoice } from '@/app/theme';
import { ChoiceGroup } from '@/design';
import { SettingsSection } from './MarketSections';

const OPTIONS = (['system', 'light', 'dark'] as const).map((value) => ({
  value,
  label: THEME_LABELS[value],
}));

/** Light or dark screen for this device; it applies at once and is not synced. */
export function AppearanceSection(): JSX.Element {
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());

  function choose(next: ThemeChoice) {
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  }

  return (
    <SettingsSection
      id="appearance-heading"
      title="Görünüm"
      description="Bu cihazın ekranı. Sistem, cihazın açık ya da koyu ayarını izler; koyu tema loş salonda gözü yormaz."
    >
      <ChoiceGroup legend="Tema" name="theme" options={OPTIONS} value={theme} onChange={choose} />
    </SettingsSection>
  );
}
