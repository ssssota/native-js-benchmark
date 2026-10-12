# Lython's JSON API uses tagged JSONValue trees instead of native dict/list.
# Keep the same records, transformations and checksum as json.cpython.py.
import json


def benchmark_workload():
    records: list[json.JSONValue] = []
    i = 0
    while i < 1000:
        records.append(json.obj_of(
            ["id", "name", "amount", "active"],
            [json.of_int(i), json.of_str("item-" + str(i)),
             json.of_int(i % 100), json.of_bool(i % 2 == 0)]))
        i += 1
    input_data = json.dumps(json.arr_of(records), separators=(",", ":"))
    checksum = 0
    iteration = 0
    while iteration < 100:
        parsed = json.loads(input_data)
        selected: list[json.JSONValue] = []
        total = 0
        i = 0
        while i < len(parsed):
            record = parsed.item(i)
            if record.get("active").as_bool():
                total += record.get("amount").as_int()
                selected.append(json.obj_of(
                    ["id", "label"],
                    [json.of_int(record.get("id").as_int()),
                     json.of_str(record.get("name").as_str().upper())]))
            i += 1
        output = json.dumps(json.obj_of(
            ["total", "items"], [json.of_int(total), json.arr_of(selected)]),
            separators=(",", ":"))
        checksum += len(output)
        iteration += 1
    return checksum


print(benchmark_workload())
