import React from 'react';
import { BibColor } from '../domain/types';
import { BIB_COLOR_MAP, formatBibLabel } from '../domain/utils';

interface BibBadgeProps {
  color: BibColor;
  number: number;
  size?: 'sm' | 'md' | 'lg';
  showColorName?: boolean;
}

export const BibBadge: React.FC<BibBadgeProps> = ({
  color,
  number,
  size = 'md',
  showColorName = true,
}) => {
  const meta = BIB_COLOR_MAP[color];
  const label = formatBibLabel(color, number);

  return (
    <span
      className={`bib-badge bib-badge--${size}`}
      style={{
        backgroundColor: meta.bgHex,
        color: meta.textHex,
        borderColor: meta.borderHex,
      }}
      aria-label={`Nomor Bib ${label} Warna ${meta.nameId} ${number}`}
    >
      <span className="bib-badge__code">{label}</span>
      {showColorName && <span className="bib-badge__name">{meta.nameId}</span>}
    </span>
  );
};
