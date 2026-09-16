const RECORD_COUNT = 1000;
const ITERATIONS = 100;

// Generate deterministic input without depending on filesystem or random APIs.
const records = [];
for (let i = 0; i < RECORD_COUNT; i++) {
  records.push({ id: i, name: "item-" + i, amount: i % 100, active: i % 2 === 0 });
}
const input = JSON.stringify(records);

let checksum = 0;
for (let iteration = 0; iteration < ITERATIONS; iteration++) {
  const parsed = JSON.parse(input);
  const selected = [];
  let total = 0;
  for (let i = 0; i < parsed.length; i++) {
    const record = parsed[i];
    if (record.active) {
      total += record.amount;
      selected.push({ id: record.id, label: record.name.toUpperCase() });
    }
  }
  const output = JSON.stringify({ total: total, items: selected });
  checksum += output.length;
}

// Make the result observable, with only one console write per process.
console.log(checksum);
