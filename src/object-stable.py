# Python dict is the analogous keyed container; this does not measure JS shapes.
def benchmark_workload():
    keys = ["a", "b", "c", "d", "e", "f", "g", "h"]
    objects = []
    i = 0
    while i < 256:
        objects.append({"a": 0, "b": 0, "c": 0, "d": 0, "e": 0, "f": 0, "g": 0, "h": 0})
        i += 1
    checksum = 0
    i = 0
    while i < 200000:
        obj = objects[i % 256]
        key = keys[(i // 256) % 8]
        obj[key] = i % 1024
        checksum += obj[key]
        obj[key] = 0
        if key not in obj or obj[key] == 0:
            checksum += 1
        i += 1
    return checksum


print(benchmark_workload())
