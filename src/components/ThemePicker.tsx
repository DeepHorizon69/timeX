import { useState } from 'react';
import { setTheme, useTheme } from '../services/theme';

export function ThemePicker() {
  const theme = useTheme();
  const [saveFailed, setSaveFailed] = useState(false);
  return (
    <section className="card">
      <fieldset className="theme-picker">
        <legend>Tema tampilan</legend>
        <div className="theme-options">
          {(
            [
              { value: 'light', label: 'Terang' },
              { value: 'dark', label: 'Gelap' },
            ] as const
          ).map((option) => (
            <label key={option.value} className="theme-option">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setSaveFailed(!setTheme(option.value))}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {saveFailed && (
        <p className="helper-text" role="status">
          Tema diterapkan untuk sesi ini. Browser gagal menyimpan pilihan tema.
        </p>
      )}
    </section>
  );
}
