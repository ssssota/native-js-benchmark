# Ruby Hash is the analogous keyed container; this does not measure JS shapes.
def benchmark_workload
  keys = ["a", "b", "c", "d", "e", "f", "g", "h"]
  objects = []
  i = 0
  while i < 256
    objects << {"a" => 0, "b" => 0, "c" => 0, "d" => 0, "e" => 0, "f" => 0, "g" => 0, "h" => 0}
    i += 1
  end
  checksum = 0
  i = 0
  while i < 200000
    object = objects[i % 256]
    key = keys[(i / 256) % 8]
    object[key] = i % 1024
    checksum += object[key]
    object[key] = 0
    object_value = object[key]
    if object_value.nil? || object_value == 0
      checksum += 1
    end
    i += 1
  end
  checksum
end

puts benchmark_workload
