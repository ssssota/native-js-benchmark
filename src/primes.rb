# Same trial division, bounds and expected count as primes.js.
def count_primes(limit)
  count = 0
  candidate = 2
  while candidate <= limit
    prime = true
    divisor = 2
    while divisor * divisor <= candidate
      if candidate % divisor == 0
        prime = false
        break
      end
      divisor += 1
    end
    count += 1 if prime
    candidate += 1
  end
  count
end

def benchmark_workload
  count_primes(100000)
end

puts benchmark_workload
