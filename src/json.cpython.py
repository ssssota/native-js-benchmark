import json


def benchmark_workload():
    records = []
    i = 0
    while i < 1000:
        records.append({"id": i, "name": "item-" + str(i), "amount": i % 100, "active": i % 2 == 0})
        i += 1
    # Compact separators preserve the JS/Ruby byte length for this ASCII input.
    input_data = json.dumps(records, separators=(",", ":"))
    checksum = 0
    iteration = 0
    while iteration < 100:
        parsed = json.loads(input_data)
        selected = []
        total = 0
        i = 0
        while i < len(parsed):
            record = parsed[i]
            if record["active"]:
                total += record["amount"]
                selected.append({"id": record["id"], "label": record["name"].upper()})
            i += 1
        output = json.dumps({"total": total, "items": selected}, separators=(",", ":"))
        checksum += len(output)
        iteration += 1
    return checksum


print(benchmark_workload())
