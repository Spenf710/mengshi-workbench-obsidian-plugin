/** 从开始日期起算工作日（开始日算第1天，跳过周六日） */
export function addWorkingDays(startStr: string, days: number): string {
  const d = new Date(startStr + 'T00:00:00');
  const dow0 = d.getDay();
  let added = (dow0 !== 0 && dow0 !== 6) ? 1 : 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
