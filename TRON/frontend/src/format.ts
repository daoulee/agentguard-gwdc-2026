export const fmt = (value: number, digits = 2) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
export const usd = (value: number, digits = 2) => `$${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const pct = (value: number, digits = 2) => `${(value * 100).toFixed(digits)}%`;
export const time = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const shortAddress = (value: string) => (value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value);
