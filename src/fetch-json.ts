type RecordItem = { id: number; name: string; amount: number; active: boolean };
type SelectedItem = { id: number; label: string };

async function fetchJsonWorkload(): Promise<number> {
  const response = await fetch("http://127.0.0.1:31337/data");
  if (!response.ok) throw new Error("HTTP request failed");
  const records = (await response.json()) as RecordItem[];
  const selected: SelectedItem[] = [];
  let total = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.active) {
      total += record.amount;
      selected.push({ id: record.id, label: record.name.toUpperCase() });
    }
  }
  return JSON.stringify({ total: total, items: selected }).length;
}

fetchJsonWorkload().then((result) => console.log(result));
