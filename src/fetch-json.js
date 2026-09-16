async function fetchJsonWorkload() {
  const response = await fetch("http://127.0.0.1:31337/data");
  if (!response.ok) throw new Error("HTTP request failed");
  const records = await response.json();
  const selected = [];
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
