require "json"

def benchmark_workload
  records = []
  i = 0
  while i < 1000
    records << {"id" => i, "name" => "item-" + i.to_s, "amount" => i % 100, "active" => i % 2 == 0}
    i += 1
  end
  input = JSON.generate(records)
  checksum = 0
  iteration = 0
  while iteration < 100
    parsed = JSON.parse(input)
    selected = []
    total = 0
    i = 0
    while i < parsed.length
      record = parsed[i]
      if record["active"]
        total += record["amount"]
        selected << {"id" => record["id"], "label" => record["name"].upcase}
      end
      i += 1
    end
    output = JSON.generate({"total" => total, "items" => selected})
    checksum += output.length
    iteration += 1
  end
  checksum
end

puts benchmark_workload
